
const storageCol = require('./storage');

class uds {
    constructor(config) {
        this.config = config;
        this.storage = new storageCol.storage(this.config);
        this.states = ['standby','waitForFF','waitForCF'];
        this.frameFC = [0x30,0x00,0x00,0x00,0x00,0x00,0x00,0x00];
        this.readByDidProt = {
            'idTx'  : this.config.canID,
            'idRx'  : Number(this.config.canID) + 0x10,
            'PCI'   : 0x03,     // Protocol Control Information
            'SIDtx' : 0x22,     // Service ID transmit
            'SIDrx' : 0x62,     // Service ID receive
            'SIDnr' : 0x7F,     // SID negative response
            'FC'    : [0x30,0x00,0x00,0x00,0x00,0x00,0x00,0x00], // Flow Control frame
        };
        this.data = {
            'len'       : 0,
            'timestamp' : 0,
            'databytes' : [],
            'did'       : 0,
            'state'     : this.states[0],
            'D0'        : 0x21
        };
        this.cmndQueueId = 'uds.0x'+Number(this.config.canID).toString(16)+'.cmndQueue';
    }

    async initStates(ctx) {
        await this.storage.initStates(ctx);
        await ctx.setObjectNotExistsAsync(this.cmndQueueId, {
            type: 'state',
            common: {
                name: 'Command queue for UDS communication',
                type: 'json',
                role: 'state',
                read: true,
                write: true,
            },
            native: {},
        });
        await ctx.setStateAsync(this.cmndQueueId, JSON.stringify([]), true);
    }

    pushCmnd(ctx, mode, dids) {
        const cmnds = JSON.parse(ctx.getState(this.cmndQueueId).val);
        cmnds.push({'mode':mode, 'dids': dids});
        ctx.setState(JSON.stringify(cmnds), true);
    }

    initialRequestSF(did) {
        return [this.readByDidProt.PCI, this.readByDidProt.SIDtx,((did >> 8) & 0xFF),(did & 0xFF),0x00,0x00,0x00,0x00];
    }

    canMessage(canID, frame) {
        return { id: canID,ext: false, rtr: false,data: Buffer.from(frame) };
    }

    async sendFrame(frame) {
        await this.config.channel.send(this.canMessage(this.config.canID,frame));
    }

    async readByDid(ctx, did) {
        this.data.state = this.states[1];   // 'waitForFF'
        this.data.did = did;
        await this.sendFrame(this.initialRequestSF(did));
    }

    async msgUds(ctx, msg) {
        const candata = msg.data.toJSON().data;
        const canid = msg.id;

        //ctx.log.debug('msgUds: '+String(canid)+' '+JSON.stringify(candata));

        switch (this.data.state) {
            case 'waitForFF':
                if ( (candata[0] == 0x03) && (candata[1] == 0x7F) && (candata[2] == this.readByDidProt.SIDtx) ) {
                    // Negative response
                    this.data.state = this.states[0];
                    ctx.log.error('msgUds(): Negative response. Code=0x'+Number(candata[3]).toString(16));
                    break;
                }
                if ( (candata.length == 8) && ((candata[0] >> 4) == 0) && (candata[1] == this.readByDidProt.SIDrx) ) {
                    // Single-frame communication
                    const didRx = candata[3]+256*candata[2];
                    if (didRx == this.data.did) {
                        // Did does match
                        this.data.len = candata[0]-3;
                        this.data.databytes = candata.slice(4,4+this.data.len);
                        await this.storage.decodeDataCAN(ctx, this.data.did, this.data.databytes.slice(0,this.data.len));
                        this.data.state = this.states[0];       // 'standby'
                        break;
                    } else {
                        // Did does not match
                        this.data.state = this.states[0];       // 'standby'
                        ctx.log.error('msgUds(): Did mismatch');
                        break;
                    }
                }
                if ( (candata.length == 8) && ((candata[0] >> 4) == 1) && (candata[2] == this.readByDidProt.SIDrx) ) {
                    // Multiframe communication
                    ctx.log.debug('msgUds FF: '+String(canid)+' '+JSON.stringify(candata));
                    const didRx = candata[4]+256*candata[3];
                    if (didRx == this.data.did) {
                        // Did does match
                        this.data.len = (candata[0] & 0x0F)*256 + candata[1] - 3;
                        ctx.log.debug('msgUds FF: data.len='+String(this.data.len));
                        this.data.databytes = candata.slice(5,4+this.data.len);
                        this.data.D0 = 0x21;
                        await this.sendFrame(this.frameFC); // Send request for Consecutive Frames
                        this.data.state = this.states[2];   // 'waitForCF'
                        break;
                    } else {
                        // Did does not match
                        this.data.state = this.states[0];
                        ctx.log.error('msgUds(): Did mismatch. Expected='+String(this.data.did)+'; Received='+String(didRx));
                        break;
                    }
                }
                ctx.log.error('msgUds(): Bad frame: '+JSON.stringify(candata));
                this.data.state = this.states[0];       // 'standby'
                break;

            case 'waitForCF':
                if ( (candata.length == 8) && (candata[0] == this.data.D0) ) {
                    // Correct code for Consecutive Frame
                    ctx.log.debug('msgUds CF: '+String(canid)+' '+JSON.stringify(candata));
                    this.data.databytes = this.data.databytes.concat(candata.slice(1));
                    if (this.data.databytes.length >= this.data.len) {
                        // All data received
                        this.storage.decodeDataCAN(ctx, this.data.did, this.data.databytes.slice(0,this.data.len));
                    } else {
                        // More data to come
                        this.data.D0 += 1;
                        if (this.data.D0 > 0x2F) {
                            this.data.D0 = 0x20;
                        }
                    }
                }
                break;

            default:
                ctx.log.error('msgUds(): Bad state value');
                this.data.state = this.states[0];
        }
    }
}

module.exports = {
    uds
};