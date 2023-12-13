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
        this.udsNewDevs    = 0;     // New devices found during scan

        this.channelExt       = null;
        this.channelExtName   = '';
        this.channelInt       = null;
        this.channelIntName   = '';
        this.udsAgents        = {};
        this.udsDidForScan    = 256;                        // Busidentification
        this.udsMaxTrialsScan = 2;                          // Number of trials during UDS scan
        this.udsTimeout       = 1500;                       // Timeout (ms) for normal UDS communication
        this.udsTimeoutScan   = this.udsTimeout + 500;      // Timeout (ms) for scan for UDS devices per trial
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
        this.udsScanDidsRetries   = 0;
        this.udsScanDidMaxRetries = 500;
        this.udsScanDidsCntSuccess = 0;

        this.updateInterval = null;

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

        await this.log.debug('onReady(): Starting.');
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

        // Startup UDS communications if configured
        // ========================================

        this.subscribeObjects('*');

        /*
        await this.sleep(2*2000);
        if (udsAgent1.storage.udsScanResult) {
            this.log.debug(String(udsAgent1.canIDhex)+': '+udsAgent1.storage.udsScanResult.res.DeviceProperty.Text);
        }
        if (udsAgent2.storage.udsScanResult) {
            this.log.debug(String(udsAgent2.canIDhex)+': '+udsAgent2.storage.udsScanResult.res.DeviceProperty.Text);
        }
        */

        //await this.sleep(2500);
        //await this.scanUdsDids([0x680,0x684,0x68c,0x6a1,0x6c3,0x6c5,0x6cf]);
        //await this.scanUdsDids([0x6a1]);

        await this.log.debug('onReady(): Done.');

        // In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
        // this.subscribeStates('testVariable');
        // You can also add a subscription for multiple states. The following line watches all states starting with "lights."
        // this.subscribeStates('lights.*');
        // Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
        // this.subscribeStates('*');

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

    // Setup agents for collecting data and for communication via UDS

    async startupUdsAgent(agents, agent, opMode) {
        const rxAddr = Number(agent.config.canID) + Number(0x10);
        agents[rxAddr] = agent;
        await agent.startup(this, opMode);
    }

    async setupUdsAgents() {
        if ( (this.config.tableUdsSchedules) && (this.config.tableUdsSchedules.length > 0) ) {
            for (const agent of Object.values(this.config.tableUdsSchedules)) {
                let udsAgent = null;
                if (agent.udsScheduleActive) {
                    if (!(Object.keys(this.udsAgents).includes(agent.udsSelectDevAddr))) {
                        const devInfo = this.config.tableUdsDevices.filter(item => item.devAddr == agent.udsSelectDevAddr);
                        if (devInfo.length > 0) {
                            const dev_name = devInfo[0].devStateName;
                            await this.log.debug('New UDS device on '+String(agent.udsSelectDevAddr)+' with name '+String(dev_name));
                            udsAgent = new uds.uds(
                                {   'canID'    : [Number(agent.udsSelectDevAddr)],
                                    'stateBase': dev_name,
                                    'device'   : 'common',
                                    'delay'    : 0,
                                    'active'   : agent.udsScheduleActive,
                                    'channel'  : this.channelExt,
                                    'timeout'  : this.udsTimeout
                                });
                            this.udsAgents[agent.udsSelectDevAddr] = udsAgent;
                            await udsAgent.initStates(this);
                            await udsAgent.addSchedule(this, agent.udsSchedule, agent.udsScheduleDids);
                            await this.log.debug('New Schedule ('+String(agent.udsSchedule)+'s) UDS device on '+String(agent.udsSelectDevAddr));
                        } else {
                            this.log.error('Could not setup UDS device on address '+String(agent.udsSelectDevAddr)+' due to missing device name.');
                        }
                    } else {
                        await this.udsAgents[agent.udsSelectDevAddr].addSchedule(this,agent.udsSchedule, agent.udsScheduleDids);
                        await this.log.debug('New Schedule ('+String(agent.udsSchedule)+'s) UDS device on '+String(agent.udsSelectDevAddr));
                    }
                    await this.startupUdsAgent(this.E3UdsAgents, udsAgent, 'normal');
                }
            }
        }
    }

    async scanDevCallback(ctx, ctxAgent, args) {
        async function mergeDev(dev) {
            let pushDev = true;
            await ctx.log.debug('UDS device scan found device: '+String(ctxAgent.canIDhex)+': '+res.res.DeviceProperty.Text);
            for (const d of Object(ctx.udsScanDevices).values()) {
                if ( (d.devName == dev.devName) && (d.devAddr == dev.devAddr) ) {
                    ctx.log.silly('UDS device scan found device already known. No change applied.');
                    pushDev = false;
                    break;
                }
            }
            if (pushDev) {
                await ctx.log.info('UDS device scan found NEW device: '+String(ctxAgent.canIDhex)+': '+res.res.DeviceProperty.Text);
                ctx.udsNewDevs += 1;
                ctx.udsScanDevices.push(dev);
            }
        }
        const res = ctxAgent.storage.udsScanResult;
        if (res) {
            const devName = res.res.DeviceProperty.Text;
            const dev = {
                'devName': devName,
                'devStateName': devName+'.'+String(ctxAgent.canIDhex),
                'devAddr': String(ctxAgent.canIDhex),
                'collectCanId': (devName in ctx.udsDevName2CanId ? ctx.udsDevName2CanId[devName] : '')
            };
            await mergeDev(dev);
        } else {
            await ctx.log.silly('UDS Scan: '+String(ctxAgent.canIDhex)+': Timeout');
        }
        if (ctxAgent.cmndsQueue.length == 0) {
            await ctxAgent.setCallback(null);    // Scan agent completed. Reset callback.
            ctx.cntUdsScansActive -= 1;
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
                'timeout'  : this.udsTimeout
            });
        await udsAgent.setCallback(this.scanDevCallback);
        await this.startupUdsAgent(udsScanAgents, udsAgent, 'udsDevScan');
        udsAgent.checkDeviceAddress(this, this.udsDidForScan, this.udsTimeoutScan, this.udsMaxTrialsScan);
        this.cntUdsScansActive += 1;
    }

    async scanUdsDevices(canConfig) {
        function range(size, startAt = 0) {
            return [...Array(size).keys()].map(i => i + startAt);
        }

        await this.log.info('UDS scan for devices - start');
        this.udsScanAgents = {};
        this.udsNewDevs    = 0;

        // Stop all running agents to avoid communication conflicts:
        for (const agent of Object.values(this.E3UdsAgents)) {
            await agent.stop(this);
        }

        // Startup CAN:
        if (canConfig.activated) {
            if  ((this.channelExt) &&
            (this.channelExtName != canConfig.name) ) {
            // CAN is different from running CAN. Stop actual CAN first.
                [this.channelExt, this.channelExtName] = await this.disconnectFromCan(this.channelExt, this.channelExtName);
            }
            [this.channelExt, this.channelExtName] = await this.connectToCan(this.channelExt, canConfig.name, this.onCanMsgExt);
            if (!this.channelExt) {
                await this.log.error('UDS scan devices: Could not connect to CAN Adapter '+canConfig.name+'. Aborting.');
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
                const tsAbort = new Date().getTime() + this.udsMaxTrialsScan*this.udsTimeoutScan+250;
                await this.log.info('UDS scan: Waiting for scans to complete.');
                while ( (this.cntUdsScansActive > 0) && (new Date().getTime() < tsAbort) ) {
                    await this.sleep(100);
                }

                // Stop all scan agents:
                for (const agent of Object.values(this.udsScanAgents)) {
                    await agent.stop(this,'normal');
                }
                this.udsScanAgents = {};

                // Restart all previously running agents:
                for (const agent of Object.values(this.E3UdsAgents)) {
                    await agent.startup(this,'normal');
                }

                if (this.cntUdsScansActive < 0) await this.log.warn('UDS scan finished. Number of active UDS scans (should be 0): '+String(this.cntUdsScansActive));
                await this.log.info('UDS scan found '+
                    String(this.udsNewDevs)+
                    ' new of total '+
                    String(this.udsScanDevices.length)+
                    ' devices: '+
                    JSON.stringify(this.udsScanDevices)
                );
                break;
            default:
                // do nothing
                this.log.debug('UDS scan TEST mode: Do nothing. return unchanged device list.');
        }

        // Restart all previously running agents:
        for (const agent of Object.values(this.E3UdsAgents)) {
            await agent.startup(this,'normal');
        }

        await this.log.info('UDS scan for devices - done');

        return(this.udsScanDevices);
    }

    async scanDidsCallback(ctx, ctxAgent, args) {
        const response = args[0];
        const did = args[1];
        if (ctxAgent.cmndsQueue.length == 0) ctxAgent.setCallback(null);    // Scan agent completed. Reset callback.
        if (response == 'ok') {
            await ctx.udsKnownDids[ctxAgent.canIDhex].push(did);
        }
        if ( (response == 'ok') || (response == 'negative response') ) {
            ctx.udsScanDidsCntSuccess += 1;
            await ctx.log.silly('UDS did scan: '+String(ctxAgent.data.did)+'@'+String(ctxAgent.canIDhex)+': '+response);
        }else {
            await ctx.log.debug('UDS did scan: '+String(ctxAgent.data.did)+'@'+String(ctxAgent.canIDhex)+': '+response);
        }
        if ( (response == 'timeout') && (ctx.udsScanDidsRetries > 0) ) {
            // Retry dids with timeout until budget for retries is 0
            ctx.udsScanDidsRetries -= 1;
            ctxAgent.pushCmnd(ctx,'read', [did]);
            if (ctx.udsScanDidsRetries == 0) {
                await ctx.log.warn('UDS did scan: Budget for retries after timeout is used up. Dids may be missed.');
            }
        } else {
            ctx.udsScanDids[ctxAgent.canIDhex] -= 1;
        }
        if (ctx.udsScanDids[ctxAgent.canIDhex] == 0) ctx.cntUdsScansActive -= 1;
        if (ctx.cntUdsScansActive < 0) {
            await ctx.log.error('UDS did scan: Number of active dids got negative @'+
                String(ctxAgent.canIDhex)+' - this should not happen.');
        }
        if (ctx.udsScanDids[ctxAgent.canIDhex] < 0) {
            await ctx.log.error('UDS did scan: Number of remaining dids got negative @'+
                String(ctxAgent.canIDhex)+' - this should not happen.');
        }
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
                'timeout'  : this.udsTimeout
            });
        await udsAgent.setCallback(this.scanDidsCallback);
        this.udsScanDidsRetries = this.udsScanDidMaxRetries;
        this.udsScanDids[udsAgent.canIDhex] = dids.length;
        this.udsKnownDids[udsAgent.canIDhex] = [];
        await this.startupUdsAgent(udsScanAgents, udsAgent, 'udsDidScan');
        this.cntUdsScansActive += 1;
        await udsAgent.pushCmnd(this, 'read', dids);
    }

    async scanUdsDids(udsAddrs) {
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

        this.cntUdsScansActive = 0;
        const dids = range(3000, 256);
        for (const addr of Object(udsAddrs).values()) {
            await this.startupScanUdsDids(this.udsScanAgents, addr, dids);
            await this.sleep(50);
        }
        this.udsScanDidsCntSuccess = 0;
        const tsAbort = new Date().getTime() + dids.length*this.udsTimeoutScan;
        while ( (this.cntUdsScansActive > 0) && (new Date().getTime() < tsAbort) ) {
            await this.sleep(990);
            if ((new Date().getSeconds() % 10) == 0) {
                await this.log.info('UDS dids scan checked '+
                    String(Math.round(this.udsScanDidsCntSuccess/10))+
                    ' dids/second. Dids remaining: '+
                    JSON.stringify(this.udsScanDids));
                this.udsScanDidsCntSuccess = 0;
            }
        }

        // Stop all scan agents:
        for (const agent of Object.values(this.udsScanAgents)) {
            await agent.stop(this,'normal');
        }
        this.udsScanAgents = {};

        // Restart all previously running agents:
        for (const agent of Object.values(this.E3UdsAgents)) {
            await agent.startup(this,'normal');
        }

        if (this.cntUdsScansActive < 0) await this.log.warn('UDS did scan finished. Number of active UDS scans (should be 0): '+String(this.cntUdsScansActive));
        await this.log.info('UDS did scan found: '+JSON.stringify(this.udsKnownDids));
        await this.log.info('UDS did scan - done');
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
        /*
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
        */
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
        await this.log.debug('this.config:');
        await this.log.debug(JSON.stringify(this.config));
        if (typeof obj === 'object' && obj.message) {
            this.log.silly(`command received ${obj.command}`);

            if (obj.command === 'getUdsDevices') {
                if (obj.callback) {
                    if (!this.udsDevScanIsRunning) {
                        this.udsDevScanIsRunning = true;
                        await this.log.debug(`Received data - ${JSON.stringify(obj)}`);
                        this.udsScanDevices = obj.message.udsDevices;
                        this.udsDevices = await this.scanUdsDevices(obj.message.canExt);
                        await this.sendTo(obj.from, obj.command, this.udsDevices, obj.callback);
                        //await this.sendTo(obj.from, obj.command, [], obj.callback);
                        this.udsDevScanIsRunning = false;
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
