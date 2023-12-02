
const didsDict = require('./didsE3').dids;

class storage {
    constructor(config) {
        this.config = config;
    }
    async initStates(ctx) {
        if (this.config.doJson) {
            await ctx.setObjectNotExistsAsync(this.config.stateBase+'.json', {
                type: 'channel',
                common: {
                    name: this.config.stateBase+' JSON',
                    role: 'device'
                },
                native: {},
            });
        }

        if (this.config.doTree) {
            await ctx.setObjectNotExistsAsync(this.config.stateBase+'.tree', {
                type: 'channel',
                common: {
                    name: this.config.stateBase+' TREE',
                    role: 'device'
                },
                native: {},
            });
        }
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
        const val = didsDict[this.config.device][did].decode(data);
        if (val) {
            const didStr = '000'+String(did);
            const stateIdJson = this.config.stateBase+'.json.'+didStr.slice(-4)+'_'+idStr;
            const stateIdTree = this.config.stateBase+'.tree.'+didStr.slice(-4)+'_'+idStr;
            if (this.config.doTree) { await storeObjectTree(ctx, stateIdTree, val); }
            if (this.config.doJson) { await storeObjectJson(ctx, stateIdJson, val); }
        }
    }

}

module.exports = {
    storage
};