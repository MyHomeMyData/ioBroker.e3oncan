
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
        this.canIDhex         = '0x'+Number(this.config.canID).toString(16);
        this.cmndQueueId      = 'admin.uds.'+this.canIDhex+'.cmndQueue';
        this.timeoutId        = 'admin.uds.'+this.canIDhex+'.timeout';
        this.schedulesId      = 'admin.uds.'+this.canIDhex+'.schedules';
        this.userDidsToReadId = 'uds.'+this.canIDhex+'.didsToRead';
    }

    async initStates(ctx) {
        await this.storage.initStates(ctx);
        await ctx.setObjectNotExistsAsync(this.cmndQueueId, {
            type: 'state',
            common: {
                name: 'Command queue for UDS communication',
                type: 'json',
                role: 'state',
                read: true,
                write: true,
            },
            native: {},
        });
        await ctx.setStateAsync(this.cmndQueueId, { val: JSON.stringify([]), ack: true });
        await ctx.setObjectNotExistsAsync(this.timeoutId, {
            type: 'state',
            common: {
                name: 'Timeout control for UDS communication. Gets null in case of timeout.',
                type: 'boolean',
                role: 'state',
                read: true,
                write: true,
            },
            native: {},
        });
        await ctx.setStateAsync(this.timeoutId, { val: false, ack: true });
        ctx.subscribeStates(this.timeoutId);
        await ctx.setObjectNotExistsAsync(this.schedulesId, {
            type: 'state',
            common: {
                name: 'List schedules to be read via UDS ReadByDid according to adapter configuration.',
                type: 'json',
                role: 'state',
                read: true,
                write: true,
            },
            native: {},
        });
        await ctx.setStateAsync(this.schedulesId, { val: JSON.stringify({}), ack: true });
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

    async addSchedule(ctx, schedule, dids) {
        // x
        const obj = await ctx.getStateAsync(this.schedulesId);
        const schedules = JSON.parse(obj.val);
        if (!Object.keys(schedules).includes(schedule)) {
            const didsArr = dids.replace(' ','').split(',');
            schedules[schedule] = didsArr.map(function(str) { return parseInt(str); });
            ctx.log.silly('addSchedule: '+String(schedule)+' '+JSON.stringify(schedules[schedule]));
            await ctx.setStateAsync(this.schedulesId, {val: JSON.stringify(schedules), ack: true});
        } else {
            ctx.log.warn('Multiple definiton of schedule: Dev='+this.config.stateBase+'; Schedule='+String(schedule));
        }
    }

    async pushCmnd(ctx, mode, dids) {
        const obj = await ctx.getStateAsync(this.cmndQueueId);
        const cmnds = JSON.parse(obj.val);
        cmnds.push({'mode':mode, 'dids': dids});
        await ctx.setStateAsync(this.cmndQueueId, {val: JSON.stringify(cmnds), ack: true});
    }

    sleep(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    async cmndLoop(ctx) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const obj = await ctx.getStateAsync(this.cmndQueueId);
            const cmnds = JSON.parse(obj.val);
            if ( (cmnds.length > 0) && (this.data.state == this.states[0]) ) {
                const cmnd = cmnds.shift();
                if (cmnd.mode == 'read') {
                    for (const did of Object.values(cmnd.dids)) {
                        // Do ReadByDid for each did
                        await this.readByDid(ctx,did);
                        await ctx.log.silly('cmndLoop()->ReadByDid: '+String(did));
                        while (this.data.state != this.states[0]) {
                            await this.sleep(10);
                        }
                        await this.sleep(10);
                    }
                } else {
                    ctx.log.error('Only UDS mode "readByDid" implemented yet.');
                }
                await ctx.setStateAsync(this.cmndQueueId, {val: JSON.stringify(cmnds), ack: true});
            }
            await this.sleep(100);
        }
    }

    async schedulesLoop(ctx) {
        const obj = await ctx.getStateAsync(this.schedulesId);
        const schedules = JSON.parse(obj.val);
        if (Object.keys(schedules).includes('0')) {
            // One time schedule
            await ctx.log.silly('scheduleLoop() one time: '+JSON.stringify(schedules[0]));
            await this.pushCmnd(ctx, 'read', schedules[0]);
        }
        let secsLast = -1;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const secs = Math.floor(new Date().getTime() / 1000);
            if (secs != secsLast) {
                secsLast = secs;
                for (const [sched, dids] of Object.entries(schedules)) {
                    if ( (Number(sched) > 0) && ((secs % Number(sched)) == 0) ) {
                        await ctx.log.silly('scheduleLoop(): '+JSON.stringify(dids));
                        await this.pushCmnd(ctx, 'read', dids);                    }
                }
            }
            await this.sleep(100);
        }
    }

    async onTimeoutChange(ctx, obj) {
        if (!obj) {
            ctx.log.error('UDS timeout on device '+this.canIDhex+'. Did='+String(this.data.did));
            await ctx.setStateAsync(this.timeoutId, { val: false, ack: true });
            this.data.state = this.states[0];   // Reset communication
        }
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
        if (this.data.state != this.states[0]) {
            await ctx.log.error('ReadByDid(): state != standBy when called! Aborting.');
            return;
        }
        this.data.state = this.states[1];   // 'waitForFF'
        await ctx.setStateAsync(this.timeoutId,
            { val: false, ack: true, expire: this.config.timeout });    // Start Timeout monitoring
        this.data.did = did;
        await this.sendFrame(ctx, this.initialRequestSF(did));
    }

    async msgUds(ctx, msg) {
        const candata = msg.data.toJSON().data;

        switch (this.data.state) {
            case 'standby':
                return;
            case 'waitForFF':
                if ( (candata[0] == 0x03) && (candata[1] == 0x7F) && (candata[2] == this.readByDidProt.SIDtx) ) {
                    // Negative response
                    this.data.state = this.states[0];
                    await ctx.setStateAsync(this.timeoutId, { val: false, ack: true }); // Stop timeout monitoring
                    ctx.log.error('msgUds(): Negative response on device '+this.canIDhex+'. Code=0x'+Number(candata[3]).toString(16));
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
                        await ctx.setStateAsync(this.timeoutId, { val: false, ack: true }); // Stop timeout monitoring
                        await this.storage.decodeDataCAN(ctx, this.data.did, this.data.databytes.slice(0,this.data.len));
                        this.data.state = this.states[0];       // 'standby'
                        break;
                    } else {
                        // Did does not match
                        this.data.state = this.states[0];       // 'standby'
                        await ctx.setStateAsync(this.timeoutId, { val: false, ack: true }); // Stop timeout monitoring
                        ctx.log.error('msgUds(): Did mismatch on device '+this.canIDhex);
                        break;
                    }
                }
                if ( (candata.length == 8) && ((candata[0] >> 4) == 1) && (candata[2] == this.readByDidProt.SIDrx) ) {
                    // Multiframe communication
                    ctx.log.silly('msgUds FF: '+this.canIDhex+' '+JSON.stringify(candata));
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
                        await ctx.setStateAsync(this.timeoutId, { val: false, ack: true }); // Stop timeout monitoring
                        ctx.log.error('msgUds(): Did mismatch on device '+this.canIDhex+'. Expected='+String(this.data.did)+'; Received='+String(didRx));
                        break;
                    }
                }
                ctx.log.error('msgUds(): Bad frame on device '+this.canIDhex+': '+JSON.stringify(candata));
                this.data.state = this.states[0];       // 'standby'
                await ctx.setStateAsync(this.timeoutId, { val: false, ack: true }); // Stop timeout monitoring
                break;

            case 'waitForCF':
                if ( (candata.length == 8) && (candata[0] == this.data.D0) ) {
                    // Correct code for Consecutive Frame
                    ctx.log.silly('msgUds CF: '+this.canIDhex+' '+JSON.stringify(candata));
                    this.data.databytes = this.data.databytes.concat(candata.slice(1));
                    if (this.data.databytes.length >= this.data.len) {
                        // All data received
                        ctx.log.silly('msgUds multi frame completed: '+this.canIDhex+' '+JSON.stringify(this.data));
                        await ctx.setStateAsync(this.timeoutId, { val: false, ack: true }); // Stop timeout monitoring
                        await this.storage.decodeDataCAN(ctx, this.data.did, this.data.databytes.slice(0,this.data.len));
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
                ctx.log.error('msgUds(): Bad state value ('+String(this.data.state)+') on device '+this.canIDhex);
                this.data.state = this.states[0];
                await ctx.setStateAsync(this.timeoutId, { val: false, ack: true }); // Stop timeout monitoring
        }
    }
}

module.exports = {
    uds
};