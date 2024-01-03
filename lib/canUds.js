const storage = require('./storage');

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
        try {
            if (this.schedHandle) await clearInterval(this.schedHandle);
            await this.ctxGlobal.log.silly('UDS schedule stopped: '+String(this.schedule)+' '+this.ctxLocal.canIDhex+'.'+JSON.stringify(this.dids));
        } catch (e) {
            // Dod nothing
        }
    }

    async loop() {
        await this.ctxGlobal.log.silly('UDS schedule: '+String(this.schedule)+' '+this.ctxLocal.canIDhex+'.'+JSON.stringify(this.dids));
        await this.ctxLocal.pushCmnd(this.ctxGlobal, 'read', this.dids);
    }
}

class uds {
    constructor(config) {
        this.config = config;
        this.config.statId = 'statUDS';
        this.config.worker = 'uds';
        this.storage = new storage.storage(this.config);
        this.states = ['standby','waitForFFrbd','waitForCFrbd','waitForFFSFwbd','waitForFFMFwbd'];
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
        this.writeByDidProt = {
            'idTx'  : this.config.canID,
            'idRx'  : Number(this.config.canID) + 0x10,
            'PCI'   : 0x00,     // Protocol Control Information = length of data +3
            'SIDtx' : 0x2E,     // Service ID transmit
            'SIDrx' : 0x6E,     // Service ID receive
            'SIDnr' : 0x7F,     // SID negative response
            'FCrx'  : 0x30,     // Flow Control ID for MF transfer
        };
        this.data = {
            'len'       : 0,
            'tsRequest' : 0,
            'tsReply'   : 0,
            'tsTotal'   : 0,
            'databytes' : [],
            'did'       : 0,
            'state'     : 0,
            'D0'        : 0x21,
            'txPos'     : 0
        };
        this.canIDhex          = '0x'+Number(this.config.canID).toString(16);
        this.cmndsQueue        = [];
        this.cmndsHandle       = null;
        this.cmndsUpdateTime   = 40;            // Check for new commands (ms)
        this.busy              = false;         // Worker is busy
        this.commBusy          = false;         // Communication routine running
        this.schedules         = {};
        this.userReadByDidId   = this.config.stateBase+'.cmnd.udsReadByDid';
        this.timeoutHandle     = null;
        this.callback          = null;
        this.coolDownTs        = 0;             // Earliest time for next communication
        this.stat = {
            state               : 'standby',
            cntCommTotal        : 0,            // Number of startes communications
            cntCommOk           : 0,            // Number of succesfull communications
            cntCommNR           : 0,            // Number of communications ending in negative response
            cntCommTimeout      : 0,            // Number of communications ending in timeout
            cntCommTimeoutPerDid: {},           // Number of communications ending in timeout for specific did
            cntCommBadProtocol  : 0,            // Number of bad communications, e.g. bad frame
            cntTooBusy          : 0,            // Number of conflicting calls of msgUds()
            replyTime           : {min:this.config.timeout,max:0,mean:0},
            nextTs              : 0,            // Timestamp for next storage (earliest)
            tsMinStep           : 5000          // Minimum time step between storages
        };
    }

    async initStates(ctx, opMode) {
        await this.storage.initStates(ctx, opMode);
        if (['standby','normal','udsDidScan'].includes(opMode)) {
            await ctx.setObjectNotExistsAsync(this.config.stateBase+'.cmnd', {
                type: 'channel',
                common: {
                    name: this.config.stateBase+' commands',
                    role: 'device'
                },
                native: {},
            });
            await ctx.setObjectNotExistsAsync(this.userReadByDidId, {
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
            await ctx.setStateAsync(this.userReadByDidId, { val: JSON.stringify([]), ack: true });
            await this.storage.storeStatistics(ctx, this, true);
        }
        this.stat.state = 'standby';
    }

    async startup(ctx, opMode) {
        await this.setComState(0);
        await this.setWorkerOpMode(opMode);
        this.stat.state = 'active';
        await this.storage.storeStatistics(ctx, this, true);
        if (opMode == 'normal') {
            for (const sched of Object.values(this.schedules)) {
                // Start schedules on startup and do one-time schedules
                await sched.startSchedule();
            }
        }
        if (opMode == 'normal') {
            await ctx.log.info('UDS worker started on '+this.config.stateBase);
        } else {
            await ctx.log.silly('UDS worker started in mode '+opMode+' on '+this.config.stateBase);
        }
        this.cmndsHandle = setInterval(async () => {
            await this.cmndsLoop(ctx);
        }, this.cmndsUpdateTime);
    }

    async stop(ctx) {
        try {
            if (this.stat.state == 'stopped') return;

            this.stat.state = 'stopped';
            const opMode = await this.storage.getOpMode();

            await this.storage.storeStatistics(ctx, this, true);
            await this.storage.setOpMode('standby');

            // Stop loops:
            for (const sched of Object.values(this.schedules)) {
                await sched.stopSchedule();
            }
            if (this.cmndsHandle) await clearInterval(this.cmndsHandle);

            // Stop Timeout:
            if (this.timeoutHandle) await clearTimeout(this.timeoutHandle);
            this.timeoutHandle = null;

            // Stop worker:
            this.callback = null;
            if (opMode == 'normal') {
                await ctx.log.info('UDS worker stopped on '+this.config.stateBase);
            } else {
                await ctx.log.silly('UDS worker stopped in mode '+opMode+' on '+this.config.stateBase);
            }
        } catch (e) {
            await ctx.log.error('UDS worker on '+this.config.stateBase+' could not be stopped. err='+e.message);
        }
    }

    async setWorkerOpMode(opMode) {
        await this.storage.setOpMode(opMode);
    }

    async getWorkerOpMode() {
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

    async setDidStart(ctx, did, mode, len) {
        switch (mode) {
            case 'read':
                await this.setComState(1);   // 'waitForFFrbd'
                break;
            case 'write':
                if (len<=4) {
                    // Single frame communication
                    await this.setComState(3);   // 'waitForFFSFwbd'
                } else {
                    // Multi frame communication
                    await this.setComState(4);   // 'waitForFFMFwbd'
                }
                break;
            default:
                ctx.log.warn('UDS worker started on '+this.config.stateBase+': mode '+mode+' not implemented.');
        }
        const tsNow = new Date().getTime();
        const minWaiting = this.coolDownTs - tsNow;
        if (minWaiting > 0) await this.sleep(minWaiting);
        this.busy = true;
        this.timeoutHandle = await setTimeout(this.onTimeout, this.config.timeout, ctx, this);
        this.data.did = did;
        this.data.tsRequest = tsNow;
    }

    async calcStat() {
        this.data.tsReply = new Date().getTime();
        const rt = this.data.tsReply - this.data.tsRequest;
        this.data.tsTotal += rt;
        if (rt < this.stat.replyTime.min) this.stat.replyTime.min = rt;
        if (rt > this.stat.replyTime.max) this.stat.replyTime.max = rt;
        this.stat.replyTime.mean = Math.round(this.data.tsTotal/this.stat.cntCommOk);
    }

    async setCallback(callback) {
        this.callback = callback;
    }

    async addSchedule(ctx, schedule, dids) {
        if (!Object.keys(this.schedules).includes(schedule)) {
            const didsArr = dids.replace(' ','').split(',');
            this.schedules[schedule] = new scheduleLoop(ctx, this, schedule, didsArr.map(function(str) { return parseInt(str); }));
            ctx.log.silly('UDS worker on '+this.config.stateBase+': Added schedule '+String(schedule)+'s '+JSON.stringify(didsArr));
        } else {
            ctx.log.warn('UDS worker warning on '+this.config.stateBase+': Multiple definiton of schedule:'+String(schedule)+'s');
        }
    }

    async pushCmnd(ctx, mode, dids) {
        await ctx.log.silly('UDS worker on '+this.config.stateBase+': pushCmnd(): '+mode+' '+String(this.canIDhex)+'.'+String(JSON.stringify(dids)));
        if (Array.isArray(dids)) {
            for (const did of Object.values(dids)) {
                await this.cmndsQueue.push({'mode':mode, 'did': did});
            }
        } else {
            await ctx.log.warn('UDS worker warning on '+this.config.stateBase+': Wrong format for command. dids have to be array. Got dids='+JSON.stringify(dids));
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
                    await ctx.log.silly('UDS worker on '+this.config.stateBase+': cmndLoop()->readByDid(): '+String(cmnd.did));
                    break;
                }
                case 'write': {
                    // WriteByDid
                    await this.writeByDid(ctx,cmnd.did);
                    await ctx.log.silly('UDS worker on '+this.config.stateBase+': cmndLoop()->writeByDid(): '+String(cmnd.did));
                    break;
                }
                default: {
                    await ctx.log.error('UDS worker on '+this.config.stateBase+': Received unknown command '+cmnd.mode);
                }
            }
        }
    }

    async onTimeout(ctxGlobal, ctxLocal) {
        const opMode = await ctxLocal.storage.getOpMode();
        if (['standby','normal'].includes(opMode)) {
            await ctxGlobal.log.error('UDS timeout on '+ctxLocal.canIDhex+'.'+String(ctxLocal.data.did));
        }
        ctxLocal.stat.cntCommTimeout += 1;
        const did = await Number(ctxLocal.data.did);
        if (did in ctxLocal.stat.cntCommTimeoutPerDid) {
            ctxLocal.stat.cntCommTimeoutPerDid[did] += 1;
        } else {
            ctxLocal.stat.cntCommTimeoutPerDid[did]  = 1;
        }
        if (ctxLocal.callback) await ctxLocal.callback(ctxGlobal, ctxLocal, ['timeout', {'did':ctxLocal.data.did,'didInfo':{'id':'','len':0},'val':''}]);
        await ctxLocal.setDidDone(0);
    }

    async onUdsStateChange(ctx, id, state) {
        if (id.includes(this.userReadByDidId)) {
            // User requests ReadByDid
            const dids = JSON.parse(state.val);
            await ctx.log.debug('UDS user command ReadByDid on '+this.config.stateBase+'. Dids='+JSON.stringify(dids));
            await this.pushCmnd(ctx, 'read', dids);
            await ctx.setStateAsync(id, { val: JSON.stringify(dids), ack: true }); // Acknowlegde user command
        }
        if (id.includes('.json.')) {
            // User requests WriteByDid for specific did
            const i = id.indexOf('.json.')+6;   // Index of start of did
            const did = Number(id.slice(i,i+4));
            //ctx.log.debug(JSON.stringify(JSON.parse(state.val)));
            const valArr = await this.storage.encodeDataCAN(ctx, this, did, JSON.parse(state.val));
            await ctx.log.debug('UDS user command WriteByDid on '+this.config.stateBase+'.'+String(did)+': '+JSON.stringify(valArr));
            if (valArr) {
                await this.storage.setOpMode('TEST');
                const valJson = await this.storage.decodeDataCAN(ctx, this, did, valArr);
                if (JSON.stringify(JSON.parse(state.val)) == JSON.stringify(valJson)) {
                    ctx.log.debug('SUCESS');
                } else {
                    await ctx.log.debug('Length = '+String(valArr.length));
                    await ctx.log.debug('valArr = '+JSON.stringify(valArr));
                    await ctx.log.debug('Source = '+JSON.stringify(JSON.parse(state.val)));
                    await ctx.log.debug('Result = '+JSON.stringify(valJson));
                }
                await this.storage.setOpMode('normal');
            }
            //const ts = valArr[3]*Math.pow(2,24)+valArr[2]*Math.pow(2,16)+valArr[1]*Math.pow(2,8)+valArr[0];
            //await ctx.log.debug(new Date(ts*1000));
            //await ctx.log.error('UDS user command WriteByDid on '+this.config.stateBase+'.'+String(did)+' - JSON format not supported yet.');
        }
        if (id.includes('.raw.')) {
            // User requests WriteByDid for specific did
            const i = id.indexOf('.raw.')+5;   // Index of start of did
            const did = Number(id.slice(i,i+4));
            const val = await this.storage.toByteArray(JSON.parse(state.val));
            await ctx.log.debug('UDS user command WriteByDid on '+this.config.stateBase+'.'+String(did)+'='+this.storage.arr2Hex(val));
            await this.pushCmnd(ctx, 'write', [[did,val]]);
            setTimeout(function(ctx,did){ctx.cmndsQueue.push({'mode':'read', 'did': did});},2500,this,did);    // Read value after 2500 ms
        }
        if (id.includes('.tree.')) {
            // User requests WriteByDid for specific did
            const i = id.indexOf('.tree.')+6;   // Index of start of did
            const did = Number(id.slice(i,i+4));
            if (id.slice(i).includes('.')) {
                // Datapoint has sub structure. Not supported yet
                /*
                await ctx.log.error('UDS user command WriteByDid on '+this.config.stateBase+'.'+String(did)+': Did has sub structure. Not supported yet.');
                const idBase = id.slice(ctx.namespace.length+1,i+id.slice(i).indexOf('.'));
                const valSubId = id.slice(i+id.slice(i).indexOf('.')+1);
                const val = JSON.parse(state.val);
                const valDict = JSON.parse((await ctx.getStateAsync(idBase.replace('.tree.','.json.'))).val);
                await this.storage.mergeToJson(ctx, valSubId, val, valDict);
                */
                ///*
                //const idBase = id.slice(ctx.namespace.length+1,i+id.slice(i).indexOf('.'));
                const idBase = id.slice(0,i+id.slice(i).indexOf('.'));
                await ctx.log.debug(idBase);
                ctx.log.debug(JSON.stringify(ctx.idToDCS(id)));
                await ctx.getStatesOf(async function(err,obj) {
                    const data =[];
                    for (const st of Object.values(obj)) {
                        if (st._id.includes(idBase)) {
                            await ctx.log.debug(st._id.slice(ctx.namespace.length+1));
                            data.push(await JSON.parse((await (ctx.getStateAsync(st._id.slice(ctx.namespace.length+1)))).val));
                        }
                    }
                    await ctx.log.debug(JSON.stringify(data));
                });
                //await ctx.getObject(idBase, function(err,obj) {ctx.log.debug(JSON.stringify(obj));});
                //await ctx.log.debug(await JSON.stringify((await ctx.getObject((idBase)).val));
                //*/
                return;
            }
            const val = await this.storage.encodeDataCAN(ctx, this, did, String(JSON.parse(state.val)));
            await ctx.log.debug('UDS user command WriteByDid on '+this.config.stateBase+'.'+String(did)+'='+this.storage.arr2Hex(val));
            await this.pushCmnd(ctx, 'write', [[did,val]]);
            setTimeout(function(ctx,did){ctx.cmndsQueue.push({'mode':'read', 'did': did});},2500,this,did);    // Read value after 2500 ms
        }
    }

    initialRequestReadSF(did) {
        return [this.readByDidProt.PCI, this.readByDidProt.SIDtx,((did >> 8) & 0xFF),(did & 0xFF),0x00,0x00,0x00,0x00];
    }

    initialRequestWrite(did, valRaw, len) {
        let frame;
        if (len <= 4) {
            // Single frame communication
            frame = [this.writeByDidProt.PCI+len+3, this.writeByDidProt.SIDtx,((did >> 8) & 0xFF),(did & 0xFF),0x00,0x00,0x00,0x00];
            for (let i=0; i<len; i++) {
                frame[i+4] = valRaw[i];
            }
        } else {
            // Multi frame communication
            frame = [this.writeByDidProt.PCI+0x10, len+3, this.writeByDidProt.SIDtx,((did >> 8) & 0xFF),(did & 0xFF),0x00,0x00,0x00];
            for (let i=0; i<3; i++) {
                frame[i+5] = valRaw[i];
            }
        }
        return(frame);
    }

    canMessage(canID, frame) {
        return { id: canID,ext: false, rtr: false,data: Buffer.from(frame) };
    }

    async sendFrame(ctx, frame) {
        await this.config.channel.send(this.canMessage(this.config.canID,frame));
    }

    async readByDid(ctx, did) {
        if (await this.storage.getOpMode() == 'standby') {
            ctx.log.warn('UDS worker warning on '+this.config.stateBase+': Could not execute ReadByDid() for '+String(this.canIDhex)+'.'+String(did)+' due to opMode == standby.');
            return;
        }
        const state = await this.getComState();
        if (state != 0) {
            await ctx.log.warn('UDS worker warning on '+this.config.stateBase+': ReadByDid(): state '+this.states[state]+' != standby when called! Did '+String(this.canIDhex)+'.'+String(did)+'; Retry issued.');
            await this.pushCmnd(ctx, 'read', [did]);
            return;
        }
        this.stat.cntCommTotal += 1;
        await this.setDidStart(ctx, did, 'read', 0);
        await this.sendFrame(ctx, await this.initialRequestReadSF(did));
        await ctx.log.silly('UDS worker on '+this.config.stateBase+': ReadByDid(): '+String(this.canIDhex)+'.'+String(did));
    }

    async writeByDid(ctx, didArr) {
        if (await this.storage.getOpMode() == 'standby') {
            ctx.log.warn('UDS worker warning on '+this.config.stateBase+': Could not execute WriteByDid() for '+String(this.canIDhex)+'.'+JSON.stringify(didArr)+' due to opMode == standby.');
            return;
        }
        const did=didArr[0];
        const valRaw=didArr[1];
        const len=valRaw.length;
        this.stat.cntCommTotal += 1;
        this.data.len = len;
        this.data.databytes = valRaw.concat(0x00,0x00,0x00,0x00,0x00,0x00,0x00);  // Add padding
        this.data.did = did;
        this.data.txPos = 3;
        this.data.D0 = 0x21;
        await this.setDidStart(ctx, did, 'write', len);
        await this.sendFrame(ctx, await this.initialRequestWrite(did, valRaw, len));
        await ctx.log.silly('UDS worker on '+this.config.stateBase+': WriteByDid(): '+String(this.canIDhex)+'.'+String(did)+'='+this.storage.arr2Hex(valRaw));
    }

    async msgUds(ctx, msg) {

        if (await this.storage.getOpMode() == 'standby') return;    // No communication in mode 'standby'

        if (this.commBusy) {
            this.stat.cntTooBusy += 1;
            if (this.stat.cntTooBusy == 1) ctx.log.warn('UDS worker warning on '+this.config.stateBase+': Evaluation of messages overloaded.');
            return;
        }

        this.commBusy = true;

        const candata = msg.data.toJSON().data;

        switch (await this.getComState()) {
            case 0: // standby
                break;
            case 1: // waitForFFrbd
                if ( (candata[0] == 0x03) && (candata[1] == 0x7F) && (candata[2] == this.readByDidProt.SIDtx) ) {
                    // Negative response
                    this.stat.cntCommNR += 1;
                    if (this.callback) {
                        this.callback(ctx, this, ['negative response', {'did':this.data.did,'didInfo':{'id':'','len':0},'val':''}]);
                    } else {
                        ctx.log.error('UDS worker error on '+this.config.stateBase+': Negative response on device '+this.canIDhex+'. Code=0x'+Number(candata[3]).toString(16));
                    }
                    await this.setDidDone(0);
                    break;
                }
                if ( (candata.length == 8) && ((candata[0] >> 4) == 0) && (candata[1] == this.readByDidProt.SIDrx) ) {
                    // Single-frame communication
                    const didRx = candata[3]+256*candata[2];
                    if (didRx == this.data.did) {
                        // Did does match
                        this.stat.cntCommOk += 1;
                        ctx.log.silly('UDS worker on '+this.config.stateBase+': SF received. candata: '+this.storage.arr2Hex(candata));
                        await this.calcStat();
                        this.data.len = candata[0]-3;
                        this.data.databytes = candata.slice(4,4+this.data.len);
                        this.storage.decodeDataCAN(ctx, this, this.data.did, this.data.databytes.slice(0,this.data.len));
                        await this.setDidDone(0);
                        break;
                    } else {
                        // Did does not match
                        this.stat.cntCommBadProtocol += 1;
                        if (this.callback) {
                            this.callback(ctx, this, ['did mismatch SF', {'did':this.data.did,'didInfo':{'id':'','len':0},'val':''}]);
                        } else {
                            ctx.log.error('UDS worker on '+this.config.stateBase+': Did mismatch MF. Expected='+String(this.data.did)+'; Received='+String(didRx));
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
                        ctx.log.silly('UDS worker on '+this.config.stateBase+': FF received. candata: '+this.storage.arr2Hex(candata));
                        this.data.databytes = candata.slice(5);
                        this.data.D0 = 0x21;
                        this.sendFrame(ctx, this.frameFC); // Send request for Consecutive Frames
                        await this.setComState(2);   // 'waitForCFrbd'
                        break;
                    } else {
                        // Did does not match
                        this.stat.cntCommBadProtocol += 1;
                        await this.calcStat();
                        if (this.callback) {
                            this.callback(ctx, this, ['did mismatch MF', {'did':this.data.did,'didInfo':{'id':'','len':0},'val':''}]);
                        } else {
                            ctx.log.error('UDS worker on '+this.config.stateBase+': Did mismatch MF. Expected='+String(this.data.did)+'; Received='+String(didRx));
                        }
                        await this.setDidDone(1000);
                        break;
                    }
                }
                if (this.callback) {
                    this.callback(ctx, this, ['bad MF frame', {'did':this.data.did,'didInfo':{'id':'','len':0},'val':''}]);
                } else {
                    ctx.log.error('UDS worker on '+this.config.stateBase+': Bad frame. candata: '+this.storage.arr2Hex(candata));
                }
                await this.calcStat();
                this.stat.cntCommBadProtocol += 1;
                await this.setDidDone(2500);
                break;

            case 2: // waitForCFrbd
                if ( (candata.length == 8) && (candata[0] == this.data.D0) ) {
                    // Correct code for Consecutive Frame
                    ctx.log.silly('UDS worker on '+this.config.stateBase+': CF received. candata: '+this.storage.arr2Hex(candata));
                    this.data.databytes = this.data.databytes.concat(candata.slice(1));
                    if (this.data.databytes.length >= this.data.len) {
                        // All data received
                        this.stat.cntCommOk += 1;
                        await this.calcStat();
                        ctx.log.silly('UDS worker on '+this.config.stateBase+': MF completed. candata: '+this.storage.arr2Hex(candata));
                        this.storage.decodeDataCAN(ctx, this, this.data.did, this.data.databytes.slice(0,this.data.len));
                        await this.setDidDone(0);
                    } else {
                        // More data to come
                        this.data.D0 += 1;
                        if (this.data.D0 > 0x2F) this.data.D0 = 0x20;
                    }
                } else {
                    // Bad CF
                    if (this.callback) {
                        this.callback(ctx, this, ['bad CF frame', {'did':this.data.did,'didInfo':{'id':'','len':0},'val':''}]);
                    } else {
                        ctx.log.error('UDS worker on '+this.config.stateBase+': Bad frame. candata: '+this.storage.arr2Hex(candata));
                    }
                    this.stat.cntCommBadProtocol += 1;
                    await this.setDidDone(2500);
                }
                break;

            case 3: // waitForFFSFwbd
                if ( (candata[0] == 0x03) && (candata[1] == 0x7F) && (candata[2] == this.writeByDidProt.SIDtx) ) {
                    // Negative response
                    this.stat.cntCommNR += 1;
                    ctx.log.error('UDS worker error on '+this.config.stateBase+': Negative response on device '+this.canIDhex+'. Code=0x'+Number(candata[3]).toString(16));
                    await this.setDidDone(0);
                    break;
                }
                if ( (candata.length == 8) && (candata[0] == 0x03) && (candata[1] == this.writeByDidProt.SIDrx) ) {
                    // Single-frame communication
                    const didRx = candata[3]+256*candata[2];
                    if (didRx == this.data.did) {
                        // Did does match
                        this.stat.cntCommOk += 1;
                        ctx.log.silly('UDS worker on '+this.config.stateBase+': writeByDid SF confirmation received.');
                        await this.calcStat();
                        this.storage.storeStatistics(ctx, this, false);
                        await this.setDidDone(0);
                        break;
                    } else {
                        // Did does not match
                        this.stat.cntCommBadProtocol += 1;
                        ctx.log.error('UDS worker on '+this.config.stateBase+': Did mismatch writeByDid SF. Expected='+String(this.data.did)+'; Received='+String(didRx));
                        await this.calcStat();
                        this.storage.storeStatistics(ctx, this, true);
                        await this.setDidDone(1000);
                        break;
                    }
                }
                ctx.log.error('UDS worker on '+this.config.stateBase+': Bad frame for writeByDid SF. candata: '+this.storage.arr2Hex(candata));
                this.stat.cntCommBadProtocol += 1;
                await this.calcStat();
                await this.setDidDone(2500);
                break;

            case 4: // waitForFFFwbd
                if ( (candata[0] == 0x03) && (candata[1] == 0x7F) && (candata[2] == this.writeByDidProt.SIDtx) ) {
                    // Negative response
                    this.stat.cntCommNR += 1;
                    ctx.log.error('UDS worker error on '+this.config.stateBase+': Negative response on device '+this.canIDhex+'. Code=0x'+Number(candata[3]).toString(16));
                    await this.setDidDone(0);
                    break;
                }
                if ( (candata.length == 8) && (candata[0] == 0x30) && (candata[1] == 0x00) ) {
                    // Multi-frame communication confirmed
                    // Send data in slices of 7 bytes
                    let ST = candata[2];  // Separation Time (ms)
                    if ((ST<20) || (ST>127)) ST=50; // Accept ST 20 .. 127 ms. Default to 50 ms.
                    while (this.data.txPos < this.data.len) {
                        // More data to send
                        await this.sleep(ST);
                        const frame = [this.data.D0].concat(this.data.databytes.slice(this.data.txPos,this.data.txPos+7));
                        await this.sendFrame(ctx, frame);
                        this.data.txPos += 7;
                        this.data.D0 += 1;
                        if (this.data.D0 > 0x2f) this.data.D0 = 0x20;
                    }
                    await this.setComState(3);  // waitForFFSFwbd (wait for confirmation)
                    break;
                }
                ctx.log.error('UDS worker on '+this.config.stateBase+': Bad frame for writeByDid MF. candata: '+this.storage.arr2Hex(candata));
                this.stat.cntCommBadProtocol += 1;
                await this.calcStat();
                await this.setDidDone(2500);
                break;

            default:
                this.stat.cntCommBadProtocol += 1;
                if (this.callback) {
                    this.callback(ctx, this, ['bad state value', {'did':this.data.did,'didInfo':{'id':'','len':0},'val':''}]);
                } else {
                    ctx.log.error('UDS worker on '+this.config.stateBase+': Bad state value: '+String(await this.getComState()));
                }
                await this.setDidDone(2500);
        }
        this.commBusy = false;
    }
}

module.exports = {
    uds
};