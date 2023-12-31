
const E3              = require('./codecs');
const E3DidsDict      = require('./didsE3.json');
const E380DidsDict    = require('./didsE380.json');

class storageDids {
    constructor(config) {
        this.config = config;
        this.didsWritablesId = 'udsDidsWritable';
        this.didsCommonId    = 'udsDidsCommon';
        this.didsSpecId      = 'udsDidsSpecific';
        this.didsWritable    = {};
        this.didsDictE3      = {};      // Common dids imported from project open3e
        this.didsDictDevCom  = {};      // Dids of this device matching the E3 common list
        this.didsDictDevSpec = {};      // Dids specific for this device
        this.dids            = {};      // Consolidated list of dids available for this device
    }
    async initStates(ctx, opMode) {
        if (['standby','normal','udsDidScan'].includes(opMode)) {
            if (this.config.device != 'e380') {
                await ctx.setObjectNotExistsAsync(this.config.stateBase+'.info.'+this.didsWritablesId, {
                    type: 'state',
                    common: {
                        name: this.config.stateBase+' list of datapoints writable via WriteByDid',
                        role: 'state',
                        type: 'json',
                        read: true,
                        write: true,
                        def: JSON.stringify({})
                    },
                    native: {},
                });

                await ctx.setObjectNotExistsAsync(this.config.stateBase+'.info.'+this.didsCommonId, {
                    type: 'state',
                    common: {
                        name: this.config.stateBase+' all available datapoints',
                        role: 'state',
                        type: 'json',
                        read: true,
                        write: true,
                        def: JSON.stringify({})
                    },
                    native: {},
                });

                await ctx.setObjectNotExistsAsync(this.config.stateBase+'.info.'+this.didsSpecId, {
                    type: 'state',
                    common: {
                        name: this.config.stateBase+' available datapoints specific to this device',
                        role: 'state',
                        type: 'json',
                        read: true,
                        write: true,
                        def: JSON.stringify({})
                    },
                    native: {},
                });
            }
        }
    }
    async mergeDids(didsCommon, didsDevSpecific) {
        const dids = await JSON.parse(JSON.stringify(didsCommon));
        for (const [id, did] of Object.entries(didsDevSpecific)) {
            dids[id] = did;
        }
        return(dids);
    }
    async readKnownDids(ctx, opMode) {
        // Read common and devive specific dids list known from dids scan
        // If scanned dids are avalilable: return complete list of dids for this device
        // else return list of common dids for all devices and list of writable dids
        if (this.config.device != 'e380') {
            if (opMode != 'udsDevScan') {
                try {
                    const baseId = this.config.stateBase+'.info.';
                    this.didsWritable    = await JSON.parse((await ctx.getStateAsync(baseId+this.didsWritablesId)).val);
                    this.didsDictDevCom  = await JSON.parse((await ctx.getStateAsync(baseId+this.didsCommonId)).val);
                    this.didsDictDevSpec = await JSON.parse((await ctx.getStateAsync(baseId+this.didsSpecId)).val);
                } catch(e) {
                    this.didsWritable    = {};
                    this.didsDictDevCom  = E3DidsDict;
                    this.didsDictDevSpec = {};
                    ctx.log.warn('Could not read dids of device '+this.config.stateBase+'. err='+e.message);
                }
                if (Object.keys(this.didsDictDevCom).length == 0) {
                    // No dids scan results available yet
                    this.didsDictDevCom  = E3DidsDict;
                }
            } else {
                // UDS device scan
                this.didsWritable    = {};
                this.didsDictDevCom[ctx.udsDidForScan]  = E3DidsDict[ctx.udsDidForScan];
                this.didsDictDevSpec = {};
            }
        } else {
            this.didsWritable    = {};
            this.didsDictDevCom  = {};
            this.didsDictDevSpec = E380DidsDict;
        }
        if (opMode == 'udsDidScan') {
            this.didsDictDevCom  = {};
            this.dids = E3DidsDict;
        } else {
            this.dids = await this.mergeDids(this.didsDictDevCom,this.didsDictDevSpec);
        }
    }
    async storeKnownDids(ctx) {
        if (this.config.device != 'e380') {
            const baseId = this.config.stateBase+'.info.';
            await ctx.setStateAsync(baseId+this.didsWritablesId, {val: JSON.stringify(this.didsWritable), ack: true});
            await ctx.setStateAsync(baseId+this.didsCommonId, {val: JSON.stringify(this.didsDictDevCom), ack: true});
            await ctx.setStateAsync(baseId+this.didsSpecId, {val: JSON.stringify(this.didsDictDevSpec), ack: true});
        }
    }
}

class storage {
    constructor(config) {
        this.config = config;
        this.storageDids   = new storageDids({
            stateBase:this.config.stateBase,
            device:this.config.device
        });
        this.opModes = ['standby','udsDevScan','udsDidScan','normal','TEST'];
        this.opMode = this.opModes[0];
        this.udsScanResult = null;
    }
    async initStates(ctx, opMode) {
        await this.setOpMode(opMode);
        if (opMode != 'udsDevScan') {
            await ctx.setObjectNotExistsAsync(this.config.stateBase, {
                type: 'device',
                common: {
                    name: this.config.stateBase,
                    role: 'device'
                },
                native: {},
            });

            await ctx.setObjectNotExistsAsync(this.config.stateBase+'.info', {
                type: 'channel',
                common: {
                    name: this.config.stateBase+' informations',
                    role: 'channel'
                },
                native: {},
            });

            await ctx.setObjectNotExistsAsync(this.config.stateBase+'.info.'+this.config.statId, {
                type: 'state',
                common: {
                    name: this.config.stateBase+' statistics about communication',
                    role: 'state',
                    type: 'json',
                    read: true,
                    write: true,
                    def: JSON.stringify({})
                },
                native: {},
            });

            await this.storageDids.initStates(ctx, opMode);

            await ctx.setObjectNotExistsAsync(this.config.stateBase+'.json', {
                type: 'channel',
                common: {
                    name: this.config.stateBase+' JSON',
                    role: 'channel for json data'
                },
                native: {},
            });

            await ctx.setObjectNotExistsAsync(this.config.stateBase+'.tree', {
                type: 'channel',
                common: {
                    name: this.config.stateBase+' TREE',
                    role: 'channel for tree data'
                },
                native: {},
            });

            await ctx.setObjectNotExistsAsync(this.config.stateBase+'.raw', {
                type: 'channel',
                common: {
                    name: this.config.stateBase+' RAW',
                    role: 'channel for raw data'
                },
                native: {},
            });
        }
        await this.storageDids.readKnownDids(ctx, opMode);
    }

    async setOpMode(mode) {
        if (this.opModes.includes(mode)) {
            this.opMode = mode;
        }
    }

    async getOpMode() {
        return(this.opMode);
    }

    toHex(d) {
        // Convert integer to hex string of length len
        return ('00'+(Number(d).toString(16))).slice(-2);
    }

    arr2Hex(arr) {
        // Convert byte array to hex string
        let hs = '';
        for (const v in arr) { hs += this.toHex(arr[v]); }
        return hs;
    }

    toByteArray(hs) {
        // Convert hex string, e.g. '21A8' to byte array: [33,168]
        const ba = [];
        for (let i=0; i<hs.length/2; i++) {
            ba.push(parseInt(hs.slice(2*i,2*i+2), 16));
        }
        return ba;
    }

    async storeStatistics(ctx, ctxWorker, forceStore) {
        if (['standby','normal','udsDidScan'].includes(await this.getOpMode())) {
            const ts = new Date().getTime();
            if ( (!forceStore) && (ts < ctxWorker.stat.nextTs) ) return;     // Min. time step not reached. Do not store.
            if (ctxWorker.stat) await ctx.setStateAsync(ctxWorker.config.stateBase+'.info.'+this.config.statId, JSON.stringify(ctxWorker.stat), true);
            ctxWorker.stat.nextTs = ts+ctxWorker.stat.tsMinStep;
        }
    }

    async encodeDataCAN(ctx, ctxWorker, did, data) {
        // Encode data for given did
        let val;
        if (did in this.storageDids.dids) {
            const cdi = this.storageDids.dids[did];     // Infos about did codec
            try {
                const codec = await new E3.O3Ecodecs[cdi.codec](cdi.len, cdi.id, cdi.args);
                val = await codec.encode(data);
            } catch(e) {
                await ctx.log.warn('encodeDataCAN(): Could not encode data for '+ctxWorker.config.stateBase+'.'+String(did)+'. err='+e.message);
                val = null;
            }
        } else {
            await ctx.log.warn('encodeDataCAN(): Did not found for '+ctxWorker.config.stateBase+'.'+String(did));
            val = null;
        }
        return(val);
    }

    async decodeDataCAN(ctx, ctxWorker, did, data) {
        async function storeObjectJson(ctx, stateId, obj) {
            try {
                await ctx.setObjectNotExistsAsync(stateId, {
                    type: 'state',
                    common: {
                        name: idStr,
                        type: 'string',
                        role: 'state',
                        read: true,
                        write: true,
                    },
                    native: {},
                });
                ctx.log.silly(String(stateId)+': '+JSON.stringify(obj));
                await ctx.setStateAsync(stateId, JSON.stringify(obj), true);
            }
            catch(e) {
                ctx.log.error('Storage of did '+stateId+'.'+String(did)+' failed. err='+e.message);
            }
        }
        async function storeObjectTree(ctx, stateId, obj) {
            try {
                if (typeof(obj) == 'object') {
                    if (Object.keys(obj).length <= 100) {
                        for (const [key, itm] of Object.entries(obj)) {
                            await storeObjectTree(ctx, String(stateId)+'.'+String(key),itm);
                        }
                    } else {
                        ctx.log.error('Did valuation aborted. Too many members ('+String(Object.keys(obj).length)+') '+stateId+'.'+String(did));
                    }
                } else {
                    await storeObjectJson(ctx, stateId, obj);
                }
            }
            catch(e) {
                ctx.log.error('Storage of did '+stateId+'.'+String(did)+' failed. err='+e.message);
            }
        }

        if (this.opMode == this.opModes[0]) { return; }
        const raw = this.arr2Hex(data);
        let idStr, val, common, cdi, codec;
        if (did in this.storageDids.dids) {
            cdi = this.storageDids.dids[did];     // Infos about did codec
            if (cdi.len == data.length) {
                try {
                    codec = await new E3.O3Ecodecs[cdi.codec](cdi.len, cdi.id, cdi.args);
                } catch(e) {
                    ctx.log.warn('Could not retreive codec for '+ctxWorker.config.stateBase+'.'+String(did)+'. err='+e.message);
                    codec = 'RawCodec';
                }
                idStr = cdi.id;
                common = true;
                try {
                    val = await codec.decode(data);
                }
                catch(e) {
                    val = raw;
                    ctx.log.warn('Codec failed: '+ctxWorker.canIDhex+'.'+String(did)+'. err='+e.message);
                }
            } else {
                idStr = 'DeviceSpecific';
                val = raw;
                common = false;
            }
        } else {
            idStr = 'DeviceSpecific';
            val = raw;
            common = false;
        }
        if (val != null) {
            const didStr = '000'+String(did);
            const stateIdJson = this.config.stateBase+'.json.'+didStr.slice(-4)+'_'+idStr;
            const stateIdTree = this.config.stateBase+'.tree.'+didStr.slice(-4)+'_'+idStr;
            const stateIdRaw = this.config.stateBase+'.raw.'+didStr.slice(-4)+'_'+idStr;
            let didInfo;
            switch (this.opMode) {
                case this.opModes[0]:   // 'standby'
                    break;
                case this.opModes[1]:   // 'udsDevScan'
                    this.udsScanResult = {
                        did: did,
                        didInfo: {
                            id : idStr,
                            len: data.length
                        },
                        val: val,
                        common: common
                    };
                    if (ctxWorker.callback) await ctxWorker.callback(ctx, ctxWorker, ['ok', this.udsScanResult]);
                    break;
                case this.opModes[2]:   // 'udsDidScan'
                    if (common) {
                        didInfo = {
                            id : idStr,
                            len: cdi.len,
                            codec: cdi.codec,
                            args: cdi.args
                        };
                    } else {
                        didInfo = {
                            id : idStr,
                            len: data.length,
                            codec: 'RawCodec',
                            args : {}
                        };
                    }
                    this.udsScanResult = {
                        did: did,
                        didInfo: didInfo,
                        val: val,
                        common: common
                    };
                    if (ctxWorker.callback) await ctxWorker.callback(ctx, ctxWorker, ['ok', this.udsScanResult]);
                    await storeObjectTree(ctx, stateIdTree, val);
                    await storeObjectJson(ctx, stateIdJson, val);
                    await storeObjectJson(ctx, stateIdRaw, raw);
                    await this.storeStatistics(ctx, ctxWorker, false);
                    break;
                case this.opModes[3]:   // 'normal'
                    await storeObjectTree(ctx, stateIdTree, val);
                    await storeObjectJson(ctx, stateIdJson, val);
                    await storeObjectJson(ctx, stateIdRaw, raw);
                    await this.storeStatistics(ctx, ctxWorker, false);
                    break;
                case this.opModes[4]:   // 'TEST'
                    return val;
                default:
                    ctx.log.error('Invalid opMode at class storage. Change to "standby"');
                    this.opMode = this.opModes[0];
            }
        }
    }
}

module.exports = {
    storageDids,
    storage
};