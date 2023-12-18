'use strict';

/*
 * Created with @iobroker/create-adapter v2.5.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
// const fs = require("fs");

const codecs = require('./lib/codecs');
const collect = require('./lib/canCollect');
const uds = require('./lib/canUds');
const udsCallback = require('./lib/callback');
const can = require('socketcan');

class E3oncan extends utils.Adapter {

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'e3oncan',
        });

        this.udsScanTEST = true;

        this.e380Collect      = null;    // E380 alway is assigned to external bus
        this.E3CollectInt     = {};    // Dict of collect devices on internal bus
        this.E3CollectExt     = {};    // Dict of collect devices on external bus
        this.collectTimeout   = 1500;  // Timeout (ms) for collecting data
        this.E3UdsWorkers     = {};    // Dict of uds devices on external bus
        this.udsScanWorkers   = {};    // Dict for uds scan workers
        this.udsCntNewDevs    = 0;     // New devices found during scan

        this.channelExt       = null;
        this.channelExtName   = '';
        this.channelInt       = null;
        this.channelIntName   = '';

        this.udsWorkers          = {};
        this.udsOnStateChanges   = {};     // onChange routines
        this.udsDidForScan       = 256;    // Busidentification
        this.udsMaxTrialsDevScan = 2;      // Number of trials during UDS device scan
        this.udsMaxTrialsDidScan = 4;      // Number of trials during UDS device scan
        this.udsTimeout          = 7500;   // Timeout (ms) for normal UDS communication
        this.udsTimeoutDevScan   = 1500;   // Timeout (ms) for UDS devive scan
        this.udsTimeoutDidScan   = 7500;   // Timeout (ms) for UDS dids scan
        this.udsDevices          = [];     // Confirmed & edited UDS devices
        this.udsScanDevices      = [];     // UDS devices found during scan
        this.udsScanAddrSpan     = 0x10;
        this.udsScanAddrRange    = [0x680, 0x6a0, 0x6c0, 0x6e0];
        this.cntUdsScansActive   = 0;
        this.udsDevName2CanId    = {
            'HPMUMASTER': '0x693',    // available only on internal bus (?)
            'EMCUMASTER': '0x451'
        };
        this.udsKnownDids          = {};
        this.udsScanDids           = {};
        this.udsScanDidsCntSuccess = 0;
        this.udsScanDidsCntTotal   = 0;
        this.udsScanDidsCntDone    = 0;
        this.udsScanDidsCntRetries = 0;
        this.udsScanDevReqId       = 'uds.udsDevScanRequired';
        this.udsScanDidReqId       = 'uds.udsDidScanRequired';
        this.doUdsDevScan          = false;

        //this.on('install', this.onInstall.bind(this));
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('objectChange', this.onObjectChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /*
    async onInstall() {
        await this.log.debug('onInstall()');
        await this.log.debug('this.config:');
        await this.log.debug(JSON.stringify(this.config));
    }
    */

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        await this.log.info('Startup of instance '+this.namespace+': Starting.');
        //await this.log.debug('this.config:');
        //await this.log.debug(JSON.stringify(this.config));

        // Reset the connection indicator during startup
        this.setState('info.connection', false, true);

        codecs.rawmode.setOpMode(false);

        // Check for required scan for UDS devices
        this.doUdsDevScan = Object(await this.getStateAsync(this.udsScanDevReqId)).val;
        if (this.doUdsDevScan) this.log.info('UDS device scan is required.');

        //await this.log.debug(JSON.stringify(this.getStateAsync('BACKENDGATEWAY.0x6c3.json.0256_BusIdentification')));

        // Setup external CAN bus if required
        // ==================================

        if (this.config.canExtActivated) {
            [this.channelExt, this.channelExtName] = await this.connectToCan(this.channelExt, this.config.canExtName, this.onCanMsgExt);
        }

        // Setup internal CAN bus if required
        // ==================================

        if (this.config.canIntActivated) {
            [this.channelInt, this.channelIntName] = await this.connectToCan(this.channelInt, this.config.canIntName, this.onCanMsgInt);
        }

        // Setup E380 collect worker:
        this.e380Collect = await this.setupE380CollectWorker(this.config);

        // Setup all configured devices for collect:
        await this.setupE3CollectWorkers(this.config.tableCollectCanExt, this.E3CollectExt, this.channelExt);
        await this.setupE3CollectWorkers(this.config.tableCollectCanInt, this.E3CollectInt, this.channelInt);

        // Initial setup all configured devices for UDS:
        await this.setupUdsWorkers();

        await this.subscribeStates('*.udsDidsToRead');

        await this.log.info('Startup of instance '+this.namespace+': Done.');
    }

    // Setup CAN busses

    async connectToCan(channel, name, onMsg) {
        let chName = name;
        if (!channel) {
            try {
                channel = can.createRawChannel(name, true);
                await channel.addListener('onMessage', onMsg, this);
                await channel.start();
                await this.setState('info.connection', true, true);
                await this.log.info('CAN-Adapter '+name+' successfully started.');
            } catch (e) {
                await this.log.error(`Could not connect to CAN "${name}" - ${JSON.stringify(e)}`);
                channel = null;
                chName  = '';
            }
        }
        return([channel, chName]);
    }

    async disconnectFromCan(channel, name) {
        if (channel) {
            try {
                await channel.stop();
                this.log.debug('CAN-Adapter '+name+' stopped.');
                channel = null;
            } catch (e) {
                this.log.error(`Could not disconnect from CAN "${name}" - ${JSON.stringify(e)}`);
                channel = null;
            }
        }
        return([channel,'']);
    }

    // Setup E380 collect worker:

    async setupE380CollectWorker(conf) {
        let e380Worker = null;
        if (conf.e380Active) {
            e380Worker = new collect.collect(
                {   'canID': [0x250,0x252,0x254,0x256,0x258,0x25A,0x25C],
                    'stateBase': conf.e380Name,
                    'device': 'e380',
                    'delay': conf.e380Delay,
                    'active': conf.e380Active});
            await e380Worker.initStates(this,'standby');
        }
        if (e380Worker) await e380Worker.startup(this);
        return e380Worker;
    }

    // Setup E3 collect workers:

    async setupE3CollectWorkers(conf, workers) {
        if ( (conf) && (conf.length > 0) ) {
            for (const workerConf of Object.values(conf)) {
                if (workerConf.collectActive) {
                    const devInfo = this.config.tableUdsDevices.filter(item => item.collectCanId == workerConf.collectCanId);
                    if (devInfo.length > 0) {
                        const worker = new collect.collect(
                            {   'canID'    : [Number(workerConf.collectCanId)],
                                'stateBase': devInfo[0].devStateName,
                                'device'   : 'common',
                                'timeout'  : this.collectTimeout,
                                'delay'    : workerConf.collectDelayTime
                            });
                        await worker.initStates(this, 'standby');
                        if (worker) await worker.startup(this);
                        workers[Number(workerConf.collectCanId)] = worker;
                    }
                }
            }
        }
    }

    async registerUdsOnStateChange(ctx, id, onChange) {
        const fullId = this.namespace+'.'+id;
        this.udsOnStateChanges[fullId] = { 'ctx': ctx, 'onChange': onChange };
    }

    async unRegisterUdsOnStateChange(id) {
        const fullId = 'e3oncan.0.'+id;
        if (this.udsOnStateChanges[fullId]) this.udsOnStateChanges[id] = null;
    }

    // Setup workers for collecting data and for communication via UDS

    async startupUdsWorker(workers, worker, opMode) {
        const rxAddr = Number(worker.config.canID) + Number(0x10);
        workers[rxAddr] = worker;
        await worker.startup(this, opMode);
    }

    async setupUdsWorkers() {
        if ( (this.config.tableUdsSchedules) && (this.config.tableUdsSchedules.length > 0) ) {
            for (const dev of Object.values(this.config.tableUdsSchedules)) {
                if (dev.udsScheduleActive) {
                    await this.sleep(50);     // 50 ms pause to next schedule
                    const devTxAddr = Number(dev.udsSelectDevAddr);
                    const devRxAddr = devTxAddr + 16;
                    if (!(this.E3UdsWorkers[devRxAddr])) {
                        // Create new worker
                        const devInfo = this.config.tableUdsDevices.filter(item => item.devAddr == dev.udsSelectDevAddr);
                        if (devInfo.length > 0) {
                            const dev_name = devInfo[0].devStateName;
                            await this.log.silly('New UDS device on '+String(dev.udsSelectDevAddr)+' with name '+String(dev_name));
                            this.E3UdsWorkers[devRxAddr] = new uds.uds(
                                {   'canID'    : devTxAddr,
                                    'stateBase': dev_name,
                                    'device'   : 'common',
                                    'delay'    : 0,
                                    'active'   : dev.udsScheduleActive,
                                    'channel'  : this.channelExt,
                                    'timeout'  : this.udsTimeout
                                });
                            await this.E3UdsWorkers[devRxAddr].initStates(this,'standby');
                            await this.E3UdsWorkers[devRxAddr].addSchedule(this, dev.udsSchedule, dev.udsScheduleDids);
                            await this.log.silly('New Schedule ('+String(dev.udsSchedule)+'s) UDS device on '+String(dev.udsSelectDevAddr));
                        } else {
                            await this.log.error('Could not setup UDS device on address '+String(dev.udsSelectDevAddr)+' due to missing device name.');
                            break;
                        }
                    } else {
                        await this.E3UdsWorkers[devRxAddr].addSchedule(this, dev.udsSchedule, dev.udsScheduleDids);
                        await this.log.silly('New Schedule ('+String(dev.udsSchedule)+'s) UDS device on '+String(dev.udsSelectDevAddr));
                    }
                }
            }
            for (const worker of Object.values(this.E3UdsWorkers)) await worker.startup(this, 'normal');
        }
    }

    async startupScanUdsDevice(udsScanWorkers, addr) {
        const udsWorker = new uds.uds(
            {   'canID'    : Number(addr),
                'stateBase': 'udsScanAddr',
                'device'   : 'common',
                'delay'    : 0,
                'active'   : true,
                'channel'  : this.channelExt,
                'timeout'  : this.udsTimeoutDevScan
            });
        await udsWorker.initStates(this, 'udsDevScan');
        const callback = new udsCallback.udsCallback();
        await udsWorker.setCallback(callback.scanDevCallback);
        await this.startupUdsWorker(udsScanWorkers, udsWorker, 'udsDevScan');
        await udsWorker.pushCmnd(this, 'read', [this.udsDidForScan]);
        this.cntUdsScansActive += 1;
    }

    async scanUdsDevices() {
        function range(size, startAt = 0) {
            return [...Array(size).keys()].map(i => i + startAt);
        }

        await this.log.info('UDS scan for devices - start');
        this.udsScanWorkers = {};
        this.udsCntNewDevs = 0;
        this.udsDevices = this.config.tableUdsDevices;

        // Stop all running workers to avoid communication conflicts:
        for (const worker of Object.values(this.E3UdsWorkers)) {
            await worker.stop(this);
        }

        const canExtActivated = this.config.canExtActivated;
        const canExtName = this.config.canExtName;

        // Startup CAN:
        if (canExtActivated) {
            if  ((this.channelExt) &&
            (this.channelExtName != canExtName) ) {
            // CAN is different from running CAN. Stop actual CAN first.
                [this.channelExt, this.channelExtName] = await this.disconnectFromCan(this.channelExt, this.channelExtName);
            }
            [this.channelExt, this.channelExtName] = await this.connectToCan(this.channelExt, canExtName, this.onCanMsgExt);
            if (!this.channelExt) {
                await this.log.error('UDS scan devices: Could not connect to CAN Adapter '+canExtName+'. Aborting.');
                return(false);
            }
        } else {
            await this.log.error('UDS scan: External CAN not activated! Aborting.');
            return(false);
        }

        this.udsScanDidsCntRetries = 0;
        this.cntUdsScansActive = 0;
        for (const baseAddr of Object(this.udsScanAddrRange).values()) {
            for (const addr of Object(range(Number(this.udsScanAddrSpan), Number(baseAddr))).values()) {
                await this.startupScanUdsDevice(this.udsScanWorkers, addr);
                await this.sleep(50);
            }
        }
        // eslint-disable-next-line no-case-declarations
        const tsAbort = new Date().getTime() + this.udsMaxTrialsDevScan*this.udsTimeoutDevScan+250;
        await this.log.info('UDS scan: Waiting for scans to complete.');
        while ( (this.cntUdsScansActive > 0) && (new Date().getTime() < tsAbort) ) {
            await this.sleep(100);
        }

        // Stop all scan workers:
        for (const worker of Object.values(this.udsScanWorkers)) {
            await worker.stop(this);
        }

        // Restart all previously running workers:
        for (const worker of Object.values(this.E3UdsWorkers)) {
            await worker.startup(this,'normal');
        }

        if (this.cntUdsScansActive < 0) await this.log.warn('UDS scan finished. Number of retries / active UDS scans (should be 0): '+String(this.udsScanDidsCntRetries)+' / '+String(this.cntUdsScansActive));
        await this.log.info('UDS scan found '+
            String(this.udsCntNewDevs)+
            ' new of total '+
            String(this.udsDevices.length)+
            ' devices: '+
            JSON.stringify(this.udsDevices)
        );

        await this.log.info('UDS scan for devices - done');

        return(true);
    }

    async startupScanUdsDids(udsScanWorkers, addr, dids) {
        const hexAddr = '0x'+Number(addr).toString(16);
        const devInfo = this.config.tableUdsDevices.filter(item => item.devAddr == hexAddr);
        let devName = '';
        if (devInfo.length > 0) {
            devName = devInfo[0].devStateName;
        } else {
            devName = String(addr);
        }
        const udsWorker = new uds.uds(
            {   'canID'    : Number(addr),
                'stateBase': devName,
                'device'   : 'common',
                'delay'    : 0,
                'active'   : true,
                'channel'  : this.channelExt,
                'timeout'  : this.udsTimeoutDidScan
            });
        const callback = new udsCallback.udsCallback();
        await udsWorker.setCallback(callback.scanDidsCallback);
        this.udsScanDids[udsWorker.canIDhex] = dids.length;
        this.udsScanDidsCntTotal += dids.length;
        this.udsKnownDids[udsWorker.canIDhex] = {};
        await this.startupUdsWorker(udsScanWorkers, udsWorker, 'udsDidScan');
        this.cntUdsScansActive += 1;
        await udsWorker.pushCmnd(this, 'read', dids);
    }

    async scanUdsDids(udsAddrs, udsMaxCntDids) {
        function range(size, startAt = 0) {
            return [...Array(size).keys()].map(i => i + startAt);
        }

        await this.log.info('UDS did scan - start');
        this.udsScanWorkers = {};
        this.udsScanDids   = {};

        // Stop all running workers to avoid communication conflicts:
        for (const worker of Object.values(this.E3UdsWorkers)) {
            await worker.stop(this);
        }

        this.cntUdsScansActive     = 0;
        this.udsScanDidsCntTotal   = 0;
        this.udsScanDidsCntRetries = 0;
        this.udsScanDidsCntSuccess = 0;
        this.udsScanDidsCntDone    = 0;
        const dids = range(udsMaxCntDids, 256);
        for (const addr of Object(udsAddrs).values()) {
            await this.startupScanUdsDids(this.udsScanWorkers, addr, dids);
            await this.sleep(50);
        }
        let cntDoneLast = -1;
        const tsAbort = new Date().getTime() + this.udsScanDidsCntTotal*500;
        while ( (this.cntUdsScansActive > 0) && (new Date().getTime() < tsAbort) ) {
            await this.sleep(990);
            if ((new Date().getSeconds() % 10) == 0) {
                await this.log.info('UDS dids scan status (retries/found/done/total): ('+
                    String(this.udsScanDidsCntRetries)+'/'+
                    String(this.udsScanDidsCntSuccess)+'/'+
                    String(this.udsScanDidsCntDone)+'/'+
                    String(this.udsScanDidsCntTotal)+
                    '), remaining: '+
                    JSON.stringify(this.udsScanDids)
                );
                if (cntDoneLast == this.udsScanDidsCntDone) {
                    // No progress in last 10 seconds
                    await this.log.warn('UDS dids scan stalled. Aborting');
                    break;
                }
                cntDoneLast = this.udsScanDidsCntDone;
            }
        }

        // Store dids found and stop all scan workers:
        for (const worker of Object.values(this.udsScanWorkers)) {
            await worker.storage.storeKnownDids(this, this.udsKnownDids[worker.canIDhex]);
            await worker.stop(this);
        }
        this.udsScanWorkers = {};

        if (this.cntUdsScansActive < 0) await this.log.warn('UDS did scan finished. Number of active UDS scans (should be 0): '+String(this.cntUdsScansActive));
        await this.log.info('UDS did scan found '+String(this.udsScanDidsCntSuccess)+' dids. See state "dids" @device objects for details.');

        // Restart all previously running workers:
        for (const worker of Object.values(this.E3UdsWorkers)) {
            await worker.startup(this,'normal');
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            // Stop UDS workers:
            for (const worker of Object.values(this.E3UdsWorkers)) worker.stop(this);
            for (const worker of Object.values(this.udsScanWorkers)) worker.stop(this);

            // Stop Collect workers:
            if (this.e380Collect) this.e380Collect.stop(this);
            for (const worker of Object.values(this.E3CollectExt)) worker.stop(this);
            for (const worker of Object.values(this.E3CollectInt)) worker.stop(this);

            // Stop CAN communication:
            this.disconnectFromCan(this.channelExt,this.config.canExtName);
            this.disconnectFromCan(this.channelInt,this.config.canIntName);

            callback();
        } catch (e) {
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
    onObjectChange(id, obj) {
        /*
        if (obj) {
            // The object was changed
            this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
        } else {
            // The object was deleted
            this.log.info(`object ${id} deleted`);
        }
        */
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (state) {
            // The state was changed
            //this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
            const worker = this.udsOnStateChanges[id];
            if (worker) {
                worker.onChange(this, worker.ctx, state);
            }
        } else {
            // The state was deleted
            //this.log.info(`state ${id} deleted`);
        }
    }

    sleep(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
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
                    if (!this.udsDevScanIsRunning) {
                        if (this.doUdsDevScan) {
                            let success = false;
                            this.udsDevScanIsRunning = true;
                            await this.log.silly(`Received data - ${JSON.stringify(obj)}`);
                            //this.udsScanDevices = obj.message.udsDevices;
                            success = await this.scanUdsDevices();
                            await this.sendTo(obj.from, obj.command, this.udsDevices, obj.callback);
                            if (success) {
                                await this.setStateAsync(this.udsScanDevReqId, {val: false, ack: true});
                            }
                            this.udsDevScanIsRunning = false;
                        } else {
                            // Scan not required. Do nothing
                            this.sendTo(obj.from, obj.command, obj.message, obj.callback);
                        }
                    } else {
                        await this.log.debug('Request "getUdsDevice" during running UDS scan!');
                        this.sendTo(obj.from, obj.command, obj.message, obj.callback);
                    }
                } else {
                    this.sendTo(obj.from, obj.command, [], obj.callback);
                }
            }

            if (obj.command === 'getUdsDeviceSelect') {
                if (obj.callback) {
                    this.log.silly(`Received data - ${JSON.stringify(obj)}`);
                    if (Array.isArray(obj.message) ) {
                        const selUdsDevices = obj.message.map(item => ({label: item.devStateName, value: item.devAddr}));
                        this.log.silly(`Data to send - ${JSON.stringify(selUdsDevices)}`);
                        if (selUdsDevices) {
                            this.sendTo(obj.from, obj.command, selUdsDevices, obj.callback);
                        }
                    } else {
                        this.sendTo(obj.from, obj.command, [{label: 'Not available', value: ''}], obj.callback);
                    }
                } else {
                    this.sendTo(obj.from, obj.command, [{label: 'Not available', value: ''}], obj.callback);
                }
            }

            if (obj.command === 'getExtColDeviceSelect') {
                if (obj.callback) {
                    this.log.silly(`Received data - ${JSON.stringify(obj)}`);
                    if (Array.isArray(obj.message) ) {
                        const selUdsDevices = obj.message.filter(item => item.collectCanId != '').map(item => ({label: item.devStateName, value: item.collectCanId}));
                        this.log.silly(`Data to send - ${JSON.stringify(selUdsDevices)}`);
                        if (selUdsDevices) {
                            this.sendTo(obj.from, obj.command, selUdsDevices, obj.callback);
                        }
                    } else {
                        this.sendTo(obj.from, obj.command, [{label: 'Not available', value: ''}], obj.callback);
                    }
                } else {
                    this.sendTo(obj.from, obj.command, [{label: 'Not available', value: ''}], obj.callback);
                }
            }

            if (obj.command === 'getIntColDeviceSelect') {
                if (obj.callback) {
                    this.log.silly(`Received data - ${JSON.stringify(obj)}`);
                    if (Array.isArray(obj.message) ) {
                        const selUdsDevices = obj.message.filter(item => item.collectCanId != '').map(item => ({label: item.devStateName, value: item.collectCanId}));
                        this.log.silly(`Data to send - ${JSON.stringify(selUdsDevices)}`);
                        if (selUdsDevices) {
                            this.sendTo(obj.from, obj.command, selUdsDevices, obj.callback);
                        }
                    } else {
                        this.sendTo(obj.from, obj.command, [{label: 'Not available', value: ''}], obj.callback);
                    }
                } else {
                    this.sendTo(obj.from, obj.command, [{label: 'Not available', value: ''}], obj.callback);
                }
            }

        }
    }

    onCanMsgExt(msg) {
        if ( (this.e380Collect) && (this.e380Collect.config.canID.includes(msg.id)) ) { this.e380Collect.msgCollect(this, msg); }
        if (this.E3CollectExt[msg.id]) this.E3CollectExt[msg.id].msgCollect(this, msg);
        if (this.E3UdsWorkers[msg.id]) this.E3UdsWorkers[msg.id].msgUds(this, msg);
        if (this.udsScanWorkers[msg.id]) this.udsScanWorkers[msg.id].msgUds(this, msg);
    }

    onCanMsgInt(msg) {
        if (this.E3CollectInt[msg.id]) this.E3CollectInt[msg.id].msgCollect(this, msg);
    }
}


if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new E3oncan(options);
} else {
    // otherwise start the instance directly
    new E3oncan();
}
