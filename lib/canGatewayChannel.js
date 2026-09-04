const mqtt = require('mqtt');

/**
 * Drop-in replacement for a socketcan RawChannel, backed by an open3e-esp32
 * gateway's raw MQTT topics instead of a local CAN interface.
 *
 * Implements only the subset of the RawChannel interface e3oncan actually
 * uses: addListener('onMessage' | 'onStopped', ...) and start()/stop().
 * There is deliberately no send() here - UDS reads/writes for a gateway bus
 * go through the separate REST-based udsGateway transport, never through
 * this channel, so nothing is expected to call it.
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
     * @param {string} [config.rawTopicPrefix]  Raw frame topic prefix, default 'open3e/raw'
     * @param {string} [config.baseTopic]  Base topic for LWT/status, default 'open3e'
     */
    constructor(config) {
        this.config = config;
        this.rawTopicPrefix = config.rawTopicPrefix || 'open3e/raw';
        this.baseTopic = config.baseTopic || 'open3e';
        this.client = null;
        this.started = false;
        this.stopped = false;
        this.listeners = { onMessage: [], onStopped: [] };
        this.mqttOnline = false;
        this.canRunning = false;
    }

    /**
     * Register an event listener. Mirrors socketcan RawChannel.addListener(),
     * including its "thisArg" convention: main.js passes the adapter instance
     * as thisArg so its listener methods see the right `this`, while
     * lib/udsScan.js's ad-hoc listeners are plain closures called with two
     * arguments and no thisArg.
     *
     * @param {string} event  'onMessage' or 'onStopped'
     * @param {Function} listener  Callback function
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
     * @param {string} event  'onMessage' or 'onStopped'
     * @param {*} [arg]  Event argument (the message for 'onMessage', none for 'onStopped')
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
        // An unhandled 'error' event would crash the process; connection
        // problems are surfaced through the health tracking below instead.
        client.on('error', () => {});
        client.on('message', (topic, payload) => this.onMqttMessage(topic, payload));
        client.on('connect', () => {
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
     * Release the MQTT client. Shared by stop() and the internal
     * "gateway became unhealthy" path in evaluateHealth() - the latter must
     * not go through stop() itself, since stop() throws when already
     * stopped and is meant for the external caller (disconnectFromCan()).
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
            return;
        }
        if (topic === `${this.baseTopic}/LWT`) {
            this.mqttOnline = payload.toString() === 'online';
            this.evaluateHealth();
            return;
        }
        if (topic === `${this.baseTopic}/status`) {
            try {
                this.canRunning = JSON.parse(payload.toString()).can === 'running';
            } catch {
                this.canRunning = false;
            }
            this.evaluateHealth();
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
     * fire 'onStopped' - once - on a healthy-to-unhealthy transition. Once
     * fired, this channel is done for good, same as the local one: nothing
     * here tries to recover on its own (see ioBroker.e3oncan#255 for why
     * that was deliberately left to an external watchdog instead of adapter
     * code).
     */
    evaluateHealth() {
        const healthy = this.mqttOnline && this.canRunning;
        if (!healthy && this.started && !this.stopped) {
            this.stopped = true;
            this.teardown();
            this.emitToListeners('onStopped');
        }
    }
}

module.exports = {
    gatewayChannel,
};
