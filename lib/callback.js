
class udsCallback {

    constructor() {
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
                ctx.udsNewDevs += 1;
            }
        }
        /* Version for scanUdsDevicesCommands(). Starting with empty device list
        async function mergeDev(dev) {
            let newDev = true;
            let devKnown;
            await ctx.log.silly('UDS device scan found device: '+String(dev.devStateName));
            for (const d of Object(ctx.udsDevices).values()) {
                if ( (d.devName == dev.devStateName.slice(0,-6)) && (d.devAddr == dev.devAddr) ) {
                    await ctx.log.silly('Device is already known. No change applied.');
                    newDev = false;
                    devKnown = d;
                    break;
                }
            }
            if (newDev) {
                await ctx.log.info('UDS device scan found NEW device: '+String(dev.devStateName));
                await ctx.udsScanDevices.push(dev);
                ctx.udsNewDevs += 1;
            } else {
                await ctx.udsScanDevices.push(devKnown);
            }
        }
        */
        const response = _args[0];
        const result   = _args[1];
        switch (response) {
            case 'ok':
                if (result) {
                    const devName = result.val.DeviceProperty.Text;
                    await mergeDev ({
                        'devName': devName,
                        'devStateName': devName+'.'+String(ctxWorker.canIDhex),
                        'devAddr': String(ctxWorker.canIDhex),
                        'collectCanId': (devName in ctx.udsDevName2CanId ? ctx.udsDevName2CanId[devName] : '')
                    });
                } else {
                    await ctx.log.error('UDS Scan: '+String(ctxWorker.canIDhex)+' got ok, but empty response!');
                }
                break;
            case 'timeout':
                if (ctxWorker.stat.cntCommTimeout < ctx.udsMaxTrialsDevScan) {
                    await ctxWorker.pushCmnd(ctx, 'read', [ctx.udsDidForScan]);
                    ctx.udsScanDidsCntRetries += 1;
                }
                await ctx.log.silly('UDS Scan: '+String(ctxWorker.canIDhex)+' '+response);
                break;
            default:
                await ctx.log.silly('UDS Scan: '+String(ctxWorker.canIDhex)+' '+response);
        }
        if (ctxWorker.cmndsQueue.length == 0) {
            await ctxWorker.setCallback(null);    // Scan worker completed. Reset callback.
            ctx.cntUdsScansActive -= 1;
        }
    }

    async scanDidsCallback(ctx, ctxWorker, _args) {
        const response = _args[0];
        const result = _args[1];
        if (result) {
            const did = await Number(result.did);
            switch (response) {
                case 'ok':
                case 'negative response':
                    if (response == 'ok') {
                        ctx.udsKnownDids[ctxWorker.canIDhex][did] = result.didInfo;
                        ctx.udsScanDidsCntSuccess += 1;
                    }
                    ctx.udsScanDidsCntDone += 1;
                    ctx.udsScanDids[ctxWorker.canIDhex] -= 1;
                    await ctx.log.silly('UDS did scan: '+String(ctxWorker.canIDhex)+'.'+String(ctxWorker.data.did)+': '+response);
                    break;
                case 'timeout':
                case 'did mismatch SF':
                case 'did mismatch MF':
                case 'bad frame':
                    if (response == 'timeout') {
                        //ctx.log.debug('UDS did scan: Timeout on '+String(ctxWorker.canIDhex)+'.'+String(ctxWorker.data.did)+' cnt: '+String(ctxWorker.stat.cntCommTimeoutPerDid[ctxWorker.data.did]));
                        if (ctxWorker.stat.cntCommTimeoutPerDid[ctxWorker.data.did] < ctx.udsMaxTrialsDidScan) {
                            ctxWorker.pushCmnd(ctx, 'read', [ctxWorker.data.did]);
                            ctx.udsScanDidsCntRetries += 1;
                        }
                        await ctx.log.silly('UDS Scan: '+String(ctxWorker.canIDhex)+' '+response);
                    } else {
                        ctx.log.debug('UDS did scan: Communication failed: '+response);
                    }
                    break;
                default:
                    await ctx.log.warn('UDS did scan: Callback received unknown status: '+String(response));
            }
            if (ctx.udsScanDids[ctxWorker.canIDhex] == 0) ctx.cntUdsScansActive -= 1;
            if (ctx.cntUdsScansActive == -1) {
                await ctx.log.error('UDS did scan: Number of active dids got negative @'+
                    String(ctxWorker.canIDhex)+' - this should not happen.');
            }
            if (ctx.udsScanDids[ctxWorker.canIDhex] == -1) {
                await ctx.log.error('UDS did scan: Number of remaining dids got negative @'+
                    String(ctxWorker.canIDhex)+' - this should not happen.');
            }
        }
    }

}

module.exports = {
    udsCallback
};