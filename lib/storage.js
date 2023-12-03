
const didsDict = require('./didsE3').dids;

class storage {
    constructor(config) {
        this.config = config;
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

    async decodeDataCAN(ctx, did, data) {
        async function storeObjectJson(ctx, stateId, obj) {
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
        async function storeObjectTree(ctx, stateId, obj) {
            if (typeof(obj) == 'object') {
                if (Object.keys(obj).length <= 100) {
                    for (const [key, itm] of Object.entries(obj)) {
                        await storeObjectTree(ctx, String(stateId)+'.'+String(key),itm);
                    }
                } else {
                    ctx.log.error('Evaluation aborted. Too many members ('+String(Object.keys(obj).length)+') for Did '+stateId);
                }
            } else {
                await storeObjectJson(ctx, stateId, obj);
            }
        }
        const idStr = didsDict[this.config.device][did].id;
        const raw = this.arr2Hex(data);
        const val = didsDict[this.config.device][did].decode(data);
        if (val) {
            const didStr = '000'+String(did);
            const stateIdJson = this.config.stateBase+'.json.'+didStr.slice(-4)+'_'+idStr;
            const stateIdTree = this.config.stateBase+'.tree.'+didStr.slice(-4)+'_'+idStr;
            const stateIdRaw = this.config.stateBase+'.raw.'+didStr.slice(-4)+'_'+idStr;
            await storeObjectTree(ctx, stateIdTree, val);
            await storeObjectJson(ctx, stateIdJson, val);
            await storeObjectJson(ctx, stateIdRaw, raw);
        }
    }

}

module.exports = {
    storage
};