const uds = require('./canUds');
const E3DidsWritable  = require('./didsE3Writables.json');

class udsScan {

    constructor() {

        this.callbackBusy          = false;
        this.udsMaxTrialsDevScan   = 2;      // Number of trials during UDS device scan
        this.udsMaxTrialsDidScan   = 4;      // Number of trials during UDS dids scan
        this.udsTimeoutDevScan     = 1500;   // Timeout (ms) for UDS devive scan
        this.udsTimeoutDidScan     = 2500;   // Timeout (ms) for UDS dids scan

        this.udsDevName2CanId      = {
            'HPMUMASTER': '0x693',    // available only on internal bus (?)
            'EMCUMASTER': '0x451'
        };
        this.workers               = {};
        this.udsCntNewDevs         = 0;    // New devices found during scan
        this.cntUdsScansActive     = 0;
        this.udsScanAddrSpan       = 0x10;
        this.udsScanAddrRange      = [0x680, 0x6a0, 0x6c0, 0x6e0];
        this.cntUdsScansActive     = 0;
        this.udsScanDids           = {};
        this.udsScanDidsCntSuccess = 0;
        this.udsScanDidsCntTotal   = 0;
        this.udsScanDidsCntDone    = 0;
        this.udsScanDidsCntRetries = 0;
    }

    async scanDevCallback(ctx, ctxWorker, _args) {
        async function mergeDev(dev) {
            let newDev = true;
            await ctx.log.silly('UDS device scan found device: '+String(dev.devStateName));
            for (const d of Object(ctx.udsDevices).values()) {
                if ( (d.devName == dev.devStateName.slice(0,-6)) && (d.devAddr == dev.devAddr) ) {
                    await ctx.log.silly('Device is already known. No change applied.');
                    newDev = false;
                    dev.devStateName = d.devStateName;
                    dev.collectCanId = d.collectCanId;
                    break;
                }
            }
            if (newDev) {
                await ctx.log.info('UDS device scan found NEW device: '+String(dev.devStateName));
                await ctx.udsDevices.push(dev);
                ctx.udsScanWorker.udsCntNewDevs += 1;
            }
        }
        const response = _args[0];
        const result   = _args[1];
        switch (response) {
            case 'ok':
                if (result) {
                    const devName = result.val.DeviceProperty.Text;
                    await mergeDev ({
                        'devName': devName,
                        'devStateName': devName+'_'+String(ctxWorker.canIDhex),
                        'devAddr': String(ctxWorker.canIDhex),
                        'collectCanId': (devName in ctx.udsScanWorker.udsDevName2CanId ? ctx.udsScanWorker.udsDevName2CanId[devName] : '')
                    });
                } else {
                    await ctx.log.error('UDS Scan: '+String(ctxWorker.canIDhex)+' got ok, but empty response!');
                }
                break;
            case 'timeout':
                if (ctxWorker.stat.cntCommTimeout < ctx.udsScanWorker.udsMaxTrialsDevScan) {
                    await ctxWorker.pushCmnd(ctx, 'read', [ctx.udsDidForScan]);
                    ctx.udsScanWorker.udsScanDidsCntRetries += 1;
                }
                await ctx.log.silly('UDS Scan: '+String(ctxWorker.canIDhex)+' '+response);
                break;
            default:
                await ctx.log.silly('UDS Scan: '+String(ctxWorker.canIDhex)+' '+response);
        }
        if (ctxWorker.cmndsQueue.length == 0) {
            await ctxWorker.setCallback(null);    // Scan worker completed. Reset callback.
            ctx.udsScanWorker.cntUdsScansActive -= 1;
        }
    }

    async scanDidsCallback(ctx, ctxWorker, _args) {
        if (ctx.udsScanWorker.callbackBusy) {
            ctx.log.error('UDS dids scan: '+ctxWorker.config.stateBase+' -  callback busy!');
            return;
        }
        ctx.udsScanWorker.callbackBusy = true;
        const response = _args[0];
        const result = _args[1];
        if (result) {
            const did = await Number(result.did);
            switch (response) {
                case 'ok':
                case 'negative response':
                    if (response == 'ok') {
                        if (result.common) {
                            ctxWorker.storage.storageDids.didsDictDevCom[did] = result.didInfo;
                        } else {
                            // Device specific did. Do not override previous data
                            if (!(did in ctxWorker.storage.storageDids.didsDictDevSpec)) {
                                ctxWorker.storage.storageDids.didsDictDevSpec[did] = result.didInfo;
                            }
                        }
                        if (did in E3DidsWritable) {
                            // Did is writable. Add it to device specific list of writable dids:
                            ctxWorker.storage.storageDids.didsWritable[did] = E3DidsWritable[did];
                        }
                        ctx.udsScanWorker.udsScanDidsCntSuccess += 1;
                    }
                    ctx.udsScanWorker.udsScanDidsCntDone += 1;
                    ctx.udsScanWorker.udsScanDids[ctxWorker.canIDhex] -= 1;
                    await ctx.log.silly('UDS dids scan: '+ctxWorker.config.stateBase+'.'+String(ctxWorker.data.did)+': '+response);
                    break;
                case 'timeout':
                case 'did mismatch SF':
                case 'did mismatch MF':
                case 'bad MF frame':
                case 'bad CF frame':
                    if (response == 'timeout') {
                        ctx.log.silly('UDS dids scan: Timeout on '+ctxWorker.config.stateBase+'.'+String(ctxWorker.data.did)+' cnt: '+String(ctxWorker.stat.cntCommTimeoutPerDid[ctxWorker.data.did]));
                        if (ctxWorker.stat.cntCommTimeoutPerDid[ctxWorker.data.did] < ctx.udsScanWorker.udsMaxTrialsDidScan) {
                            ctxWorker.pushCmnd(ctx, 'read', [ctxWorker.data.did]);
                            ctx.udsScanWorker.udsScanDidsCntRetries += 1;
                        }
                        await ctx.log.silly('UDS dids scan: '+ctxWorker.config.stateBase+' '+response);
                    } else {
                        ctx.log.debug('UDS dids scan: '+ctxWorker.config.stateBase+' - communication failed: '+response);
                    }
                    break;
                default:
                    await ctx.log.warn('UDS dids scan: '+ctxWorker.config.stateBase+' - callback received unknown status: '+String(response));
            }
            if (ctx.udsScanWorker.udsScanDids[ctxWorker.canIDhex] == 0) ctx.udsScanWorker.cntUdsScansActive -= 1;
            if (ctx.udsScanWorker.cntUdsScansActive == -1) {
                await ctx.log.error('UDS dids scan: '+ctxWorker.config.stateBase+' - number of active dids got negative - this should not happen.');
            }
            if (ctx.udsScanWorker.udsScanDids[ctxWorker.canIDhex] == -1) {
                await ctx.log.error('UDS dids scan: '+ctxWorker.config.stateBase+' - number of remaining dids got negative - this should not happen.');
            }
        } else {
            await ctx.log.error('UDS dids scan: '+ctxWorker.config.stateBase+' - callback received empty result. response='+String(response));
        }
        ctx.udsScanWorker.callbackBusy = false;
    }

    async startupUdsWorker(ctx, worker, opMode) {
        const rxAddr = Number(worker.config.canID) + Number(0x10);
        ctx.udsScanWorker.workers[rxAddr] = worker;
        await worker.initStates(ctx, opMode);
        await worker.startup(ctx, opMode);
        //await ctx.log.debug(ctx.udsScanWorker.workers[rxAddr].canIDhex+': '+await this.workers[rxAddr].storage.getOpMode());
    }

    async startupScanUdsDevice(ctx, addr) {
        const udsWorker = new uds.uds(
            {   'canID'    : Number(addr),
                'stateBase': 'udsScanAddr',
                'device'   : 'common',
                'delay'    : 0,
                'active'   : true,
                'channel'  : ctx.channelExt,
                'timeout'  : this.udsTimeoutDevScan
            });
        await udsWorker.initStates(ctx, 'udsDevScan');
        await udsWorker.setCallback(this.scanDevCallback);
        await this.startupUdsWorker(ctx, udsWorker, 'udsDevScan');
        await udsWorker.pushCmnd(ctx, 'read', [ctx.udsDidForScan]);
        this.cntUdsScansActive += 1;
    }

    async scanUdsDevices(ctx) {
        function range(size, startAt = 0) {
            return [...Array(size).keys()].map(i => i + startAt);
        }

        await ctx.log.info('UDS device scan - start');
        this.workers = {};
        this.udsCntNewDevs = 0;
        ctx.udsDevices = ctx.config.tableUdsDevices;

        // Stop all running workers to avoid communication conflicts:
        for (const worker of Object.values(ctx.E3UdsWorkers)) {
            await worker.stop(ctx);
        }

        // @ts-ignore
        const canExtActivated = ctx.config.canExtActivated;
        // @ts-ignore
        const canExtName = ctx.config.canExtName;

        // Startup CAN:
        if (canExtActivated) {
            if  ((ctx.channelExt) &&
            (ctx.channelExtName != canExtName) ) {
            // CAN is different from running CAN. Stop actual CAN first.
                [ctx.channelExt, ctx.channelExtName] = await ctx.disconnectFromCan(ctx.channelExt, ctx.channelExtName);
            }
            [ctx.channelExt, ctx.channelExtName] = await ctx.connectToCan(ctx.channelExt, canExtName, ctx.onCanMsgExt);
            if (!ctx.channelExt) {
                await ctx.log.error('UDS device scan: Could not connect to CAN Adapter '+canExtName+'. Aborting.');
                return(false);
            }
        } else {
            await ctx.log.error('UDS device scan: External CAN not activated! Aborting.');
            return(false);
        }

        this.udsScanDidsCntRetries = 0;
        this.cntUdsScansActive = 0;
        for (const baseAddr of Object(this.udsScanAddrRange).values()) {
            for (const addr of Object(range(Number(this.udsScanAddrSpan), Number(baseAddr))).values()) {
                await this.startupScanUdsDevice(ctx, addr);
                await this.sleep(50);
            }
        }
        // eslint-disable-next-line no-case-declarations
        const tsAbort = new Date().getTime() + this.udsMaxTrialsDevScan*this.udsTimeoutDevScan+250;
        await ctx.log.info('UDS device scan: Waiting for scans to complete.');
        while ( (this.cntUdsScansActive > 0) && (new Date().getTime() < tsAbort) ) {
            await this.sleep(100);
        }

        // Stop all scan workers:
        for (const worker of Object.values(this.workers)) {
            await worker.stop(ctx);
        }
        this.workers = {};

        // Restart all previously running workers:
        for (const worker of Object.values(ctx.E3UdsWorkers)) {
            await worker.startup(ctx,'normal');
        }

        if (this.cntUdsScansActive < 0) await ctx.log.warn('UDS scan finished. Number of retries / active UDS scans (should be 0): '+String(this.udsScanDidsCntRetries)+' / '+String(this.cntUdsScansActive));
        await ctx.log.info('UDS device scan found '+
            String(this.udsCntNewDevs)+
            ' new of total '+
            String(ctx.udsDevices.length)+
            ' devices: '+
            JSON.stringify(ctx.udsDevices)
        );

        await ctx.log.info('UDS device scan - done');

        return(true);
    }

    async startupScanUdsDids(ctx, addr, dids) {
        const hexAddr = '0x'+Number(addr).toString(16);
        // @ts-ignore
        const devInfo = ctx.config.tableUdsDevices.filter(item => item.devAddr == hexAddr);
        let devName = '';
        if (devInfo.length > 0) {
            devName = devInfo[0].devStateName;
        } else {
            devName = hexAddr;
        }
        const udsWorker = await new uds.uds(
            {   'canID'    : Number(addr),
                'stateBase': devName,
                'device'   : 'common',
                'delay'    : 0,
                'active'   : true,
                'channel'  : ctx.channelExt,
                'timeout'  : this.udsTimeoutDidScan
            });
        await udsWorker.setCallback(this.scanDidsCallback);
        this.udsScanDids[udsWorker.canIDhex] = dids.length;
        this.udsScanDidsCntTotal += dids.length;
        await this.startupUdsWorker(ctx, udsWorker, 'udsDidScan');
        this.cntUdsScansActive += 1;
        await udsWorker.pushCmnd(ctx, 'read', dids);
    }

    async scanUdsDids(ctx, udsAddrs, udsMaxCntDids) {
        function range(size, startAt = 0) {
            return [...Array(size).keys()].map(i => i + startAt);
        }
        async function logStatus(ctx, ctxScan) {
            await ctx.log.info('UDS dids scan status (retries/found/done/total): ('+
            String(ctxScan.udsScanDidsCntRetries)+'/'+
            String(ctxScan.udsScanDidsCntSuccess)+'/'+
            String(ctxScan.udsScanDidsCntDone)+'/'+
            String(ctxScan.udsScanDidsCntTotal)+
            '), remaining: '+
            JSON.stringify(ctxScan.udsScanDids)
            );
        }

        await ctx.log.info('UDS dids scan - start');
        this.workers = {};
        this.udsScanDids   = {};

        // Stop all running workers to avoid communication conflicts:
        for (const worker of Object.values(ctx.E3UdsWorkers)) {
            await worker.stop(ctx);
        }

        this.cntUdsScansActive     = 0;
        this.udsScanDidsCntTotal   = 0;
        this.udsScanDidsCntRetries = 0;
        this.udsScanDidsCntSuccess = 0;
        this.udsScanDidsCntDone    = 0;
        const dids = range(udsMaxCntDids, 256);
        for (const addr of Object(udsAddrs).values()) {
            await this.startupScanUdsDids(ctx, addr, dids);
            await this.sleep(50);
        }
        let cntDoneLast = -1;
        await logStatus(ctx, this);
        let ts = new Date().getTime();
        const tsAbort = ts + this.udsScanDidsCntTotal*500;
        while ( (this.cntUdsScansActive > 0) && (new Date().getTime() < tsAbort) ) {
            await this.sleep(100);
            if ((new Date().getTime() - ts) >= 10000) {
                ts += 10000;
                await logStatus(ctx, this);
                const cnt = this.udsScanDidsCntDone+this.udsScanDidsCntRetries;
                if (cntDoneLast == cnt) {
                    // No progress in last 10 seconds
                    await ctx.log.warn('UDS dids scan stalled. Aborting');
                    break;
                }
                cntDoneLast = cnt;
            }
        }
        await logStatus(ctx, this);

        // Store dids found and stop all scan workers:
        for (const worker of Object.values(this.workers)) {
            await worker.storage.storageDids.storeKnownDids(ctx);
            await worker.stop(ctx);
        }
        this.workers = {};

        if (this.cntUdsScansActive < 0) await ctx.log.warn('UDS dids scan finished. Number of active UDS scans (should be 0): '+String(this.cntUdsScansActive));
        await ctx.log.info('UDS dids scan found '+String(this.udsScanDidsCntSuccess)+' dids. See channel "info" at device objects for details.');

        // Restart all previously running workers:
        for (const worker of Object.values(ctx.E3UdsWorkers)) {
            await worker.startup(ctx,'normal');
        }
    }

    sleep(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

}

module.exports = {
    udsScan
};