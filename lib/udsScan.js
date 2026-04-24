const uds = require('./canUds');
const E3DidsDict = require('./didsE3.json');
const E3DidsVarDict = require('./didsE3var.json');
const E3DidsWritable = require('./didsE3Writables.json');

/**
 *  Perform scan for devices or scan for data points of a specific device
 */
class udsScan {
    /**
     * Init
     */
    constructor() {
        this.callbackBusy = false;
        this.udsMaxTrialsDevScan = 2; // Number of trials during UDS device scan
        this.udsMaxTrialsDidScan = 4; // Number of trials during UDS dids scan
        this.udsTimeoutDevScan = 1500; // Timeout (ms) for UDS devive scan
        this.udsTimeoutDidScan = 2500; // Timeout (ms) for UDS dids scan

        this.udsDevName2CanId = {
            HPMUMASTER: '0x693', // available only on internal bus (?)
            EMCUMASTER: '0x451',
        };
        this.workers = {};
        this.udsCntNewDevs = 0; // New devices found during scan
        this.cntUdsScansActive = 0;
        this.udsScanAddrSpan = 0x10;
        this.udsScanAddrRange = [0x680, 0x6a0, 0x6c0, 0x6e0];
        this.cntUdsScansActive = 0;
        this.udsScanDids = {};
        this.udsScanDidsCntSuccess = 0;
        this.udsScanDidsCntTotal = 0;
        this.udsScanDidsCntDone = 0;
        this.udsScanDidsCntRetries = 0;
    }

    /**
     * Callback function for scan for devices
     *
     * @param {object} ctx  Adapter context
     * @param {object} ctxWorker  Worker context
     * @param {Array} _args  Optional arguments
     */
    async scanDevCallback(ctx, ctxWorker, _args) {
        async function mergeDev(dev) {
            let newDev = true;
            await ctx.log.silly(`UDS Device Scan found device: ${String(dev.devStateName)}`);
            for (const d of Object(ctx.udsDevices).values()) {
                if (d.devName == dev.devStateName.split('_0x')[0] && d.devAddr == dev.devAddr) {
                    await ctx.log.silly('Device is already known. No change applied.');
                    newDev = false;
                    dev.devStateName = d.devStateName;
                    dev.collectCanId = d.collectCanId;
                    dev.devUnits = d.devUnits;
                    break;
                }
            }
            if (newDev) {
                await ctx.log.info(`UDS Device Scan found NEW device: ${String(dev.devStateName)}`);
                await ctx.udsDevices.push(dev);
                ctx.udsScanWorker.udsCntNewDevs += 1;
            }
        }
        async function setDevUnits(devAddr, devUnits) {
            for (const d of Object(ctx.udsDevices).values()) {
                if (d.devAddr == devAddr) {
                    await ctx.log.debug(`Set format of units for device ${String(devAddr)} to "${devUnits}"`);
                    d.devUnits = devUnits;
                    if (devAddr == ctx.udsMasterDevAddr) {
                        // Store Units and Formats of master device. Will be used for devices not providing own confiuraion of units and formats.
                        ctx.udsMasterDevUnits = devUnits;
                    }
                }
            }
        }
        const response = _args[0];
        const result = _args[1];
        switch (response) {
            case 'ok':
                if (result) {
                    if (result.did == String(ctx.udsDidForScan)) {
                        const devName = result.val.DeviceProperty.Text;
                        const busAddress = `00${String(result.val.BusAddress)}`;
                        await mergeDev({
                            devName: devName,
                            devStateName: `${devName}_${String(ctxWorker.canIDhex)}`,
                            devUnits: 'n/a',
                            devAddr: String(ctxWorker.canIDhex),
                            collectCanId: await (devName in ctx.udsScanWorker.udsDevName2CanId
                                ? ctx.udsScanWorker.udsDevName2CanId[devName]
                                : ''),
                            devTopName: `${devName.replace('MASTER', '')}_CAN${busAddress.slice(-2)}`,
                        });
                    } else {
                        if (result.did == String(ctx.udsDidForUnits)) {
                            await ctx.log.silly(
                                `UDS Device Scan got UnitsAndFormats for ${String(ctxWorker.canIDhex)}: ${JSON.stringify(result.val)}`,
                            );
                            let devUnits;
                            try {
                                devUnits = `${result.val.Units.Text} / ${result.val.DateFormat.Text} / ${result.val.TimeFormat.Text}`;
                            } catch {
                                devUnits = 'n/a';
                            }
                            await setDevUnits(String(ctxWorker.canIDhex), devUnits);
                        } else {
                            await ctx.log.error(
                                `UDS Device Scan: ${String(ctxWorker.canIDhex)} got unexpected data point: ${response.did}`,
                            );
                        }
                    }
                } else {
                    await ctx.log.error(`UDS Device Scan: ${String(ctxWorker.canIDhex)} got ok, but empty response!`);
                }
                break;
            case 'timeout':
                if (ctxWorker.stat.cntCommTimeout < ctx.udsScanWorker.udsMaxTrialsDevScan) {
                    if (result.did == ctx.udsDidForScan) {
                        await ctxWorker.pushCmnd(ctx, 'read', [ctx.udsDidForScan]);
                        ctx.udsScanWorker.udsScanDidsCntRetries += 1;
                    }
                }
                await ctx.log.silly(`UDS Device Scan: ${String(ctxWorker.canIDhex)} ${response}`);
                break;
            case 'negative response':
                if (result.did == ctx.udsDidForUnits) {
                    await setDevUnits(String(ctxWorker.canIDhex), 'n/a');
                }
                await ctx.log.silly(`UDS Device Scan: ${String(ctxWorker.canIDhex)} ${response}`);
                break;
            default:
                await ctx.log.silly(`UDS Device Scan: ${String(ctxWorker.canIDhex)} ${response}`);
        }
        if (ctxWorker.cmndsQueue.length == 0) {
            await ctxWorker.setCallback(null); // Scan worker completed. Reset callback.
            ctx.udsScanWorker.cntUdsScansActive -= 1;
        }
    }

    /**
     * Callback function for scan for data points of a specific device
     *
     * @param {object} ctx  Adapter context
     * @param {object} ctxWorker  Worker context
     * @param {Array} _args  Optional arguments
     */
    async scanDidsCallback(ctx, ctxWorker, _args) {
        if (ctx.udsScanWorker.callbackBusy) {
            ctx.log.error(`UDS dids scan: ${ctxWorker.config.stateBase} -  callback busy!`);
            return;
        }
        ctx.udsScanWorker.callbackBusy = true;
        const response = _args[0];
        const result = _args[1];
        if (result) {
            const did = await Number(result.did);
            const didLen = Number(result.didInfo.len);
            switch (response) {
                case 'ok':
                case 'negative response':
                    if (response == 'ok') {
                        var acc = ''; // Default value for access mode
                        if (result.common) {
                            ctxWorker.storage.storageDids.didsDictDevCom[did] = result.didInfo;
                            if ('acc' in result.didInfo.args) {
                                acc = result.didInfo.args.acc;
                            }
                        } else {
                            // Device specific did. Check, if definition is available in variant dids list
                            if (did in E3DidsVarDict && didLen in E3DidsVarDict[did]) {
                                // Definition is available. Use it as deviced specific definition. Override it, if it already exists.
                                ctx.log.debug(`Variant Did ${ctxWorker.config.stateBase}_${did} found.`);
                                // Remark: No backup of actual data point definition is done during scan. If needed, a backup was already performed during startup of adapter.
                                ctxWorker.storage.storageDids.didsDictDevSpec[did] = await E3DidsVarDict[did][didLen];
                                ctxWorker.storage.storageDids.didsDictDevCom[did] = await E3DidsVarDict[did][didLen]; // Also valid as common did for this device
                                _args[1].didInfo = await E3DidsVarDict[did][didLen]; // Pass new definition of state back to caller
                                if ('acc' in E3DidsVarDict[did][didLen].args) {
                                    acc = E3DidsVarDict[did][didLen].args.acc;
                                }
                                // Remember version of source:
                                ctxWorker.storage.storageDids.didsDictDevSpec[did]['source'] =
                                    `didsE3var_${E3DidsVarDict.Version}`;
                            } else {
                                // Device specific did. Do not override previous data
                                if (!(did in ctxWorker.storage.storageDids.didsDictDevSpec)) {
                                    ctxWorker.storage.storageDids.didsDictDevSpec[did] = result.didInfo;
                                }
                            }
                        }
                        if (did in E3DidsWritable || acc == 'rw') {
                            // Did is writable according to white list or codec info (acc). Add it to device specific list of writable dids:
                            ctxWorker.storage.storageDids.didsWritable[did] = result.didInfo.id;
                        }
                        ctx.udsScanWorker.udsScanDidsCntSuccess += 1;
                    }
                    ctx.udsScanWorker.udsScanDidsCntDone += 1;
                    ctx.udsScanWorker.udsScanDids[ctxWorker.canIDhex] -= 1;
                    await ctx.log.silly(
                        `UDS dids scan: ${ctxWorker.config.stateBase}.${String(ctxWorker.data.did)}: ${response}`,
                    );
                    break;
                case 'timeout':
                case 'did mismatch SF':
                case 'did mismatch MF':
                case 'bad MF frame':
                case 'bad CF frame':
                    if (response == 'timeout') {
                        ctx.log.silly(
                            `UDS dids scan: Timeout on ${ctxWorker.config.stateBase}.${String(
                                ctxWorker.data.did,
                            )} cnt: ${String(ctxWorker.stat.cntCommFailedPerDid[ctxWorker.data.did])}`,
                        );
                        ctx.log.silly(`UDS dids scan: ${ctxWorker.config.stateBase} ${response}`);
                    } else {
                        ctx.log.debug(
                            `UDS dids scan: ${ctxWorker.config.stateBase} - communication failed: ${response}`,
                        );
                    }
                    if (
                        ctxWorker.stat.cntCommFailedPerDid[ctxWorker.data.did] < ctx.udsScanWorker.udsMaxTrialsDidScan
                    ) {
                        ctxWorker.pushCmnd(ctx, 'read', [ctxWorker.data.did]);
                        ctx.udsScanWorker.udsScanDidsCntRetries += 1;
                    }
                    break;
                default:
                    await ctx.log.warn(
                        `UDS dids scan: ${ctxWorker.config.stateBase} - callback received unknown status: ${String(
                            response,
                        )}`,
                    );
            }
            if (ctx.udsScanWorker.udsScanDids[ctxWorker.canIDhex] == 0) {
                ctx.udsScanWorker.cntUdsScansActive -= 1;
            }
            if (ctx.udsScanWorker.cntUdsScansActive == -1) {
                await ctx.log.error(
                    `UDS dids scan: ${
                        ctxWorker.config.stateBase
                    } - number of active dids got negative - this should not happen.`,
                );
            }
            if (ctx.udsScanWorker.udsScanDids[ctxWorker.canIDhex] == -1) {
                await ctx.log.error(
                    `UDS dids scan: ${
                        ctxWorker.config.stateBase
                    } - number of remaining dids got negative - this should not happen.`,
                );
            }
        } else {
            await ctx.log.error(
                `UDS dids scan: ${ctxWorker.config.stateBase} - callback received empty result. response=${String(
                    response,
                )}`,
            );
        }
        ctx.udsScanWorker.callbackBusy = false;
    }

    /**
     * Start an UDS worker for scan
     *
     * @param {object} ctx  Adapter context
     * @param {object} worker  UDS Worker
     * @param {string} opMode  Operation mode of worker
     */
    async startupUdsWorker(ctx, worker, opMode) {
        const rxAddr = Number(worker.config.canID) + Number(0x10);
        ctx.udsScanWorker.workers[rxAddr] = worker;
        await worker.initStates(ctx, opMode);
        await worker.startup(ctx, opMode);
        //await ctx.log.debug(ctx.udsScanWorker.workers[rxAddr].canIDhex+': '+await this.workers[rxAddr].storage.getOpMode());
    }

    /**
     * Start an UDS device for scan
     *
     * @param {object} ctx  Adapter context
     * @param {string} addr  Address of device
     */
    async startupScanUdsDevice(ctx, addr) {
        const udsWorker = new uds.uds({
            canID: Number(addr),
            stateBase: 'udsScanAddr',
            devUnits: 'n/a',
            device: 'common',
            delay: 0,
            active: true,
            channel: ctx.channelExt,
            timeout: this.udsTimeoutDevScan,
        });
        await udsWorker.initStates(ctx, 'udsDevScan');
        await udsWorker.setCallback(this.scanDevCallback);
        await this.startupUdsWorker(ctx, udsWorker, 'udsDevScan');
        await udsWorker.pushCmnd(ctx, 'read', [ctx.udsDidForScan, ctx.udsDidForUnits]);
        this.cntUdsScansActive += 1;
    }

    /**
     * Start a set of an UDS devices for scan
     *
     * @param {object} ctx  Adapter context
     */
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

        const canExtActivated = ctx.config.canExtActivated;
        const canExtName = ctx.config.canExtName;

        // Startup CAN:
        if (canExtActivated) {
            if (ctx.channelExt && ctx.channelExtName != canExtName) {
                // CAN is different from running CAN. Stop actual CAN first.
                [ctx.channelExt, ctx.channelExtName] = await ctx.disconnectFromCan(ctx.channelExt, ctx.channelExtName);
            }
            [ctx.channelExt, ctx.channelExtName] = await ctx.connectToCan(ctx.channelExt, canExtName, ctx.onCanMsgExt);
            if (!ctx.channelExt) {
                await ctx.log.error(`UDS device scan: Could not connect to CAN Adapter ${canExtName}. Aborting.`);
                return false;
            }
        } else {
            await ctx.log.error('UDS device scan: External CAN not activated! Aborting.');
            return false;
        }

        // Start energy meter detection in parallel with device scan (both channels):
        const detectedMeters = { e380_98: '', e380_97: '', e3100cb: '' };
        let energyMeterListening = true;
        const e380EvenIds = new Set([0x250, 0x252, 0x254, 0x256, 0x258, 0x25a, 0x25c]);
        const e380OddIds = new Set([0x251, 0x253, 0x255, 0x257, 0x259, 0x25b, 0x25d]);
        const makeEnergyMeterListener = channel => msg => {
            if (!energyMeterListening) {
                return;
            }
            if (e380EvenIds.has(msg.id) && !detectedMeters.e380_98) {
                detectedMeters.e380_98 = channel;
            }
            if (e380OddIds.has(msg.id) && !detectedMeters.e380_97) {
                detectedMeters.e380_97 = channel;
            }
            if (msg.id === 0x569 && !detectedMeters.e3100cb) {
                detectedMeters.e3100cb = channel;
            }
        };
        await ctx.channelExt.addListener('onMessage', makeEnergyMeterListener('ext'));
        if (ctx.channelInt) {
            await ctx.channelInt.addListener('onMessage', makeEnergyMeterListener('int'));
        }

        this.udsScanDidsCntRetries = 0;
        this.cntUdsScansActive = 0;
        for (const baseAddr of Object(this.udsScanAddrRange).values()) {
            for (const addr of Object(range(Number(this.udsScanAddrSpan), Number(baseAddr))).values()) {
                await this.startupScanUdsDevice(ctx, addr);
                await this.sleep(ctx, ctx.udsTimeDelta);
            }
        }
        const tsAbort = new Date().getTime() + this.udsMaxTrialsDevScan * this.udsTimeoutDevScan + 250;
        await ctx.log.info('UDS device scan: Waiting for scans to complete.');
        while (this.cntUdsScansActive > 0 && new Date().getTime() < tsAbort) {
            await this.sleep(ctx, 100);
        }

        // Stop all scan workers:
        for (const worker of Object.values(this.workers)) {
            await worker.stop(ctx);
        }
        this.workers = {};

        // Stop energy meter detection and store results:
        energyMeterListening = false;
        const chanLabel = ch => (ch === 'int' ? '2nd CAN' : 'UDS CAN');
        const meterList = [
            detectedMeters.e380_97 ? `E380 at CAN address 97 (${chanLabel(detectedMeters.e380_97)})` : null,
            detectedMeters.e380_98 ? `E380 at CAN address 98 (${chanLabel(detectedMeters.e380_98)})` : null,
            detectedMeters.e3100cb ? `E3100CB (${chanLabel(detectedMeters.e3100cb)})` : null,
        ].filter(Boolean);
        await ctx.log.info(
            `UDS device scan: Energy meters detected: ${meterList.length > 0 ? meterList.join(', ') : 'none'}`,
        );
        ctx.detectedEnergyMeters = detectedMeters;
        for (const [stateId, val] of [
            ['info.e380_97', detectedMeters.e380_97],
            ['info.e380_98', detectedMeters.e380_98],
            ['info.e3100cb', detectedMeters.e3100cb],
        ]) {
            await ctx.extendObject(stateId, {
                type: 'state',
                common: {
                    name: stateId,
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false,
                },
                native: {},
            });
            await ctx.setStateAsync(stateId, val, true);
        }

        // Restart all previously running workers:
        for (const worker of Object.values(ctx.E3UdsWorkers)) {
            await worker.startup(ctx, 'normal');
            await this.sleep(ctx, ctx.udsTimeDelta);
        }

        if (this.cntUdsScansActive < 0) {
            await ctx.log.warn(
                `UDS scan finished. Number of retries / active UDS scans (should be 0): ${String(
                    this.udsScanDidsCntRetries,
                )} / ${String(this.cntUdsScansActive)}`,
            );
        }
        await ctx.log.info(
            `UDS device scan found ${String(this.udsCntNewDevs)} new of total ${String(
                ctx.udsDevices.length,
            )} devices: ${JSON.stringify(ctx.udsDevices)}`,
        );

        await ctx.log.debug(
            `UDS device scan: Units and Formats of master device (0x${Number(ctx.udsMasterDevAddr).toString(16)}) set to "${ctx.udsMasterDevUnits}"`,
        );

        await ctx.log.info('UDS device scan - done');

        return true;
    }

    /**
     * Start an UDS device for scan of data points
     *
     * @param {object} ctx  Adapter context
     * @param {string} addr  Address of device
     * @param {Array} dids  List of DIDs to be scanned
     */
    async startupScanUdsDids(ctx, addr, dids) {
        const hexAddr = `0x${Number(addr).toString(16)}`;
        const devInfo = ctx.config.tableUdsDevices.filter(item => item.devAddr == hexAddr);
        let devName = '';
        let devUnits = 'n/a';
        if (devInfo.length > 0) {
            devName = devInfo[0].devStateName;
            devUnits = devInfo[0].devUnits ? devInfo[0].devUnits : 'n/a';
        } else {
            devName = hexAddr;
            devUnits = 'n/a';
        }
        const udsWorker = await new uds.uds({
            canID: Number(addr),
            stateBase: devName,
            devUnits: devUnits,
            device: 'common',
            delay: 0,
            active: true,
            channel: ctx.channelExt,
            timeout: this.udsTimeoutDidScan,
        });
        await udsWorker.setCallback(this.scanDidsCallback);
        this.udsScanDids[udsWorker.canIDhex] = dids.length;
        this.udsScanDidsCntTotal += dids.length;
        await this.startupUdsWorker(ctx, udsWorker, 'udsDidScan');
        this.cntUdsScansActive += 1;
        await udsWorker.pushCmnd(ctx, 'read', dids);
    }

    /**
     * Perform scan of data points for a set of devices
     *
     * @param {object} ctx  Adapter context
     * @param {Array} udsAddrs  List of device addresses to be scanned
     * @param {object} udsDidsLimits  Numerical limits of dids to be scanned
     */
    async scanUdsDids(ctx, udsAddrs, udsDidsLimits) {
        function range(size, startAt = 0) {
            return [...Array(size).keys()].map(i => i + startAt);
        }
        async function logStatus(ctx, ctxScan) {
            await ctx.log.info(
                `UDS dids scan status (retries/found/done/total): (${String(ctxScan.udsScanDidsCntRetries)}/${String(
                    ctxScan.udsScanDidsCntSuccess,
                )}/${String(ctxScan.udsScanDidsCntDone)}/${String(
                    ctxScan.udsScanDidsCntTotal,
                )}), remaining: ${JSON.stringify(ctxScan.udsScanDids)}`,
            );
        }

        await ctx.log.info('UDS dids scan - start');
        if (ctx.suppressStateStorage) {
            await ctx.log.info('UDS dids scan: Storing of data point values in object tree is disabled.');
        }
        this.workers = {};
        this.udsScanDids = {};

        // Stop all running UDS workers to avoid communication conflicts:
        for (const worker of Object.values(ctx.E3UdsWorkers)) {
            await worker.stop(ctx);
        }

        // Stop all running Collect workers on extternal bus to avoid data storage conflicts:
        for (const worker of Object.values(ctx.E3CollectExt)) {
            await worker.stop(ctx);
        }

        // Detect Collect-capable devices by listening for time messages (21 FA 01 B3 ...) on 0x451 / 0x693:
        const collectIds = new Set([0x451, 0x693]);
        let collectListening = true;
        const onCollectMsg = function (msg) {
            if (!collectListening) {
                return;
            }
            if (
                collectIds.has(msg.id) &&
                msg.data.length >= 4 &&
                msg.data[0] === 0x21 &&
                msg.data[1] === 0xfa &&
                msg.data[2] === 0x01 &&
                msg.data[3] === 0xb3
            ) {
                ctx.detectedCollectCanIds.add(msg.id);
            }
        };
        ctx.detectedCollectCanIds = new Set();
        await ctx.channelExt.addListener('onMessage', onCollectMsg);
        if (ctx.channelInt) {
            await ctx.channelInt.addListener('onMessage', onCollectMsg);
        }

        this.cntUdsScansActive = 0;
        this.udsScanDidsCntTotal = 0;
        this.udsScanDidsCntRetries = 0;
        this.udsScanDidsCntSuccess = 0;
        this.udsScanDidsCntDone = 0;
        const dids = range(udsDidsLimits.max - udsDidsLimits.min + 1, udsDidsLimits.min);
        for (const addr of Object(udsAddrs).values()) {
            await this.startupScanUdsDids(ctx, addr, dids);
            await this.sleep(ctx, 50);
        }
        let cntDoneLast = -1;
        await logStatus(ctx, this);
        let ts = new Date().getTime();
        const tsAbort = ts + this.udsScanDidsCntTotal * 500;
        while (this.cntUdsScansActive > 0 && new Date().getTime() < tsAbort) {
            await this.sleep(ctx, 100);
            if (new Date().getTime() - ts >= 10000) {
                ts += 10000;
                await logStatus(ctx, this);
                const cnt = this.udsScanDidsCntDone + this.udsScanDidsCntRetries;
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
            worker.storage.storageDids.didsDictDevCom['Version'] = E3DidsDict.Version;
            await worker.storage.storageDids.storeKnownDids(ctx);
            await worker.stop(ctx);
        }
        this.workers = {};
        ctx.suppressStateStorage = false;

        // Stop Collect detection, log result and persist to states:
        collectListening = false;
        await ctx.log.info(
            `UDS dids scan: Collect-capable devices detected on CAN IDs: ${
                ctx.detectedCollectCanIds.size > 0
                    ? [...ctx.detectedCollectCanIds].map(id => `0x${id.toString(16)}`).join(', ')
                    : 'none'
            }`,
        );
        for (const canId of [0x451, 0x693]) {
            const stateId = `info.detectedCollect${canId.toString(16)}`;
            await ctx.extendObject(stateId, {
                type: 'state',
                common: { name: stateId, type: 'boolean', role: 'state', read: true, write: false },
                native: {},
            });
            await ctx.setStateAsync(stateId, ctx.detectedCollectCanIds.has(canId), true);
        }

        if (this.cntUdsScansActive < 0) {
            await ctx.log.warn(
                `UDS dids scan finished. Number of active UDS scans (should be 0): ${String(this.cntUdsScansActive)}`,
            );
        }
        await ctx.log.info(
            `UDS dids scan found ${String(
                this.udsScanDidsCntSuccess,
            )} dids. See channel "info" at device objects for details.`,
        );

        // Restart all previously running workers:

        // Collect workers:
        for (const worker of Object.values(ctx.E3CollectExt)) {
            await worker.startup(ctx);
        }

        // UDS workers:
        for (const worker of Object.values(ctx.E3UdsWorkers)) {
            await worker.startup(ctx, 'normal');
            await this.sleep(ctx, ctx.udsTimeDelta);
        }
    }

    /**
     * Wait for a specified time
     *
     * @param {object} ctx  Caller context
     * @param {number} milliseconds  Waiting time (ms)
     */
    sleep(ctx, milliseconds) {
        return new Promise(resolve => ctx.setTimeout(resolve, milliseconds));
    }
}

module.exports = {
    udsScan,
};
