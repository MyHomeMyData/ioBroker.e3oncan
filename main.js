'use strict';

/*
 * Unveil life data of Viessmann E3 series devices via CAN bus
 *
 * Based on project open3e: https://github.com/open3e/open3e
 *
 */

/*
 * Created with @iobroker/create-adapter v2.5.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Loading modules:
let can = null;
let canLoadError = null;
try {
    can = require('socketcan');
} catch (e) {
    canLoadError = e;
}
// Raw API version of open3e-esp32 this adapter was written against (RAW_API_VERSION in its httpd_api.c):
const GATEWAY_RAW_API_VERSION = 1;
const adapterVersion = require('./package.json').version;
const storage = require('./lib/storage');
const E3DidsDict = require('./lib/didsE3.json');
const E3DidsVarDict = require('./lib/didsE3var.json');
const E380DidsDict = require('./lib/didsE380.json');
const E3100CBDidsDict = require('./lib/didsE3100CB.json');
const E3DidsWritable = require('./lib/didsE3Writables.json');
const collect = require('./lib/canCollect');
const uds = require('./lib/canUds');
const udsGateway = require('./lib/canUdsGateway');
const gatewayChannel = require('./lib/canGatewayChannel');
const udsScan = require('./lib/udsScan');

class E3oncan extends utils.Adapter {
    /**
     * @param {object} options  Adapter options
     */
    constructor(options) {
        super({
            ...options,
            name: 'e3oncan',
        });

        this.stoppingInstance = false; // true during unLoad()
        this.suppressStateStorage = false;
        this.defaultDelayEM = 5;
        this.e380Active = false;
        this.e3100cbActive = false;
        this.e380Delay = 5;
        this.e3100cbDelay = 5;
        this.e380Collect97 = null;
        this.e380Collect97Channel = 'ext';
        this.e380Collect98 = null;
        this.e380Collect98Channel = 'ext';
        this.e3100cbCollect = null;
        this.e3100cbCollectChannel = 'ext';
        this.E3CollectInt = {}; // Dict of collect devices on internal bus
        this.E3CollectExt = {}; // Dict of collect devices on external bus
        this.collectTimeout = 2000; // Timeout (ms) for collecting data
        this.E3UdsWorkers = {}; // Dict of standard uds workers
        this.E3UdsSID77Workers = {}; // Dict of uds workers for service 77
        this.cntWorkersActive = 0; // Total number of active workers (collect + UDS)

        this.channelExt = null;
        this.channelExtName = '';
        this.channelInt = null;
        this.channelIntName = '';
        this.cntCanConnDesired = 0; // Number of activated CAN connections in config
        this.cntCanConnActual = 0; // Number if actualy connected CAN buses

        this.udsWorkers = {};
        this.udsTimeout = 7500; // Timeout (ms) for normal UDS communication
        this.udsDevices = []; // Confirmed & edited UDS devices
        this.udsTimeDelta = 50; // Time delta (ms) between UDS schedules
        this.udsTimeoutHandles = [];
        this.udsMasterDevAddr = 0x680; // Address of master device
        this.udsMasterDevUnits = 'n/a'; // Units and Formats of master device (0x680)

        this.didsVersionTC = '20240309'; // Change of type of numerical dids to Number at this version
        this.udsDidForScan = 256; // Busidentification is in this id
        this.udsDidForUnits = 382; // UnitsAndFormats
        this.udsDidsVarLength = [257, 258, 259, 260, 261, 262, 263, 264, 265, 266]; // Dids have content of variable length dependend of number of list elements
        this.udsScanWorker = new udsScan.udsScan();
        this.detectedEnergyMeters = { e380_97: '', e380_98: '', e3100cb: '' };
        this.detectedCollectCanIds = new Set();
        this.collectScanDone = false; // true if info.collect exists in v1.x format (detectedIds array)
        this.udsScanDevices = []; // UDS devices found during scan
        this.udsDevAddrs = [];
        this.udsDevStateNames = [];
        //this.udsDidsLimits = { min: 256, max: 268 }; // Min. and max. numerical value of dids for scan of data points. Should meet range defined in didsE3,json
        this.udsDidsLimits = { min: 256, max: 3338 }; // Min. and max. numerical value of dids for scan of data points. Should meet range defined in didsE3,json
        this.scanIsRunning = false; // Device scan or data point scan in progress; only one at a time

        //this.on('install', this.onInstall.bind(this));
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        //this.on('objectChange', this.onObjectChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        if (!can) {
            if (
                canLoadError &&
                /compiled against a different Node\.js version|did not self-register/i.test(canLoadError.message)
            ) {
                this.log.error('Native module socketcan was compiled for a different Node.js version.');
                this.log.error(
                    'Fix: upgrade the adapter to version 1.0.3 or later. From that version, socketcan uses N-API and no longer needs to be rebuilt after a Node.js upgrade.',
                );
            } else {
                this.log.error(
                    `Failed to load native module socketcan: ${canLoadError ? canLoadError.message : 'unknown error'}`,
                );
            }
            return;
        }

        await this.log.info(`Startup of instance ${this.namespace}: Starting.`);
        await this.log.debug(`Adapter version ${adapterVersion}`);
        //await this.log.debug('this.config:');
        //await this.log.debug(JSON.stringify(this.config));

        // Reset the connection indicator during startup
        this.setState('info.connection', false, true);

        await this.initScanStatus();

        // Read energy meter configuration from info.energyMeter JSON (with migration fallback):
        try {
            const sEm = await this.getStateAsync('info.energyMeter');
            if (sEm && sEm.val) {
                const em = JSON.parse(String(sEm.val));
                const toChannel = v => (v && typeof v === 'string' ? v : '');
                this.detectedEnergyMeters = {
                    e380_97: toChannel(em.e380_97),
                    e380_98: toChannel(em.e380_98),
                    e3100cb: toChannel(em.e3100cb),
                };
                this.e380Active = em.e380Active != null ? !!em.e380Active : false;
                this.e380Delay = em.e380Delay != null ? Number(em.e380Delay) : this.defaultDelayEM;
                this.e3100cbActive = em.e3100cbActive != null ? !!em.e3100cbActive : false;
                this.e3100cbDelay = em.e3100cbDelay != null ? Number(em.e3100cbDelay) : this.defaultDelayEM;
            } else {
                // Migration: read from old individual states (pre-v1.0.0 installations)
                const s97 = await this.getStateAsync('info.e380_97');
                const s98 = await this.getStateAsync('info.e380_98');
                const sCb = await this.getStateAsync('info.e3100cb');
                const toChannel = s => (s && s.val ? (typeof s.val === 'string' ? s.val : 'ext') : '');
                this.detectedEnergyMeters = {
                    e380_97: toChannel(s97),
                    e380_98: toChannel(s98),
                    e3100cb: toChannel(sCb),
                };
                const sDelay380 = await this.getStateAsync('info.e380_delay');
                this.e380Delay = sDelay380 && sDelay380.val != null ? Number(sDelay380.val) : this.defaultDelayEM;
                const sDelayCb = await this.getStateAsync('info.e3100cb_delay');
                this.e3100cbDelay = sDelayCb && sDelayCb.val != null ? Number(sDelayCb.val) : this.defaultDelayEM;
                const sActive380 = await this.getStateAsync('info.e380_active');
                if (sActive380 == null) {
                    // @ts-expect-error AdapterConfig
                    this.e380Active = !!this.config.e380Active; // migrate from very old config
                    if (this.e380Active) {
                        this.detectedEnergyMeters.e380_98 = 'ext';
                        this.log.warn(
                            'Upgrade migration: E380 configured for CAN address 98 on UDS CAN channel. ' +
                                'If your E380 uses CAN address 97, please run a device scan to reconfigure.',
                        );
                    }
                } else {
                    this.e380Active = !!sActive380.val;
                }
                const sActiveCb = await this.getStateAsync('info.e3100cb_active');
                if (sActiveCb == null) {
                    // @ts-expect-error AdapterConfig
                    this.e3100cbActive = !!this.config.e3100cbActive; // migrate from very old config
                    if (this.e3100cbActive) {
                        this.detectedEnergyMeters.e3100cb = 'ext';
                        this.log.info('Upgrade migration: E3100CB configured for UDS CAN channel.');
                    }
                } else {
                    this.e3100cbActive = !!sActiveCb.val;
                }
            }
        } catch {
            // states not yet available, keep defaults
        }

        // Read detected Collect CAN IDs from info.collect JSON (with migration fallback):
        try {
            const sCo = await this.getStateAsync('info.collect');
            if (sCo && sCo.val) {
                const co = JSON.parse(String(sCo.val));
                if (Array.isArray(co.detectedIds)) {
                    // Current format: array of numeric CAN IDs
                    this.collectScanDone = true;
                    for (const id of co.detectedIds) {
                        this.detectedCollectCanIds.add(Number(id));
                    }
                } else {
                    // Migration: old format before dynamic Collect IDs (pre-v1.0.0)
                    if (co.detected451) {
                        this.detectedCollectCanIds.add(0x451);
                    }
                    if (co.detected693) {
                        this.detectedCollectCanIds.add(0x693);
                    }
                }
            } else {
                // Migration: read from old individual states (pre-v1.0.0 installations)
                for (const canId of [0x451, 0x693]) {
                    const s = await this.getStateAsync(`info.detectedCollect${canId.toString(16)}`);
                    if (s && s.val) {
                        this.detectedCollectCanIds.add(canId);
                    }
                }
            }
        } catch {
            // states not yet available, keep default
        }

        // Collect known devices adresses:
        for (const dev of Object.values(this.config.tableUdsDevices)) {
            // @ts-expect-error AdapterConfig
            this.udsDevAddrs.push(dev.devAddr);
            // @ts-expect-error AdapterConfig
            this.udsDevStateNames.push(dev.devStateName);
        }

        // Check for updates of list of datapoints and perform update if needed:
        await this.updateDatapointsSpecificNumTypeChange(this.config.tableUdsDevices); // UDS devices, specific dids, possible change of type of numerical values
        await this.updateDatapointsSpecificVariants(this.config.tableUdsDevices); // UDS devices, specific dids, update for dids having variant length of structure
        await this.updateDatapointsCommon(this.config.tableUdsDevices); // UDS devices, common dids
        // Update datapoints for detected energy meters (auto-named):
        if (this.detectedEnergyMeters.e380_98) {
            const name98 = this.detectedEnergyMeters.e380_98 === 'int' ? 'e380_98' : 'e380';
            await this.updateDatapointsCommon([{ devStateName: name98, device: 'e380' }]);
        }
        if (this.detectedEnergyMeters.e380_97) {
            await this.updateDatapointsCommon([{ devStateName: 'e380_97', device: 'e380' }]);
        }
        if (this.detectedEnergyMeters.e3100cb) {
            await this.updateDatapointsCommon([{ devStateName: 'e3100cb', device: 'e3100cb' }]);
        }

        // Setup external CAN bus if required
        // ==================================

        // @ts-expect-error AdapterConfig
        if (this.config.canExtActivated) {
            this.cntCanConnDesired++;
            [this.channelExt, this.channelExtName] = await this.connectToCan(
                this.channelExt,
                // @ts-expect-error AdapterConfig
                this.config.canExtTransport || 'local',
                // @ts-expect-error AdapterConfig
                this.config.canExtName,
                {
                    // @ts-expect-error AdapterConfig
                    brokerUrl: this.config.canExtGatewayMqttUrl,
                    // @ts-expect-error AdapterConfig
                    username: this.config.canExtGatewayMqttUser,
                    // @ts-expect-error AdapterConfig
                    password: this.config.canExtGatewayMqttPassword,
                    // @ts-expect-error AdapterConfig
                    baseTopic: this.config.canExtGatewayMqttBaseTopic,
                    log: this.log,
                },
                this.onCanMsgExt,
                this.onCanExtStopped,
            );
        }

        // Setup internal CAN bus if required
        // ==================================

        // @ts-expect-error AdapterConfig
        if (this.config.canIntActivated) {
            this.cntCanConnDesired++;
            [this.channelInt, this.channelIntName] = await this.connectToCan(
                this.channelInt,
                // @ts-expect-error AdapterConfig
                this.config.canIntTransport || 'local',
                // @ts-expect-error AdapterConfig
                this.config.canIntName,
                {
                    // @ts-expect-error AdapterConfig
                    brokerUrl: this.config.canIntGatewayMqttUrl,
                    // @ts-expect-error AdapterConfig
                    username: this.config.canIntGatewayMqttUser,
                    // @ts-expect-error AdapterConfig
                    password: this.config.canIntGatewayMqttPassword,
                    // @ts-expect-error AdapterConfig
                    baseTopic: this.config.canIntGatewayMqttBaseTopic,
                    log: this.log,
                },
                this.onCanMsgInt,
                this.onCanIntStopped,
            );
        }

        if (this.cntCanConnActual == this.cntCanConnDesired) {
            // All configured CAN connections are established
            await this.setState('info.connection', true, true);
        }

        // Tell any gateway-transport bus which CAN-IDs to relay raw over MQTT,
        // so this adapter's own Collect/energy-meter code (fed via
        // lib/canGatewayChannel.js, unchanged either way) has something to see:
        await this.configureGatewayRawCanIds();
        await this.checkGatewayCapabilities();

        // Setup energy meter collect workers for detected and activated meters:
        if (this.channelExt || this.channelInt) {
            if (this.e380Active) {
                if (this.detectedEnergyMeters.e380_97) {
                    this.e380Collect97Channel = this.detectedEnergyMeters.e380_97;
                    this.e380Collect97 = await this.setupE380Collect97Worker(this.e380Delay);
                }
                if (this.detectedEnergyMeters.e380_98) {
                    this.e380Collect98Channel = this.detectedEnergyMeters.e380_98;
                    this.e380Collect98 = await this.setupE380Collect98Worker(this.e380Delay);
                }
            }
            if (this.e3100cbActive && this.detectedEnergyMeters.e3100cb) {
                this.e3100cbCollectChannel = this.detectedEnergyMeters.e3100cb;
                this.e3100cbCollect = await this.setupE3100cbCollectWorker(this.e3100cbDelay);
            }
        }

        // Setup all configured devices for collect:
        if (this.channelExt) {
            // @ts-expect-error AdapterConfig
            await this.setupE3CollectWorkers(this.config.tableCollectCanExt, this.E3CollectExt, this.channelExt);
        }
        if (this.channelInt) {
            // @ts-expect-error AdapterConfig
            await this.setupE3CollectWorkers(this.config.tableCollectCanInt, this.E3CollectInt, this.channelInt);
        }

        // Initial setup all configured devices for UDS:
        if (this.channelExt) {
            await this.setupUdsWorkers();
        }

        this.log.debug(`Total number of active workers: ${String(this.cntWorkersActive)}`);

        this.log.info(`Startup of instance ${this.namespace}: Done.`);
    }

    // Check for updates:

    async updateDatapointsCommon(devices) {
        // Update list of common datapoints of all devices during startup of adapter
        for (const dev of Object.values(devices)) {
            let didsDictNew = null;
            let didsWritable = null;
            switch (dev.device) {
                case 'e380':
                    didsDictNew = E380DidsDict;
                    didsWritable = {};
                    break;
                case 'e3100cb':
                    didsDictNew = E3100CBDidsDict;
                    didsWritable = {};
                    break;
                default:
                    didsDictNew = E3DidsDict;
                    didsWritable = E3DidsWritable;
            }
            const devDids = new storage.storageDids({ stateBase: dev.devStateName, device: dev.device });
            await devDids.initStates(this, 'standby');
            await devDids.readKnownDids(this, 'standby');
            if (devDids.didsDevSpecAvail) {
                if (
                    devDids.didsDictDevCom.Version === undefined ||
                    Number(didsDictNew.Version) > Number(devDids.didsDictDevCom.Version)
                ) {
                    this.log.info(
                        `Updating common datapoints to version ${didsDictNew.Version} for device ${dev.devStateName}`,
                    );
                    for (const did of Object.keys(devDids.didsDictDevCom)) {
                        if (did != 'Version' && did in didsDictNew) {
                            // Check for changes in datapoint structure
                            const didStateName = `${await devDids.getDidStr(did)}_${await devDids.didsDictDevCom[did].id}`;
                            const devStruct = await devDids.getDidStruct(this, [], devDids.didsDictDevCom[did]);
                            const E3Struct = await devDids.getDidStruct(this, [], didsDictNew[did]);
                            if (JSON.stringify(devStruct) != JSON.stringify(E3Struct)) {
                                // Structure of datapoint has changed
                                // Replace .json and .tree state(s) based on raw data of did
                                this.log.info(`  > Structure of datapoint ${didStateName} has changed. Updating.`);
                                // Delete tree states based on old structure:
                                await this.delObjectAsync(
                                    `${this.namespace}.${dev.devStateName}.tree.${didStateName}`,
                                    { recursive: true },
                                );
                                const raw = await devDids.getObjectVal(this, `${dev.devStateName}.raw.${didStateName}`);
                                if (raw != null) {
                                    // Create states based on new structure if raw data is available:
                                    const cdi = await didsDictNew[did];
                                    const res = await devDids.decodeDid(
                                        this,
                                        { config: { stateBase: dev.devStateName, devUnits: dev.devUnits } },
                                        did,
                                        cdi,
                                        devDids.toByteArray(raw),
                                    );
                                    await devDids.storeObjectJson(
                                        this,
                                        did,
                                        res.idStr,
                                        `${this.namespace}.${dev.devStateName}.json.${didStateName}`,
                                        res.val,
                                    );
                                    await devDids.setupCodecById(
                                        cdi,
                                        `${this.namespace}.${dev.devStateName}.${devDids.getDidStr(did)}_`,
                                        dev.devUnits,
                                    );
                                    await devDids.storeObjectTree(
                                        this,
                                        did,
                                        res.idStr,
                                        `${this.namespace}.${dev.devStateName}.tree.${didStateName}`,
                                        res.val,
                                    );
                                }
                            } else {
                                // No change of structure of datapoint
                                // Check for change of data type for numerical values
                                if (Number(devDids.didsDictDevCom.Version) < Number(this.didsVersionTC)) {
                                    // Make sure, data type and role of tree objects are correct
                                    // Force update of .tree state(s) based on raw data of did
                                    if (this.udsDidsVarLength.includes(Number(did))) {
                                        // Did with variable length has to be deleted to avoid type confilct, when length gets larger in future
                                        this.log.silly(
                                            `  > Delete datapoint ${didStateName} to secure change of data type`,
                                        );
                                        await this.delObjectAsync(
                                            `${this.namespace}.${dev.devStateName}.tree.${didStateName}`,
                                            { recursive: true },
                                        );
                                    }
                                    const raw = await devDids.getObjectVal(
                                        this,
                                        `${dev.devStateName}.raw.${didStateName}`,
                                    );
                                    if (raw != null) {
                                        // Update .tree states:
                                        this.log.silly(`  > Update type and role of datapoint ${didStateName}`);
                                        const cdi = await didsDictNew[did];
                                        const res = await devDids.decodeDid(
                                            this,
                                            { config: { stateBase: dev.devStateName, devUnits: dev.devUnits } },
                                            did,
                                            cdi,
                                            devDids.toByteArray(raw),
                                        );
                                        await devDids.setupCodecById(
                                            cdi,
                                            `${this.namespace}.${dev.devStateName}.${devDids.getDidStr(did)}_`,
                                            dev.devUnits,
                                        );
                                        await devDids.storeObjectTree(
                                            this,
                                            did,
                                            res.idStr,
                                            `${this.namespace}.${dev.devStateName}.tree.${didStateName}`,
                                            res.val,
                                            true,
                                        );
                                    }
                                }
                            }
                            // Update datapoint description:
                            devDids.didsDictDevCom[did] = await didsDictNew[did];
                            // Update list of writable datapoints:
                            if (did in didsWritable && !(did in devDids.didsWritable)) {
                                this.log.silly(`  > Add ${didStateName} to list of writable datapoints`);
                                devDids.didsWritable[did] = await didsWritable[did];
                            }
                        }
                    }
                    devDids.didsDictDevCom['Version'] = didsDictNew.Version;
                }
            }
            await devDids.storeKnownDids(this);
        }
    }

    async updateDatapointsSpecificNumTypeChange(devices) {
        // Update list of device-specific datapoints of all devices during startup of adapter
        // Take care about possible change of type of numerical values
        for (const dev of Object.values(devices)) {
            const didsDictNew = E3DidsDict;
            const devDids = new storage.storageDids({ stateBase: dev.devStateName, device: dev.device });
            await devDids.initStates(this, 'standby');
            await devDids.readKnownDids(this, 'standby');
            if (devDids.didsDevSpecAvail) {
                if (
                    devDids.didsDictDevCom.Version === undefined ||
                    (Number(didsDictNew.Version) > Number(devDids.didsDictDevCom.Version) &&
                        Number(devDids.didsDictDevCom.Version) < Number(this.didsVersionTC))
                ) {
                    this.log.info(
                        `Fixing numerical type handling for device specific datapoints to version ${didsDictNew.Version} for device ${
                            dev.devStateName
                        }`,
                    );
                    for (const did of Object.keys(devDids.didsDictDevSpec)) {
                        if (did.length <= 4) {
                            try {
                                const didNo = Number(did);
                                // Make sure, data type and role of tree objects are correct
                                // Force update of .tree state(s) based on raw data of did
                                const didStateName = `${await devDids.getDidStr(did)}_${await devDids.didsDictDevSpec[did].id}`;
                                if (this.udsDidsVarLength.includes(didNo)) {
                                    // Did with variable length of content has to be deleted to avoid type confilct, when length gets larger in future
                                    this.log.silly(
                                        `  > Delete datapoint ${didStateName} to secure change of data type`,
                                    );
                                    await this.delObjectAsync(
                                        `${this.namespace}.${dev.devStateName}.tree.${didStateName}`,
                                        { recursive: true },
                                    );
                                }
                                const raw = await devDids.getObjectVal(this, `${dev.devStateName}.raw.${didStateName}`);
                                if (raw != null) {
                                    // Update .tree states:
                                    this.log.silly(`  > Update type and role of datapoint ${didStateName}`);
                                    const cdi = await devDids.didsDictDevSpec[did];
                                    const res = await devDids.decodeDid(
                                        this,
                                        { config: { stateBase: dev.devStateName, devUnits: dev.devUnits } },
                                        did,
                                        cdi,
                                        devDids.toByteArray(raw),
                                    );
                                    await devDids.setupCodecById(
                                        cdi,
                                        `${this.namespace}.${dev.devStateName}.${devDids.getDidStr(did)}_`,
                                        dev.devUnits,
                                    );
                                    await devDids.storeObjectTree(
                                        this,
                                        did,
                                        res.idStr,
                                        `${this.namespace}.${dev.devStateName}.tree.${didStateName}`,
                                        res.val,
                                        true,
                                    );
                                }
                            } catch {
                                this.log.warn(
                                    `  > Could not update did ${did} because of wrong format (expected a number).`,
                                );
                                continue;
                            }
                        }
                    }
                }
            }
        }
    }

    async updateDatapointsSpecificVariants(devices) {
        // Update list of device-specific datapoints of all devices during startup of adapter
        // Take care about dids having variant length of structure (introduced with open3e 0.6.0)
        for (const dev of Object.values(devices)) {
            const didsDictVar = E3DidsVarDict;
            const devDids = new storage.storageDids({ stateBase: dev.devStateName, device: dev.device });
            await devDids.initStates(this, 'standby');
            await devDids.readKnownDids(this, 'standby');
            if (devDids.didsDevSpecAvail) {
                if (
                    devDids.didsDictDevSpec.Version === undefined ||
                    Number(didsDictVar.Version) > Number(devDids.didsDictDevSpec.Version)
                ) {
                    this.log.info(
                        `Updating device specific datapoints to version ${didsDictVar.Version} for device ${
                            dev.devStateName
                        }`,
                    );
                    if (!('Backup' in devDids.didsDictDevSpec)) {
                        devDids.didsDictDevSpec['Backup'] = {};
                    }
                    // Data points known as common with a length that is no longer the common length, but that
                    // have a variant with variable length (e.g. circuit names 631-634, formerly 12 bytes):
                    // treat them like device specific data points, so they get the variant definition below.
                    const movedFromCommon = new Set();
                    for (const [did, def] of Object.entries(devDids.didsDictDevCom)) {
                        if (
                            did.length <= 4 &&
                            !(did in devDids.didsDictDevSpec) &&
                            storage.variableLengthDef(did) &&
                            def?.len !== E3DidsDict[did]?.len &&
                            Number(def?.len) !== 0
                        ) {
                            devDids.didsDictDevSpec[did] = def;
                            movedFromCommon.add(did);
                        }
                    }
                    for (const did of Object.keys(devDids.didsDictDevSpec)) {
                        if (did.length <= 4 && did in didsDictVar) {
                            // Check if matching did is available in list of variant dids:
                            // exact length first, then a variant with variable length (len 0)
                            // Skip entries for 'Version' and 'Backup'
                            const oldDef = devDids.didsDictDevSpec[did];
                            const didLen = oldDef.len;
                            // Data point with variable length, stored with exactly the common length (e.g. circuit
                            // name 631 with 40 bytes, formerly common length 12): the common definition applies.
                            // Such devices use a fixed length, so values must be padded when writing.
                            const toCommon =
                                !didsDictVar[did][didLen] &&
                                storage.variableLengthDef(did) !== null &&
                                E3DidsDict[did] !== undefined &&
                                Number(didLen) === Number(E3DidsDict[did].len);
                            const newDef = toCommon
                                ? E3DidsDict[did]
                                : didsDictVar[did][didLen] ||
                                  (Number(didLen) !== 0 ? storage.variableLengthDef(did, Number(didLen)) : null);
                            if (!newDef) {
                                // No variant definition for stored length available, skip this did
                                if (devDids.didsDictDevCom[did]?.len !== didLen) {
                                    this.log.warn(
                                        `  > Variant did ${did}: no definition for length ${String(didLen)} found in didsE3var. Skipping.`,
                                    );
                                }
                                continue;
                            }
                            // Up to now, only RawCodec was known for this did or an user defined version or an older version of variant did => Use newly defined variant did
                            // Replace .json and .tree state(s) based on raw data of did
                            const didStr = await devDids.getDidStr(did);
                            const didStateName = `${didStr}_${await newDef.id}`;
                            // State name of the previous definition, e.g. 0627_DeviceSpecific:
                            const oldStateName = `${didStr}_${String(oldDef.id).replace(this.FORBIDDEN_CHARS, '_').replace('.', '_')}`;
                            // Check for changes in datapoint structure
                            const devStruct = await devDids.getDidStruct(this, [], oldDef);
                            const E3Struct = await devDids.getDidStruct(this, [], newDef);
                            if (JSON.stringify(devStruct) != JSON.stringify(E3Struct)) {
                                if (oldDef.protected) {
                                    const reason = oldDef.reason ? ` Reason: "${oldDef.reason}"` : '';
                                    this.log.info(
                                        `  > Variant datapoint ${didStateName} is protected by user. Update skipped.${reason}`,
                                    );
                                    if (movedFromCommon.has(did)) {
                                        delete devDids.didsDictDevSpec[did];
                                    }
                                    continue;
                                }
                                this.log.info(
                                    toCommon
                                        ? `  > Common definition applies to datapoint ${didStateName}. Updating.`
                                        : `  > New or updated defintion of variant datapoint ${didStateName} is available. Updating.`,
                                );
                                // Delete tree states based on old structure:
                                await this.delObjectAsync(
                                    `${this.namespace}.${dev.devStateName}.tree.${didStateName}`,
                                    { recursive: true },
                                );
                                let raw = await devDids.getObjectVal(this, `${dev.devStateName}.raw.${didStateName}`);
                                if (raw == null && oldStateName != didStateName) {
                                    raw = await devDids.getObjectVal(this, `${dev.devStateName}.raw.${oldStateName}`);
                                }
                                if (raw != null) {
                                    // Create states based on new structure if raw data is available:
                                    const cdi = newDef;
                                    const res = await devDids.decodeDid(
                                        this,
                                        { config: { stateBase: dev.devStateName, devUnits: dev.devUnits } },
                                        did,
                                        cdi,
                                        devDids.toByteArray(raw),
                                    );
                                    await devDids.storeObjectJson(
                                        this,
                                        did,
                                        res.idStr,
                                        `${this.namespace}.${dev.devStateName}.json.${didStateName}`,
                                        res.val,
                                    );
                                    await devDids.storeObjectJson(
                                        this,
                                        did,
                                        res.idStr,
                                        `${this.namespace}.${dev.devStateName}.raw.${didStateName}`,
                                        raw,
                                    );
                                    await devDids.setupCodecById(
                                        cdi,
                                        `${this.namespace}.${dev.devStateName}.${didStr}_`,
                                        dev.devUnits,
                                    );
                                    await devDids.storeObjectTree(
                                        this,
                                        did,
                                        res.idStr,
                                        `${this.namespace}.${dev.devStateName}.tree.${didStateName}`,
                                        res.val,
                                    );
                                }
                                if (oldStateName != didStateName) {
                                    // Remove states of the previous definition, e.g. 0627_DeviceSpecific:
                                    this.log.info(`  > Removing states of previous datapoint ${oldStateName}.`);
                                    for (const channel of ['tree', 'json', 'raw']) {
                                        await this.delObjectAsync(
                                            `${this.namespace}.${dev.devStateName}.${channel}.${oldStateName}`,
                                            { recursive: true },
                                        );
                                    }
                                }
                                // Create Backup of user defined data point definition:
                                if (
                                    !movedFromCommon.has(did) && // It's not a former common definition
                                    ((oldDef.codec != 'RawCodec' && // It's not a RawCodec
                                        !('source' in oldDef)) || // and info about source of definition is missing OR
                                        ('source' in oldDef && // the source of definition is known
                                            !oldDef.source.includes('didsE3var_'))) // and the source is NOT the list of variant codecs
                                ) {
                                    this.log.info(
                                        `  > Creating backup of actual definition of data point ${didStateName} - see section "Backup"`,
                                    );
                                    await (devDids.didsDictDevSpec['Backup'][did] = await oldDef);
                                }
                                if (toCommon) {
                                    // Common definition: remove device specific entry
                                    delete devDids.didsDictDevSpec[did];
                                    devDids.didsDictDevCom[did] = { ...newDef };
                                } else {
                                    // Update datapoint description:
                                    await (devDids.didsDictDevSpec[did] = { ...newDef });
                                    // Remember version of source:
                                    devDids.didsDictDevSpec[did]['source'] = `didsE3var_${didsDictVar.Version}`;
                                }
                            } else if (movedFromCommon.has(did)) {
                                delete devDids.didsDictDevSpec[did];
                            }
                        }
                    }
                    devDids.didsDictDevSpec['Version'] = didsDictVar.Version;
                }
            }
            await devDids.storeKnownDids(this);
        }
    }

    // Setup CAN busses

    /**
     * @param {object} channel  Existing channel object, or null/undefined to create one
     * @param {string} transport  'local' (default) or 'gateway'
     * @param {string} name  Local CAN interface name (transport 'local' only)
     * @param {object} gatewayConfig  MQTT connection config for the gateway channel (transport 'gateway' only)
     * @param {(msg: object) => void} onMsg  onMessage listener
     * @param {() => void} onStop  onStopped listener
     */
    async connectToCan(channel, transport, name, gatewayConfig, onMsg, onStop) {
        let chName = transport === 'gateway' ? gatewayConfig.brokerUrl : name;
        if (!channel) {
            try {
                channel =
                    transport === 'gateway'
                        ? new gatewayChannel.gatewayChannel(gatewayConfig)
                        : can.createRawChannel(name, true);
                await channel.addListener('onMessage', onMsg, this);
                await channel.addListener('onStopped', onStop, this);
                if (transport === 'gateway') {
                    await channel.addListener('onRecovered', this.onGatewayRecovered, this);
                }
                await channel.start();
                this.cntCanConnActual++;
                if (transport === 'gateway') {
                    // start() only kicks off the MQTT connection attempt, it
                    // does not confirm one - and "CAN-Adapter connected" would
                    // wrongly name the broker as the CAN adapter anyway. The
                    // gateway channel logs the real connect/fail itself, once
                    // the broker actually answers.
                    await this.log.debug(`Gateway channel starting, broker: ${chName}`);
                } else {
                    await this.log.info(`CAN-Adapter connected: ${chName}`);
                }
            } catch (e) {
                await this.log.error(`Could not connect to CAN-Adapter "${chName}" - err=${e.message}`);
                channel = null;
                chName = '';
            }
        }
        return [channel, chName];
    }

    /**
     * @param {object} channel  Channel to disconnect, or null/undefined if there is none
     * @param {string} name  Name to log (interface name or broker URL)
     * @returns {Array}  [null, ''] always, so a caller can destructure it the same way as connectToCan()'s result
     */
    disconnectFromCan(channel, name) {
        if (channel) {
            try {
                channel.stop();
                this.log.info(`CAN-Adapter disconnected: ${name}`);
            } catch (e) {
                this.log.error(`Could not disconnect from CAN "${name}" - err=${e.message}`);
            }
        }
        return [null, ''];
    }

    /**
     * CAN-IDs a gateway should relay raw over MQTT (docs/raw-gateway-api.md
     * section 2): both energy meters' fixed broadcast IDs, always - not
     * gated on e380Active/e3100cbActive, because the scan's own passive
     * detection (lib/udsScan.js) needs to see them before a user has any
     * reason to enable collection - plus every device-type-suggested
     * collectCanId from the confirmed device table, whether or not the user
     * has activated collection for it yet. Relaying an ID nobody ever sends
     * costs nothing; not relaying one that is needed silently breaks
     * detection or collection.
     *
     * @returns {string}  Comma-separated hex IDs, e.g. "0x250,0x251,...,0x693"
     */
    computeGatewayRawCanIds() {
        const ids = new Set([
            // E380, both meter addresses (97 odd, 98 even) combined:
            0x250, 0x251, 0x252, 0x253, 0x254, 0x255, 0x256, 0x257, 0x258, 0x259, 0x25a, 0x25b, 0x25c, 0x25d,
            // E3100CB:
            0x569,
        ]);
        for (const id of udsScan.collectIdsFromDevices(this.config.tableUdsDevices)) {
            ids.add(id);
        }
        return [...ids].map(id => `0x${id.toString(16)}`).join(',');
    }

    /**
     * REST base URLs of all buses configured as gateway transport.
     *
     * @returns {string[]}  REST base URLs, empty if no bus uses a gateway
     */
    gatewayBaseUrls() {
        const targets = [
            // @ts-expect-error AdapterConfig
            [this.config.canExtTransport, this.config.canExtGatewayUrl],
            // @ts-expect-error AdapterConfig
            [this.config.canIntTransport, this.config.canIntGatewayUrl],
        ];
        return targets.filter(([transport, base]) => transport === 'gateway' && base).map(([, base]) => base);
    }

    /**
     * Check each gateway once at startup. A firmware without the raw API cannot
     * serve the gateway transport at all, which is an error; a different raw API
     * version is a warning. Raw write switched off is also a warning, because
     * every data point write over a gateway goes through /api/rawwrite.
     */
    async checkGatewayCapabilities() {
        for (const base of this.gatewayBaseUrls()) {
            try {
                const status = await udsScan.fetchJson(`${base}/api/status`, {
                    signal: AbortSignal.timeout(5000),
                });
                await this.log.debug(
                    `Gateway ${base}: firmware ${status.firmware}, built ${status.buildDate}, ` +
                        `build id ${status.elfSha}, raw API version ${status.rawApiVersion}, ` +
                        `raw write ${status.rawWriteEnabled ? 'enabled' : 'disabled'}`,
                );
                if (status.rawApiVersion === undefined) {
                    await this.log.error(
                        `Gateway ${base} does not provide the raw API. Its firmware is too old for the gateway transport - ` +
                            `please update open3e-esp32.`,
                    );
                    continue;
                }
                if (status.rawApiVersion !== GATEWAY_RAW_API_VERSION) {
                    await this.log.warn(
                        `Gateway ${base} reports raw API version ${status.rawApiVersion}, this adapter expects ` +
                            `${GATEWAY_RAW_API_VERSION}. Some features may not work.`,
                    );
                }
                if (status.rawWriteEnabled === false) {
                    await this.log.warn(
                        `Raw write is disabled on gateway ${base}. Data point writes over this gateway will fail. ` +
                            `Enable "Rohes Schreiben freigeben" in the gateway's system settings if you need to write.`,
                    );
                }
            } catch (e) {
                await this.log.warn(`Could not check capabilities of gateway ${base}: ${e.message}`);
            }
        }
    }

    /**
     * Push the current raw CAN-ID set to every bus running as a gateway.
     * Failure only logs a warning - detection/collection over the gateway
     * would simply see nothing until the next successful attempt, not
     * something worth failing adapter startup over.
     */
    async configureGatewayRawCanIds() {
        const rawCanIds = this.computeGatewayRawCanIds();
        for (const base of this.gatewayBaseUrls()) {
            try {
                const res = await fetch(`${base}/api/settings`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ system: { rawCanIds: rawCanIds } }),
                    signal: AbortSignal.timeout(5000),
                });
                if (res.ok) {
                    await this.log.info(`Configured gateway ${base} to relay raw CAN-IDs: ${rawCanIds}`);
                } else {
                    await this.log.warn(`Could not configure the gateway's raw CAN-ID relay - HTTP ${res.status}`);
                }
            } catch (e) {
                await this.log.warn(`Could not configure the gateway's raw CAN-ID relay: ${e.message}`);
            }
        }
    }

    // Setup E380 collect worker for CAN address 97 (odd CAN IDs):
    async setupE380Collect97Worker(delay) {
        const worker = new collect.collect({
            canID: [0x251, 0x253, 0x255, 0x257, 0x259, 0x25b, 0x25d],
            stateBase: 'e380_97',
            device: 'e380',
            delay: delay,
            active: true,
        });
        await worker.initStates(this, 'standby');
        await worker.startup(this);
        return worker;
    }

    // Setup E380 collect worker for CAN address 98 (even CAN IDs).
    // Backward compat: state name is 'e380' on ext channel, 'e380_98' on int channel.
    async setupE380Collect98Worker(delay) {
        const stateName = this.e380Collect98Channel === 'int' ? 'e380_98' : 'e380';
        const worker = new collect.collect({
            canID: [0x250, 0x252, 0x254, 0x256, 0x258, 0x25a, 0x25c],
            stateBase: stateName,
            device: 'e380',
            delay: delay,
            active: true,
        });
        await worker.initStates(this, 'standby');
        await worker.startup(this);
        return worker;
    }

    // Setup E3100CB collect worker:
    async setupE3100cbCollectWorker(delay) {
        const worker = new collect.collect({
            canID: [0x569],
            stateBase: 'e3100cb',
            device: 'e3100cb',
            delay: delay,
            active: true,
        });
        await worker.initStates(this, 'standby');
        await worker.startup(this);
        return worker;
    }

    // Setup E3 collect workers:

    async setupE3CollectWorkers(conf, workers) {
        if (conf && conf.length > 0) {
            for (const workerConf of Object.values(conf)) {
                if (workerConf.collectActive) {
                    const devInfo = this.config.tableUdsDevices.filter(
                        // @ts-expect-error AdapterConfig
                        item => item.collectCanId == workerConf.collectCanId,
                    );
                    if (devInfo.length > 0) {
                        const worker = new collect.collect({
                            canID: [Number(workerConf.collectCanId)],
                            stateBase: devInfo[0].devStateName,
                            devUnits: await (devInfo[0].devUnits ? devInfo[0].devUnits : 'n/a'),
                            device: 'common',
                            timeout: this.collectTimeout,
                            delay: workerConf.collectDelayTime,
                        });
                        await worker.initStates(this, 'standby');
                        if (worker) {
                            await worker.startup(this);
                        }
                        workers[Number(workerConf.collectCanId)] = worker;
                    }
                }
            }
        }
    }

    // Setup workers for collecting data and for communication via UDS

    async setupUdsWorkers() {
        // UDS communication only ever happens on the external bus - the internal
        // bus is collect-only - so its transport alone decides the worker class.
        // @ts-expect-error AdapterConfig
        const UdsWorkerClass = this.config.canExtTransport === 'gateway' ? udsGateway.udsGateway : uds.uds;
        // Create an UDS worker for each device
        // This is to allow writing of data points even when no schedule for reading is defined
        for (const dev of Object.values(this.config.tableUdsDevices)) {
            // @ts-expect-error AdapterConfig
            const devTxAddr = Number(dev.devAddr);
            const devRxAddr = devTxAddr + 16;
            // @ts-expect-error AdapterConfig
            this.log.silly(`New UDS worker on ${String(dev.devStateName)}`);
            this.E3UdsWorkers[devRxAddr] = new UdsWorkerClass({
                canID: devTxAddr,
                // @ts-expect-error AdapterConfig
                stateBase: dev.devStateName,
                // @ts-expect-error AdapterConfig
                devUnits: await (dev.devUnits ? dev.devUnits : 'n/a'),
                device: 'common',
                delay: 0,
                active: false,
                channel: this.channelExt,
                // @ts-expect-error AdapterConfig
                gatewayBaseUrl: this.config.canExtGatewayUrl,
                timeout: this.udsTimeout,
            });
            await this.E3UdsWorkers[devRxAddr].initStates(this, 'standby');
            if (devTxAddr == this.udsMasterDevAddr) {
                // Initialize units of master device
                this.udsMasterDevUnits = await this.E3UdsWorkers[devRxAddr].config.devUnits;
            }
        }
        // @ts-expect-error AdapterConfig
        if (this.config.tableUdsSchedules && this.config.tableUdsSchedules.length > 0) {
            // @ts-expect-error AdapterConfig
            for (const dev of Object.values(this.config.tableUdsSchedules)) {
                if (dev.udsScheduleActive) {
                    const devTxAddr = Number(dev.udsSelectDevAddr);
                    const devRxAddr = devTxAddr + 16;
                    await this.E3UdsWorkers[devRxAddr].addSchedule(this, dev.udsSchedule, dev.udsScheduleDids);
                    this.log.silly(
                        `New Schedule (${String(dev.udsSchedule)}s) UDS device on ${String(dev.udsSelectDevAddr)}`,
                    );
                }
            }
        }
        for (const worker of Object.values(this.E3UdsWorkers)) {
            await worker.startup(this, 'normal');
            this.subscribeStates(`${this.namespace}.${worker.config.stateBase}.*`, this.onStateChange);
            await this.udsScanWorker.sleep(this, this.udsTimeDelta);
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param {object} callback Callback
     */
    async onUnload(callback) {
        try {
            const tStart = new Date().getTime();
            this.stoppingInstance = true;
            // Stop UDS workers:
            for (const toh of Object.values(this.udsTimeoutHandles)) {
                await this.clearTimeout(toh);
            }
            for (const worker of Object.values(this.E3UdsWorkers)) {
                await worker.stop(this);
            }
            for (const worker of Object.values(this.E3UdsSID77Workers)) {
                await worker.stop(this);
            }
            for (const worker of Object.values(this.udsScanWorker.workers)) {
                await worker.stop(this);
            }

            // Stop Collect workers:
            if (this.e380Collect97) {
                await this.e380Collect97.stop(this);
            }
            if (this.e380Collect98) {
                await this.e380Collect98.stop(this);
            }
            if (this.e3100cbCollect) {
                await this.e3100cbCollect.stop(this);
            }
            for (const worker of Object.values(this.E3CollectExt)) {
                await worker.stop(this);
            }
            for (const worker of Object.values(this.E3CollectInt)) {
                await worker.stop(this);
            }

            if (this.cntWorkersActive > 0) {
                // Timeout - there are still unstopped workers
                this.log.warn(
                    `Not all workers could be stopped during onOnload(). Number of still active workers: ${String(
                        this.cntWorkersActive,
                    )}`,
                );
            }

            // Stop CAN communication:
            // @ts-expect-error AdapterConfig
            this.disconnectFromCan(this.channelExt, this.config.canExtName);
            // @ts-expect-error AdapterConfig
            this.disconnectFromCan(this.channelInt, this.config.canIntName);
            this.setState('info.connection', false, true);

            this.log.debug(`onUnload() took ${String(new Date().getTime() - tStart)} ms to complete.`);

            callback();
        } catch (e) {
            this.log.error(`unLoad() could not be completed. err=${e.message}`);
            callback();
        }
    }

    // If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
    // You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
    // /**
    //  * Is called if a subscribed object changes
    //  * @param {string} id
    //  * @param {ioBroker.Object | null | undefined} obj
    //  */
    /*
    onObjectChange(id, obj) {
        if (obj) {
            // The object was changed
            this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
        } else {
            // The object was deleted
            this.log.info(`object ${id} deleted`);
        }
    }
    */

    /**
     * Is called if a subscribed state changes
     *
     * @param {string} id   State id
     * @param {ioBroker.State | null | undefined} state State
     */
    onStateChange(id, state) {
        if (state && !state.ack) {
            // The state was changed and ack == false
            this.log.silly(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
            // Check for necessary measures for all UDS workers
            for (const worker of Object.values(this.E3UdsWorkers)) {
                if (id.includes(`${this.namespace}.${worker.config.stateBase}`)) {
                    this.log.silly(`Call UDS worker for ${worker.config.stateBase}`);
                    worker.onUdsStateChange(this, worker, id, state);
                }
            }
            // Check for necessary measures for all collect workers on external CAN
            for (const worker of Object.values(this.E3CollectExt)) {
                if (id.includes(`${this.namespace}.${worker.config.stateBase}`)) {
                    this.log.silly(`Call internal collect worker for ${worker.config.stateBase}`);
                    worker.onUdsStateChange(this, worker, id, state);
                }
            }
            // Check for necessary measures for all collect workers on internal CAN
            for (const worker of Object.values(this.E3CollectInt)) {
                if (id.includes(`${this.namespace}.${worker.config.stateBase}`)) {
                    this.log.silly(`Call internal collect worker for ${worker.config.stateBase}`);
                    worker.onUdsStateChange(this, worker, id, state);
                }
            }
        }
    }

    /**
     * Create the scan status states if missing. A status that still says
     * "running" belongs to a scan the previous adapter process could not finish.
     */
    async initScanStatus() {
        const common = { read: true, write: false };
        await this.extendObject('info.scanStatus', {
            type: 'state',
            common: {
                ...common,
                name: 'Status of the last device or data point scan',
                type: 'string',
                role: 'text',
                def: '',
            },
            native: {},
        });
        await this.extendObject('info.scanStatusHtml', {
            type: 'state',
            common: {
                ...common,
                name: 'Status of the last device or data point scan (HTML)',
                type: 'string',
                role: 'html',
                def: '',
            },
            native: {},
        });
        const state = await this.getStateAsync('info.scanStatus');
        if (state && typeof state.val === 'string' && state.val.includes(' running')) {
            await this.setScanStatus(
                `${state.val.split(' running')[0]} interrupted by a restart of the adapter.`,
                'error',
            );
        }
    }

    /**
     * Show the progress or result of a scan in the admin UI. info.scanStatus
     * holds the plain text, info.scanStatusHtml the same text for the settings
     * dialog: the final result in bold, green on success and red otherwise.
     *
     * @param {string} text  Status text
     * @param {'running'|'ok'|'error'} [level]  Running scan or final result
     */
    async setScanStatus(text, level = 'running') {
        const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const color = { ok: '#4caf50', error: '#f44336' }[level];
        const html = color ? `<b style="color: ${color}">${escaped}</b>` : escaped;
        try {
            await this.setStateAsync('info.scanStatus', { val: text, ack: true });
            await this.setStateAsync('info.scanStatusHtml', { val: html, ack: true });
        } catch (e) {
            this.log.debug(`Could not set scan status: ${e.message}`);
        }
    }

    /**
     * Run a scan unless another one is in progress. Errors end up in the log
     * and in info.scanStatus instead of being lost in a detached promise.
     *
     * @param {string} label  "Device scan" or "Data point scan"
     * @param {() => Promise<void>} scanFn  The scan itself
     */
    async runScan(label, scanFn) {
        if (this.scanIsRunning) {
            this.log.warn(`${label} requested while another scan is running - request ignored.`);
            return;
        }
        this.scanIsRunning = true;
        try {
            await scanFn();
        } catch (e) {
            this.log.error(`${label} failed: ${e.message}`);
            await this.setScanStatus(`${label} failed: ${e.message}`, 'error');
        } finally {
            this.scanIsRunning = false;
        }
    }

    /**
     * Device scan started from the admin UI. The result goes straight into the
     * instance configuration, which restarts the instance. Nothing is written
     * when the scan changed nothing.
     *
     * An open settings dialog does not notice the new configuration (it reads the
     * instance object only when opened), so the status asks for a page reload.
     */
    async runDeviceScan() {
        const instObjId = `system.adapter.${this.namespace}`;
        const instObj = await this.getForeignObjectAsync(instObjId);
        const before = JSON.stringify({
            tableUdsDevices: instObj?.native?.tableUdsDevices ?? [],
            energyMeterDetectionResult: instObj?.native?.energyMeterDetectionResult ?? '',
        });

        if (!(await this.udsScanWorker.scanUdsDevices(this))) {
            return; // scanUdsDevices() has reported the reason in log and status
        }

        const em = this.detectedEnergyMeters;
        const emChan = ch => (ch === 'int' ? '2nd CAN' : 'UDS CAN');
        const emParts = [
            em.e380_97 ? `E380 (CAN addr 97, ${emChan(em.e380_97)})` : null,
            em.e380_98 ? `E380 (CAN addr 98, ${emChan(em.e380_98)})` : null,
            em.e3100cb ? `E3100CB (${emChan(em.e3100cb)})` : null,
        ].filter(Boolean);
        const energyMeterDetectionResult = emParts.length > 0 ? emParts.join(', ') : 'None detected';
        const after = { tableUdsDevices: this.udsDevices, energyMeterDetectionResult };

        const summary =
            `Device scan done: ${this.udsDevices.length} device(s), ${this.udsScanWorker.udsCntNewDevs} new. ` +
            `Energy meters: ${energyMeterDetectionResult}.`;
        // No device at all usually means a problem with the bus or the gateway (see log)
        const level = this.udsDevices.length > 0 ? 'ok' : 'error';
        if (JSON.stringify(after) === before) {
            await this.setScanStatus(`${summary} No changes.`, level);
            return;
        }
        await this.log.silly(`Device scan: writing to configuration - ${JSON.stringify(after)}`);
        await this.setScanStatus(
            `${summary} List saved. If the list of devices is empty, reload the page (F5).`,
            level,
        );
        await this.extendForeignObjectAsync(instObjId, { native: after });
    }

    // If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.messagebox" property to be set to true in io-package.json
    //  * @param {ioBroker.Message} obj
    //  */
    async onMessage(obj) {
        //await this.log.debug('this.config:');
        //await this.log.debug(JSON.stringify(this.config));
        if (typeof obj === 'object' && obj.message) {
            this.log.silly(`command received ${obj.command}`);

            if (obj.command === 'getUdsDevices') {
                if (obj.callback) {
                    // Answer at once and report progress and result via info.scanStatus.
                    // The admin's WebSocket client drops answers that take longer than
                    // 30 s (ioBroker.admin#3737), and a scan usually does.
                    this.sendTo(obj.from, obj.command, {}, obj.callback);
                    void this.runScan('Device scan', () => this.runDeviceScan());
                } else {
                    this.sendTo(obj.from, obj.command, { native: { tableUdsDevices: [] } }, obj.callback);
                }
            }

            if (obj.command === 'getUdsDeviceSelect') {
                if (obj.callback) {
                    this.log.silly(`Received data - ${JSON.stringify(obj)}`);
                    if (Array.isArray(obj.message)) {
                        const selUdsDevices = obj.message.map(item => ({
                            label: item.devStateName,
                            value: item.devAddr,
                        }));
                        this.log.silly(`Data to send - ${JSON.stringify(selUdsDevices)}`);
                        if (selUdsDevices) {
                            this.sendTo(obj.from, obj.command, selUdsDevices, obj.callback);
                        }
                    } else {
                        this.sendTo(obj.from, obj.command, [{ label: 'Not available', value: '' }], obj.callback);
                    }
                } else {
                    this.sendTo(obj.from, obj.command, [{ label: 'Not available', value: '' }], obj.callback);
                }
            }

            if (obj.command === 'getExtColDeviceSelect') {
                if (obj.callback) {
                    this.log.silly(`Received data - ${JSON.stringify(obj)}`);
                    if (Array.isArray(obj.message)) {
                        const selUdsDevices = obj.message
                            .filter(item => item.collectCanId != '')
                            .map(item => ({ label: item.devStateName, value: item.collectCanId }));
                        this.log.silly(`Data to send - ${JSON.stringify(selUdsDevices)}`);
                        if (selUdsDevices) {
                            this.sendTo(obj.from, obj.command, selUdsDevices, obj.callback);
                        }
                    } else {
                        this.sendTo(obj.from, obj.command, [{ label: 'Not available', value: '' }], obj.callback);
                    }
                } else {
                    this.sendTo(obj.from, obj.command, [{ label: 'Not available', value: '' }], obj.callback);
                }
            }

            if (obj.command === 'getIntColDeviceSelect') {
                if (obj.callback) {
                    this.log.silly(`Received data - ${JSON.stringify(obj)}`);
                    if (Array.isArray(obj.message)) {
                        const selUdsDevices = obj.message
                            .filter(item => item.collectCanId != '')
                            .map(item => ({ label: item.devStateName, value: item.collectCanId }));
                        this.log.silly(`Data to send - ${JSON.stringify(selUdsDevices)}`);
                        if (selUdsDevices) {
                            this.sendTo(obj.from, obj.command, selUdsDevices, obj.callback);
                        }
                    } else {
                        this.sendTo(obj.from, obj.command, [{ label: 'Not available', value: '' }], obj.callback);
                    }
                } else {
                    this.sendTo(obj.from, obj.command, [{ label: 'Not available', value: '' }], obj.callback);
                }
            }

            if (obj.command === 'startDidScan') {
                if (obj.callback) {
                    this.log.silly(`Received data - ${JSON.stringify(obj)}`);
                    // Answer at once, see getUdsDevices above.
                    this.sendTo(obj.from, obj.command, {}, obj.callback);
                    const message = obj.message;
                    void this.runScan('Data point scan', async () => {
                        this.suppressStateStorage =
                            (message?.saveDidsOnScan ?? this.config.saveDidsOnScan ?? true) === false;
                        const limits = Array.isArray(message?.dids) ? { dids: message.dids } : this.udsDidsLimits;
                        await this.udsScanWorker.scanUdsDids(this, this.udsDevAddrs, limits);
                    });
                } else {
                    this.sendTo(obj.from, obj.command, obj.message, obj.callback);
                }
            }

            if (obj.command === 'getTabDids') {
                if (obj.callback) {
                    const result = [];
                    // eslint-disable-next-line jsdoc/check-tag-names
                    for (const dev of /** @type {object[]} */ (Object.values(this.config.tableUdsDevices))) {
                        const devStateName = dev.devStateName;
                        const udsDids = new storage.storageDids({ stateBase: devStateName, device: devStateName });
                        await udsDids.readKnownDids(this, 'standby');
                        const dids = [];
                        if (udsDids.didsDevSpecAvail) {
                            for (const [did, item] of Object.entries(udsDids.didsDictDevCom)) {
                                if (did === 'Version' || did in udsDids.didsDictDevSpec) {
                                    continue;
                                }
                                dids.push({ didId: Number(did), didName: item.id, didDesc: item.args.desc || '' });
                            }
                            for (const [did, item] of Object.entries(udsDids.didsDictDevSpec)) {
                                if (did.length > 4) {
                                    continue;
                                }
                                dids.push({ didId: Number(did), didName: item.id, didDesc: item.args.desc || '' });
                            }
                            dids.sort((a, b) => a.didId - b.didId);
                        }
                        result.push({
                            devStateName,
                            devAddr: dev.devAddr,
                            collectCanId: dev.collectCanId || '',
                            dids,
                            scanDone: udsDids.didsScanDone,
                        });
                    }
                    this.sendTo(
                        obj.from,
                        obj.command,
                        {
                            devices: result,
                            energyMeters: this.detectedEnergyMeters,
                            detectedCollectCanIds: [...this.detectedCollectCanIds],
                            collectScanDone: this.collectScanDone,
                            energyMeterDelays: { e380: this.e380Delay, e3100cb: this.e3100cbDelay },
                            energyMeterActive: { e380: this.e380Active, e3100cb: this.e3100cbActive },
                        },
                        obj.callback,
                    );
                }
            }

            if (obj.command === 'getUdsDidsDevSelect') {
                if (obj.callback) {
                    this.log.silly(`Received data - ${JSON.stringify(obj)}`);
                    const selUdsDevices = this.config.tableUdsDevices.map(item => ({
                        // @ts-expect-error AdapterConfig
                        label: item.devStateName,
                        // @ts-expect-error AdapterConfig
                        value: item.devStateName,
                    }));
                    await this.log.silly(`Data to send - ${JSON.stringify(selUdsDevices)}`);
                    if (selUdsDevices) {
                        await this.sendTo(obj.from, obj.command, selUdsDevices, obj.callback);
                    }
                } else {
                    await this.sendTo(obj.from, obj.command, [{ label: 'Not available', value: '' }], obj.callback);
                }
            }
        }
    }

    /**
     * @param {string} [reason]  Gateway transport's evaluateHealth() passes a
     *   specific cause here; the local socketcan channel passes nothing.
     */
    onCanExtStopped(reason) {
        if (!this.stoppingInstance) {
            // External CAN connection was terminated unexpectedly
            this.log.error(`External CAN bus was stopped.${reason ? ` Reason: ${reason}.` : ''}`);
        }
        this.cntCanConnActual--;
        this.setState('info.connection', false, true);
    }

    /**
     * @param {string} [reason]  See onCanExtStopped().
     */
    onCanIntStopped(reason) {
        if (!this.stoppingInstance) {
            // External CAN connection was terminated unexpectedly
            this.log.error(`Internal CAN bus was stopped.${reason ? ` Reason: ${reason}.` : ''}`);
        }
        this.cntCanConnActual--;
        this.setState('info.connection', false, true);
    }

    /**
     * A gateway channel's health recovered after 'onStopped' had already
     * fired for it (lib/canGatewayChannel.js). Reconnecting its UDS/Collect
     * workers safely in place is the same hard problem ioBroker.e3oncan#255
     * deliberately left to an external watchdog restarting the whole
     * instance rather than attempting in-adapter - so this does the same
     * full restart, just event-driven and without needing that separate
     * script. No rate limiting of its own: this only fires on an actual
     * recovery, never on continued failure, and js-controller has its own
     * protection against a restart loop.
     */
    onGatewayRecovered() {
        this.log.info('Gateway connection recovered - restarting the adapter to reconnect.');
        this.terminate('Gateway connection recovered', utils.EXIT_CODES.START_IMMEDIATELY_AFTER_STOP);
    }

    onCanMsgExt(msg) {
        if (
            this.e380Collect97Channel === 'ext' &&
            this.e380Collect97 &&
            this.e380Collect97.config.canID.includes(msg.id)
        ) {
            this.e380Collect97.msgCollect(this, msg);
        }
        if (
            this.e380Collect98Channel === 'ext' &&
            this.e380Collect98 &&
            this.e380Collect98.config.canID.includes(msg.id)
        ) {
            this.e380Collect98.msgCollect(this, msg);
        }
        if (
            this.e3100cbCollectChannel === 'ext' &&
            this.e3100cbCollect &&
            this.e3100cbCollect.config.canID.includes(msg.id)
        ) {
            this.e3100cbCollect.msgCollect(this, msg);
        }
        if (this.E3CollectExt[msg.id]) {
            this.E3CollectExt[msg.id].msgCollect(this, msg);
        }
        if (this.E3UdsWorkers[msg.id]) {
            this.E3UdsWorkers[msg.id].msgUds(this, msg);
        }
        if (this.E3UdsSID77Workers[msg.id]) {
            this.E3UdsSID77Workers[msg.id].msgUds(this, msg);
        }
        if (this.udsScanWorker.workers[msg.id]) {
            this.udsScanWorker.workers[msg.id].msgUds(this, msg);
        }
    }

    onCanMsgInt(msg) {
        if (
            this.e380Collect97Channel === 'int' &&
            this.e380Collect97 &&
            this.e380Collect97.config.canID.includes(msg.id)
        ) {
            this.e380Collect97.msgCollect(this, msg);
        }
        if (
            this.e380Collect98Channel === 'int' &&
            this.e380Collect98 &&
            this.e380Collect98.config.canID.includes(msg.id)
        ) {
            this.e380Collect98.msgCollect(this, msg);
        }
        if (
            this.e3100cbCollectChannel === 'int' &&
            this.e3100cbCollect &&
            this.e3100cbCollect.config.canID.includes(msg.id)
        ) {
            this.e3100cbCollect.msgCollect(this, msg);
        }
        if (this.E3CollectInt[msg.id]) {
            this.E3CollectInt[msg.id].msgCollect(this, msg);
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {object} options  Adapter options
     */
    module.exports = options => new E3oncan(options);
} else {
    // otherwise start the instance directly
    new E3oncan({});
}
