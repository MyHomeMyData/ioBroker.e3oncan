const storageCol = require('./storage');

class scheduleLoop {
    constructor(ctxGlobal, ctxLocal, schedule, dids) {
        this.ctxGlobal   = ctxGlobal;
        this.ctxLocal    = ctxLocal;
        this.schedule    = schedule;
        this.dids        = dids;
        this.schedHandle = null;
    }

    async startSchedule() {
        if (this.schedule == 0) {
            await this.ctxGlobal.log.silly('UDS schedule one time: '+this.ctxLocal.canIDhex+'.'+JSON.stringify(this.dids));
            await this.ctxLocal.pushCmnd(this.ctxGlobal, 'read', this.dids);
            this.schedHandle = null;
        } else {
            this.schedHandle = setInterval(async () => {
                await this.loop();
            }, this.schedule*1000);
        }
    }

    async stopSchedule() {
        if (this.schedHandle) await clearInterval(this.schedHandle);
        await this.ctxGlobal.log.silly('UDS schedule stopped: '+String(this.schedule)+' '+this.ctxLocal.canIDhex+'.'+JSON.stringify(this.dids));
    }

    async loop() {
        await this.ctxGlobal.log.silly('UDS schedule: '+String(this.schedule)+' '+this.ctxLocal.canIDhex+'.'+JSON.stringify(this.dids));
        await this.ctxLocal.pushCmnd(this.ctxGlobal, 'read', this.dids);
    }
}

class uds {
    constructor(config) {
        this.config = config;
        this.storage = new storageCol.storage(this.config);
        this.states = ['standby','waitForFF','waitForCF'];
        this.frameFC = [0x30,0x00,0x00,0x00,0x00,0x00,0x00,0x00];
        this.readByDidProt = {
            'idTx'  : this.config.canID,
            'idRx'  : Number(this.config.canID) + 0x10,
            'PCI'   : 0x03,     // Protocol Control Information
            'SIDtx' : 0x22,     // Service ID transmit
            'SIDrx' : 0x62,     // Service ID receive
            'SIDnr' : 0x7F,     // SID negative response
            'FC'    : [0x30,0x00,0x00,0x00,0x00,0x00,0x00,0x00], // Flow Control frame
        };
        this.data = {
            'len'       : 0,
            'timestamp' : 0,
            'databytes' : [],
            'did'       : 0,
            'state'     : 0,
            'D0'        : 0x21
        };
        this.canIDhex          = '0x'+Number(this.config.canID).toString(16);
        this.cmndsQueue        = [];
        this.cmndsHandle       = null;
        this.cmndsUpdateTime   = 50;            // Check for new commands (ms)
        this.busy              = false;         // Agent is busy
        this.schedules         = {};
        this.userDidsToReadId  = 'uds.'+this.canIDhex+'.didsToRead';
        this.timeoutHandle     = null;
        this.callback          = null;
        this.coolDownTs        = 0;             // Earliest time for next communication
        this.cntCommTotal      = 0;             // Number of startes communications
        this.cntCommOk         = 0;             // Number of succesfull communications
        this.cntCommNR         = 0;             // Number of communications ending in negative response
        this.cntCommTimeout    = 0;             // Number of communications ending in timeout
        this.cntCommTimeoutPerDid = {};         // Number of communications ending in timeout for specific did
        this.cntCommBad        = 0;             // Number of bad communications, e.g. bad frame
    }

    async initStates(ctx) {
        await this.storage.initStates(ctx);
        await ctx.setObjectNotExistsAsync(this.userDidsToReadId, {
            type: 'state',
            common: {
                name: 'List of dids to be read via UDS ReadByDid. Place command with ack=false.',
                type: 'json',
                role: 'state',
                read: true,
                write: true,
            },
            native: {},
        });
        await ctx.setStateAsync(this.userDidsToReadId, { val: JSON.stringify([]), ack: true });
        ctx.subscribeStates(this.userDidsToReadId);
    }

    async setAgentOpMode(opMode) {
        await this.storage.setOpMode(opMode);
    }

    async getAgentOpMode() {
        return this.storage.getOpMode();
    }

    async getComState() {
        return this.data.state;
    }

    async setComState(comState) {
        this.data.state = comState;
    }

    async setDidDone(coolDownTime) {
        // Finalize communication for recent did
        this.coolDownTs = new Date().getTime()+coolDownTime;
        if (this.cmndsQueue.length == 0) this.busy = false;
        await this.setComState(0);
        if (this.timeoutHandle) await clearTimeout(this.timeoutHandle);
    }

    async setDidStart(ctx, did) {
        await this.setComState(1);   // 'waitForFF'
        const minWaiting = this.coolDownTs - new Date().getTime();
        if (minWaiting > 0) await this.sleep(minWaiting);
        this.busy = true;
        this.timeoutHandle = await setTimeout(this.onTimeout, this.config.timeout, ctx, this);
        this.data.did = did;
    }

    async startup(ctx, opMode) {
        await this.setComState(0);
        this.cmndsHandle = setInterval(async () => {
            await this.cmndsLoop(ctx);
        }, this.cmndsUpdateTime);
        if (opMode == 'normal') {
            for (const sched of Object.values(this.schedules)) {
                // Start schedules on startup and do one-time schedules
                await sched.startSchedule();
            }
        }
        await this.setAgentOpMode(opMode);
        if (opMode == 'normal') {
            await ctx.log.debug('UDS agent started on '+this.canIDhex);
        } else {
            await ctx.log.silly('UDS agent started in mode '+opMode+' on '+this.canIDhex);
        }
    }

    async stop(ctx) {
        // Stop loops:
        for (const sched of Object.values(this.schedules)) {
            await sched.stopSchedule();
        }
        if (this.cmndsHandle) await clearInterval(this.cmndsHandle);

        // Wait till possibly running communication has finished:
        const tsAbort = await new Date().getTime() + this.config.timeout;
        while ( (this.busy) && (new Date().getTime() < tsAbort) ) {
            await this.sleep(50);
        }

        // Stop agent:
        const opMode = await this.storage.getOpMode();
        this.callback = null;
        await this.storage.setOpMode('standby');
        if (opMode == 'normal') {
            await ctx.log.debug('UDS agent stopped on '+this.canIDhex);
        } else {
            await ctx.log.silly('UDS agent stopped in mode '+opMode+' on '+this.canIDhex);
        }
    }

    async setCallback(callback) {
        this.callback = callback;
    }

    async addSchedule(ctx, schedule, dids) {
        if (!Object.keys(this.schedules).includes(schedule)) {
            const didsArr = dids.replace(' ','').split(',');
            this.schedules[schedule] = new scheduleLoop(ctx, this, schedule, didsArr.map(function(str) { return parseInt(str); }));
            ctx.log.silly('addSchedule: '+String(schedule)+' '+JSON.stringify(didsArr));
        } else {
            ctx.log.warn('UDS: Multiple definiton of schedule: Dev='+this.config.stateBase+'; Schedule='+String(schedule));
        }
    }

    async pushCmnd(ctx, mode, dids) {
        await ctx.log.silly('pushCmnd(): '+mode+' '+String(this.canIDhex)+'.'+String(JSON.stringify(dids)));
        if (Array.isArray(dids)) {
            for (const did of Object.values(dids)) {
                await this.cmndsQueue.push({'mode':mode, 'did': did});
            }
        } else {
            await ctx.log.warn('UDS: Wrong format for command. dids have to be array. Got dids='+JSON.stringify(dids));
        }
    }

    sleep(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    async cmndsLoop(ctx) {
        if ( (await this.storage.getOpMode() != 'standby') && (this.cmndsQueue.length > 0) && (await this.getComState() == 0) ) {
            const cmnd = await this.cmndsQueue.shift();
            switch (cmnd.mode) {
                case 'read': {
                    // ReadByDid
                    await this.readByDid(ctx,cmnd.did);
                    await ctx.log.silly('cmndLoop()->readByDid(): '+String(cmnd.did));
                    break;
                }
                case 'write': {
                    // WriteByDid
                    await this.writeByDid(ctx,cmnd.did);
                    await ctx.log.silly('cmndLoop()->writeByDid(): '+String(cmnd.did));
                    break;
                }
                default: {
                    await ctx.log.error('UDS: Received unknown command '+cmnd.mode);
                }
            }
        }
    }

    async onTimeout(ctxGlobal, ctxLocal) {
        const opMode = await ctxLocal.storage.getOpMode();
        if ( (opMode != 'udsDevScan') && ((opMode != 'udsDidScan')) ) {
            await ctxGlobal.log.error('UDS timeout on '+ctxLocal.canIDhex+'.'+String(ctxLocal.data.did));
        }
        ctxLocal.cntCommTimeout += 1;
        const did = await Number(ctxLocal.data.did);
        if (did in ctxLocal.cntCommTimeoutPerDid) {
            ctxLocal.cntCommTimeoutPerDid[did] += 1;
        } else {
            ctxLocal.cntCommTimeoutPerDid[did]  = 1;
        }
        if (ctxLocal.callback) await ctxLocal.callback(ctxGlobal, ctxLocal, ['timeout', ctxLocal.storage.udsScanResult]);
        //ctxGlobal.log.debug('Timeout: '+String(ctxLocal.canIDhex)+'.'+String(ctxLocal.data.did));
        await ctxLocal.setDidDone(0);
    }

    async onUserReadDidsChange(ctx, state) {
        const dids = JSON.parse(state.val);
        if (!state.ack) {
            // Execute user command
            ctx.log.debug('UDS user command on device '+this.canIDhex+'. Dids='+String(dids));
            await this.pushCmnd(ctx, 'read', dids);
            await ctx.setStateAsync(this.userDidsToReadId, { val: JSON.stringify(dids), ack: true }); // Acknowlegde user command
        }
    }

    initialRequestSF(did) {
        return [this.readByDidProt.PCI, this.readByDidProt.SIDtx,((did >> 8) & 0xFF),(did & 0xFF),0x00,0x00,0x00,0x00];
    }

    canMessage(canID, frame) {
        return { id: canID,ext: false, rtr: false,data: Buffer.from(frame) };
    }

    async sendFrame(ctx, frame) {
        await this.config.channel.send(this.canMessage(this.config.canID,frame));
    }

    async readByDid(ctx, did) {
        if (await this.storage.getOpMode() == 'standby') {
            ctx.log.warn('UDS: Could not execute ReadByDid() for '+String(this.canIDhex)+'.'+String(did)+' due to opMode == standby.');
            return;
        }
        const state = await this.getComState();
        if (state != 0) {
            await ctx.log.warn('UDS: ReadByDid(): state '+this.states[state]+' != standby when called! Did '+String(this.canIDhex)+'.'+String(did)+'; Retry issued.');
            await this.pushCmnd(ctx, 'read', [did]);
            return;
        }
        this.cntCommTotal += 1;
        await this.setDidStart(ctx, did);
        await this.sendFrame(ctx, await this.initialRequestSF(did));
        await ctx.log.silly('ReadByDid(): '+String(this.canIDhex)+'.'+String(did));
    }

    async writeByDid(ctx, did) {
        await ctx.log.error('UDS: writeByDid() is not implemented yet. Did '+JSON.stringify(did)+' ignored.');
    }

    async msgUds(ctx, msg) {
        if (await this.storage.getOpMode() == 'standby') return;    // No communication in mode 'standby'

        const candata = msg.data.toJSON().data;

        switch (await this.getComState()) {
            case 0: // standby
                return;
            case 1: // waitForFF
                if ( (candata[0] == 0x03) && (candata[1] == 0x7F) && (candata[2] == this.readByDidProt.SIDtx) ) {
                    // Negative response
                    this.cntCommNR += 1;
                    if (this.callback) {
                        await this.callback(ctx, this, ['negative response', this.storage.udsScanResult]);
                    } else {
                        await ctx.log.error('msgUds(): Negative response on device '+this.canIDhex+'. Code=0x'+Number(candata[3]).toString(16));
                    }
                    await this.setDidDone(100);
                    break;
                }
                if ( (candata.length == 8) && ((candata[0] >> 4) == 0) && (candata[1] == this.readByDidProt.SIDrx) ) {
                    // Single-frame communication
                    const didRx = candata[3]+256*candata[2];
                    if (didRx == this.data.did) {
                        // Did does match
                        this.cntCommOk += 1;
                        await ctx.log.silly('msgUds SF: '+this.canIDhex+' '+JSON.stringify(candata));
                        this.data.len = candata[0]-3;
                        this.data.databytes = candata.slice(4,4+this.data.len);
                        await this.storage.decodeDataCAN(ctx, this.data.did, this.data.databytes.slice(0,this.data.len));
                        if (this.callback) await this.callback(ctx, this, ['ok', this.storage.udsScanResult]);
                        await this.setDidDone(0);
                        break;
                    } else {
                        // Did does not match
                        this.cntCommBad += 1;
                        if (this.callback) {
                            await this.callback(ctx, this, ['did mismatch SF', this.storage.udsScanResult]);
                        } else {
                            await ctx.log.error('msgUds(): Did mismatch SF on device '+this.canIDhex);
                        }
                        await this.setDidDone(1000);
                        break;
                    }
                }
                if ( (candata.length == 8) && ((candata[0] >> 4) == 1) && (candata[2] == this.readByDidProt.SIDrx) ) {
                    // Multiframe communication
                    const didRx = candata[4]+256*candata[3];
                    if (didRx == this.data.did) {
                        // Did does match
                        this.data.len = (candata[0] & 0x0F)*256 + candata[1] - 3;
                        await ctx.log.silly('msgUds FF: data.len='+String(this.data.len));
                        this.data.databytes = candata.slice(5);
                        this.data.D0 = 0x21;
                        await this.sendFrame(ctx, this.frameFC); // Send request for Consecutive Frames
                        await this.setComState(2);   // 'waitForCF'
                        break;
                    } else {
                        // Did does not match
                        this.cntCommBad += 1;
                        if (this.callback) {
                            await this.callback(ctx, this, ['did mismatch MF', this.storage.udsScanResult]);
                        } else {
                            await ctx.log.error('msgUds(): Did mismatch MF on device '+this.canIDhex+'. Expected='+String(this.data.did)+'; Received='+String(didRx));
                        }
                        await this.setDidDone(1000);
                        break;
                    }
                }
                if (this.callback) {
                    await this.callback(ctx, this, ['bad frame', this.storage.udsScanResult]);
                } else {
                    await ctx.log.error('msgUds(): Bad frame on device '+this.canIDhex+': '+JSON.stringify(candata));
                }
                this.cntCommBad += 1;
                await this.setDidDone(2500);
                break;

            case 2: // waitForCF
                if ( (candata.length == 8) && (candata[0] == this.data.D0) ) {
                    // Correct code for Consecutive Frame
                    ctx.log.silly('msgUds CF: '+this.canIDhex+' '+JSON.stringify(candata));
                    this.data.databytes = this.data.databytes.concat(candata.slice(1));
                    if (this.data.databytes.length >= this.data.len) {
                        // All data received
                        this.cntCommOk += 1;
                        await ctx.log.silly('msgUds multi frame completed: '+this.canIDhex+' '+JSON.stringify(this.data));
                        await this.storage.decodeDataCAN(ctx, this.data.did, this.data.databytes.slice(0,this.data.len));
                        if (this.callback) await this.callback(ctx, this, ['ok', this.storage.udsScanResult]);
                        await this.setDidDone(0);
                    } else {
                        // More data to come
                        this.data.D0 += 1;
                        if (this.data.D0 > 0x2F) {
                            this.data.D0 = 0x20;
                        }
                    }
                }
                break;

            default:
                this.cntCommBad += 1;
                if (this.callback) {
                    this.callback(ctx, this, ['bad state value', this.storage.udsScanResult]);
                } else {
                    ctx.log.error('msgUds(): Bad state value ('+String(await this.getComState())+') on device '+this.canIDhex);
                }
                await this.setDidDone(2500);
        }
    }
}

module.exports = {
    uds
};