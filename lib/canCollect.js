const storage = require('./storage');

class collect {
    constructor(config) {
        this.config = config;
        this.config.statId = 'statCollect';
        this.config.worker = 'collect';
        this.storage = new storage.storage(this.config);
        this.ts = {};
        this.msDelay = config.delay*1000;
        this.timeoutHandle = null;
        this.maxDid  = 3500;
        this.commBusy = false;         // Communication routine running
        this.data = {
            'len'       : 0,
            'timestamp' : 0,
            'databytes' : [],
            'did'       : 0,
            'collecting': false,
            'D0expected': 0x21
        };
        this.stat = {
            state               : 'standby',
            cntCommTotal        : 0,    // Number collected dids
            cntCommOk           : 0,    // Number of ok
            cntCommStored       : 0,    // Number of dids stored
            cntCommTimeout      : 0,    // Number of timeouts
            cntCommBadProt      : 0,    // Number of bad communications
            cntTooBusy          : 0,    // Number of conflicting calls of msgCollect()
        };
    }

    async initStates(ctx, opMode) {
        await this.storage.initStates(ctx, opMode);
        this.stat.state = 'standby';
        await this.storage.storeStatistics(ctx, this);
    }

    async onTimeout(ctxGlobal, ctxLocal) {
        ctxGlobal.log.error('Collect timeout on 0x'+Number(ctxLocal.config.canID[0]).toString(16)+'.'+String(ctxLocal.data.did));
        ctxLocal.stat.cntCommTimeout += 1;
        ctxLocal.data.collecting = false;
    }

    async startup(ctx) {
        this.stat.state = 'active';
        await this.storage.storeStatistics(ctx, this);
        this.data.collecting = false;
        await this.storage.setOpMode('normal');
        await ctx.log.info('Collect worker started on '+this.config.stateBase);
    }

    async stop(ctx) {
        try {
            if (this.stat.state == 'stopped') return;

            await this.storage.setOpMode('standby');

            // Stop Timeout:
            if (this.timeoutHandle) await clearTimeout(this.timeoutHandle);
            this.timeoutHandle = null;

            this.stat.state = 'stopped';
            await this.storage.storeStatistics(ctx, this);

            // Stop worker:
            this.data.collecting = false;
            await ctx.log.info('Collect worker stopped on '+this.config.stateBase);
        } catch (e) {
            await ctx.log.warn('Collect worker stop could not be completed on '+this.config.stateBase+'. err='+e.message);
        }
    }

    sleep(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    async msgCollect(ctx, msg) {

        if (await this.storage.getOpMode() == 'standby') return;    // No communication in mode 'standby'

        if (this.commBusy) {
            this.stat.cntTooBusy += 1;
            if (this.stat.cntTooBusy == 1) ctx.log.warn('Collect worker error on '+this.config.stateBase+': Evaluation of messages overloaded on.');
            return;
        }

        this.commBusy = true;
        const candata = msg.data.toJSON().data;

        const canid = msg.id;
        const msgDlc = candata.length;
        const tsNow = new Date().getTime();
        if (this.config.device == 'e380') {
            // Energy meter
            this.stat.cntCommTotal += 1;
            this.stat.cntCommOk += 1;
            if (!(canid in this.ts)) { this.ts[canid] = tsNow; }
            if ( (this.config.delay == 0) || ((tsNow >= this.ts[canid])) ) {
                this.stat.cntCommStored += 1;
                this.storage.decodeDataCAN(ctx,this,msg.id,candata);
                this.ts[canid] = tsNow+this.msDelay;
            }
        } else {
            // E3 device
            if (this.data.collecting) {
                if (candata[0] == this.data.D0expected) {
                    // append next part of data
                    this.data.databytes = this.data.databytes.concat(candata.slice(1));
                    if (this.data.databytes.length >= this.data.len) {
                        // All data received
                        if (this.timeoutHandle) await clearTimeout(this.timeoutHandle);
                        this.stat.cntCommOk += 1;
                        if (!(this.data.did in this.ts)) { this.ts[this.data.did] = tsNow; }
                        if ( (this.config.delay == 0) || ((tsNow >= this.ts[this.data.did])) ) {
                            this.stat.cntCommStored += 1;
                            this.storage.decodeDataCAN(ctx, this, this.data.did, this.data.databytes.slice(0,this.data.len));
                            this.ts[this.data.did] = tsNow+this.msDelay;
                        }
                        this.data.collecting = false;
                    } else {
                        // More data to come
                        this.data.D0expected += 1;
                        if (this.data.D0expected > 0x2f) {
                            this.data.D0expected = 0x20;
                        }
                    }
                }
            }

            const D3 = candata[3];
            if ( (!this.data.collecting) && (msgDlc > 4) && (candata[0] == 0x21) && (D3 >= 0xb0) && (D3 < 0xc0)) {
                this.data.D0expected = candata[0];
                this.data.did = candata[1]+256*candata[2];
                this.data.timestamp = msg.ts_sec*1000+Math.round(msg.ts_usec/1000);
                if ( (this.data.did > 0) && (this.data.did < this.maxDid) ) {
                    switch (D3) {
                        case 0xb1:
                        case 0xb2:
                        case 0xb3:
                        case 0xb4:
                            // Single Frame B1,B2,B3,B4
                            this.data.len = D3-0xb0;
                            this.data.databytes = candata.slice(4);
                            this.stat.cntCommTotal += 1;
                            this.stat.cntCommOk += 1;
                            if (!(this.data.did in this.ts)) { this.ts[this.data.did] = tsNow; }
                            if ( (this.config.delay == 0) || ((tsNow >= this.ts[this.data.did])) ) {
                                this.stat.cntCommStored += 1;
                                this.storage.decodeDataCAN(ctx, this, this.data.did, this.data.databytes.slice(0,this.data.len));
                                this.ts[this.data.did] = tsNow+this.msDelay;
                            }
                            break;
                        case 0xb0:
                            // Multi Frame B0
                            this.data.D0expected = candata[0]+1;
                            this.stat.cntCommTotal += 1;
                            if (candata[4]==0xc1) {
                                this.data.databytes = candata.slice(6);
                                this.data.len = candata[5];
                            } else {
                                this.data.databytes = candata.slice(5);
                                this.data.len = candata[4];
                            }
                            this.timeoutHandle = setTimeout(this.onTimeout, this.config.timeout, ctx, this);
                            this.data.collecting = true;
                            break;
                        case 0xb5:
                        case 0xb6:
                        case 0xb7:
                        case 0xb8:
                        case 0xb9:
                        case 0xba:
                        case 0xbb:
                        case 0xbc:
                        case 0xbd:
                        case 0xbe:
                        case 0xbf:
                            // Multi Frame B6 .. BF
                            this.stat.cntCommTotal += 1;
                            this.data.D0expected = candata[0]+1;
                            this.data.databytes = candata.slice(4);
                            this.data.len = D3-0xb0;
                            this.timeoutHandle = setTimeout(this.onTimeout, this.config.timeout, ctx, this);
                            this.data.collecting = true;
                            break;
                        default:
                            ctx.log.debug('Collect worker error on '+this.config.stateBase+': Unplausible byte D3: Did='+String(this.data.did)+' D3=0x'+Number(D3).toString(16)+' candata='+this.storage.arr2Hex(candata));
                    }
                }
            }
        }
        this.commBusy = false;
    }
}

module.exports = {
    collect
};