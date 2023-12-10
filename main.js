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

        this.e380Collect = null;    // E380 alway is assigned to external bus
        this.E3CollectInt = {};     // Dict of collect devices on internal bus
        this.E3CollectExt = {};     // Dict of collect devices on external bus
        this.E3Uds        = {};     // Dict of uds devices on external bus

        this.channelExt       = null;
        this.channelInt       = null;
        this.udsAgents        = {};
        this.udsDidForScan    = 256;                        // Busidentification
        this.udsMaxTrialsScan = 2;                          // Number of trials during UDS scan
        this.udsTimeout       = 1500;                       // Timeout (ms) for normal UDS communication
        this.udsTimeoutScan   = this.udsTimeout + 500;      // Timeout (ms) for scan for UDS devices per trial
        this.myUdsDevices     = [];
        this.udsScanDevices   = [];
        this.myUdsAddrSpan    = 0x10;
        //this.myUdsAddrRange   = [0x680, 0x6a0];
        this.myUdsAddrRange   = [0x680, 0x6a0, 0x6c0, 0x6e0];
        this.myScansActive    = 0;
        this.udsDevName2CanId = {
            'HPMUMASTER': '0x693',    // available only on internal bus (?)
            'EMCUMASTER': '0x451'
        };

        this.updateInterval = null;

        this.on('install', this.onInstall.bind(this));
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('objectChange', this.onObjectChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onInstall() {
        this.log.debug('onInstall()');
        this.log.debug(JSON.stringify(this.config));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        this.log.debug('onReady(): Starting.');
        this.log.debug(JSON.stringify(this.config));

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
            this.channelExt = await this.connectToCan(this.channelExt, this.config.canExtName, this.onCanMsgExt);
        }

        // Setup internal CAN bus if required
        // ==================================

        if (this.config.canIntActivated) {
            this.channelInt = await this.connectToCan(this.channelInt, this.config.canIntName, this.onCanMsgInt);
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

        for (const agent of Object.values(this.E3Uds)) {
            if (agent) {
                agent.cmndLoop(this);
                agent.schedulesLoop(this);
            }
        }

        this.subscribeObjects('*');

        //await this.scanUdsDevices();

        /*
        await this.sleep(2*2000);
        if (udsAgent1.storage.udsScanResult) {
            this.log.debug(String(udsAgent1.canIDhex)+': '+udsAgent1.storage.udsScanResult.res.DeviceProperty.Text);
        }
        if (udsAgent2.storage.udsScanResult) {
            this.log.debug(String(udsAgent2.canIDhex)+': '+udsAgent2.storage.udsScanResult.res.DeviceProperty.Text);
        }
        */

        this.log.debug('onReady(): Done.');

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
        if (!channel) {
            try {
                channel = can.createRawChannel(name, true);
                await channel.addListener('onMessage', onMsg, this);
                await channel.start();
                this.setState('info.connection', true, true);
                this.log.debug('CAN-Adapter '+name+' successfully started.');
            } catch (e) {
                this.log.error(`Could not connect to CAN "${name}" - ${JSON.stringify(e)}`);
                channel = null;
            }
        }
        return(channel);
    }

    async disconnectFromCan(channel, name) {
        if (channel) {
            try {
                await channel.stop();
                this.log.debug('CAN-Adapter '+name+' stopped.');
            } catch (e) {
                this.log.error(`Could not disconnect from CAN "${name}" - ${JSON.stringify(e)}`);
                channel = null;
            }
        }
        return(channel);
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
                                'stateBase': devInfo[0].devMyName,
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

    // Setup of agents for collecting data and for communication via UDS
    // Called during initial startup and on changes of configuration

    async registerUdsAgent(agent) {
        const rxAddr = Number(agent.config.canID) + Number(0x10);
        this.E3Uds[rxAddr] = agent;
    }

    async setupUdsAgents() {
        if ( (this.config.tableUdsSchedules) && (this.config.tableUdsSchedules.length > 0) ) {
            for (const agent of Object.values(this.config.tableUdsSchedules)) {
                if (agent.udsScheduleActive) {
                    if (!(Object.keys(this.udsAgents).includes(agent.udsSelectDevAddr))) {
                        const devInfo = this.config.tableUdsDevices.filter(item => item.devAddr == agent.udsSelectDevAddr);
                        if (devInfo.length > 0) {
                            const dev_name = devInfo[0].devMyName;
                            await this.log.debug('New UDS device on '+String(agent.udsSelectDevAddr)+' with name '+String(dev_name));
                            const udsAgent = new uds.uds(
                                {   'canID': [Number(agent.udsSelectDevAddr)],
                                    'stateBase': dev_name,
                                    'device': 'common',
                                    'delay': 0,
                                    'active': agent.udsScheduleActive,
                                    'channel': this.channelExt,
                                    'timeout': 1500     // Commuication timeout (ms)
                                });
                            //this.E3Uds[Number(agent.udsSelectDevAddr)+Number(0x10)] = udsAgent;
                            this.registerUdsAgent(udsAgent);
                            this.udsAgents[agent.udsSelectDevAddr] = udsAgent;
                            await udsAgent.initStates(this, true);
                            await udsAgent.addSchedule(this, agent.udsSchedule, agent.udsScheduleDids);
                            await this.log.debug('New Schedule ('+String(agent.udsSchedule)+'s) UDS device on '+String(agent.udsSelectDevAddr));
                        } else {
                            this.log.error('Could not setup UDS device on address '+String(agent.udsSelectDevAddr)+' due to missing device name.');
                        }
                    } else {
                        await this.udsAgents[agent.udsSelectDevAddr].addSchedule(this,agent.udsSchedule, agent.udsScheduleDids);
                        await this.log.debug('New Schedule ('+String(agent.udsSchedule)+'s) UDS device on '+String(agent.udsSelectDevAddr));
                    }
                }
            }
        }
    }

    range(size, startAt = 0) {
        return [...Array(size).keys()].map(i => i + startAt);
    }

    async scanCallback(ctx, hexAddr, res) {
        async function mergeDev(dev) {
            let pushDev = true;
            // @ts-ignore
            for (const [i, d] of Object(ctx.udsScanDevices).entries()) {
                if ( (d.devName == dev.devName) && (d.devAddr == dev.devAddr) ) {
                    ctx.log.silly('UDS Scan found device already known. No change applied.');
                    pushDev = false;
                    break;
                }
                /*
                // Won't work this way, because there my be serveral devices with the same name
                if ( (d.devName == dev.devName) && (d.devAddr != dev.devAddr) ) {
                    ctx.log.info('UDS Scan found known device on different address. Updating address: '+dev.devName+' ->'+dev.devAddr);
                    pushDev = false;
                    ctx.udsScanDevices[i].devAddr = dev.devAddr;
                    break;
                }
                */
            }
            if (pushDev) {
                ctx.udsScanDevices.push(dev);
                await ctx.log.debug('UDS Scan found new device: '+String(hexAddr)+': '+res.res.DeviceProperty.Text);
            }
        }
        if (res) {
            const devName = res.res.DeviceProperty.Text;
            const dev = {
                'devName': devName,
                'devMyName': devName,
                'devAddr': String(hexAddr),
                'collectCanId': (devName in ctx.udsDevName2CanId ? ctx.udsDevName2CanId[devName] : '')
            };
            mergeDev(dev);
        } else {
            await ctx.log.silly('UDS Scan: '+String(hexAddr)+': Timeout');
        }
        ctx.myScansActive -= 1;
        if (this.myScansActive < 0) {
            ctx.log.error('Number of actvive UDS-Scans got negative. This schould not happen.');
        }
    }

    async scanUdsDevice(addr) {
        const udsAgent = new uds.uds(
            {   'canID': Number(addr),
                'stateBase': 'udsScanAddr',
                'device': 'common',
                'delay': 0,
                'active': true,
                'channel': this.channelExt,
                'timeout': this.udsTimeout     // Commuication timeout (ms)
            });
        await udsAgent.initStates(this, false);
        await udsAgent.setCallback(this.scanCallback);
        await this.registerUdsAgent(udsAgent);
        udsAgent.checkDeviceAddress(this, this.udsDidForScan, this.udsTimeoutScan, this.udsMaxTrialsScan);
        this.myScansActive += 1;
    }

    async scanUdsDevices() {
        await this.log.info('UDS scan for devices - start');
        if (this.E3Uds != {}) {
            await this.log.warn('Scan for UDS devices will delete all UDS agents!');
            this.E3Uds = {};    // Delete agents
        }
        this.myScansActive = 0;
        for (const baseAddr of Object(this.myUdsAddrRange).values()) {
            for (const addr of Object(this.range(Number(this.myUdsAddrSpan), Number(baseAddr))).values()) {
                await this.scanUdsDevice(addr);
                await this.sleep(50);
            }
        }
        const tsAbort = new Date().getTime() + this.udsMaxTrialsScan*this.udsTimeoutScan+250;
        while ( (this.myScansActive > 0) && (new Date().getTime() < tsAbort) ) {
            await this.sleep(100);
        }
        this.E3Uds = {};    // Delete all scan agents
        await this.log.debug('UDS scan finished. Number of active UDS scans (should be 0): '+String(this.myScansActive));
        await this.log.info('UDS scan found '+String(this.udsScanDevices.length)+' devices: '+JSON.stringify(this.udsScanDevices));
        await this.log.info('UDS scan for devices - done');
        return(this.udsScanDevices);
    }

    setUdsDevicesForTesting() {
        return([
            {
                'devName': 'HPMUMASTER',
                'devMyName': 'vitocal',
                'devAddr': '0x680',
                'collectCanId': '0x693'
            },
            {
                'devName': 'EMCUMASTER',
                'devMyName': 'vx3',
                'devAddr': '0x6a1',
                'collectCanId': '0x451'
            },
            {
                'devName': 'VCMU',
                'devMyName': 'VCMU',
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
            this.disconnectFromCan(this.channelExt,this.config.canExtName);
            this.disconnectFromCan(this.channelInt,this.config.canIntName);
            this.updateInterval && clearInterval(this.updateInterval);
            this.E3Uds = {};            // Delete all UDS agents
            this.E3CollectExt = {};     // Delete all collect agents on external bus
            this.E3CollectInt = {};     // Delete all collect agents on internal bus
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
        if (typeof obj === 'object' && obj.message) {
            this.log.debug(`command received ${obj.command}`);

            if (obj.command === 'getUdsDevices') {
                if (obj.callback) {
                    if (!this.udsDevScanIsRunning) {
                        this.udsDevScanIsRunning = true;
                        await this.log.debug(`Received data - ${JSON.stringify(obj)}`);
                        this.udsScanDevices = obj.message;
                        //this.myUdsDevices = await this.setUdsDevicesForTesting();
                        this.myUdsDevices = await this.scanUdsDevices();
                        await this.sendTo(obj.from, obj.command, this.myUdsDevices, obj.callback);
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
                    this.log.debug(`Received data - ${JSON.stringify(obj)}`);
                    if (Array.isArray(obj.message) ) {
                        const selUdsDevices = obj.message.map(item => ({label: item.devMyName, value: item.devAddr}));
                        this.log.debug(`Data to send - ${JSON.stringify(selUdsDevices)}`);
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
                    this.log.debug(`Received data - ${JSON.stringify(obj)}`);
                    if (Array.isArray(obj.message) ) {
                        const selUdsDevices = obj.message.filter(item => item.collectCanId != '').map(item => ({label: item.devMyName, value: item.collectCanId}));
                        this.log.debug(`Data to send - ${JSON.stringify(selUdsDevices)}`);
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
                    this.log.debug(`Received data - ${JSON.stringify(obj)}`);
                    if (Array.isArray(obj.message) ) {
                        const selUdsDevices = obj.message.filter(item => item.collectCanId != '').map(item => ({label: item.devMyName, value: item.collectCanId}));
                        this.log.debug(`Data to send - ${JSON.stringify(selUdsDevices)}`);
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
        if (this.E3Uds[msg.id]) this.E3Uds[msg.id].msgUds(this, msg);
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
