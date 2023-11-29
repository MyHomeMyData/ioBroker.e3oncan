
//const codecs = require('./codecs');
const didsDict = require('./didsE3').dids;

class collect {
    constructor(canID, stateBase, device, delay, doTree, doJson) {
        this.canID = canID;
        this.stateBase = stateBase;
        this.device = device;
        this.delay = delay;     // Minumum time delay (s) for evaluation of specific did
        this.doTree = doTree;
        this.doJson = doJson;
        this.ts = {};
        this.dids = null;
        this.didwatch = 7777;
        this.data = {
            'len'       : 0,
            'timestamp' : 0,
            'databytes' : [],
            'did'       : 0,
            'collecting': false,
            'D0'        : 0x21
        };
    }
    async initStates(ctx) {
        if (this.doJson) {
            await ctx.setObjectNotExistsAsync(this.stateBase+'.json', {
                type: 'channel',
                common: {
                    name: this.stateBase+' JSON',
                    role: 'device'
                },
                native: {},
            });
        }

        if (this.doTree) {
            await ctx.setObjectNotExistsAsync(this.stateBase+'.tree', {
                type: 'channel',
                common: {
                    name: this.stateBase+' TREE',
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
            await ctx.setStateAsync(stateId, JSON.stringify(obj), true);
        }
        async function storeObjectTree(ctx, stateId, obj) {
            if (typeof(obj) == 'object') {
                for (const key in Object.keys(obj)) {
                    const itm = obj[Object.keys(obj)[key]];
                    storeObjectTree(ctx, String(stateId)+'.'+String(Object.keys(obj)[key]),itm);
                }
            } else {
                storeObjectJson(ctx, stateId, obj);
            }
        }
        const idStr = didsDict[this.device][did].id;
        const val = didsDict[this.device][did].decode(data);
        const didStr = '000'+String(did);
        const stateIdJson = this.stateBase+'.json.'+didStr.slice(-4)+'_'+idStr;
        const stateIdTree = this.stateBase+'.tree.'+didStr.slice(-4)+'_'+idStr;
        if (this.doTree) { storeObjectTree(ctx, stateIdTree, val); }
        if (this.doJson) { storeObjectJson(ctx, stateIdJson, val); }
    }

    async msgCollect(ctx, msg) {
        const candata = msg.data.toJSON().data;
        const canid = msg.id;
        const tsNow = new Date().getTime();

        if (this.device == 'e380') {
            if (!(canid in this.ts)) { this.ts[canid] = 0; }
            if ( (this.delay > 0) && ((tsNow-this.ts[canid]) < this.delay*1000) ) { return; }
            this.decodeDataCAN(ctx,msg.id,candata);
            this.ts[canid] = tsNow;
        } else {
            //ctx.log.debug(JSON.stringify(candata));
            if (this.data.collecting) {
                this.data.D0 += 1;
                if (this.data.D0 > 0x2f) {
                    this.data.D0 = 0x20;
                }
                if (candata[0] == this.data.D0) {
                    // append next part of data
                    this.data.databytes = this.data.databytes.concat(candata.slice(1));
                    if (this.data.did == this.didwatch) { ctx.log.debug('D0='+String(this.data.D0)+'; candata='+JSON.stringify(this.data.databytes)); }
                } else {
                    // no more data
                    if ((this.dids == null) || (this.data.did in this.dids) ) {
                        if (this.data.did == this.didwatch) {
                            ctx.log.debug(JSON.stringify(this.data));
                        }
                        this.data.collecting = false;
                        this.decodeDataCAN(ctx, this.data.did, this.data.databytes.slice(0,this.data.len));
                        this.ts[this.data.did] = tsNow;
                    }
                }
            }

            if ( (!this.data.collecting) && (candata.length > 4) && (candata[0] == 0x21) && (candata[3] >= 0xb0) && (candata[3] < 0xc0)) {
                this.data.D0 = candata[0];
                const D3 = candata[3];
                if (D3 == 0xb0) {
                    this.data.len = candata[4];
                    if (candata[5]==0xb5) {
                        this.data.databytes = candata.slice(6);
                    } else {
                        this.data.databytes = candata.slice(5);
                    }
                } else {
                    this.data.len = D3-0xb0;
                    this.data.databytes = candata.slice(4);
                }
                this.data.did = candata[1]+256*candata[2];
                if (this.data.did == this.didwatch) {
                    ctx.log.debug('Start did '+String(this.didwatch));
                    ctx.log.debug(JSON.stringify(this.data));
                }
                if ( (this.data.did > 0) && (this.data.did < 10000) ) {
                    if (!(this.data.did in this.ts)) { this.ts[this.data.did] = 0; }
                    if ( (this.delay > 0) && ((tsNow-this.ts[this.data.did]) < this.delay*1000) ) { return; }
                    this.data.timestamp = msg.ts_sec*1000+Math.round(msg.ts_usec/1000);
                    this.data.collecting = true;
                }
            }
        }
    }
}

module.exports = {
    collect
};