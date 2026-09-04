'use strict';

const { expect } = require('@iobroker/testing/node_modules/chai');
const { EventEmitter } = require('events');
const proxyquire = require('proxyquire');

/**
 * A minimal stand-in for an mqtt.js client: an EventEmitter plus the two
 * methods canGatewayChannel.js actually calls, recording what happened.
 *
 * @returns {any}
 */
function makeFakeMqttClient() {
    /** @type {any} */
    const client = new EventEmitter();
    client.subscribed = [];
    client.ended = false;
    client.subscribe = topic => client.subscribed.push(topic);
    client.end = () => {
        client.ended = true;
    };
    return client;
}

/** Load canGatewayChannel.js with mqtt.connect() replaced by a stub that
 * always returns the given fake client, instead of touching the network. */
function loadWithFakeMqtt(fakeClient) {
    return proxyquire('./canGatewayChannel', {
        mqtt: { connect: () => fakeClient, '@noCallThru': true },
    });
}

async function startedChannel(config = {}) {
    const client = makeFakeMqttClient();
    const { gatewayChannel } = loadWithFakeMqtt(client);
    const ch = new gatewayChannel({ brokerUrl: 'mqtt://test', ...config });
    await ch.start();
    return { ch, client };
}

// ── addListener() ────────────────────────────────────────────────────────────

describe('canGatewayChannel.js => gatewayChannel.addListener()', () => {
    it('throws "Event not supported" for an unknown event, same as the native RawChannel', async () => {
        const { ch } = await startedChannel();
        let err;
        try {
            await ch.addListener('onSomethingElse', () => {});
        } catch (e) {
            err = e;
        }
        expect(err).to.be.an('error');
        expect(err.message).to.equal('Event not supported');
    });

    it('calls the listener with the given thisArg, mirroring main.js registering its own methods', async () => {
        const { ch } = await startedChannel();
        const receiver = {
            seen: null,
            onMessage(msg) {
                this.seen = msg;
            },
        };
        await ch.addListener('onMessage', receiver.onMessage, receiver);
        ch.emitToListeners('onMessage', { id: 1 });
        expect(receiver.seen).to.deep.equal({ id: 1 });
    });

    it('calls the listener with no thisArg when none is given, matching udsScan.js\'s ad-hoc listeners', async () => {
        const { ch } = await startedChannel();
        let seen = null;
        await ch.addListener('onMessage', msg => {
            seen = msg;
        });
        ch.emitToListeners('onMessage', { id: 2 });
        expect(seen).to.deep.equal({ id: 2 });
    });

    it('delivers to every registered listener, and one throwing does not block the others', async () => {
        const { ch } = await startedChannel();
        const calls = [];
        await ch.addListener('onMessage', () => {
            calls.push('first');
            throw new Error('boom');
        });
        await ch.addListener('onMessage', () => calls.push('second'));
        ch.emitToListeners('onMessage', {});
        expect(calls).to.deep.equal(['first', 'second']);
    });
});

// ── start()/stop() ───────────────────────────────────────────────────────────

describe('canGatewayChannel.js => gatewayChannel.start()/stop()', () => {
    it('subscribes to the raw, LWT and status topics once connected', async () => {
        const { ch, client } = await startedChannel({ rawTopicPrefix: 'open3e/raw', baseTopic: 'open3e' });
        client.emit('connect');
        expect(client.subscribed).to.deep.equal(['open3e/raw/+', 'open3e/LWT', 'open3e/status']);
        ch.stop();
    });

    it('throws "Channel already started" on a second start()', async () => {
        const { ch } = await startedChannel();
        let err;
        try {
            await ch.start();
        } catch (e) {
            err = e;
        }
        expect(err.message).to.equal('Channel already started');
    });

    it('throws "Channel not started" when stopping a channel that was never started', () => {
        const { gatewayChannel } = loadWithFakeMqtt(makeFakeMqttClient());
        const ch = new gatewayChannel({ brokerUrl: 'mqtt://test' });
        expect(() => ch.stop()).to.throw('Channel not started');
    });

    it('throws "Channel not started" when stopping twice', async () => {
        const { ch } = await startedChannel();
        ch.stop();
        expect(() => ch.stop()).to.throw('Channel not started');
    });

    it('ends the mqtt client on stop()', async () => {
        const { ch, client } = await startedChannel();
        ch.stop();
        expect(client.ended).to.equal(true);
    });
});

// ── Raw frame messages ───────────────────────────────────────────────────────

describe('canGatewayChannel.js => gatewayChannel raw frame handling', () => {
    it('turns a raw topic message into the socketcan message shape', async () => {
        const { ch, client } = await startedChannel({ rawTopicPrefix: 'open3e/raw', baseTopic: 'open3e' });
        /** @type {any} */
        let received = null;
        await ch.addListener('onMessage', msg => (received = msg));

        client.emit(
            'message',
            'open3e/raw/251',
            Buffer.from(JSON.stringify({ dlc: 4, data: '21fa01b3', ts: 1725455669123 })),
        );

        if (!received) {
            throw new Error('no message received');
        }
        expect(received.id).to.equal(0x251);
        expect(Buffer.isBuffer(received.data)).to.equal(true);
        expect(received.data.toJSON().data).to.deep.equal([0x21, 0xfa, 0x01, 0xb3]);
        expect(received.ts_sec).to.equal(Math.floor(1725455669123 / 1000));
        expect(received.ts_usec).to.equal((1725455669123 % 1000) * 1000);
    });

    it('ignores a raw topic with a non-hex id', async () => {
        const { ch, client } = await startedChannel({ rawTopicPrefix: 'open3e/raw' });
        let called = false;
        await ch.addListener('onMessage', () => (called = true));
        client.emit('message', 'open3e/raw/notAnId', Buffer.from(JSON.stringify({ data: '00' })));
        expect(called).to.equal(false);
    });

    it('ignores a raw topic with malformed JSON instead of throwing', async () => {
        const { ch, client } = await startedChannel({ rawTopicPrefix: 'open3e/raw' });
        let called = false;
        await ch.addListener('onMessage', () => (called = true));
        expect(() => client.emit('message', 'open3e/raw/251', Buffer.from('{not json'))).to.not.throw();
        expect(called).to.equal(false);
    });

    it('ignores messages once stopped', async () => {
        const { ch, client } = await startedChannel({ rawTopicPrefix: 'open3e/raw' });
        let called = false;
        await ch.addListener('onMessage', () => (called = true));
        ch.stop();
        client.emit('message', 'open3e/raw/251', Buffer.from(JSON.stringify({ data: '00' })));
        expect(called).to.equal(false);
    });
});

// ── Health / onStopped ───────────────────────────────────────────────────────

describe('canGatewayChannel.js => gatewayChannel health tracking', () => {
    it('does not fire onStopped while mqtt is online and can is running', async () => {
        const { ch, client } = await startedChannel({ baseTopic: 'open3e' });
        let stopped = false;
        await ch.addListener('onStopped', () => (stopped = true));
        client.emit('message', 'open3e/LWT', Buffer.from('online'));
        client.emit('message', 'open3e/status', Buffer.from(JSON.stringify({ can: 'running', mqtt: true })));
        expect(stopped).to.equal(false);
    });

    it('fires onStopped when LWT goes offline', async () => {
        const { ch, client } = await startedChannel({ baseTopic: 'open3e' });
        let stopped = 0;
        await ch.addListener('onStopped', () => stopped++);
        client.emit('message', 'open3e/LWT', Buffer.from('online'));
        client.emit('message', 'open3e/status', Buffer.from(JSON.stringify({ can: 'running' })));
        client.emit('message', 'open3e/LWT', Buffer.from('offline'));
        expect(stopped).to.equal(1);
    });

    it('fires onStopped when the CAN bus is not running even though mqtt is online', async () => {
        const { ch, client } = await startedChannel({ baseTopic: 'open3e' });
        let stopped = 0;
        await ch.addListener('onStopped', () => stopped++);
        client.emit('message', 'open3e/LWT', Buffer.from('online'));
        client.emit('message', 'open3e/status', Buffer.from(JSON.stringify({ can: 'bus-off' })));
        expect(stopped).to.equal(1);
    });

    it('fires onStopped only once even if further unhealthy updates arrive', async () => {
        const { ch, client } = await startedChannel({ baseTopic: 'open3e' });
        let stopped = 0;
        await ch.addListener('onStopped', () => stopped++);
        client.emit('message', 'open3e/LWT', Buffer.from('offline'));
        client.emit('message', 'open3e/LWT', Buffer.from('offline'));
        client.emit('message', 'open3e/status', Buffer.from(JSON.stringify({ can: 'bus-off' })));
        expect(stopped).to.equal(1);
    });

    it('ends the mqtt client once unhealthy, same as an explicit stop()', async () => {
        const { ch, client } = await startedChannel({ baseTopic: 'open3e' });
        client.emit('message', 'open3e/status', Buffer.from(JSON.stringify({ can: 'running' })));
        client.emit('message', 'open3e/LWT', Buffer.from('offline'));
        expect(client.ended).to.equal(true);
        expect(() => ch.stop()).to.throw('Channel not started');
    });

    it('does not judge health from only one of LWT/status having been heard from yet', async () => {
        const { ch, client } = await startedChannel({ baseTopic: 'open3e' });
        let stopped = false;
        await ch.addListener('onStopped', () => (stopped = true));
        // Only LWT has arrived so far (e.g. status is still in flight) -
        // canRunning defaults to false, which must not be read as "the bus
        // is down" this early.
        client.emit('message', 'open3e/LWT', Buffer.from('online'));
        expect(stopped).to.equal(false);
        expect(client.ended).to.equal(false);
    });
});
