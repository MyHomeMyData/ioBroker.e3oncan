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

        this.e380Collect = null;    // E380 alway is assigned to external bus
        this.E3CollectInt  = {};    // Dict of collect devices on internal bus
        this.E3CollectExt  = {};    // Dict of collect devices on external bus
        this.E3UdsAgents   = {};    // Dict of uds devices on external bus
        this.udsScanAgents = {};    // Dict for uds scan agents
        this.udsCntNewDevs    = 0;     // New devices found during scan

        this.channelExt       = null;
        this.channelExtName   = '';
        this.channelInt       = null;
        this.channelIntName   = '';

        this.udsAgents        = {};
        this.udsOnStateChanges = {};    // onChange routines
        this.udsDidForScan    = 256;    // Busidentification
        this.udsMaxTrialsDevScan = 2;      // Number of trials during UDS device scan
        this.udsMaxTrialsDidScan = 4;      // Number of trials during UDS device scan
        this.udsTimeout       = 5000;   // Timeout (ms) for normal UDS communication
        this.udsTimeoutDevScan= 1500;   // Timeout (ms) for UDS devive scan
        this.udsTimeoutDidScan= 7500;   // Timeout (ms) for UDS dids scan
        this.udsDevices       = [];     // Confirmed & edited UDS devices
        this.udsScanDevices   = [];     // UDS devices found during scan
        this.udsScanAddrSpan  = 0x10;
        this.udsScanAddrRange = [0x680, 0x6a0, 0x6c0, 0x6e0];
        this.cntUdsScansActive= 0;
        this.udsDevName2CanId = {
            'HPMUMASTER': '0x693',    // available only on internal bus (?)
            'EMCUMASTER': '0x451'
        };
        this.udsKnownDids         = {};
        this.udsScanDids          = {};
        this.udsScanDidsCntSuccess = 0;
        this.udsScanDidsCntTotal   = 0;
        this.udsScanDidsCntDone    = 0;
        this.udsScanDidsCntRetries = 0;
        this.udsScanDevReqId       = 'uds.udsDevScanRequired';
        this.udsScanDidReqId       = 'uds.udsDidScanRequired';
        this.doUdsDevScan          = false;

        this.on('install', this.onInstall.bind(this));
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('objectChange', this.onObjectChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onInstall() {
        await this.log.debug('onInstall()');
        await this.log.debug('this.config:');
        await this.log.debug(JSON.stringify(this.config));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        //await this.log.debug('onReady(): Starting.');
        await this.log.debug('this.config:');
        await this.log.debug(JSON.stringify(this.config));

        /*
        this.updateInterval = setInterval(async () => {
            await this.updateDevices();
        }, this.config.interval * 1 * 1000);
        */

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

        // Setup E380 collect agent:
        this.e380Collect = await this.setupE380CollectAgent(this.config);

        // Setup all configured devices for collect:
        await this.setupE3CollectAgents(this.config.tableCollectCanExt, this.E3CollectExt, this.channelExt);
        await this.setupE3CollectAgents(this.config.tableCollectCanInt, this.E3CollectInt, this.channelInt);

        // Initial setup all configured devices for UDS:
        await this.setupUdsAgents();

        // The adapters config (in the instance object everything under the attribute "native") is accessible via
        // this.config:
        //this.log.info('config option1: ' + this.config.option1);
        //this.log.info('config option2: ' + this.config.option2);

        /*
        For every state in the system there has to be also an object of type state
        Here a simple template for a boolean variable named "testVariable"
        Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
        */

        //this.subscribeObjects('*');

        /*
        await this.sleep(2*2000);
        if (udsAgent1.storage.udsScanResult) {
            this.log.debug(String(udsAgent1.canIDhex)+': '+udsAgent1.storage.udsScanResult.res.DeviceProperty.Text);
        }
        if (udsAgent2.storage.udsScanResult) {
            this.log.debug(String(udsAgent2.canIDhex)+': '+udsAgent2.storage.udsScanResult.res.DeviceProperty.Text);
        }
        */

        // In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
        // this.subscribeStates('testVariable');
        // You can also add a subscription for multiple states. The following line watches all states starting with "lights."
        // this.subscribeStates('lights.*');
        // Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:

        await this.subscribeStates('*.udsDidsToRead');

        await this.log.debug('onReady(): Done.');


        /*
            setState examples
            you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
        */
        // the variable testVariable is set to true as command (ack=false)
        // await this.setStateAsync('testVariable', true);

        // same thing, but the value is flagged "ack"
        // ack should be always set to true if the value is received from or acknowledged from the target system
        // await this.setStateAsync('testVariable', { val: true, ack: true });

        // same thing, but the state is deleted after 30s (getState will return null afterwards)
        // await this.setStateAsync('testVariable', { val: true, ack: true, expire: 30 });

        // examples for the checkPassword/checkGroup functions
        //let result = await this.checkPasswordAsync('admin', 'iobroker');
        //this.log.info('check user admin pw iobroker: ' + result);

        //result = await this.checkGroupAsync('admin', 'admin');
        //this.log.info('check group user admin group admin: ' + result);
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
                await this.log.debug('CAN-Adapter '+name+' successfully started.');
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

    // Setup E380 collect agent:

    async setupE380CollectAgent(conf) {
        let e380Agent = null;
        if (conf.e380Active) {
            e380Agent = new collect.collect(
                {   'canID': [0x250,0x252,0x254,0x256,0x258,0x25A,0x25C],
                    'stateBase': conf.e380Name,
                    'device': conf.e380Name,
                    'delay': conf.e380Delay,
                    'active': conf.e380Active});
            await e380Agent.initStates(this);
        }
        return e380Agent;
    }

    // Setup E3 collect agents:

    async setupE3CollectAgents(conf, agents, channel) {
        if ( (conf) && (conf.length > 0) ) {
            for (const agent of Object.values(conf)) {
                if (agent.collectActive) {
                    const devInfo = this.config.tableUdsDevices.filter(item => item.collectCanId == agent.collectCanId);
                    if (devInfo.length > 0) {
                        const Collect = new collect.collect(
                            {   'canID'    : [Number(agent.collectCanId)],
                                'stateBase': devInfo[0].devStateName,
                                'device'   : 'common',
                                'delay'    : agent.collectDelayTime,
                                'active'   : agent.collectActive,
                                'channel'  : channel
                            });
                        agents[Number(agent.collectCanId)] = Collect;
                        await Collect.initStates(this);
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

    // Setup agents for collecting data and for communication via UDS

    async startupUdsAgent(agents, agent, opMode) {
        const rxAddr = Number(agent.config.canID) + Number(0x10);
        agents[rxAddr] = agent;
        await agent.startup(this, opMode);
    }

    async setupUdsAgents() {
        if ( (this.config.tableUdsSchedules) && (this.config.tableUdsSchedules.length > 0) ) {
            for (const dev of Object.values(this.config.tableUdsSchedules)) {
                if (dev.udsScheduleActive) {
                    await this.sleep(50);     // 50 ms pause to next schedule
                    const devTxAddr = Number(dev.udsSelectDevAddr);
                    const devRxAddr = devTxAddr + 16;
                    if (!(this.E3UdsAgents[devRxAddr])) {
                        // Create new agent
                        const devInfo = this.config.tableUdsDevices.filter(item => item.devAddr == dev.udsSelectDevAddr);
                        if (devInfo.length > 0) {
                            const dev_name = devInfo[0].devStateName;
                            await this.log.silly('New UDS device on '+String(dev.udsSelectDevAddr)+' with name '+String(dev_name));
                            this.E3UdsAgents[devRxAddr] = new uds.uds(
                                {   'canID'    : devTxAddr,
                                    'stateBase': dev_name,
                                    'device'   : 'common',
                                    'delay'    : 0,
                                    'active'   : dev.udsScheduleActive,
                                    'channel'  : this.channelExt,
                                    'timeout'  : this.udsTimeout
                                });
                            await this.E3UdsAgents[devRxAddr].initStates(this);
                            await this.E3UdsAgents[devRxAddr].addSchedule(this, dev.udsSchedule, dev.udsScheduleDids);
                            await this.log.silly('New Schedule ('+String(dev.udsSchedule)+'s) UDS device on '+String(dev.udsSelectDevAddr));
                        } else {
                            await this.log.error('Could not setup UDS device on address '+String(dev.udsSelectDevAddr)+' due to missing device name.');
                            break;
                        }
                    } else {
                        await this.E3UdsAgents[devRxAddr].addSchedule(this, dev.udsSchedule, dev.udsScheduleDids);
                        await this.log.silly('New Schedule ('+String(dev.udsSchedule)+'s) UDS device on '+String(dev.udsSelectDevAddr));
                    }
                }
            }
            for (const agent of Object.values(this.E3UdsAgents)) await agent.startup(this, 'normal');
        }
    }

    async startupScanUdsDevice(udsScanAgents, addr) {
        const udsAgent = new uds.uds(
            {   'canID'    : Number(addr),
                'stateBase': 'udsScanAddr',
                'device'   : 'common',
                'delay'    : 0,
                'active'   : true,
                'channel'  : this.channelExt,
                'timeout'  : this.udsTimeoutDevScan
            });
        const callback = new udsCallback.udsCallback();
        await udsAgent.setCallback(callback.scanDevCallback);
        await this.startupUdsAgent(udsScanAgents, udsAgent, 'udsDevScan');
        await udsAgent.pushCmnd(this, 'read', [this.udsDidForScan]);
        this.cntUdsScansActive += 1;
    }

    /*
    async scanUdsDevicesCommands(canExtName, canExtActivated) {
        function range(size, startAt = 0) {
            return [...Array(size).keys()].map(i => i + startAt);
        }

        await this.log.info('UDS scan for devices - start');
        this.udsScanAgents = {};
        this.udsCntNewDevs = 0;

        // Stop all running agents to avoid communication conflicts:
        for (const agent of Object.values(this.E3UdsAgents)) {
            await agent.stop(this);
        }

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
                if (!this.udsScanTEST) return(this.udsScanDevices);
            }
        } else {
            this.log.error('UDS scan: External CAN not activated! Continue for TESTING !');
            // STOPP here due to missing CAN.
            // Continue for testing
        }

        let scanMode = '';
        if (this.udsScanDevices.length > 0) {
            scanMode = this.udsScanDevices[0].devStateName;
        } else {
            scanMode = 'TEST DEVICES';
        }
        switch (scanMode) {
            case 'TEST DEVICES':
                this.log.debug('UDS scan TEST mode: return test devices.');
                this.udsScanDevices = await this.setUdsDevicesForTesting();
                break;
            case 'DELETE ALL':
                this.log.debug('UDS scan TEST mode: return empty device list.');
                this.udsScanDevices = [];
                break;
            case 'SCAN FULL RANGE':
            case 'SCAN SMALL RANGE':
                this.udsScanDevices = [];
                this.udsScanDidsCntRetries = 0;
                if (scanMode == 'SCAN FULL RANGE') {
                    this.log.debug('UDS scan TEST mode: Do a full scan.');
                    this.udsScanAddrRange = [0x680, 0x6a0, 0x6c0, 0x6e0];
                    this.udsScanAddrSpan  = 0x10;
                } else {
                    this.log.debug('UDS scan TEST mode: Do a small scan.');
                    this.udsScanAddrRange = [0x680, 0x6a0];
                    this.udsScanAddrSpan  = 0x02;
                }
                this.cntUdsScansActive = 0;
                for (const baseAddr of Object(this.udsScanAddrRange).values()) {
                    for (const addr of Object(range(Number(this.udsScanAddrSpan), Number(baseAddr))).values()) {
                        await this.startupScanUdsDevice(this.udsScanAgents, addr);
                        await this.sleep(50);
                    }
                }
                // eslint-disable-next-line no-case-declarations
                const tsAbort = new Date().getTime() + this.udsMaxTrialsDevScan*this.udsTimeoutDevScan+250;
                await this.log.info('UDS scan: Waiting for scans to complete.');
                while ( (this.cntUdsScansActive > 0) && (new Date().getTime() < tsAbort) ) {
                    await this.sleep(100);
                }

                // Stop all scan agents:
                for (const agent of Object.values(this.udsScanAgents)) {
                    await agent.stop(this);
                }

                // Restart all previously running agents:
                for (const agent of Object.values(this.E3UdsAgents)) {
                    await agent.startup(this,'normal');
                }

                if (this.cntUdsScansActive < 0) await this.log.warn('UDS scan finished. Number of retries / active UDS scans (should be 0): '+String(this.udsScanDidsCntRetries)+' / '+String(this.cntUdsScansActive));
                await this.log.info('UDS scan found '+
                    String(this.udsCntNewDevs)+
                    ' new of total '+
                    String(this.udsScanDevices.length)+
                    ' devices: '+
                    JSON.stringify(this.udsScanDevices)
                );
                break;
            case 'SCAN SMALL RANGE DIDS':
                await this.log.debug('UDS scan TEST mode: Do a SMALL RANGE DIDS scan. Return unchanged device list.');
                await this.scanUdsDids([0x6c3], 100);
                break;
            case 'SCAN FULL RANGE DIDS':
                await this.log.debug('UDS scan TEST mode: Do a FULL RANGE DIDS scan. Return unchanged device list.');
                await this.scanUdsDids([0x680,0x684,0x68c,0x6a1,0x6c3,0x6c5,0x6cf], 3000);
                break;

            default:
                // do nothing
                this.log.debug('UDS scan TEST mode: Do nothing. return unchanged device list.');
        }

        await this.log.info('UDS scan for devices - done');

        return(this.udsScanDevices);
    }
    */

    async scanUdsDevices() {
        function range(size, startAt = 0) {
            return [...Array(size).keys()].map(i => i + startAt);
        }

        await this.log.info('UDS scan for devices - start');
        this.udsScanAgents = {};
        this.udsCntNewDevs = 0;
        this.udsDevices = this.config.tableUdsDevices;

        // Stop all running agents to avoid communication conflicts:
        for (const agent of Object.values(this.E3UdsAgents)) {
            await agent.stop(this);
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
                await this.startupScanUdsDevice(this.udsScanAgents, addr);
                await this.sleep(50);
            }
        }
        // eslint-disable-next-line no-case-declarations
        const tsAbort = new Date().getTime() + this.udsMaxTrialsDevScan*this.udsTimeoutDevScan+250;
        await this.log.info('UDS scan: Waiting for scans to complete.');
        while ( (this.cntUdsScansActive > 0) && (new Date().getTime() < tsAbort) ) {
            await this.sleep(100);
        }

        // Stop all scan agents:
        for (const agent of Object.values(this.udsScanAgents)) {
            await agent.stop(this);
        }

        // Restart all previously running agents:
        for (const agent of Object.values(this.E3UdsAgents)) {
            await agent.startup(this,'normal');
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

    async startupScanUdsDids(udsScanAgents, addr, dids) {
        const hexAddr = '0x'+Number(addr).toString(16);
        const devInfo = this.config.tableUdsDevices.filter(item => item.devAddr == hexAddr);
        let devName = '';
        if (devInfo.length > 0) {
            devName = devInfo[0].devStateName;
        } else {
            devName = String(addr);
        }
        const udsAgent = new uds.uds(
            {   'canID'    : Number(addr),
                'stateBase': devName,
                'device'   : 'common',
                'delay'    : 0,
                'active'   : true,
                'channel'  : this.channelExt,
                'timeout'  : this.udsTimeoutDidScan
            });
        const callback = new udsCallback.udsCallback();
        await udsAgent.setCallback(callback.scanDidsCallback);
        this.udsScanDids[udsAgent.canIDhex] = dids.length;
        this.udsScanDidsCntTotal += dids.length;
        this.udsKnownDids[udsAgent.canIDhex] = {};
        await this.startupUdsAgent(udsScanAgents, udsAgent, 'udsDidScan');
        this.cntUdsScansActive += 1;
        await udsAgent.pushCmnd(this, 'read', dids);
    }

    async scanUdsDids(udsAddrs, udsMaxCntDids) {
        function range(size, startAt = 0) {
            return [...Array(size).keys()].map(i => i + startAt);
        }

        await this.log.info('UDS did scan - start');
        this.udsScanAgents = {};
        this.udsScanDids   = {};

        // Stop all running agents to avoid communication conflicts:
        for (const agent of Object.values(this.E3UdsAgents)) {
            await agent.stop(this);
        }

        this.cntUdsScansActive     = 0;
        this.udsScanDidsCntTotal   = 0;
        this.udsScanDidsCntRetries = 0;
        this.udsScanDidsCntSuccess = 0;
        this.udsScanDidsCntDone    = 0;
        const dids = range(udsMaxCntDids, 256);
        for (const addr of Object(udsAddrs).values()) {
            await this.startupScanUdsDids(this.udsScanAgents, addr, dids);
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

        // Store dids found and stop all scan agents:
        for (const agent of Object.values(this.udsScanAgents)) {
            await agent.storage.storeKnownDids(this, this.udsKnownDids[agent.canIDhex]);
            await agent.stop(this);
        }
        this.udsScanAgents = {};

        if (this.cntUdsScansActive < 0) await this.log.warn('UDS did scan finished. Number of active UDS scans (should be 0): '+String(this.cntUdsScansActive));
        await this.log.info('UDS did scan found '+String(this.udsScanDidsCntSuccess)+' dids. See state "dids" @device objects for details.');

        // Restart all previously running agents:
        for (const agent of Object.values(this.E3UdsAgents)) {
            await agent.startup(this,'normal');
        }
    }

    setUdsDevicesForTesting() {
        return([
            {
                'devName': 'HPMUMASTER.0x680',
                'devStateName': 'vitocal',
                'devAddr': '0x680',
                'collectCanId': '0x693'
            },
            {
                'devName': 'EMCUMASTER.0x6a1',
                'devStateName': 'vx3',
                'devAddr': '0x6a1',
                'collectCanId': '0x451'
            },
            {
                'devName': 'VCMU.0x68c',
                'devStateName': 'VCMU - List of DEVICES FOR TESTING',
                'devAddr': '0x68c',
                'collectCanId': ''
            }
        ]);
    }

    /*
    updateDevices() {
        this.log.debug('updateDevices()');
    }
    */

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            // Stop UDS agents:
            for (const agent of Object.values(this.E3UdsAgents)) {
                agent.stop(this);
            }
            for (const agent of Object.values(this.udsScanAgents)) {
                agent.stop(this);
            }

            // Stop CAN communication:
            this.disconnectFromCan(this.channelExt,this.config.canExtName);
            this.disconnectFromCan(this.channelInt,this.config.canIntName);

            // Here you must clear all timeouts or intervals that may still be active
            // clearTimeout(timeout1);
            // clearTimeout(timeout2);
            // ...
            // clearInterval(interval1);

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
            const agent = this.udsOnStateChanges[id];
            if (agent) {
                agent.onChange(this, agent.ctx, state);
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
        if (this.E3UdsAgents[msg.id]) this.E3UdsAgents[msg.id].msgUds(this, msg);
        if (this.udsScanAgents[msg.id]) this.udsScanAgents[msg.id].msgUds(this, msg);
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
