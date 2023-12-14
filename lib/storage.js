
const didsDict = require('./didsE3').dids;

class storage {
    constructor(config) {
        this.config = config;
        this.opModes = ['standby','udsDevScan','udsDidScan','normal'];
        this.opMode = this.opModes[0];
        this.udsScanResult = null;
    }
    async initStates(ctx) {
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

    async storeKnownDids(ctx, dids) {
        const stateId = this.config.stateBase+'.dids';
        await ctx.setObjectNotExistsAsync(stateId, {
            type: 'state',
            common: {
                name: 'Available dids on this device',
                type: 'json',
                role: 'state',
                read: true,
                write: true,
            },
            native: {},
        });
        await ctx.setStateAsync(stateId, JSON.stringify(dids), true);
    }

    async decodeDataCAN(ctx, did, data) {
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
                ctx.log.error('UDS storage of did @'+stateId+'.'+String(did)+' failed: '+JSON.stringify(e));
            }
        }
        async function storeObjectTree(ctx, stateId, obj) {
            if (typeof(obj) == 'object') {
                if (Object.keys(obj).length <= 100) {
                    for (const [key, itm] of Object.entries(obj)) {
                        await storeObjectTree(ctx, String(stateId)+'.'+String(key),itm);
                    }
                } else {
                    ctx.log.error('UDS did valuation aborted. Too many members ('+String(Object.keys(obj).length)+') '+stateId+'.'+String(did));
                }
            } else {
                await storeObjectJson(ctx, stateId, obj);
            }
        }
        if (this.opMode == this.opModes[0]) { return; }
        const raw = this.arr2Hex(data);
        let idStr, val;
        if (did in didsDict[this.config.device]) {
            idStr = didsDict[this.config.device][did].id;
            try {
                val = didsDict[this.config.device][did].decode(data);
            }
            catch(e) {
                val = raw;
                ctx.log.warn('UDS codec failed: '+this.config.canIDhex+'.'+String(did));
            }

        } else {
            idStr = 'unkown';
            val = raw;
        }
        if (val) {
            const didStr = '000'+String(did);
            const stateIdJson = this.config.stateBase+'.json.'+didStr.slice(-4)+'_'+idStr;
            const stateIdTree = this.config.stateBase+'.tree.'+didStr.slice(-4)+'_'+idStr;
            const stateIdRaw = this.config.stateBase+'.raw.'+didStr.slice(-4)+'_'+idStr;
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
                        'val': val
                    };
                    break;
                case this.opModes[2]:   // 'udsDidScan'
                    this.udsScanResult = {
                        'did': did,
                        'didInfo': {
                            'id' : idStr,
                            'len': data.length
                        },
                        'val': val
                    };
                    await storeObjectTree(ctx, stateIdTree, val);
                    await storeObjectJson(ctx, stateIdJson, val);
                    await storeObjectJson(ctx, stateIdRaw, raw);
                    break;
                case this.opModes[3]:   // 'normal'
                    await storeObjectTree(ctx, stateIdTree, val);
                    await storeObjectJson(ctx, stateIdJson, val);
                    await storeObjectJson(ctx, stateIdRaw, raw);
                    break;
                default:
                    ctx.log.error('Invalid opMode at class storage. Change to "standby"');
                    this.opMode = this.opModes[0];
            }
        }
    }
}

module.exports = {
    storage
};