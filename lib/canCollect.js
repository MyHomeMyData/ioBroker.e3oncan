//const codecs = require('./codecs');
const didsDict = require('./didsE3').dids;

class collect {
    constructor(canID, stateBase, device) {
        this.canID = canID;
        this.stateBase = stateBase;
        this.device = device;
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
        await ctx.setObjectNotExistsAsync(this.stateBase+'.json', {
            type: 'channel',
            common: {
                name: this.stateBase+' JSON',
                role: 'device'
            },
            native: {},
        });

        await ctx.setObjectNotExistsAsync(this.stateBase+'.tree', {
            type: 'channel',
            common: {
                name: this.stateBase+' TREE',
                role: 'device'
            },
            native: {},
        });
    }
    async decodeDataCAN(ctx, did, data) {
        async function storeObject(ctx, stateId, obj) {
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
        async function objDump(ctx, stateId, obj) {
            if (typeof(obj) == 'object') {
                for (const key in Object.keys(obj)) {
                    const itm = obj[Object.keys(obj)[key]];
                    objDump(ctx, String(stateId)+'.'+String(Object.keys(obj)[key]),itm);
                }
            } else {
                storeObject(ctx, stateId, obj);
            }
        }
        const idStr = didsDict[this.device][did].id;
        const val = didsDict[this.device][did].decode(data);
        const didStr = '000'+String(did);
        const stateIdJson = this.stateBase+'.json.'+didStr.slice(-4)+'_'+idStr;
        const stateIdTree = this.stateBase+'.tree.'+didStr.slice(-4)+'_'+idStr;
        objDump(ctx, stateIdTree, val);
        storeObject(ctx, stateIdJson, val);
    }

    async msgCollect(ctx, msg) {
        const candata = msg.data.toJSON().data;
        //console.log(canID);
        if (this.device == 'e380') {
            this.decodeDataCAN(ctx,msg.id,candata);
        } else {
            //console.log(candata);
            if (this.data.collecting) {
                this.data.D0 += 1;
                if (this.data.D0 > 0x2f) {
                    this.data.D0 = 0x20;
                }
                if (candata[0] == this.data.D0) {
                    // append next part of data
                    this.data.databytes = this.data.databytes.concat(candata.slice(1));
                    if (this.data.did == this.didwatch) { console.log('D0='+String(this.data.D0)+'; candata='+JSON.stringify(this.data.databytes)); }
                } else {
                    // no more data
                    if ((this.dids == null) || (this.data.did in this.dids) ) {
                        if (this.data.did == this.didwatch) {
                            console.log(this.data);
                        }
                        this.data.collecting = false;
                        this.decodeDataCAN(ctx, this.data.did, this.data.databytes.slice(0,this.data.len));
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
                    console.log('Start did '+String(this.didwatch));
                    console.log(this.data);
                }
                if ( (this.data.did > 0) && (this.data.did < 10000) ) {
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