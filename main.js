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
const can = require('socketcan');
const storage = require('./lib/storage');
const E3DidsDict = require('./lib/didsE3.json');
const collect = require('./lib/canCollect');
const uds = require('./lib/canUds');
const udsScan = require('./lib/udsScan');

class E3oncan extends utils.Adapter {

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'e3oncan',
        });

        this.stoppingInstance    = false; // true during unLoad()
        this.e380Collect         = null;  // E380 always is assigned to external bus
        this.E3CollectInt        = {};    // Dict of collect devices on internal bus
        this.E3CollectExt        = {};    // Dict of collect devices on external bus
        this.collectTimeout      = 2000;  // Timeout (ms) for collecting data
        this.E3UdsWorkers        = {};    // Dict of uds devices on external bus
        this.cntWorkersActive    = 0;     // Total number of active workers (collect + UDS)

        this.channelExt          = null;
        this.channelExtName      = '';
        this.channelInt          = null;
        this.channelIntName      = '';
        this.cntCanConnDesired   = 0;     // Number of activated CAN connections in config
        this.cntCanConnActual    = 0;     // Number if actualy connected CAN buses

        this.udsWorkers          = {};
        this.udsTimeout          = 7500;   // Timeout (ms) for normal UDS communication
        this.udsDevices          = [];     // Confirmed & edited UDS devices

        this.udsDidForScan       = 256;    // Busidentification is in this id
        this.udsScanWorker       = new udsScan.udsScan();
        this.udsScanDevices      = [];     // UDS devices found during scan
        this.udsDevAddrs         = [];
        this.udsDevStateNames    = [];
        this.udsDidsMaxNmbr      = 3000;    // Max. number of dids per device for scan

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

        await this.log.info('Startup of instance '+this.namespace+': Starting.');
        //await this.log.debug('this.config:');
        //await this.log.debug(JSON.stringify(this.config));

        // Reset the connection indicator during startup
        this.setState('info.connection', false, true);

        // Collect known devices adresses:
        for (const dev of Object.values(this.config.tableUdsDevices)) {
            // @ts-ignore
            this.udsDevAddrs.push(dev.devAddr);
            // @ts-ignore
            this.udsDevStateNames.push(dev.devStateName);
        }

        // Check for updates of list of datapoints and perform update if needed:
        await this.updateDatapoints(this.config.tableUdsDevices);

        // Setup external CAN bus if required
        // ==================================

        // @ts-ignore
        if (this.config.canExtActivated) {
            this.cntCanConnDesired++;
            // @ts-ignore
            [this.channelExt, this.channelExtName] = await this.connectToCan(this.channelExt, this.config.canExtName, this.onCanMsgExt, this.onCanExtStopped);
        }

        // Setup internal CAN bus if required
        // ==================================

        // @ts-ignore
        if (this.config.canIntActivated) {
            this.cntCanConnDesired++;
            // @ts-ignore
            [this.channelInt, this.channelIntName] = await this.connectToCan(this.channelInt, this.config.canIntName, this.onCanMsgInt, this.onCanIntStopped);
        }

        if (this.cntCanConnActual == this.cntCanConnDesired) {
            // All configured CAN connections are established
            await this.setState('info.connection', true, true);
        }

        // Setup E380 collect worker:
        if (this.channelExt) this.e380Collect = await this.setupE380CollectWorker(this.config);

        // Setup all configured devices for collect:
        // @ts-ignore
        if (this.channelExt) await this.setupE3CollectWorkers(this.config.tableCollectCanExt, this.E3CollectExt, this.channelExt);
        // @ts-ignore
        if (this.channelInt) await this.setupE3CollectWorkers(this.config.tableCollectCanInt, this.E3CollectInt, this.channelInt);

        // Initial setup all configured devices for UDS:
        if (this.channelExt) await this.setupUdsWorkers();

        await this.log.debug('Total number of active workers: '+String(this.cntWorkersActive));

        await this.log.info('Startup of instance '+this.namespace+': Done.');
    }

    // Check for updates:

    async updateDatapoints(udsDevs) {
        // Update list of datapoints of all devices during startup of adapter
        for (const dev of Object.values(udsDevs)) {
            const devDids = new storage.storageDids({stateBase:dev.devStateName, device:dev.devStateName});
            await devDids.initStates(this, 'standby');
            await devDids.readKnownDids(this,'standby');
            if (devDids.didsDevSpecAvail) {
                if ( (devDids.didsDictDevCom.Version === undefined) ||
                    (Number(E3DidsDict.Version) > Number(devDids.didsDictDevCom.Version)) ) {
                    this.log.info('Updating datapoints to version '+E3DidsDict.Version+' for device '+dev.devStateName);
                    for (const did of Object.keys(devDids.didsDictDevCom)) {
                        if ( (did != 'Version') &&  (did in E3DidsDict) ) {
                            // Check for changes in datapoint structure
                            const devStruct = await devDids.getDidStruct(this,[],devDids.didsDictDevCom[did]);
                            const E3Struct  = await devDids.getDidStruct(this,[],E3DidsDict[did]);
                            if (JSON.stringify(devStruct) != JSON.stringify(E3Struct)) {
                                // Structure of datapoint has changed
                                // Replace .json and .tree state(s) based on raw data of did
                                const didStateName = await devDids.getDidStr(did)+'_'+await devDids.didsDictDevCom[did].id;
                                this.log.info('  > Structure of datapoint '+didStateName+' has changed. Updating.');
                                // Delete tree states based on old structure:
                                await this.delObjectAsync(this.namespace+'.'+dev.devStateName+'.tree.'+didStateName, { recursive: true });
                                const raw = await devDids.getObjectVal(this, dev.devStateName+'.raw.'+didStateName);
                                if (raw != null) {
                                    // Create states based on new structure if raw data is available:
                                    const cdi = await E3DidsDict[did];
                                    const obj = await devDids.decodeDid(this, dev.devStateName, did, cdi, devDids.toByteArray(raw));
                                    await devDids.storeObjectJson(this, did, obj.idStr, this.namespace+'.'+dev.devStateName+'.json.'+didStateName, obj.obj);
                                    await devDids.storeObjectTree(this, did, obj.idStr, this.namespace+'.'+dev.devStateName+'.tree.'+didStateName, obj.obj);
                                }
                            } else {
                                // No change of structure of datapoint
                                // Make sure, data type and role of tree objects are correct
                                // Force update of .tree state(s) based on raw data of did
                                const didStateName = await devDids.getDidStr(did)+'_'+await devDids.didsDictDevCom[did].id;
                                const raw = await devDids.getObjectVal(this, dev.devStateName+'.raw.'+didStateName);
                                if (raw != null) {
                                    // Update .tree states:
                                    this.log.silly('  > Update type and role of datapoint '+didStateName);
                                    const cdi = await E3DidsDict[did];
                                    const obj = await devDids.decodeDid(this, dev.devStateName, did, cdi, devDids.toByteArray(raw));
                                    await devDids.storeObjectTree(this, did, obj.idStr, this.namespace+'.'+dev.devStateName+'.tree.'+didStateName, obj.obj, true);
                                }
                            }
                            devDids.didsDictDevCom[did] = await E3DidsDict[did];
                        }
                    }
                    devDids.didsDictDevCom['Version'] = E3DidsDict.Version;
                }
            }
            await devDids.storeKnownDids(this);
        }
    }

    // Setup CAN busses

    async connectToCan(channel, name, onMsg, onStop) {
        let chName = name;
        if (!channel) {
            try {
                channel = can.createRawChannel(name, true);
                await channel.addListener('onMessage', onMsg, this);
                await channel.addListener('onStopped', onStop, this);
                await channel.start();
                this.cntCanConnActual++;
                await this.log.info('CAN-Adapter connected: '+name);
            } catch (e) {
                await this.log.error(`Could not connect to CAN-Adapter "${name}" - err=${e.message}`);
                channel = null;
                chName  = '';
            }
        }
        return([channel, chName]);
    }

    disconnectFromCan(channel, name) {
        if (channel) {
            try {
                channel.stop();
                this.log.info('CAN-Adapter disconnected: '+name);
                channel = null;
            } catch (e) {
                this.log.error(`Could not disconnect from CAN "${name}" - err=${e.message}`);
                channel = null;
            }
        }
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
                    // @ts-ignore
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

    // Setup workers for collecting data and for communication via UDS

    async setupUdsWorkers() {
        // @ts-ignore
        if ( (this.config.tableUdsSchedules) && (this.config.tableUdsSchedules.length > 0) ) {
            // @ts-ignore
            for (const dev of Object.values(this.config.tableUdsSchedules)) {
                if (dev.udsScheduleActive) {
                    await this.sleep(50);     // 50 ms pause to next schedule
                    const devTxAddr = Number(dev.udsSelectDevAddr);
                    const devRxAddr = devTxAddr + 16;
                    if (!(this.E3UdsWorkers[devRxAddr])) {
                        // Create new worker
                        // @ts-ignore
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
            for (const worker of Object.values(this.E3UdsWorkers)) {
                await worker.startup(this, 'normal');
                await this.subscribeStates(this.namespace+'.'+worker.config.stateBase+'.*',this.onStateChange);
            }
        }
    }


    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    async onUnload(callback) {
        try {
            const tStart = new Date().getTime();
            this.stoppingInstance = true;
            // Stop UDS workers:
            for (const worker of Object.values(this.E3UdsWorkers)) await worker.stop(this);
            for (const worker of Object.values(this.udsScanWorker.workers)) await worker.stop(this);

            // Stop Collect workers:
            if (this.e380Collect) await this.e380Collect.stop(this);
            for (const worker of Object.values(this.E3CollectExt)) await worker.stop(this);
            for (const worker of Object.values(this.E3CollectInt)) await worker.stop(this);

            if (this.cntWorkersActive > 0) {
                // Timeout - there are still unstopped workers
                this.log.warn('Not all workers could be stopped during onOnload(). Number of still active workers: '+String(this.cntWorkersActive));
            }

            // Stop CAN communication:
            // @ts-ignore
            this.disconnectFromCan(this.channelExt,this.config.canExtName);
            // @ts-ignore
            this.disconnectFromCan(this.channelInt,this.config.canIntName);
            this.setState('info.connection', false, true);

            this.log.debug('onUnload() took '+String(new Date().getTime()-tStart)+' ms to complete.');

            callback();
        } catch (e) {
            this.log.error('unLoad() could not be completed. err='+e.message);
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
    // @ts-ignore
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
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if ( (state) && (!state.ack) ) {
            // The state was changed and ack == false
            this.log.silly(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
            for (const worker of Object.values(this.E3UdsWorkers)) {
                if (id.includes(this.namespace+'.'+worker.config.stateBase)) {
                    this.log.silly(`Call worker for ${worker.config.stateBase}`);
                    worker.onUdsStateChange(this, worker, id, state);
                }
            }
        }
    }

    sleep(milliseconds) {
        return new Promise(resolve => this.setTimeout(resolve, milliseconds));
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
                        this.udsDevScanIsRunning = true;
                        await this.log.silly(`Received data - ${JSON.stringify(obj)}`);
                        await this.udsScanWorker.scanUdsDevices(this);
                        await this.log.silly(`Data to send - ${JSON.stringify({native: {tableUdsDevices: this.udsDevices}})}`);
                        await this.sendTo(obj.from, obj.command, {native: {tableUdsDevices: this.udsDevices}}, obj.callback);
                        this.udsDevScanIsRunning = false;
                    } else {
                        await this.log.debug('Request "getUdsDevice" during running UDS scan!');
                        this.sendTo(obj.from, obj.command, {native: {tableUdsDevices: this.udsDevices}}, obj.callback);
                    }
                } else {
                    this.sendTo(obj.from, obj.command, {native: {tableUdsDevices: []}}, obj.callback);
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

            if (obj.command === 'startDidScan') {
                if (obj.callback) {
                    if (!this.udsDidScanIsRunning) {
                        this.udsDidScanIsRunning = true;
                        this.log.silly(`Received data - ${JSON.stringify(obj)}`);
                        await this.udsScanWorker.scanUdsDids(this,this.udsDevAddrs,this.udsDidsMaxNmbr);
                        //await this.udsScanWorker.scanUdsDids(this,this.udsDevAddrs,300);
                        this.sendTo(obj.from, obj.command, this.udsDevices, obj.callback);
                        this.udsDidScanIsRunning = false;
                    } else {
                        this.log.silly('Request "startDidScan" during running UDS did scan!');
                        this.sendTo(obj.from, obj.command, obj.message, obj.callback);
                    }
                } else {
                    this.sendTo(obj.from, obj.command, obj.message, obj.callback);
                }
            }

            if (obj.command === 'getUdsDids') {
                if (obj.callback) {
                    this.log.silly(`Received data - ${JSON.stringify(obj)}`);
                    if ( (obj.message) && (this.udsDevStateNames.includes(obj.message)) ) {
                        const udsDids = new storage.storageDids({stateBase:obj.message, device:obj.message});
                        await udsDids.readKnownDids(this);
                        const udsDidsTable = [];
                        if (udsDids.didsDevSpecAvail) {
                            for (const [did, item] of Object.entries(udsDids.didsDictDevCom)) {
                                udsDidsTable.push({didId:Number(did), didLen:Number(item.len), didName:item.id, didCodec:item.codec});
                                //if (udsDidsTable.length >= 50) break;
                            }
                            for (const [did, item] of Object.entries(udsDids.didsDictDevSpec)) {
                                udsDidsTable.push({didId:Number(did), didLen:Number(item.len), didName:item.id, didCodec:item.codec});
                                //if (udsDidsTable.length >= 60) break;
                            }
                            udsDidsTable.sort((a,b) => a.didId-b.didId);
                        }
                        this.sendTo(obj.from, obj.command, {native: {tableUdsDids: udsDidsTable}}, obj.callback);
                    } else {
                        this.sendTo(obj.from, obj.command, {native: {tableUdsDids: []}}, obj.callback);
                    }
                } else {
                    this.sendTo(obj.from, obj.command, {native: {tableUdsDids: []}}, obj.callback);
                }
            }

            if (obj.command === 'getUdsDidsDevSelect') {
                if (obj.callback) {
                    this.log.silly(`Received data - ${JSON.stringify(obj)}`);
                    // @ts-ignore
                    const selUdsDevices = this.config.tableUdsDevices.map(item => ({ label: item.devStateName, value: item.devStateName }));
                    await this.log.silly(`Data to send - ${JSON.stringify(selUdsDevices)}`);
                    if (selUdsDevices) {
                        await this.sendTo(obj.from, obj.command, selUdsDevices, obj.callback);
                    }
                } else {
                    await this.sendTo(obj.from, obj.command, [{label: 'Not available', value: ''}], obj.callback);
                }
            }


        }
    }

    onCanExtStopped() {
        if (!this.stoppingInstance) {
            // External CAN connection was terminated unexpectedly
            this.log.error('External CAN bus was stopped.');
        }
        this.cntCanConnActual--;
        this.setState('info.connection', false, true);
    }

    onCanIntStopped() {
        if (!this.stoppingInstance) {
            // External CAN connection was terminated unexpectedly
            this.log.error('Internal CAN bus was stopped.');
        }
        this.cntCanConnActual--;
        this.setState('info.connection', false, true);
    }

    onCanMsgExt(msg) {
        if ( (this.e380Collect) && (this.e380Collect.config.canID.includes(msg.id)) ) { this.e380Collect.msgCollect(this, msg); }
        if (this.E3CollectExt[msg.id]) this.E3CollectExt[msg.id].msgCollect(this, msg);
        if (this.E3UdsWorkers[msg.id]) this.E3UdsWorkers[msg.id].msgUds(this, msg);
        if (this.udsScanWorker.workers[msg.id]) this.udsScanWorker.workers[msg.id].msgUds(this, msg);
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
