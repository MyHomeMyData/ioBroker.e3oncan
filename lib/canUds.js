
const storageCol = require('./storage');

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
            'state'     : this.states[0],
            'D0'        : 0x21
        };
        this.canIDhex          = '0x'+Number(this.config.canID).toString(16);
        this.cmndsQueue         = [];
        this.cmndsHandle       = null;
        this.cmndsUpdateTime   = 50;            // Check for new commands (ms)
        this.busy              = false;         // Agent is busy
        this.schedules         = {};
        this.schedHandle       = null;
        this.schedUpdateTime   = 100;           // Check for schedules (ms)
        this.schedSecsLast     = -1;
        this.userDidsToReadId  = 'uds.'+this.canIDhex+'.didsToRead';
        this.timeoutHandle     = null;
        this.callback          = null;
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

    async startup(ctx, opMode) {
        this.data.state == 'standby';
        this.busy = false;
        this.cmndsHandle = setInterval(async () => {
            await this.cmndsLoop(ctx);
        }, this.cmndsUpdateTime);
        this.schedHandle = setInterval(async () => {
            await this.schedulesLoop(ctx);
        }, this.schedUpdateTime);
        if (Object.keys(this.schedules).includes('0')) {
            // Execute one time schedules on startup
            await ctx.log.silly('scheduleLoop() one time: '+JSON.stringify(this.schedules[0]));
            await this.pushCmnd(ctx, 'read', this.schedules[0]);
        }
        await this.setAgentOpMode(opMode);
        if (opMode == 'normal') {
            await ctx.log.debug('UDS agent started on '+this.canIDhex);
        } else {
            await ctx.log.silly('UDS agent started in mode '+opMode+' on '+this.canIDhex);
        }
    }

    async stop(ctx) {
        this.schedHandle && await clearInterval(this.schedHandle);
        const tsAbort = new Date().getTime() + this.config.timeout;
        while ( (this.busy) && (new Date().getTime() < tsAbort) ) {
            await this.sleep(50);
        }
        const opMode = await this.storage.getOpMode();
        await this.storage.setOpMode('standby');
        this.cmndsHandle && await clearInterval(this.cmndsHandle);
        if (opMode == 'normal') {
            await ctx.log.debug('UDS agent stopped on '+this.canIDhex);
        } else {
            await ctx.log.silly('UDS agent stopped in mode '+opMode+' on '+this.canIDhex);
        }
    }

    async setCallback(callback) {
        this.callback = callback;
    }

    async checkDeviceAddress(ctx, did, maxWait, maxTrials) {
        // Check, if ReadByDid works on the address of this agent
        this.storage.udsScanResult = null;
        for (let i=0; i<maxTrials; i++) {
            const tsAbort = new Date().getTime() + maxWait;
            if (new Date().getTime() < tsAbort) {
                await this.readByDid(ctx, did);
                while ( (new Date().getTime() < tsAbort) && (this.busy) ) {
                    await this.sleep(50);
                }
            }
            if (this.storage.udsScanResult) break;
        }
        this.callback(ctx, this, []);
    }

    async addSchedule(ctx, schedule, dids) {
        if (!Object.keys(this.schedules).includes(schedule)) {
            const didsArr = dids.replace(' ','').split(',');
            this.schedules[schedule] = didsArr.map(function(str) { return parseInt(str); });
            ctx.log.silly('addSchedule: '+String(schedule)+' '+JSON.stringify(this.schedules[schedule]));
        } else {
            ctx.log.warn('Multiple definiton of schedule: Dev='+this.config.stateBase+'; Schedule='+String(schedule));
        }
    }

    async pushCmnd(ctx, mode, dids) {
        this.cmndsQueue.push({'mode':mode, 'dids': dids});
    }

    sleep(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    async cmndsLoop(ctx) {
        if ( (await this.storage.getOpMode() != 'standby') && (this.cmndsQueue.length > 0) && (this.data.state == 'standby') ) {
            const cmnd = this.cmndsQueue.shift();
            if (cmnd.mode == 'read') {
                for (const did of Object.values(cmnd.dids)) {
                    // Do ReadByDid for each did
                    await this.readByDid(ctx,did);
                    if (this.data.state == 'standby') ctx.log.debug('cmndsLoop: DAS KANN NICHT SEIN!');
                    await ctx.log.silly('cmndLoop()->ReadByDid: '+String(did));
                    const tsAbort = await (new Date().getTime() + this.config.timeout+100);
                    while ( (await this.data.state != 'standby') && (await new Date().getTime() < tsAbort) ) {
                        await this.sleep(5);
                    }
                    if (this.data.state != 'standby') {
                        await ctx.log.error('cmndsLoop did not reach standby. '+String(new Date().getTime()-tsAbort)+' state='+String(this.data.state)+'; did '+String(did)+' on device '+String(this.canIDhex));
                    }
                    await this.sleep(10);
                }
            }
        }
        if ( (this.cmndsQueue.length == 0) && (this.data.state == 'standby') ) this.busy = false;
    }

    async schedulesLoop(ctx) {
        const secs = Math.floor(new Date().getTime() / 1000);
        if (secs != this.schedSecsLast) {
            this.schedSecsLast = secs;
            for (const [sched, dids] of Object.entries(this.schedules)) {
                if ( (Number(sched) > 0) && ((secs % Number(sched)) == 0) ) {
                    await ctx.log.silly('scheduleLoop(): '+JSON.stringify(dids));
                    await this.pushCmnd(ctx, 'read', dids);                    }
            }
        }
    }

    async onTimeout(ctxGlobal, ctxLocal) {
        const opMode = await ctxLocal.storage.getOpMode();
        if ( (opMode != 'udsDevScan') && ((opMode != 'udsDidScan')) ) {
            ctxGlobal.log.error('UDS timeout on device '+ctxLocal.canIDhex+'. Did='+String(ctxLocal.data.did));
        }
        if (ctxLocal.callback) ctxLocal.callback(ctxGlobal, ctxLocal, ['timeout', ctxLocal.data.did]);
        ctxLocal.timeoutHandle = null;
        ctxLocal.data.state = ctxLocal.states[0];   // Reset communication
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
        if (await this.data.state != 'standby') {
            await ctx.log.error('ReadByDid(): state != standby when called! state='+String(this.data.state)+'; Did '+String(did)+' on device '+String(this.canIDhex));
            return;
        }
        this.data.state = this.states[1];   // 'waitForFF'
        this.busy = true;
        this.timeoutHandle = await setTimeout(this.onTimeout, this.config.timeout, ctx, this);
        this.data.did = did;
        await this.sendFrame(ctx, this.initialRequestSF(did));
    }

    async msgUds(ctx, msg) {
        if (await this.storage.getOpMode() == 'standby') return;    // No communication in mode 'standby'

        const candata = msg.data.toJSON().data;

        switch (this.data.state) {
            case 'standby':
                return;
            case 'waitForFF':
                if ( (candata[0] == 0x03) && (candata[1] == 0x7F) && (candata[2] == this.readByDidProt.SIDtx) ) {
                    // Negative response
                    if (this.timeoutHandle) await clearTimeout(this.timeoutHandle);     // Stop timeout monitoring
                    if (await this.getAgentOpMode() == 'udsDidScan') {
                        if (this.callback) this.callback(ctx, this, ['negative response', this.data.did]);
                    } else {
                        ctx.log.error('msgUds(): Negative response on device '+this.canIDhex+'. Code=0x'+Number(candata[3]).toString(16));
                    }
                    this.data.state = this.states[0];
                    break;
                }
                if ( (candata.length == 8) && ((candata[0] >> 4) == 0) && (candata[1] == this.readByDidProt.SIDrx) ) {
                    // Single-frame communication
                    const didRx = candata[3]+256*candata[2];
                    if (didRx == this.data.did) {
                        // Did does match
                        ctx.log.silly('msgUds SF: '+this.canIDhex+' '+JSON.stringify(candata));
                        this.data.len = candata[0]-3;
                        this.data.databytes = candata.slice(4,4+this.data.len);
                        await this.storage.decodeDataCAN(ctx, this.data.did, this.data.databytes.slice(0,this.data.len));
                        if (this.timeoutHandle) await clearTimeout(this.timeoutHandle);     // Stop timeout monitoring
                        if ( (await this.getAgentOpMode() == 'udsDidScan') && (this.callback) ) this.callback(ctx, this, ['ok', this.data.did]);
                        this.data.state = this.states[0];       // 'standby'
                        break;
                    } else {
                        // Did does not match
                        if (this.timeoutHandle) await clearTimeout(this.timeoutHandle);     // Stop timeout monitoring
                        if (await this.getAgentOpMode() == 'udsDidScan') {
                            if (this.callback) this.callback(ctx, this, ['did mismatch', this.data.did]);
                        } else {
                            ctx.log.error('msgUds(): Did mismatch on device '+this.canIDhex);
                        }
                        this.data.state = this.states[0];       // 'standby'
                        break;
                    }
                }
                if ( (candata.length == 8) && ((candata[0] >> 4) == 1) && (candata[2] == this.readByDidProt.SIDrx) ) {
                    // Multiframe communication
                    const didRx = candata[4]+256*candata[3];
                    if (didRx == this.data.did) {
                        // Did does match
                        this.data.len = (candata[0] & 0x0F)*256 + candata[1] - 3;
                        ctx.log.silly('msgUds FF: data.len='+String(this.data.len));
                        this.data.databytes = candata.slice(5,4+this.data.len);
                        this.data.D0 = 0x21;
                        await this.sendFrame(ctx, this.frameFC); // Send request for Consecutive Frames
                        this.data.state = this.states[2];   // 'waitForCF'
                        break;
                    } else {
                        // Did does not match
                        this.data.state = this.states[0];
                        if (this.timeoutHandle) await clearTimeout(this.timeoutHandle);     // Stop timeout monitoring
                        if (await this.getAgentOpMode() == 'udsDidScan') {
                            if (this.callback) this.callback(ctx, this, ['did mismatch', this.data.did]);
                        } else {
                            ctx.log.error('msgUds(): Did mismatch on device '+this.canIDhex+'. Expected='+String(this.data.did)+'; Received='+String(didRx));
                        }
                        this.data.state = this.states[0];
                        break;
                    }
                }
                if (this.timeoutHandle) await clearTimeout(this.timeoutHandle);     // Stop timeout monitoring
                if (await this.getAgentOpMode() == 'udsDidScan') {
                    if (this.callback) this.callback(ctx, this, ['bad frame', this.data.did]);
                } else {
                    ctx.log.error('msgUds(): Bad frame on device '+this.canIDhex+': '+JSON.stringify(candata));
                }
                this.data.state = this.states[0];       // 'standby'
                break;

            case 'waitForCF':
                if ( (candata.length == 8) && (candata[0] == this.data.D0) ) {
                    // Correct code for Consecutive Frame
                    ctx.log.silly('msgUds CF: '+this.canIDhex+' '+JSON.stringify(candata));
                    this.data.databytes = this.data.databytes.concat(candata.slice(1));
                    if (this.data.databytes.length >= this.data.len) {
                        // All data received
                        ctx.log.silly('msgUds multi frame completed: '+this.canIDhex+' '+JSON.stringify(this.data));
                        if (this.timeoutHandle) await clearTimeout(this.timeoutHandle);     // Stop timeout monitoring
                        await this.storage.decodeDataCAN(ctx, this.data.did, this.data.databytes.slice(0,this.data.len));
                        if ( (await this.getAgentOpMode() == 'udsDidScan') && (this.callback) ) this.callback(ctx, this, ['ok', this.data.did]);
                        this.data.state = this.states[0];
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
                if (this.timeoutHandle) await clearTimeout(this.timeoutHandle);     // Stop timeout monitoring
                if (await this.getAgentOpMode() == 'udsDidScan') {
                    if (this.callback) this.callback(ctx, this, ['bad state value', this.data.did]);
                } else {
                    ctx.log.error('msgUds(): Bad state value ('+String(this.data.state)+') on device '+this.canIDhex);
                }
                this.data.state = this.states[0];
        }
    }
}

module.exports = {
    uds
};