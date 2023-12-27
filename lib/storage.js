
const E3 = require('./codecs');
const E3DidsDict = require('./didsE3.json');
const E380DidsDict = require('./didsE380.json');

class storageDids {
    constructor(config) {
        this.config = config;
        this.didsCommonId    = 'udsDidsCommon';
        this.didsSpecId      = 'udsDidsSpecific';
        this.didsDictCommon  = {};
        this.didsDictDevSpec = {};
    }
    async initStates(ctx, opMode) {
        if (['standby','normal','udsDidScan'].includes(opMode)) {
            if (this.config.device != 'e380') {
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
    async readKnownDids(ctx) {
        if (this.config.device != 'e380') {
            try {
                const baseId = this.config.stateBase+'.info.';
                this.didsDictCommon = JSON.parse((await ctx.getStateAsync(baseId+this.didsCommonId)).val);
                this.didsDictDevSpec = JSON.parse((await ctx.getStateAsync(baseId+this.didsSpecId)).val);
            } catch(e) {
                this.didsDictCommon = {};
                this.didsDictDevSpec = {};
            }
        } else {
            this.didsDictCommon = {};
            this.didsDictDevSpec = {};
        }
    }
    async storeKnownDids(ctx) {
        if (this.config.device != 'e380') {
            const baseId = this.config.stateBase+'.info.';
            await ctx.setStateAsync(baseId+this.didsCommonId, {val: JSON.stringify(this.didsDictCommon), ack: true});
            await ctx.setStateAsync(baseId+this.didsSpecId, {val: JSON.stringify(this.didsDictDevSpec), ack: true});
        }
    }
}

class storage {
    constructor(config) {
        this.config = config;
        this.opModes = ['standby','udsDevScan','udsDidScan','normal'];
        this.opMode = this.opModes[0];
        this.udsScanResult = null;
        this.dids = {};
        if (this.config.device == 'e380') {
            this.dids = E380DidsDict;
        } else {
            this.dids = E3DidsDict[this.config.device];
        }
        this.storageDids   = new storageDids({
            stateBase:this.config.stateBase,
            device:this.config.device
        });
    }
    async initStates(ctx, opMode) {
        await this.setOpMode(opMode);
        if (['standby','normal','udsDidScan'].includes(opMode)) {
            await ctx.setObjectNotExistsAsync(this.config.stateBase+'.info', {
                type: 'channel',
                common: {
                    name: this.config.stateBase+' informations',
                    role: 'device'
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
                    role: 'device'
                },
                native: {},
            });

            await ctx.setObjectNotExistsAsync(this.config.stateBase+'.tree', {
                type: 'channel',
                common: {
                    name: this.config.stateBase+' TREE',
                    role: 'device'
                },
                native: {},
            });

            await ctx.setObjectNotExistsAsync(this.config.stateBase+'.raw', {
                type: 'channel',
                common: {
                    name: this.config.stateBase+' RAW',
                    role: 'device'
                },
                native: {},
            });
            await this.storageDids.readKnownDids(ctx);
        }
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

    async storeStatistics(ctx, ctxWorker) {
        if (['standby','normal','udsDidScan'].includes(await this.getOpMode())) {
            if (ctxWorker.stat) await ctx.setStateAsync(ctxWorker.config.stateBase+'.info.'+this.config.statId, JSON.stringify(ctxWorker.stat), true);
        }
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
                ctx.log.error('Storage of did '+stateId+'.'+String(did)+' failed: '+JSON.stringify(e));
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
                ctx.log.error('Storage of did '+stateId+'.'+String(did)+' failed: '+JSON.stringify(e));
            }
        }

        if (this.opMode == this.opModes[0]) { return; }
        const raw = this.arr2Hex(data);
        let idStr, val, common;
        if (did in this.dids) {
            const cdi = this.dids[did];     // Infos about did codec
            if (cdi.len == data.length) {
                const codec = await new E3.O3Ecodecs[cdi.codec](cdi.len, cdi.id, cdi.args);
                idStr = cdi.id;
                common = true;
                try {
                    val = await codec.decode(data);
                }
                catch(e) {
                    val = raw;
                    ctx.log.warn('Codec failed: '+ctxWorker.canIDhex+'.'+String(did)+': '+JSON.stringify(e));
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
                        'did': did,
                        'didInfo': {
                            'id' : idStr,
                            'len': data.length
                        },
                        'val': val,
                        'common': common
                    };
                    if (ctxWorker.callback) await ctxWorker.callback(ctx, ctxWorker, ['ok', this.udsScanResult]);
                    break;
                case this.opModes[2]:   // 'udsDidScan'
                    if (common) {
                        didInfo = {
                            'id' : idStr,
                            'len': data.length,
                            'codec': this.dids[did].codec
                        };
                    } else {
                        didInfo = {
                            'id' : idStr,
                            'len': data.length,
                            'codec': 'RawCodec',
                            'args' : {}
                        };
                    }
                    this.udsScanResult = {
                        'did': did,
                        'didInfo': didInfo,
                        'val': val,
                        'common': common
                    };
                    if (ctxWorker.callback) await ctxWorker.callback(ctx, ctxWorker, ['ok', this.udsScanResult]);
                    await storeObjectTree(ctx, stateIdTree, val);
                    await storeObjectJson(ctx, stateIdJson, val);
                    await storeObjectJson(ctx, stateIdRaw, raw);
                    await this.storeStatistics(ctx, ctxWorker);
                    break;
                case this.opModes[3]:   // 'normal'
                    await storeObjectTree(ctx, stateIdTree, val);
                    await storeObjectJson(ctx, stateIdJson, val);
                    await storeObjectJson(ctx, stateIdRaw, raw);
                    await this.storeStatistics(ctx, ctxWorker);
                    break;
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