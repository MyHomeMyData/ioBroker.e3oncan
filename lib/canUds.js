const storage = require('./storage');

class scheduleLoop {
    constructor(ctxGlobal, ctxLocal, schedule) {
        this.ctxGlobal   = ctxGlobal;
        this.ctxLocal    = ctxLocal;
        this.schedule    = schedule;
        this.dids        = [];
        this.schedHandle = null;
    }

    async startSchedule(ctx) {
        if (this.schedule == 0) {
            await this.ctxGlobal.log.silly('UDS schedule one time: '+this.ctxLocal.canIDhex+'.'+JSON.stringify(this.dids));
            await this.ctxLocal.pushCmnd(this.ctxGlobal, 'read', this.dids);
            this.schedHandle = null;
        } else {
            this.schedHandle = ctx.setInterval(async () => {
                await this.loop();
            }, this.schedule*1000);
        }
    }

    async stopSchedule(ctx) {
        try {
            if (this.schedHandle) await ctx.clearInterval(this.schedHandle);
            await this.ctxGlobal.log.silly('UDS schedule stopped: '+String(this.schedule)+' '+this.ctxLocal.canIDhex+'.'+JSON.stringify(this.dids));
        } catch (e) {
            // Dod nothing
        }
    }

    async addDids(dids) {
        const didsArr = dids.replace(' ','').split(',');
        this.dids = this.dids.concat(didsArr.map(function(str) { return parseInt(str); }));
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
                await sched.startSchedule(ctx);
            }
        }
        if (opMode == 'normal') {
            await ctx.log.info('UDS worker started on '+this.config.stateBase);
        } else {
            await ctx.log.silly('UDS worker started in mode '+opMode+' on '+this.config.stateBase);
        }
        this.cmndsHandle = ctx.setInterval(async () => {
            await this.cmndsLoop(ctx);
        }, this.cmndsUpdateTime);
        ctx.cntWorkersActive += 1;
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
                await sched.stopSchedule(ctx);
            }
            if (this.cmndsHandle) await ctx.clearInterval(this.cmndsHandle);

            // Stop Timeout:
            if (this.timeoutHandle) await ctx.clearTimeout(this.timeoutHandle);
            this.timeoutHandle = null;

            // Stop worker:
            this.callback = null;
            if (opMode == 'normal') {
                ctx.unsubscribeStates(ctx.namespace+'.'+this.config.stateBase+'.*');
                ctx.log.info('UDS worker stopped on '+this.config.stateBase);
            } else {
                ctx.log.silly('UDS worker stopped in mode '+opMode+' on '+this.config.stateBase);
            }
        } catch (e) {
            ctx.log.error('UDS worker on '+this.config.stateBase+' could not be stopped. err='+e.message);
        }
        ctx.cntWorkersActive -= 1;
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

    async setDidDone(ctx, coolDownTime) {
        // Finalize communication for recent did
        this.coolDownTs = new Date().getTime()+coolDownTime;
        if (this.cmndsQueue.length == 0) this.busy = false;
        await this.setComState(0);
        if (this.timeoutHandle) await ctx.clearTimeout(this.timeoutHandle);
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
        if (minWaiting > 0) await this.sleep(ctx, minWaiting);
        this.busy = true;
        this.timeoutHandle = await ctx.setTimeout(this.onTimeout, this.config.timeout, ctx, this);
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
        if (!Object.keys(this.schedules).includes(String(schedule))) {
            // New schedule
            this.schedules[schedule] = new scheduleLoop(ctx, this, schedule);
            await ctx.log.silly('UDS worker on '+this.config.stateBase+': Added schedule '+String(schedule)+'s.');
        }
        await this.schedules[schedule].addDids(dids);
        await ctx.log.silly('UDS worker on '+this.config.stateBase+': Added dids to schedule '+String(schedule)+'s '+JSON.stringify(this.schedules[schedule].dids));
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

    sleep(ctx, milliseconds) {
        return new Promise(resolve => ctx.setTimeout(resolve, milliseconds));
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
        await ctxLocal.setDidDone(ctxGlobal, 0);
    }

    async onUdsStateChange(ctx, ctxWorker, id, state) {

        // Change of UDS Writables
        // =======================
        if (id.includes(this.storage.storageDids.didsWritablesId)) {
            // User requests change of UDS writables
            await ctx.log.info('User requested change of UDS dids writable on '+this.config.stateBase);
            await this.storage.storageDids.readKnownDids(ctx, await this.storage.getOpMode());
            await ctx.setStateAsync(id, { val: state.val, ack: true }); // Acknowlegde user command
            return;
        }

        // Change of UDS device specific datapoint definition
        // ==================================================
        if (id.includes(this.storage.storageDids.didsSpecId)) {
            // User requests change of UDS device specific datapoint definition
            await ctx.log.info('User requested change of UDS device specific datapoint definition on '+this.config.stateBase);
            await this.storage.storageDids.readKnownDids(ctx, await this.storage.getOpMode());
            await ctx.setStateAsync(id, { val: state.val, ack: true }); // Acknowlegde user command
            return;
        }

        // User command ReadByDid
        // ======================
        if (id.includes(this.userReadByDidId)) {
            // User requests ReadByDid
            const dids = JSON.parse(state.val);
            await ctx.log.debug('User command UDS ReadByDid on '+this.config.stateBase+'. Dids='+JSON.stringify(dids));
            await this.pushCmnd(ctx, 'read', dids);
            await ctx.setStateAsync(id, { val: JSON.stringify(dids), ack: true }); // Acknowlegde user command
            return;
        }

        // User command WriteByDid
        // =======================
        const dcs = await ctx.idToDCS(id);  // Get device, channel and state id
        if (!(['json','raw','tree'].includes(dcs.channel))) {
            // State other than datapoint was stored => no action
            return;
        }
        if (dcs.state.length < 6) {
            // Implausible state id
            ctx.log.warn('User command UDS WriteByDid on '+this.config.stateBase+': Could not evaluate state change on id '+id);
            return;
        }
        const did = Number(dcs.state.slice(0,4));
        if (!(did in this.storage.storageDids.didsWritable)) {
            ctx.log.error('User command UDS WriteByDid on '+this.config.stateBase+'.'+String(did)+': Writing not allowed on this did. Pls. refer to README for further informations.');
            return;
        }
        await ctx.log.debug('User command UDS WriteByDid on '+this.config.stateBase+'.'+String(did));
        //await ctx.log.debug(JSON.stringify(dcs)+' did='+String(did)+' id='+id+' state='+JSON.stringify(state));
        let byteArr=null;    // Encoded data
        let lenBaseId;     // Index of start of did state id (did_name ...) in full state id (e3oncan ...)
        switch (dcs.channel) {
            case 'json':
                // Change in json data
                try {
                    byteArr = await this.storage.encodeDataCAN(ctx, this, did, await JSON.parse(state.val));
                    if (byteArr) {
                        await this.pushCmnd(ctx, 'write', [[did,byteArr]]);
                        ctx.setTimeout(function(ctxWorker,did){ctxWorker.cmndsQueue.push({'mode':'read', 'did': did});},2500,this,did);    // Read value after 2500 ms
                    } else {
                        ctx.log.error('User command UDS WriteByDid on '+this.config.stateBase+': Encoding of data failed.');
                    }
                } catch(e) {
                    ctx.log.error('WriteByDid(): Encoding of data failed on '+this.config.stateBase+'.'+String(did)+'; err='+JSON.stringify(e));
                }
                break;
            case 'raw':
                // Change in raw data
                byteArr = this.storage.storageDids.toByteArray(await JSON.parse(state.val));
                if (byteArr) {
                    await this.pushCmnd(ctx, 'write', [[did,byteArr]]);
                    ctx.setTimeout(function(ctxWorker,did){ctxWorker.cmndsQueue.push({'mode':'read', 'did': did});},2500,this,did);    // Read value after 2500 ms
                } else {
                    ctx.log.error('User command UDS WriteByDid on '+this.config.stateBase+': Encoding of data failed.');
                }
                break;
            case 'tree':
                // Change in tree data

                lenBaseId = ctx.namespace.length+dcs.device.length+dcs.channel.length+dcs.state.length+3;
                if (id.length == lenBaseId) {
                    // Scalar value w/o sub structure
                    try {
                        byteArr = await this.storage.encodeDataCAN(ctx, this, did, await JSON.parse(state.val));
                        if (byteArr) {
                            await this.pushCmnd(ctx, 'write', [[did,byteArr]]);
                            ctx.setTimeout(function(ctxWorker,did){ctxWorker.cmndsQueue.push({'mode':'read', 'did': did});},2500,this,did);    // Read value after 2500 ms
                        } else {
                            ctx.log.error('User command UDS WriteByDid on '+this.config.stateBase+': Encoding of data failed.');
                        }
                    } catch(e) {
                        ctx.log.error('WriteByDid(): Encoding of data failed on '+this.config.stateBase+'.'+String(did)+'; err='+JSON.stringify(e));
                    }
                    break;
                }

                // Build json object for complete object tree of changed did:
                await ctx.getStatesOf(dcs.device,dcs.device+'.'+dcs.channel,async function(err,obj) {
                    // Get all states for changed device.channel
                    function insertDictSubVal(dict, keyArr, val) {
                        const listLabels = ['ListEntries','Schedules','TopologyElement'];
                        if (keyArr.length == 1) {
                            const key = keyArr[0];
                            if (listLabels.includes(key)) dict[key].push(val); else dict[key] = val;
                        } else {
                            const key = keyArr.shift();
                            if (!(key in dict)) if (listLabels.includes(key)) dict[key] = []; else dict[key] = {};
                            insertDictSubVal(dict[key],keyArr, val);
                        }
                    }
                    const treeDict = {};
                    for (const st of Object.values(obj)) {
                        if (st._id.includes(dcs.state)) {
                            const label = st._id.slice(lenBaseId+1);
                            const val = await JSON.parse((await (ctx.getStateAsync(st._id.slice(ctx.namespace.length+1)))).val);
                            insertDictSubVal(treeDict, label.split('.'), val);
                        }
                    }
                    try {
                        byteArr = await ctxWorker.storage.encodeDataCAN(ctx, ctxWorker, did, treeDict);
                        if (byteArr) {
                            await ctxWorker.pushCmnd(ctx, 'write', [[did,byteArr]]);
                            ctx.setTimeout(function(ctxWorker,did){ctxWorker.cmndsQueue.push({'mode':'read', 'did': did});},2500,ctxWorker,did);    // Read value after 2500 ms
                        } else {
                            ctx.log.error('User command UDS WriteByDid on '+ctxWorker.config.stateBase+': Encoding of data failed.');
                        }
                    } catch(e) {
                        ctx.log.error('WriteByDid(): Encoding of data failed on '+ctxWorker.config.stateBase+'.'+String(did)+'; err='+JSON.stringify(e));
                    }
                });
                break;
            default:
                ctx.log.warn('User command UDS WriteByDid on '+this.config.stateBase+': Could not evaluate state change on id '+id);
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
        await ctx.log.silly('UDS worker on '+this.config.stateBase+': WriteByDid(): '+String(this.canIDhex)+'.'+String(did)+'='+this.storage.storageDids.arr2Hex(valRaw));
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
                        ctx.log.error('UDS worker error on '+this.config.stateBase+': Negative response reading did '+String(this.data.did)+'. Code=0x'+Number(candata[3]).toString(16));
                    }
                    await this.setDidDone(ctx, 0);
                    break;
                }
                if ( (candata.length == 8) && ((candata[0] >> 4) == 0) && (candata[1] == this.readByDidProt.SIDrx) ) {
                    // Single-frame communication
                    const didRx = candata[3]+256*candata[2];
                    if (didRx == this.data.did) {
                        // Did does match
                        this.stat.cntCommOk += 1;
                        ctx.log.silly('UDS worker on '+this.config.stateBase+': SF received. candata: '+this.storage.storageDids.arr2Hex(candata));
                        await this.calcStat();
                        this.data.len = candata[0]-3;
                        this.data.databytes = candata.slice(4,4+this.data.len);
                        this.storage.decodeDataCAN(ctx, this, this.data.did, this.data.databytes.slice(0,this.data.len));
                        await this.setDidDone(ctx, 0);
                        break;
                    } else {
                        // Did does not match
                        this.stat.cntCommBadProtocol += 1;
                        if (this.callback) {
                            this.callback(ctx, this, ['did mismatch SF', {'did':this.data.did,'didInfo':{'id':'','len':0},'val':''}]);
                        } else {
                            ctx.log.error('UDS worker on '+this.config.stateBase+': Did mismatch MF. Expected='+String(this.data.did)+'; Received='+String(didRx));
                        }
                        await this.setDidDone(ctx, 1000);
                        break;
                    }
                }
                if ( (candata.length == 8) && ((candata[0] >> 4) == 1) && (candata[2] == this.readByDidProt.SIDrx) ) {
                    // Multiframe communication
                    const didRx = candata[4]+256*candata[3];
                    if (didRx == this.data.did) {
                        // Did does match
                        this.data.len = (candata[0] & 0x0F)*256 + candata[1] - 3;
                        ctx.log.silly('UDS worker on '+this.config.stateBase+': FF received. candata: '+this.storage.storageDids.arr2Hex(candata));
                        this.data.databytes = candata.slice(5);
                        this.data.D0 = 0x21;
                        this.sendFrame(ctx, this.readByDidProt.FC); // Send request for Consecutive Frames
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
                        await this.setDidDone(ctx, 1000);
                        break;
                    }
                }
                if (this.callback) {
                    this.callback(ctx, this, ['bad MF frame', {'did':this.data.did,'didInfo':{'id':'','len':0},'val':''}]);
                } else {
                    ctx.log.error('UDS worker on '+this.config.stateBase+': Bad frame. candata: '+this.storage.storageDids.arr2Hex(candata));
                }
                await this.calcStat();
                this.stat.cntCommBadProtocol += 1;
                await this.setDidDone(ctx, 2500);
                break;

            case 2: // waitForCFrbd
                if ( (candata.length == 8) && (candata[0] == this.data.D0) ) {
                    // Correct code for Consecutive Frame
                    ctx.log.silly('UDS worker on '+this.config.stateBase+': CF received. candata: '+this.storage.storageDids.arr2Hex(candata));
                    this.data.databytes = this.data.databytes.concat(candata.slice(1));
                    if (this.data.databytes.length >= this.data.len) {
                        // All data received
                        this.stat.cntCommOk += 1;
                        await this.calcStat();
                        ctx.log.silly('UDS worker on '+this.config.stateBase+': MF completed. candata: '+this.storage.storageDids.arr2Hex(candata));
                        this.storage.decodeDataCAN(ctx, this, this.data.did, this.data.databytes.slice(0,this.data.len));
                        await this.setDidDone(ctx, 0);
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
                        ctx.log.error('UDS worker on '+this.config.stateBase+': Bad frame. candata: '+this.storage.storageDids.arr2Hex(candata));
                    }
                    this.stat.cntCommBadProtocol += 1;
                    await this.setDidDone(ctx, 2500);
                }
                break;

            case 3: // waitForFFSFwbd
                if ( (candata[0] == 0x03) && (candata[1] == 0x7F) && (candata[2] == this.writeByDidProt.SIDtx) ) {
                    // Negative response
                    this.stat.cntCommNR += 1;
                    ctx.log.error('UDS worker error on '+this.config.stateBase+': Negative response writing did '+String(this.data.did)+'. Code=0x'+Number(candata[3]).toString(16));
                    await this.setDidDone(ctx, 0);
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
                        await this.setDidDone(ctx, 0);
                        break;
                    } else {
                        // Did does not match
                        this.stat.cntCommBadProtocol += 1;
                        ctx.log.error('UDS worker on '+this.config.stateBase+': Did mismatch writeByDid SF. Expected='+String(this.data.did)+'; Received='+String(didRx));
                        await this.calcStat();
                        this.storage.storeStatistics(ctx, this, true);
                        await this.setDidDone(ctx, 1000);
                        break;
                    }
                }
                ctx.log.error('UDS worker on '+this.config.stateBase+': Bad frame for writeByDid SF. candata: '+this.storage.storageDids.arr2Hex(candata));
                this.stat.cntCommBadProtocol += 1;
                await this.calcStat();
                await this.setDidDone(ctx, 2500);
                break;

            case 4: // waitForFFFwbd
                if ( (candata[0] == 0x03) && (candata[1] == 0x7F) && (candata[2] == this.writeByDidProt.SIDtx) ) {
                    // Negative response
                    this.stat.cntCommNR += 1;
                    ctx.log.error('UDS worker error on '+this.config.stateBase+': Negative response writing did '+String(this.data.did)+'. Code=0x'+Number(candata[3]).toString(16));
                    await this.setDidDone(ctx, 0);
                    break;
                }
                if ( (candata.length == 8) && (candata[0] == 0x30) && (candata[1] == 0x00) ) {
                    // Multi-frame communication confirmed
                    // Send data in slices of 7 bytes
                    let ST = candata[2];  // Separation Time (ms)
                    if ((ST<20) || (ST>127)) ST=50; // Accept ST 20 .. 127 ms. Default to 50 ms.
                    while (this.data.txPos < this.data.len) {
                        // More data to send
                        await this.sleep(ctx, ST);
                        const frame = [this.data.D0].concat(this.data.databytes.slice(this.data.txPos,this.data.txPos+7));
                        await this.sendFrame(ctx, frame);
                        this.data.txPos += 7;
                        this.data.D0 += 1;
                        if (this.data.D0 > 0x2f) this.data.D0 = 0x20;
                    }
                    await this.setComState(3);  // waitForFFSFwbd (wait for confirmation)
                    break;
                }
                ctx.log.error('UDS worker on '+this.config.stateBase+': Bad frame for writeByDid MF. candata: '+this.storage.storageDids.arr2Hex(candata));
                this.stat.cntCommBadProtocol += 1;
                await this.calcStat();
                await this.setDidDone(ctx, 2500);
                break;

            default:
                this.stat.cntCommBadProtocol += 1;
                if (this.callback) {
                    this.callback(ctx, this, ['bad state value', {'did':this.data.did,'didInfo':{'id':'','len':0},'val':''}]);
                } else {
                    ctx.log.error('UDS worker on '+this.config.stateBase+': Bad state value: '+String(await this.getComState()));
                }
                await this.setDidDone(ctx, 2500);
        }
        this.commBusy = false;
    }
}

module.exports = {
    uds
};