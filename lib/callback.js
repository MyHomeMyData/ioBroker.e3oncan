
class udsCallback {

    constructor() {
    }

    async scanDevCallback(ctx, ctxAgent, _args) {
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
                        'devStateName': devName+'.'+String(ctxAgent.canIDhex),
                        'devAddr': String(ctxAgent.canIDhex),
                        'collectCanId': (devName in ctx.udsDevName2CanId ? ctx.udsDevName2CanId[devName] : '')
                    });
                } else {
                    await ctx.log.error('UDS Scan: '+String(ctxAgent.canIDhex)+' got ok, but empty response!');
                }
                break;
            case 'timeout':
                if (ctxAgent.cntCommTimeout < ctx.udsMaxTrialsDevScan) {
                    await ctxAgent.pushCmnd(ctx, 'read', [ctx.udsDidForScan]);
                    ctx.udsScanDidsCntRetries += 1;
                }
                await ctx.log.silly('UDS Scan: '+String(ctxAgent.canIDhex)+' '+response);
                break;
            default:
                await ctx.log.silly('UDS Scan: '+String(ctxAgent.canIDhex)+' '+response);
        }
        if (ctxAgent.cmndsQueue.length == 0) {
            await ctxAgent.setCallback(null);    // Scan agent completed. Reset callback.
            ctx.cntUdsScansActive -= 1;
        }
    }

    async scanDidsCallback(ctx, ctxAgent, _args) {
        const response = _args[0];
        const result = _args[1];
        if (result) {
            const did = await Number(result.did);
            switch (response) {
                case 'ok':
                case 'negative response':
                    if (response == 'ok') {
                        ctx.udsKnownDids[ctxAgent.canIDhex][did] = result.didInfo;
                        ctx.udsScanDidsCntSuccess += 1;
                    }
                    ctx.udsScanDidsCntDone += 1;
                    ctx.udsScanDids[ctxAgent.canIDhex] -= 1;
                    await ctx.log.silly('UDS did scan: '+String(ctxAgent.canIDhex)+'.'+String(ctxAgent.data.did)+': '+response);
                    break;
                case 'timeout':
                case 'did mismatch SF':
                case 'did mismatch MF':
                case 'bad frame':
                    if (response == 'timeout') {
                        //ctx.log.debug('UDS did scan: Timeout on '+String(ctxAgent.canIDhex)+'.'+String(ctxAgent.data.did)+' cnt: '+String(ctxAgent.cntCommTimeoutPerDid[ctxAgent.data.did]));
                        if (ctxAgent.cntCommTimeoutPerDid[ctxAgent.data.did] < ctx.udsMaxTrialsDidScan) {
                            ctxAgent.pushCmnd(ctx, 'read', [ctxAgent.data.did]);
                            ctx.udsScanDidsCntRetries += 1;
                        }
                        await ctx.log.silly('UDS Scan: '+String(ctxAgent.canIDhex)+' '+response);
                    } else {
                        ctx.log.debug('UDS did scan: Communication failed: '+response);
                    }
                    break;
                default:
                    await ctx.log.warn('UDS did scan: Callback received unknown status: '+String(response));
            }
            if (ctx.udsScanDids[ctxAgent.canIDhex] == 0) ctx.cntUdsScansActive -= 1;
            if (ctx.cntUdsScansActive == -1) {
                await ctx.log.error('UDS did scan: Number of active dids got negative @'+
                    String(ctxAgent.canIDhex)+' - this should not happen.');
            }
            if (ctx.udsScanDids[ctxAgent.canIDhex] == -1) {
                await ctx.log.error('UDS did scan: Number of remaining dids got negative @'+
                    String(ctxAgent.canIDhex)+' - this should not happen.');
            }
        }
    }

}

module.exports = {
    udsCallback
};