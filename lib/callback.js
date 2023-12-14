
class udsCallback {

    constructor() {
    }

    async scanDevCallback(ctx, ctxAgent, _args) {
        async function mergeDev(dev) {
            let pushDev = true;
            await ctx.log.debug('UDS device scan found device: '+String(ctxAgent.canIDhex)+': '+result.val.DeviceProperty.Text);
            for (const d of Object(ctx.udsScanDevices).values()) {
                if ( (d.devName == dev.devName) && (d.devAddr == dev.devAddr) ) {
                    ctx.log.silly('UDS device scan found device already known. No change applied.');
                    pushDev = false;
                    break;
                }
            }
            if (pushDev) {
                await ctx.log.info('UDS device scan found NEW device: '+String(ctxAgent.canIDhex)+': '+result.val.DeviceProperty.Text);
                ctx.udsNewDevs += 1;
                ctx.udsScanDevices.push(dev);
            }
        }
        const response = _args[0];
        const result   = _args[1];
        if ( (result) && (response == 'ok') ) {
            const devName = result.val.DeviceProperty.Text;
            const dev = {
                'devName': devName,
                'devStateName': devName+'.'+String(ctxAgent.canIDhex),
                'devAddr': String(ctxAgent.canIDhex),
                'collectCanId': (devName in ctx.udsDevName2CanId ? ctx.udsDevName2CanId[devName] : '')
            };
            await mergeDev(dev);
        } else {
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
            const did = result.did;
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
                    ctx.udsScanDidsCntRetries += 1;
                    if (response == 'timeout') {
                        ctx.log.silly('UDS did scan: Timeout on '+String(ctxAgent.canIDhex)+'.'+String(ctxAgent.data.did));
                    } else {
                        ctx.log.debug('UDS did scan: Communication failed: '+response);
                    }
                    if (ctx.udsScanDidsRetries > 0) {
                        // Retry dids with error until budget for retries is 0
                        ctx.udsScanDidsRetries -= 1;
                        await ctxAgent.pushCmnd(ctx,'read', [did]);
                    }
                    if (ctx.udsScanDidsRetries == 0) {
                        ctx.udsScanDidsRetries = -1;
                        await ctx.log.warn('UDS did scan: Budget for retries after timeout is used up @'+String(ctxAgent.canIDhex)+' Dids may be missed.');
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