class codecOpMode {
    constructor(raw=true) {
        this.raw = raw;
    }

    setOpMode(raw) {
        this.raw = raw;
    }
    getOpMode() {
        return this.raw;
    }
}

const rawmode = new codecOpMode(true);

const enums = require('./enums');

function arr2Hex(arr) {
    // Convert byte array to hex string
    let hs = '';
    for (const v in arr) { hs += toHex(arr[v],2); }
    return hs;
}

function toHex(d, len) {
    // Convert integer to hex string of length len
    return  (('00000000'+(Number(d).toString(16))).slice(-len));
}

function toByteArray(hs) {
    // Convert hex string, e.g. '21A8' to byte array: [33,168]
    const ba = [];
    for (let i=0; i<hs.length/2; i++) {
        ba.push(parseInt(hs.slice(2*i,2*i+2), 16));
    }
    return ba;
}

function uint08toVal(j, ofs=0) {
    return j[ofs];
}

function sint08toVal(j, ofs=0) {
    return (j[ofs]<128 ? j[ofs] : j[ofs]-256);
}

function uint16toVal(j, ofs=0) {
    return Math.pow(2,8)*j[ofs+1]+j[ofs];
}

function sint16toVal(j, ofs=0) {
    let v = Math.pow(2,8)*j[ofs+1]+j[ofs];
    if (v >= Math.pow(2,15)) { v -= Math.pow(2,16); }
    return v;
}

function uint32toVal(j, ofs=0) {
    return Math.pow(2,24)*j[ofs+3]+Math.pow(2,16)*j[ofs+2]+Math.pow(2,8)*j[ofs+1]+j[ofs];
}

function sint32toVal(j, ofs=0) {
    let v = Math.pow(2,24)*j[ofs+3]+Math.pow(2,16)*j[ofs+2]+Math.pow(2,8)*j[ofs+1]+j[ofs];
    if (v >= Math.pow(2,31)) { v -= Math.pow(2,32); }
    return v;
}

function int2val(j, ofs = 0, signed = false) {
    // Convert byte array to int08, int16, int32. Signed or unsigned.
    switch (j.length) {
        case 1 :
            return (signed ? sint08toVal(j,ofs) : uint08toVal(j,ofs) );
        case 2 :
            return (signed ? sint16toVal(j,ofs) : uint16toVal(j,ofs) );
        case 4 :
            return (signed ? sint32toVal(j,ofs) : uint32toVal(j,ofs) );
        default:
            return null;
    }
}

function val2byteArr(v, byte_width, scale = 1, signed = false) {
    // Convert int08, int16, int32 to byte array. Signed or unsigned.
    let val = Math.round(eval(v) * scale);
    if ( (signed) && (val < 0) ) { val += Math.pow(2,8*byte_width); }
    const string_bin = toByteArray(toHex(val, byte_width*2));
    return string_bin.reverse();
}

function RawEncode(data, len) {
    const string_bin = toByteArray(data);
    if (string_bin.length !== len) {
        throw new Error(`String must be ${len} long`);
    }
    return string_bin;
}

function RawDecode(string_bin) {
    return arr2Hex(string_bin);
}

class O3ERawCodec {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    encode(data) {
        return RawEncode(data, this.string_len);
    }
    decode(string_bin) {
        return RawDecode(string_bin);
    }
    __len__() {
        return this.string_len;
    }
}

class O3EInt {
    constructor(string_len, idStr, byte_width, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.byte_width = byte_width;
        this.scale = _args.scale;
        this.offset = _args.offset;
        this.signed = _args.signed;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        } else {
            if (this.offset != 0) {
                throw new Error('O3EInt.encode(): offset!=0 not implemented yet');
            }
            return val2byteArr(data, this.byte_width, this.scale, this.signed);
        }
    }

    decode(data) {
        if (rawmode.getOpMode()) {
            return RawDecode(data);
        }
        return int2val(data.slice(this.offset,this.offset+this.byte_width), 0, this.signed) / this.scale;
    }

    __len__() {
        return this.string_len;
    }
}

// Named parameters in Javascript: https://masteringjs.io/tutorials/fundamentals/parameters
// function (parg1, parg2, { narg1 = 1, narg2 = 2, narg3 = 3 } = {} ) {}

class O3EInt8 extends O3EInt {
    constructor(string_len, idStr, _args) {
        super(string_len, idStr, 1, _args);
    }
}

class O3EInt16 extends O3EInt {
    constructor(string_len, idStr, _args) {
        super(string_len, idStr, 2, _args);
    }
}

class O3EInt32 extends O3EInt {
    constructor(string_len, idStr, _args) {
        super(string_len, idStr, 4, _args);
    }
}

class O3EByteVal {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.offset = _args.offset;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        } else {
            if (this.offset != 0) {
                throw new Error('O3EByteVal.encode(): offset!=0 not implemented yet');
            }
            return val2byteArr(data, this.string_len, 1, false);
        }
    }

    decode(string_bin) {
        if (rawmode.getOpMode()) {
            return RawDecode(string_bin);
        }
        let val = 0;
        for (let i = 0; i < this.string_len; i++) {
            val += string_bin[i + this.offset] << (i * 8);
        }
        return val;
    }

    __len__() {
        return this.string_len;
    }
}

class  O3EBool {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.offset = _args.offset;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        }
        return (data == 'off' ? 0 : 1);
        //throw new Error('O3EBool.encode(): not implemented yet');
    }

    decode(string_bin) {
        if (rawmode.getOpMode()) {
            return RawDecode(string_bin);
        }
        const val = string_bin[this.offset];
        return (val == 0 ? 'off' : 'on' );
    }

    __len__() {
        return this.string_len;
    }
}

class O3EUtf8 {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.offset = _args.offset;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        }
        const encoder = new TextEncoder();
        const result = Object.values(encoder.encode(data));
        if (result.length > this.string_len) throw new Error('O3EUtf8.encode() result too long: '+this.id+' - '+String(result.length)+' > '+String(this.string_len));
        return result.concat(Array.from(Array(this.string_len-result.length), () => 0));

    }
    decode(string_bin) {
        if (rawmode.getOpMode()) {
            return RawDecode(string_bin);
        }
        let mystr = '';
        for (let i=this.offset; i<this.offset+this.string_len;i++) { mystr += String.fromCharCode(string_bin[i]); }
        // eslint-disable-next-line no-control-regex
        return mystr.replace(/[\u0000-\u0008,\u000A-\u001F,\u007F-\u00A0]+/g, '');
    }

    __len__() {
        return this.string_len;
    }
}

class O3ESoftVers {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        }
        let result = [];
        const arr = data.split('.');
        for (const v of Object.values(arr)) result = result.concat(val2byteArr(v,2,1,false));
        if (result.length > this.string_len) throw new Error('O3ESoftVers.encode() result too long: '+this.id+' - '+String(result.length)+' > '+String(this.string_len));
        return result.concat(Array.from(Array(this.string_len-result.length), () => 0));
    }
    decode(string_bin) {
        if (rawmode.getOpMode()) {
            return RawDecode(string_bin);
        }
        const lstv = [];
        for (let i = 0; i < this.string_len; i += 2) {
            lstv.push(string_bin[i] + (string_bin[i+1] << 8));
        }
        return lstv.join('.');
    }
    __len__() {
        return this.string_len;
    }
}

class O3EMacAddr {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        }
        return(data.split('-').map(function(str) {return parseInt('0x'+str);}));

    }
    decode(string_bin) {
        if (rawmode.getOpMode()) {
            return RawDecode(string_bin);
        }
        const lstv = [];
        for (let i = 0; i < this.string_len; i++) {
            lstv.push(toHex(string_bin[i],2).toUpperCase());
        }
        return lstv.join('-');
    }
    __len__() {
        return this.string_len;
    }
}

class O3EIp4Addr {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        }
        return(data.split('.').map(function(str) {return parseInt(str);}));

    }
    decode(string_bin) {
        if (rawmode.getOpMode()) {
            return RawDecode(string_bin);
        }
        const lstv = [];
        for (let i = 0; i < this.string_len; i++) {
            lstv.push(string_bin[i].toString().padStart(3,'0'));
        }
        return lstv.join('.');
    }
    __len__() {
        return this.string_len;
    }
}

class O3ESdate {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        }
        const dt = new Date(data);
        if (!dt) throw new Error('could not convert date value');
        return [dt.getDate(),dt.getMonth()+1,dt.getFullYear()%100];

    }
    decode(string_bin) {
        if (rawmode.getOpMode()) {
            return RawDecode(string_bin);
        }
        const dt = new Date(
            string_bin[2]+2000,     // year
            string_bin[1]-1,        // month
            string_bin[0]           // day
        );
        return dt.toDateString();
    }
    __len__() {
        return this.string_len;
    }
}

class O3EStime {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        }
        if (this.string_len == 1) data += ':00';        // Date() needs at least hour:minute
        const now = new Date();
        const dt = new Date(now.toDateString()+' '+data);
        if (!dt) throw new Error('could not convert time value');
        const retVal = [dt.getHours(),dt.getMinutes(),dt.getSeconds()];
        return retVal.slice(0,this.string_len);

    }
    decode(string_bin) {
        if (rawmode.getOpMode()) {
            return RawDecode(string_bin);
        }
        const now = new Date();
        const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
            string_bin[0],                                     // hour
            ((this.string_len >= 2) ? string_bin[1] : 0),      // minute
            ((this.string_len >= 3) ? string_bin[2] : 0)       // second
        );
        return dt.toLocaleTimeString();
    }
    __len__() {
        return this.string_len;
    }
}

class O3EDateTime {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.timeformat = _args.timeformat;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        }
        if (this.timeformat == 'VM') {
            const dt = new Date(data.Timestamp);
            const fill = 0x05;  // Unknown byte between date and time. Known values are 0x05 and 0x06
            return([Math.floor(dt.getFullYear()/100),dt.getFullYear()%100,dt.getMonth()+1,dt.getDate(),fill,
                dt.getHours(),dt.getMinutes(),dt.getSeconds()]);
        } else {
            return(val2byteArr(data.Timestamp,this.string_len,0.001,false));
        }

    }
    decode(string_bin) {
        if (rawmode.getOpMode()) {
            return RawDecode(string_bin);
        }
        let dt = new Date();
        if (this.timeformat == 'VM') {
            dt = new Date(
                string_bin[0]*100+string_bin[1], // year
                string_bin[2]-1,                 // month
                string_bin[3],                   // day
                string_bin[5],                   // hour
                string_bin[6],                   // minute
                string_bin[7]                    // second
            );
        }
        if (this.timeformat == 'ts') {
            dt = new Date(uint32toVal(string_bin.slice(0,4),0)*1000);
        }
        return { 'DateTime': dt.toLocaleString(),
            'Timestamp': Math.round(dt.getTime())
        };
    }
    __len__() {
        return this.string_len;
    }
}

class O3EUtc {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        }
        const dt = new Date(data);
        if (!dt) throw new Error('could not convert Utc date value');
        return val2byteArr(dt.getTime(),this.string_len,0.001,false);

    }
    decode(string_bin) {
        if (rawmode.getOpMode()) {
            return RawDecode(string_bin);
        }
        const dt = new Date(uint32toVal(string_bin.slice(0,4),0)*1000);
        return dt.toUTCString();
    }
    __len__() {
        return this.string_len;
    }
}

class O3EEnum {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.listStr = _args.listStr;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        }
        return val2byteArr(data.ID, this.string_len, 1, false);

    }
    decode(string_bin) {
        if (rawmode.getOpMode()) {
            return RawDecode(string_bin);
        }
        const val = int2val(string_bin);
        let txt = '';
        if ( (this.listStr in enums.enums) && (String(val) in enums.enums[this.listStr]) ) {
            txt = enums.enums[this.listStr][String(val)];
        } else {
            txt = 'Enum not found in ' + this.listStr;
        }
        return {'ID': val,
            'Text': txt };
    }
    __len__() {
        return this.string_len;
    }
}

class O3EList {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.subTypes = _args.subTypes;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        }
        let result = [];
        for (const cdi of Object.values(this.subTypes)) {
            const subT = new O3Ecodecs[cdi.codec](cdi.len, cdi.id, cdi.args);

            if (cdi.args.subTypes) {
                for (const dataElement of Object.values(data[cdi.id])) {
                    result = result.concat(subT.encode(dataElement));
                }
            } else {
                result = result.concat(subT.encode(data[cdi.id]));
            }

        }
        if (result.length > this.string_len) throw new Error('O3EList.encode() result too long: '+String(result.length)+' > '+String(this.string_len));
        return result.concat(Array.from(Array(this.string_len-result.length), () => 0));
    }
    decode(string_bin) {
        if (rawmode.getOpMode()) {
            return RawDecode(string_bin);
        }
        const result = {};
        let index = 0;
        let count = 0;
        for (const cdi of Object.values(this.subTypes)) {
            const subT = new O3Ecodecs[cdi.codec](cdi.len, cdi.id, cdi.args);
            if (subT.id.toLowerCase() == 'count') {
                count = subT.decode(string_bin.slice(index,index+subT.string_len));
                result[subT.id]=count;
                index += subT.string_len;
            } else {
                if (('subTypes' in subT)) {
                    // O3EComplexType
                    result[subT.id] = [];
                    if (count <= 100) {
                        for (let i=0; i<count; i++) {
                            result[subT.id].push(subT.decode(string_bin.slice(index,index+subT.string_len)));
                            index += subT.string_len;
                        }
                    } else {
                        result[subT.id] = ['Implausible number of elements. Decoding aborted.'];
                    }
                } else {
                    result[subT.id] = subT.decode(string_bin.slice(index,index+subT.string_len));
                    index += subT.string_len;
                }
            }
        }
        return result;
    }
    __len__() {
        return this.string_len;
    }
}

class O3EArray {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.subTypes = _args.subTypes;
        this.len = _args.arrayLength;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        }
        throw new Error('not implemented yet');
    }
    decode(string_bin) {
        if (rawmode.getOpMode()) {
            return RawDecode(string_bin);
        }
        const result = {};
        let index = 0;
        const count = this.len;
        for (const cdi of Object.values(this.subTypes)) {
            const subT = new O3Ecodecs[cdi.codec](cdi.len, cdi.id, cdi.args);
            result[subT.id]=[];
            for (let i=0;i<count;i++) {
                result[subT.id].push((subT.decode(string_bin.slice(index,index+subT.string_len))));
                index += subT.string_len;
            }
        }
        return result;
    }
    __len__() {
        return this.string_len;
    }
}

class O3EComplexType {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.subTypes = _args.subTypes;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        }

        let result = [];
        for (const cdi of Object.values(this.subTypes)) {
            const subT = new O3Ecodecs[cdi.codec](cdi.len, cdi.id, cdi.args);
            result = result.concat(subT.encode(data[cdi.id]));
        }
        if (result.length > this.string_len) throw new Error('O3EComplexType.encode() result too long: '+this.id+' - '+String(result.length)+' > '+String(this.string_len));
        return result.concat(Array.from(Array(this.string_len-result.length), () => 0));
    }
    decode(string_bin) {
        if (rawmode.getOpMode()) {
            return RawDecode(string_bin);
        }
        const result = {};
        let index = 0;
        for (const cdi of Object.values(this.subTypes)) {
            const subT = new O3Ecodecs[cdi.codec](cdi.len, cdi.id, cdi.args);
            result[subT.id] = subT.decode(string_bin.slice(index,index+subT.string_len));
            index+=subT.string_len;
        }
        return result;
    }
    __len__() {
        return this.string_len;
    }
}

class O3EcosPhi {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.offset = _args.offset;
        this.scale = _args.scale;
    }
    encode(data) {
        if (rawmode.getOpMode()) {
            return RawEncode(data, this.string_len);
        } else {
            throw new Error('not implemented yet');
        }
    }

    decode(string_bin) {
        if (rawmode.getOpMode()) {
            return RawDecode(string_bin);
        }
        let val = string_bin[1+this.offset];
        if (string_bin[this.offset] == 0x04) {
            val = -1.0*val;
        }
        return val/this.scale;
    }

    __len__() {
        return this.string_len;
    }
}

const O3Ecodecs = {
    'RawCodec':O3ERawCodec,
    'O3EInt8':O3EInt8,
    'O3EInt16':O3EInt16,
    'O3EInt32':O3EInt32,
    'O3EByteVal':O3EByteVal,
    'O3EBool':O3EBool,
    'O3EUtf8':O3EUtf8,
    'O3ESoftVers':O3ESoftVers,
    'O3EMacAddr':O3EMacAddr,
    'O3EIp4Addr':O3EIp4Addr,
    'O3ESdate':O3ESdate,
    'O3EStime':O3EStime,
    'O3EDateTime':O3EDateTime,
    'O3EUtc':O3EUtc,
    'O3EEnum':O3EEnum,
    'O3EList':O3EList,
    'O3EArray':O3EArray,
    'O3EComplexType':O3EComplexType,
    'O3EcosPhi':O3EcosPhi
};

module.exports = {
    O3Ecodecs,
    arr2Hex,
    toByteArray,
    rawmode
};
