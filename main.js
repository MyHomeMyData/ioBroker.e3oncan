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
        this.E3CollectInt = [];     // List of collect devices on internal bus
        this.E3CollectExt = [];     // List of collect devices on external bus
        this.E3Uds        = [];     // List of uds devices on external bus
        this.udsDevices   = {};     // Uds devices-addresses

        this.channelExt = null;
        this.channelInt = null;

        //this.on('install', this.onInstall.bind(this));
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        // this.on('objectChange', this.onObjectChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));

        this.sequence = 0;
    }
    /*
    async onInstall() {
        this.log.info('onInstall()');
        this.log.info(JSON.stringify(this.config));
    }
    */
    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        const objSendTo =  {'command':'sendTo1','message':{'data1':'Text #1','data2':'Text #2'},'from':'system.adapter.admin.0','callback':{'message':{'data1':'Text #1','data2':'Text #2'},'id':396,'ack':false,'time':1701637002346},'_id':45130525};
        this.sendTo('system.adapter.admin.0', 'sendTo1',
            { native: { sendTo1Ret: `${objSendTo.message.data1} / ${objSendTo.message.data2}`}},
            objSendTo.callback);
        const myUdsDevices = [
            {'label': 'Device 1', 'value': '0x680'},
            {'label': 'Device 2', 'value': '0x6a1'},
            {'label': 'Device 3', 'value': '0x6c1'}
        ];
        this.sendTo('system.adapter.admin.0', 'this.sendTo',
            { native: { sendToMyDevices: `${JSON.stringify(myUdsDevices)}`}});

        this.log.debug('sendTo done');

        // Reset the connection indicator during startup
        this.setState('info.connection', false, true);

        this.log.debug(JSON.stringify(this.config));

        codecs.rawmode.setOpMode(false);

        // Setup external CAN bus if required
        // ==================================

        if (this.config.adapter_ext_activated) {
            try {
                this.channelExt = can.createRawChannel(this.config.adapter_ext_name, true);
                this.channelExt.addListener('onMessage', this.onCanMsgExt, this);
            } catch (e) {
                this.log.error(JSON.stringify(e));
                this.channelExt = null;
            }
        }

        // Setup internal CAN bus if required
        // ==================================

        if (this.config.adapter_int_activated) {
            try {
                this.channelInt = can.createRawChannel(this.config.adapter_int_name, true);
                this.channelInt.addListener('onMessage', this.onCanMsgInt, this);
            } catch (e) {
                this.log.error(JSON.stringify(e));
                this.channelInt = null;
            }
        }

        // Evaluate configuration for external CAN bus
        // ===========================================

        // Setup E380 collect:
        if (this.config.e380_active) {
            this.e380Collect = new collect.collect(
                {   'canID': [0x250,0x252,0x254,0x256,0x258,0x25A,0x25C],
                    'stateBase': this.config.e380_name,
                    'device': this.config.e380_name,
                    'delay': this.config.e380_delay,
                    'active': this.config.e380_active});
            await this.e380Collect.initStates(this);
        }
        // Setup all configured devices for collect:
        for (const dev of Object.values(this.config.table_collect_ext)) {
            if (dev.collect_active) {
                const Collect = new collect.collect(
                    {   'canID': [Number(dev.collect_canid)],
                        'stateBase': dev.collect_dev_name,
                        'device': 'common',
                        'delay': dev.collect_delay_time,
                        'active': dev.collect_active,
                        'channel': this.channelExt});
                this.E3CollectExt.push(Collect);
                await Collect.initStates(this);            }
        }

        // Setup all configured devices for UDS:
        for (const dev of Object.values(this.config.table_uds)) {
            if (dev.uds_active) {
                if (!(Object.keys(this.udsDevices).includes(dev.uds_dev_addr))) {
                    const Uds = new uds.uds(
                        {   'canID': [Number(dev.uds_dev_addr)],
                            'stateBase': dev.uds_dev_name,
                            'device': 'common',
                            'delay': 0,
                            'active': dev.uds_active,
                            'channel': this.channelExt,
                            'timeout': 2        // Commuication timeout (s)
                        });
                    this.E3Uds.push(Uds);
                    this.log.debug('New UDS device on '+String(dev.uds_dev_addr));
                    this.udsDevices[dev.uds_dev_addr] = Uds;
                    await Uds.initStates(this);
                    await Uds.addSchedule(this, dev.uds_schedule, dev.uds_dids);
                } else {
                    await this.udsDevices[dev.uds_dev_addr].addSchedule(this,dev.uds_schedule, dev.uds_dids);
                }
            }
        }

        // Evaluate configuration for internal CAN bus
        // ===========================================

        // Setup all configured devices for collect:
        for (const dev of Object.values(this.config.table_collect_int)) {
            if (dev.collect_active) {
                const Collect = new collect.collect(
                    {   'canID': [Number(dev.collect_canid)],
                        'stateBase': dev.collect_dev_name,
                        'device': 'common',
                        'delay': dev.collect_delay_time,
                        'active': dev.collect_active,
                        'channel': this.channelInt});
                this.E3CollectInt.push(Collect);
                await Collect.initStates(this);            }
        }


        // The adapters config (in the instance object everything under the attribute "native") is accessible via
        // this.config:
        //this.log.info('config option1: ' + this.config.option1);
        //this.log.info('config option2: ' + this.config.option2);

        /*
        For every state in the system there has to be also an object of type state
        Here a simple template for a boolean variable named "testVariable"
        Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
        */

        // Startup external CAN bus if configured
        // ======================================

        if (this.channelExt) {
            await this.channelExt.start();
            this.setState('info.connection', true, true);
        }

        // Startup internal CAN bus if configured
        // ======================================

        if (this.channelInt) {
            await this.channelInt.start();
            this.setState('info.connection', true, true);
        }

        // Startup UDS communications if configured
        // ========================================

        for (const dev of Object.values(this.E3Uds)) {
            if (dev) {
                dev.cmndLoop(this);
                dev.schedulesLoop(this);
            }
        }


        this.log.debug('onReady(): All done.');

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

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            if (this.channelExt) {
                this.channelExt.stop();
                this.log.info('CAN-Adapter '+this.config.adapter_ext_name+' stopped.');
            }
            if (this.channelInt) {
                this.channelInt.stop();
                this.log.info('CAN-Adapter '+this.config.adapter_int_name+' stopped.');
            }
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
    // onObjectChange(id, obj) {
    //     if (obj) {
    //         // The object was changed
    //         this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
    //     } else {
    //         // The object was deleted
    //         this.log.info(`object ${id} deleted`);
    //     }
    // }

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
        for (const dev of Object.values(this.E3Uds)) {
            if ( (dev) && (id.includes(dev.timeoutId)) ) {
                dev.onTimeoutChange(this, state);
            }
            if ( (dev) && (id.includes(dev.userDidsToReadId)) ) {
                dev.onUserReadDidsChange(this, state);
            }
        }
    }

    // If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.messagebox" property to be set to true in io-package.json
    //  * @param {ioBroker.Message} obj
    //  */
    onMessage(obj) {
        this.log.debug(`onMessage() - ${JSON.stringify(obj)}`);
        if (typeof obj === 'object' && obj.message) {
            this.log.info(`command received ${obj.command}`);
            if (obj.command === 'textSendTo1') {
                // Send response in callback if required
                this.log.info(`textSendTo1 - ${JSON.stringify(obj)}`);
                this.sequence++;
                if (obj.callback) this.sendTo(obj.from, obj.command, `Message received (${this.sequence})`, obj.callback);
            }
            if (obj.command === 'sendTo1') {
                // Send response in callback if required
                this.log.info(`sendTo1 - ${JSON.stringify(obj)}`);
                if (obj.callback) this.sendTo(obj.from, obj.command,
                    { native: { sendTo1Ret: `${obj.message.data1} / ${obj.message.data2}`}},
                    obj.callback);
            }
        }
        //     if (typeof obj === 'object' && obj.message) {
        //         if (obj.command === 'send') {
        //             // e.g. send email or pushover or whatever
        //             this.log.info('send command');

    //             // Send response in callback if required
    //             if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
    //         }
    //     }
    }

    onCanMsgExt(msg) {
        if ( (this.e380Collect) && (this.e380Collect.config.canID.includes(msg.id)) ) { this.e380Collect.msgCollect(this, msg); }
        for (const dev of Object.values(this.E3CollectExt)) {
            if ( (dev) && (dev.config.canID.includes(msg.id)) ) {
                dev.msgCollect(this, msg);
            }
        }
        for (const dev of Object.values(this.E3Uds)) {
            if ( (dev) && (dev.readByDidProt.idRx == msg.id) ) {
                dev.msgUds(this, msg);
            }
        }
    }

    onCanMsgInt(msg) {
        for (const dev of Object.values(this.E3CollectInt)) {
            if ( (dev) && (dev.config.canID.includes(msg.id)) ) {
                dev.msgCollect(this, msg);
            }
        }
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
