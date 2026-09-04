'use strict';

const { expect } = require('@iobroker/testing/node_modules/chai');
const { udsGateway } = require('./canUdsGateway');

/** @returns {any} */
function makeCtx() {
    return {
        log: {
            warn: () => {},
            silly: () => {},
            debug: () => {},
            info: () => {},
            error: () => {},
        },
        setTimeout: (fn, delay, ...args) => setTimeout(fn, delay, ...args),
        clearTimeout: handle => clearTimeout(handle),
        // Called by storage.js's storeStatistics() after every successful
        // comms attempt.
        setStateAsync: async () => {},
    };
}

/**
 * A ready-to-communicate worker: opMode 'normal' and state 'active', which is
 * what readByDid()/writeByDid2E()/writeByDid77() require before they do
 * anything, without going through the full initStates()/startup() sequence
 * (which needs a much larger ctx mock for its ioBroker object/state setup -
 * out of scope for testing the gateway-specific logic these overrides add).
 *
 * @param {object} [overrides]  Extra/overriding worker config fields
 */
function makeWorker(overrides = {}) {
    const worker = new udsGateway({
        canID: 0x680,
        stateBase: 'testDev',
        device: 'common',
        delay: 0,
        active: true,
        gatewayBaseUrl: 'http://gateway.test',
        timeout: 200,
        ...overrides,
    });
    worker.storage.setOpMode('normal');
    worker.stat.state = 'active';
    return worker;
}

/**
 * @param {any} handler  Replacement for global.fetch for the duration of one test
 * @returns {Function}  Call to restore the original global.fetch
 */
function stubFetch(handler) {
    const original = global.fetch;
    global.fetch = handler;
    return () => {
        global.fetch = original;
    };
}

/**
 * @param {any} body  Parsed JSON body the stubbed response should return
 * @param {boolean} [ok]  Response.ok
 * @param {number} [status]  Response.status
 */
function jsonResponse(body, ok = true, status = 200) {
    return { ok, status, json: async () => body };
}

// ── readByDid() ───────────────────────────────────────────────────────────────

describe('canUdsGateway.js => udsGateway.readByDid()', () => {
    it('does not call the gateway when opMode is standby', async () => {
        const worker = makeWorker();
        await worker.storage.setOpMode('standby');
        let called = false;
        const restore = stubFetch(() => {
            called = true;
            return jsonResponse({});
        });
        await worker.readByDid(makeCtx(), 268);
        restore();
        expect(called).to.equal(false);
    });

    it('re-queues the read and returns if a communication is already in progress', async () => {
        const worker = makeWorker();
        worker.data.state = 1; // pretend a read is already in flight (waitForFFrbd)
        let called = false;
        const restore = stubFetch(() => {
            called = true;
            return jsonResponse({});
        });
        await worker.readByDid(makeCtx(), 268);
        restore();
        expect(called).to.equal(false);
        expect(worker.cmndsQueue).to.deep.equal([{ mode: 'read', did: 268 }]);
    });

    it('requests the right ecu/did and decodes a successful response', async () => {
        const worker = makeWorker();
        let decodeArgs = null;
        worker.storage.decodeDataCAN = async (ctx, w, did, data) => {
            decodeArgs = [did, data];
        };
        let requestedUrl = null;
        const restore = stubFetch(async url => {
            requestedUrl = url;
            return jsonResponse({ results: [{ did: 268, data: '0102' }] });
        });
        await worker.readByDid(makeCtx(), 268);
        restore();

        expect(requestedUrl).to.equal('http://gateway.test/api/rawread?ecu=0x680&did=268');
        expect(decodeArgs).to.deep.equal(['268', [0x01, 0x02]]);
        expect(worker.stat.cntCommOk).to.equal(1);
        expect(await worker.getComState()).to.equal(0);
    });

    it('treats an error result as a negative response and does not decode', async () => {
        const worker = makeWorker();
        let decodeCalled = false;
        worker.storage.decodeDataCAN = async () => {
            decodeCalled = true;
        };
        const restore = stubFetch(async () => jsonResponse({ results: [{ did: 268, error: 'timeout' }] }));
        await worker.readByDid(makeCtx(), 268);
        restore();

        expect(decodeCalled).to.equal(false);
        expect(worker.stat.cntCommNR).to.equal(1);
        expect(await worker.getComState()).to.equal(0);
    });

    it('treats a zero-length response as a negative response, without decoding', async () => {
        const worker = makeWorker();
        let decodeCalled = false;
        worker.storage.decodeDataCAN = async () => {
            decodeCalled = true;
        };
        const restore = stubFetch(async () => jsonResponse({ results: [{ did: 268, data: '' }] }));
        await worker.readByDid(makeCtx(), 268);
        restore();

        expect(decodeCalled).to.equal(false);
        expect(worker.stat.cntCommZL).to.equal(1);
    });

    it('treats a fetch failure as a negative response instead of throwing', async () => {
        const worker = makeWorker();
        const restore = stubFetch(async () => {
            throw new Error('network down');
        });
        await worker.readByDid(makeCtx(), 268);
        restore();

        expect(worker.stat.cntCommNR).to.equal(1);
        expect(await worker.getComState()).to.equal(0);
    });

    it('treats a non-2xx HTTP response as a failure', async () => {
        const worker = makeWorker();
        const restore = stubFetch(async () => jsonResponse({}, false, 500));
        await worker.readByDid(makeCtx(), 268);
        restore();

        expect(worker.stat.cntCommNR).to.equal(1);
    });

    it('ignores a late response if the request already timed out while it was in flight', async () => {
        const worker = makeWorker();
        let decodeCalled = false;
        worker.storage.decodeDataCAN = async () => {
            decodeCalled = true;
        };
        // readByDid() crosses several await points (opMode/comState checks,
        // setDidStart()) before it actually calls fetch(); a signal for "fetch
        // was called" is needed to simulate the timeout at the right moment,
        // rather than assuming how many microtask ticks that takes.
        /** @type {Function} */
        let resolveFetch = () => {};
        /** @type {Function} */
        let fetchStarted = () => {};
        const fetchStartedPromise = new Promise(resolve => (fetchStarted = resolve));
        const restore = stubFetch(() => {
            fetchStarted();
            return new Promise(resolve => (resolveFetch = resolve));
        });

        const ctx = makeCtx();
        const readPromise = worker.readByDid(ctx, 268);
        await fetchStartedPromise;
        // Simulate onTimeout() having already fired and reset the worker
        // while the gateway request was still in flight:
        await worker.setDidDone(ctx, 0);
        resolveFetch(jsonResponse({ results: [{ did: 268, data: '0102' }] }));
        await readPromise;
        restore();

        expect(decodeCalled).to.equal(false);
    });
});

// ── writeByDid2E() / writeByDid77() ─────────────────────────────────────────────

describe('canUdsGateway.js => udsGateway write', () => {
    it('does nothing when the worker state is not active', async () => {
        const worker = makeWorker();
        worker.stat.state = 'standby';
        let called = false;
        const restore = stubFetch(() => {
            called = true;
            return jsonResponse({ ok: true });
        });
        await worker.writeByDid2E(makeCtx(), [396, [0x16, 0x00]]);
        restore();
        expect(called).to.equal(false);
    });

    it('writeByDid2E sends svc 0x2E with the plain value bytes as hex', async () => {
        const worker = makeWorker();
        let requestBody = null;
        const restore = stubFetch(async (url, init) => {
            requestBody = JSON.parse(init.body);
            return jsonResponse({ ok: true });
        });
        await worker.writeByDid2E(makeCtx(), [396, [0x16, 0x00]]);
        restore();

        expect(requestBody).to.deep.equal({ ecu: '0x680', did: 396, svc: '0x2E', data: '1600' });
        expect(await worker.getComState()).to.equal(0);
    });

    it('writeByDid77 sends svc 0x77 with the same plain value bytes - no client-side envelope', async () => {
        const worker = makeWorker();
        let requestBody = null;
        const restore = stubFetch(async (url, init) => {
            requestBody = JSON.parse(init.body);
            return jsonResponse({ ok: true });
        });
        await worker.writeByDid77(makeCtx(), [396, [0x16, 0x00]]);
        restore();

        expect(requestBody).to.deep.equal({ ecu: '0x680', did: 396, svc: '0x77', data: '1600' });
    });

    it('retries via service 0x77 when a 0x2E write gets a negative response in normal mode', async () => {
        const worker = makeWorker();
        const restore = stubFetch(async () => jsonResponse({ ok: false, error: 'negative' }));
        await worker.writeByDid2E(makeCtx(), [396, [0x16, 0x00]]);
        restore();

        expect(worker.cmndsQueue).to.deep.equal([{ mode: 'write77', did: [396, [0x16, 0x00]] }]);
    });

    it('does not retry after a 0x77 write itself gets a negative response', async () => {
        const worker = makeWorker();
        const restore = stubFetch(async () => jsonResponse({ ok: false, error: 'negative' }));
        await worker.writeByDid77(makeCtx(), [396, [0x16, 0x00]]);
        restore();

        expect(worker.cmndsQueue).to.deep.equal([]);
    });
});

// ── startupUdsWorkerService77() ──────────────────────────────────────────────

describe('canUdsGateway.js => udsGateway.startupUdsWorkerService77()', () => {
    it('constructs a udsGateway sub-worker (not the local uds class), carrying the gateway config over', async () => {
        const worker = makeWorker({ gatewayBaseUrl: 'http://gateway.test', timeout: 321 });
        // initStates()/startup() need a much larger ioBroker ctx mock than the
        // rest of this file - they are inherited from `uds` unchanged and not
        // part of what this override actually does, so they are stubbed out
        // for this one test to isolate what startupUdsWorkerService77() itself
        // is responsible for: constructing the right class with the right
        // config.
        const origInitStates = udsGateway.prototype.initStates;
        const origStartup = udsGateway.prototype.startup;
        udsGateway.prototype.initStates = async function () {};
        udsGateway.prototype.startup = async function () {};
        let sub;
        try {
            sub = await worker.startupUdsWorkerService77(makeCtx(), 0x682);
        } finally {
            udsGateway.prototype.initStates = origInitStates;
            udsGateway.prototype.startup = origStartup;
        }

        expect(sub).to.be.instanceOf(udsGateway);
        expect(sub.config.canID).to.equal(0x682);
        expect(sub.config.gatewayBaseUrl).to.equal('http://gateway.test');
        expect(sub.config.timeout).to.equal(321);
    });
});
