const mqtt = require('mqtt');

/**
 * Drop-in replacement for a socketcan RawChannel, backed by an open3e-esp32
 * gateway's raw MQTT topics instead of a local CAN interface.
 *
 * Implements only the subset of the RawChannel interface e3oncan actually
 * uses: addListener('onMessage' | 'onStopped', ...) and start()/stop(), plus
 * one gateway-only extra: 'onRecovered' (see evaluateHealth()). There is
 * deliberately no send() here - UDS reads/writes for a gateway bus go
 * through the separate REST-based udsGateway transport, never through this
 * channel, so nothing is expected to call it.
 *
 * Because lib/canCollect.js, main.js's onCanMsgExt()/onCanMsgInt() and the
 * ad-hoc listeners in lib/udsScan.js only depend on this event interface and
 * on the {id, data, ts_sec, ts_usec} message shape - never on socketcan
 * itself - all of that code runs unchanged against an instance of this class.
 */
class gatewayChannel {
    /**
     * @param {object} config  Gateway connection configuration
     * @param {string} config.brokerUrl  MQTT broker URL, e.g. mqtt://open3e-esp32.local
     * @param {string} [config.username]  MQTT username
     * @param {string} [config.password]  MQTT password
     * @param {string} [config.baseTopic]  Gateway's configured MQTT base topic
     *   (its /api/settings "mqtt.baseTopic", NOT the firmware default unless
     *   the user left that setting untouched), default 'open3e'
     * @param {string} [config.rawTopicPrefix]  Raw frame topic prefix, default
     *   `${baseTopic}/raw` - override only for a setup that deviates from the
     *   gateway's own `<baseTopic>/raw/<id>` convention
     * @param {{info: (msg: string) => void, warn: (msg: string) => void}} [config.log]
     *   Adapter logger. Without one, connect/fail is not logged - tests don't
     *   need to supply it.
     */
    constructor(config) {
        this.config = config;
        this.baseTopic = config.baseTopic || 'open3e';
        this.rawTopicPrefix = config.rawTopicPrefix || `${this.baseTopic}/raw`;
        this.client = null;
        this.started = false;
        this.stopped = false;
        // Set once evaluateHealth() has fired 'onStopped' for a recoverable
        // reason (broker/gateway link or CAN side unwell) - distinct from
        // `stopped`, which means a real, explicit stop() (adapter unload, a
        // deliberate reconnect). The MQTT client stays alive while merely
        // `unhealthy`, so LWT/status keep being observed and a later
        // recovery can still be detected - see evaluateHealth().
        this.unhealthy = false;
        this.listeners = { onMessage: [], onStopped: [], onRecovered: [] };
        this.mqttOnline = false;
        this.canRunning = false;
        // Set once a connect failure has been logged, so a broker that stays
        // unreachable does not spam a warning on every reconnect attempt
        // (mqtt.js retries once a second by default). Cleared on success.
        this.loggedConnectError = false;
        // LWT and status are two independent retained topics that can arrive
        // in either order (or with a delay between them) right after
        // subscribing. Health must not be judged from just one of them - an
        // unheard-from topic defaults to "unhealthy" above, which would
        // otherwise fire 'onStopped' on a perfectly healthy gateway simply
        // because the other retained message had not arrived yet.
        this.lwtKnown = false;
        this.statusKnown = false;
    }

    /**
     * Register an event listener. Mirrors socketcan RawChannel.addListener(),
     * including its "thisArg" convention: main.js passes the adapter instance
     * as thisArg so its listener methods see the right `this`, while
     * lib/udsScan.js's ad-hoc listeners are plain closures called with two
     * arguments and no thisArg.
     *
     * @param {string} event  'onMessage', 'onStopped' or 'onRecovered'
     * @param {(arg?: object | string) => void} listener  Callback function -
     *   receives the message object for 'onMessage', a human-readable reason
     *   string for 'onStopped', nothing for 'onRecovered'
     * @param {object} [thisArg]  Optional 'this' binding for the callback
     */
    async addListener(event, listener, thisArg) {
        if (!this.listeners[event]) {
            throw new Error('Event not supported');
        }
        this.listeners[event].push({ listener, thisArg });
    }

    /**
     * Invoke every listener registered for an event, same fan-out semantics
     * as main.js's dispatch (each registered worker gets every message) and
     * resilient the same way a native EventEmitter is: one listener throwing
     * must not stop delivery to the others.
     *
     * @param {string} event  'onMessage', 'onStopped' or 'onRecovered'
     * @param {object | string} [arg]  Event argument (the message for 'onMessage', a reason string for 'onStopped', none for 'onRecovered')
     */
    emitToListeners(event, arg) {
        for (const { listener, thisArg } of this.listeners[event]) {
            try {
                listener.call(thisArg, arg);
            } catch {
                // A listener's own error must not break delivery to the rest.
            }
        }
    }

    /**
     * Connect to the MQTT broker and subscribe to the raw frame and
     * status/LWT topics. Resolves once the connection attempt has been
     * kicked off, not once it has actually succeeded - matching the local
     * channel's start(), which also does not wait for bus traffic to prove
     * the interface works. Whether the gateway is actually usable is reported
     * afterwards via the 'onStopped' event, driven by LWT/status.
     */
    async start() {
        if (this.started) {
            throw new Error('Channel already started');
        }
        const client = mqtt.connect(this.config.brokerUrl, {
            username: this.config.username || undefined,
            password: this.config.password || undefined,
        });
        this.client = client;
        // An unhandled 'error' event would crash the process. Logged once per
        // outage (see loggedConnectError) rather than on every retry - mqtt.js
        // reconnects on its own, so a wrong broker address would otherwise
        // warn once a second for as long as it stays wrong.
        client.on('error', e => {
            if (!this.loggedConnectError) {
                this.loggedConnectError = true;
                this.config.log?.warn(
                    `Could not connect to gateway MQTT broker ${this.config.brokerUrl}: ${e.message}`,
                );
            }
        });
        client.on('message', (topic, payload) => this.onMqttMessage(topic, payload));
        client.on('connect', () => {
            this.loggedConnectError = false;
            this.config.log?.info(`Connected to gateway MQTT broker ${this.config.brokerUrl}`);
            client.subscribe(`${this.rawTopicPrefix}/+`);
            client.subscribe(`${this.baseTopic}/LWT`);
            client.subscribe(`${this.baseTopic}/status`);
        });
        this.started = true;
        this.stopped = false;
    }

    /**
     * Disconnect. Mirrors the local channel's synchronous, throwing stop():
     * calling it on a channel that is not started/already stopped throws
     * "Channel not started", same message the local socketcan channel gives
     * in that situation.
     */
    stop() {
        if (!this.started || this.stopped) {
            throw new Error('Channel not started');
        }
        this.stopped = true;
        this.teardown();
    }

    /**
     * Release the MQTT client. Only reached via an explicit stop() (adapter
     * unload, a deliberate reconnect) - evaluateHealth()'s "gateway became
     * unhealthy" path deliberately does not tear the client down, so it can
     * keep watching LWT/status for a possible recovery.
     */
    teardown() {
        this.started = false;
        if (this.client) {
            this.client.end(true);
            this.client = null;
        }
    }

    /**
     * @param {string} topic  MQTT topic
     * @param {Buffer} payload  MQTT payload
     */
    onMqttMessage(topic, payload) {
        if (this.stopped) {
            // A real stop() has already torn the client down; this should be
            // unreachable, but a message racing the teardown must not act.
            return;
        }
        if (topic === `${this.baseTopic}/LWT`) {
            this.mqttOnline = payload.toString() === 'online';
            this.lwtKnown = true;
            this.evaluateHealth();
            return;
        }
        if (topic === `${this.baseTopic}/status`) {
            try {
                this.canRunning = JSON.parse(payload.toString()).can === 'running';
            } catch {
                this.canRunning = false;
            }
            this.statusKnown = true;
            this.evaluateHealth();
            return;
        }
        if (this.unhealthy) {
            // Bus traffic is not meaningful while unhealthy - main.js has
            // already been told via 'onStopped' and stopped counting this
            // channel as connected. Only LWT/status keep being watched,
            // above, so a recovery can still be detected.
            return;
        }
        if (topic.startsWith(`${this.rawTopicPrefix}/`)) {
            const id = parseInt(topic.slice(this.rawTopicPrefix.length + 1), 16);
            if (isNaN(id)) {
                return;
            }
            let frame;
            try {
                frame = JSON.parse(payload.toString());
            } catch {
                return;
            }
            const ts = frame.ts || Date.now();
            this.emitToListeners('onMessage', {
                id: id,
                data: Buffer.from(frame.data, 'hex'),
                ts_sec: Math.floor(ts / 1000),
                ts_usec: (ts % 1000) * 1000,
            });
        }
    }

    /**
     * Derive overall gateway health from the last known LWT/status state and
     * fire 'onStopped' - once - on a healthy-to-unhealthy transition, or
     * 'onRecovered' - once - on the reverse. Unlike the local socketcan
     * channel, this one does not stay dead for good: reconnecting UDS/Collect
     * workers safely in place is the same hard problem #255 deliberately
     * left to a full adapter restart rather than attempting in-adapter, so
     * 'onRecovered' does not try to resume this channel either - it only
     * tells main.js that restarting the whole adapter (which the external
     * #255 watchdog would otherwise have to trigger from outside) is likely
     * to succeed now.
     */
    evaluateHealth() {
        if (!this.lwtKnown || !this.statusKnown) {
            // Wait until both retained topics have reported at least once -
            // otherwise "not heard from yet" would be judged as unhealthy.
            return;
        }
        const healthy = this.mqttOnline && this.canRunning;
        if (!healthy && this.started && !this.stopped && !this.unhealthy) {
            this.unhealthy = true;
            // Distinguishes the two failure modes for the caller's log message
            // - LWT going offline means the gateway/broker link itself is
            // gone, while a live gateway reporting its own CAN side as down
            // is a different problem for the user to chase.
            const reason = !this.mqttOnline
                ? `gateway unreachable (MQTT broker ${this.config.brokerUrl})`
                : `gateway reports CAN bus not running`;
            this.emitToListeners('onStopped', reason);
            return;
        }
        if (healthy && this.unhealthy) {
            this.unhealthy = false;
            this.emitToListeners('onRecovered');
        }
    }
}

module.exports = {
    gatewayChannel,
};
