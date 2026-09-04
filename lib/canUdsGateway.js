const { uds } = require('./canUds');

/**
 * uds worker variant for a bus reached through an open3e-esp32 gateway
 * instead of a local CAN interface.
 *
 * Extends `uds` and overrides only the entry points that do frame-level I/O
 * locally - readByDid, writeByDid2E, writeByDid77, and
 * startupUdsWorkerService77 (only to keep its sub-worker a udsGateway too).
 * Everything else - the command queue, scheduling, onUdsStateChange,
 * timeout/statistics bookkeeping - is reused unchanged from `uds`.
 * sendFrame()/msgUds() are never invoked for this class: nothing dispatches
 * CAN frames to a gateway worker, since there is no local channel carrying
 * them for it.
 *
 * See docs/raw-gateway-api.md for the REST contract this talks to.
 */
class udsGateway extends uds {
    /**
     * Start a sub-worker for service 0x77 writes on the offset ECU address.
     * Identical to the inherited implementation except for constructing a
     * udsGateway instead of the base uds, so the sub-worker keeps using the
     * gateway too.
     *
     * @param {object} ctx  Caller context
     * @param {number} addr  Device address
     */
    async startupUdsWorkerService77(ctx, addr) {
        const udsWorker = new udsGateway({
            canID: Number(addr),
            stateBase: `${this.config.stateBase}_service77`,
            device: 'common',
            delay: 0,
            active: true,
            gatewayBaseUrl: this.config.gatewayBaseUrl,
            timeout: this.config.timeout,
        });
        await udsWorker.initStates(ctx, 'service77');
        await udsWorker.startup(ctx, 'service77');
        return udsWorker;
    }

    /**
     * fetch() against config.gatewayBaseUrl, bounded by the worker's own
     * comms timeout so a stuck gateway can't leave a request dangling
     * forever - the queue's own onTimeout() is the primary safety net for
     * "nothing ever came back", this is only to not leak the fetch itself
     * past that point.
     *
     * @param {string} path  Path below config.gatewayBaseUrl
     * @param {object} [init]  fetch() options
     * @returns {Promise<object>}  Parsed JSON response body
     */
    async gatewayFetch(path, init) {
        const res = await fetch(`${this.config.gatewayBaseUrl}${path}`, {
            ...init,
            signal: AbortSignal.timeout(this.config.timeout),
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
    }

    /**
     * A response arriving for a request the queue has already moved past -
     * e.g. onTimeout() fired first and reset comState while this was still
     * in flight - must be ignored, the same way a late CAN frame is ignored
     * once comState is back to standby.
     *
     * @param {number} did  DID the response belongs to
     */
    async isStale(did) {
        return this.data.did !== did || (await this.getComState()) === 0;
    }

    /**
     * Read DID from device via the gateway's rawread endpoint.
     *
     * @param {object} ctx  Adapter context
     * @param {number} did  Requested DID
     */
    async readByDid(ctx, did) {
        if ((await this.getWorkerOpMode()) == 'standby') {
            ctx.log.warn(
                `UDS gateway worker warning on ${this.config.stateBase}: Could not execute ReadByDid() for ${String(
                    this.canIDhex,
                )}.${String(did)} due to opMode == standby.`,
            );
            return;
        }
        const state = await this.getComState();
        if (state != 0) {
            await ctx.log.warn(
                `UDS gateway worker warning on ${this.config.stateBase}: ReadByDid(): state ${
                    this.states[state]
                } != standby when called! Did ${String(this.canIDhex)}.${String(did)}; Retry issued.`,
            );
            await this.pushCmnd(ctx, 'read', [did]);
            return;
        }
        this.stat.cntCommTotal += 1;
        await this.setDidStart(ctx, did, 'read', 0);
        await ctx.log.silly(
            `UDS gateway worker on ${this.config.stateBase}: ReadByDid(): ${String(this.canIDhex)}.${String(did)}`,
        );

        let body;
        try {
            body = await this.gatewayFetch(`/api/rawread?ecu=${encodeURIComponent(this.canIDhex)}&did=${did}`);
        } catch (e) {
            await this.readFailed(ctx, did, e.message);
            return;
        }
        if (await this.isStale(did)) {
            return;
        }
        const entry = body.results && body.results[0];
        if (!entry || entry.error) {
            await this.readFailed(ctx, did, entry ? entry.error : 'empty response');
            return;
        }

        this.stat.cntCommOk += 1;
        await this.calcStat();
        const bytes = this.storage.storageDids.toByteArray(entry.data);
        if (bytes.length > 0) {
            this.storage.decodeDataCAN(ctx, this, String(did), bytes);
        } else {
            // Treat zero length did as negative response, same as msgUds().
            this.stat.cntCommZL += 1;
            if (this.callback) {
                await this.callback(ctx, this, ['negative response', { did, didInfo: { id: '', len: 0 }, val: '' }]);
            } else {
                ctx.log.warn(
                    `UDS gateway worker error on ${this.config.stateBase}: Got did with a length of zero. Ignoring. Did=${String(did)}`,
                );
            }
        }
        await this.setDidDone(ctx, 0);
    }

    /**
     * Shared failure path for a failed/negative-response gateway read,
     * mirroring the negative-response branch of msgUds() so scan callbacks
     * (see lib/udsScan.js's setCallback()) behave the same regardless of
     * transport.
     *
     * @param {object} ctx  Adapter context
     * @param {number} did  Requested DID
     * @param {string} reason  Error description for the log
     */
    async readFailed(ctx, did, reason) {
        if (await this.isStale(did)) {
            return;
        }
        this.stat.cntCommNR += 1;
        this.statCommFailed(this, did);
        if (this.callback) {
            await this.callback(ctx, this, ['negative response', { did, didInfo: { id: '', len: 0 }, val: '' }]);
        } else {
            ctx.log.warn(
                `UDS gateway worker error on ${this.config.stateBase}: Read failed for did ${String(
                    did,
                )}. reason=${reason}`,
            );
        }
        await this.setDidDone(ctx, 0);
    }

    /**
     * Shared implementation for both write services. Unlike the local
     * writeByDid77, which builds the Viessmann-specific service 0x77
     * envelope itself, the gateway is given the plain value bytes for
     * either service and builds whatever framing that service needs on its
     * own - exactly as it already does transparently when decoding a 0x77
     * read (see docs/raw-gateway-api.md).
     *
     * @param {object} ctx  Adapter context
     * @param {Array} didArr  [did, valRaw]
     * @param {string} svc  '0x2E' or '0x77'
     */
    async gatewayWrite(ctx, didArr, svc) {
        if (this.stat.state != 'active') {
            ctx.log.warn(
                `UDS gateway worker warning on ${this.config.stateBase}: Could not execute WriteByDid() for ${String(
                    this.canIDhex,
                )}.${JSON.stringify(didArr)} due to state != active.`,
            );
            return;
        }
        const did = didArr[0];
        const valRaw = didArr[1];
        this.stat.cntCommTotal += 1;
        this.data.valRaw = valRaw;
        await this.setDidStart(ctx, did, 'write', valRaw.length);
        await ctx.log.silly(
            `UDS gateway worker on ${this.config.stateBase}: WriteByDid(): ${String(this.canIDhex)}.${String(
                did,
            )}=${this.storage.storageDids.arr2Hex(valRaw)} svc=${svc}`,
        );

        let body;
        try {
            body = await this.gatewayFetch('/api/rawwrite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ecu: this.canIDhex,
                    did: did,
                    svc: svc,
                    data: this.storage.storageDids.arr2Hex(valRaw),
                }),
            });
        } catch (e) {
            await this.writeFailed(ctx, did, svc, e.message);
            return;
        }
        if (await this.isStale(did)) {
            return;
        }
        if (!body.ok) {
            await this.writeFailed(ctx, did, svc, body.error);
            return;
        }

        this.stat.cntCommOk += 1;
        await this.calcStat();
        this.storage.storeStatistics(ctx, this, (await this.getWorkerOpMode()) == 'service77');
        await this.setDidDone(ctx, 0);
    }

    /**
     * Shared failure path for both write services, mirroring the
     * negative-response branches of msgUds() - including the same
     * fall-back-to-service-0x77 retry writeByDid2E does locally.
     *
     * @param {object} ctx  Adapter context
     * @param {number} did  Requested DID
     * @param {string} svc  Service that failed
     * @param {string} reason  Error description for the log
     */
    async writeFailed(ctx, did, svc, reason) {
        if (await this.isStale(did)) {
            return;
        }
        this.stat.cntCommNR += 1;
        ctx.log.warn(
            `UDS gateway worker error on ${this.config.stateBase}: Negative response writing did ${String(
                did,
            )}. reason=${reason}`,
        );
        if (svc === '0x2E' && (await this.getWorkerOpMode()) == 'normal') {
            ctx.log.info(`Going to try again using SID 0x77 to write data point on ${this.config.stateBase}`);
            this.pushCmnd(ctx, 'write77', [[did, this.data.valRaw]]);
        }
        await this.setDidDone(ctx, 100);
    }

    /**
     * Write DID to device using standard service 2E via the gateway.
     *
     * @param {object} ctx  Adapter context
     * @param {Array} didArr  Requested DID and value
     */
    async writeByDid2E(ctx, didArr) {
        await this.gatewayWrite(ctx, didArr, '0x2E');
    }

    /**
     * Write DID to device using Viessmann specific service 77 via the gateway.
     *
     * @param {object} ctx  Adapter context
     * @param {Array} didArr  Requested DID and value
     */
    async writeByDid77(ctx, didArr) {
        await ctx.log.debug('User command UDS writeByDid is using SID 0x77 (gateway)');
        await this.gatewayWrite(ctx, didArr, '0x77');
    }
}

module.exports = {
    udsGateway,
};
