const enums = require('./enums');

const C2POW08  = 0x100;
const C2POW15  = 0x08000;
const C2POW16  = 0x10000;
const C2POW24  = 0x1000000;
const C2POW31  = 0x080000000;
const C2POW32  = 0x100000000;
const C2POW40  = 0x10000000000;
const C2POW48  = 0x1000000000000;
const C2POW52n = BigInt(0x10000000000000);
const C2POW56n = BigInt(0x100000000000000);
const C2POW63n = BigInt(0x08000000000000000);
const C2POW64n = BigInt(0x10000000000000000);

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

function toHex64(d, len) {
    // Convert int64 to hex string of length len
    return  (('0000000000000000'+(d.toString(16))).slice(-len));
}

function toByteArray(hs) {
    // Convert hex string, e.g. '21A8' to byte array: [33,168]
    const ba = [];
    for (let i=0; i<hs.length/2; i++) {
        ba.push(parseInt(hs.slice(2*i,2*i+2), 16));
    }
    return ba;
}

function uint08toVal(j) {
    return j[0];
}

function sint08toVal(j) {
    return (j[0]<128 ? j[0] : j[0]-256);
}

function uint16toVal(j) {
    return C2POW08*j[1]+j[0];
}

function sint16toVal(j) {
    let v = C2POW08*j[1]+j[0];
    if (v >= C2POW15) { v -= C2POW16; }
    return v;
}

function uint32toVal(j,) {
    return C2POW24*j[3]+C2POW16*j[2]+C2POW08*j[1]+j[0];
}

function sint32toVal(j) {
    let v = C2POW24*j[3]+C2POW16*j[2]+C2POW08*j[1]+j[0];
    if (v >= C2POW31) { v -= C2POW32; }
    return v;
}

function uint64toVal(j,) {
    return Number(C2POW56n*BigInt(j[7])+BigInt(C2POW48)*BigInt(j[6])+BigInt(C2POW40)*BigInt(j[5])+BigInt(C2POW32)*BigInt(j[4])+
                  BigInt(C2POW24)*BigInt(j[3])+BigInt(C2POW16)*BigInt(j[2])+BigInt(C2POW08)*BigInt(j[1])+BigInt(j[0]));
}

function sint64toVal(j) {
    let v = C2POW56n*BigInt(j[7])+BigInt(C2POW48)*BigInt(j[6])+BigInt(C2POW40)*BigInt(j[5])+BigInt(C2POW32)*BigInt(j[4])+
            BigInt(C2POW24)*BigInt(j[3])+BigInt(C2POW16)*BigInt(j[2])+BigInt(C2POW08)*BigInt(j[1])+BigInt(j[0]);
    if (v >= C2POW63n) { v -= C2POW64n; }
    return Number(v);
}

function int2val(j, signed = false) {
    // Convert byte array to int08, int16, int32. Signed or unsigned.
    switch (j.length) {
        case 1 :
            return (signed ? sint08toVal(j) : uint08toVal(j) );
        case 2 :
            return (signed ? sint16toVal(j) : uint16toVal(j) );
        case 4 :
            return (signed ? sint32toVal(j) : uint32toVal(j) );
        case 8 :
            return (signed ? sint64toVal(j) : uint64toVal(j) );
        default:
            return null;
    }
}

function val2byteArr(v, byte_width, scale = 1, signed = false) {
    // Convert int08, int16, int32 to byte array. Signed or unsigned.
    let val = Math.round(eval(v) * scale);
    if ( (signed) && (val < 0) ) { val += (2**(8*byte_width)); }
    const string_bin = toByteArray(toHex(val, byte_width*2));
    return string_bin.reverse();
}

function val2byteArr64(v, byte_width, scale = 1, signed = false) {
    // Convert int64 to byte array. Signed or unsigned.
    // Due to internal limitations of Javascript this only works correctly for values < 2^52 (4.503.599.627.370.496)
    let val = BigInt(Math.round(v * scale));
    if ( (val >= C2POW52n) || (val <= -C2POW52n) ) {
        throw new Error('O3EInt64.encode(): Value out of range. For encoding only values in range -2**52 < value < 2**52 (4.503.599.627.370.496) are allowed!');
    }
    if ( (signed) && (val < 0) ) { val += C2POW64n; }
    const string_bin = toByteArray(toHex64(val, byte_width*2));
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
        this.signed = _args.signed;
    }
    encode(data) {
        if (this.byte_width == 8) {
            return val2byteArr64(data, this.byte_width, this.scale, this.signed);
        } else {
            return val2byteArr(data, this.byte_width, this.scale, this.signed);
        }
    }

    decode(data) {
        return int2val(data.slice(0,this.byte_width), this.signed) / this.scale;
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

class O3EInt64 extends O3EInt {
    constructor(string_len, idStr, _args) {
        super(string_len, idStr, 8, _args);
    }
}

class O3EByteVal {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    encode(data) {
        return val2byteArr(data, this.string_len, 1, false);
    }

    decode(string_bin) {
        let val = 0;
        for (let i = 0; i < this.string_len; i++) {
            val += string_bin[i] << (i * 8);
        }
        return val;
    }

    __len__() {
        return this.string_len;
    }
}

class O3EFloat32 {
    // IEEE-754 Converter for float32: https://www.h-schmidt.net/FloatConverter/IEEE754de.html
    // Convert byte values to float: https://stackoverflow.com/questions/4414077/read-write-bytes-of-float-in-js
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.scale = _args.scale;
    }
    encode(_data) {
        throw new Error('O3EFloat32.encode(): not implemented yet');
    }

    decode(string_bin) {
        const buffer = new ArrayBuffer(4);
        const intView = new Int32Array(buffer);
        const floatView = new Float32Array(buffer);
        intView[0] = int2val(string_bin, false);
        return floatView[0]/this.scale;
    }

    __len__() {
        return this.string_len;
    }
}

class  O3EBool {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    encode(data) {
        return (data == 'off' ? 0 : 1);
    }

    decode(string_bin) {
        const val = string_bin[0];
        return (val == 0 ? 'off' : 'on' );
    }

    __len__() {
        return this.string_len;
    }
}

class  O3EStateEM {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    encode(data) {
        return (data == -1 ? 4 : 0);
    }

    decode(string_bin) {
        const val = string_bin[0];
        if (val == 4) return -1;
        if (val == 0) return 1;
        return 0;
    }

    __len__() {
        return this.string_len;
    }
}

class O3EUtf8 {
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }

    encode(data) {
        let result;
        try {
            result = Object.values(new TextEncoder().encode(data));
        } catch(e) {
            throw new Error('O3EUtf8.encode(): Conversion from Utf8 failed '+this.id+'; err='+JSON.stringify(e));
        }
        if (result.length > this.string_len) throw new Error('O3EUtf8.encode(): Result too long: '+this.id+' - '+String(result.length)+' > '+String(this.string_len));
        return result.concat(Array.from(Array(this.string_len-result.length), () => 0));

    }
    decode(string_bin) {
        let i = string_bin.slice(0).indexOf(0);
        if (i == -1) { i = string_bin.length; }
        let result;
        try {
            result = new TextDecoder().decode(new Uint8Array(string_bin.slice(0,i)));
        } catch(e) {
            throw new Error('O3EUtf8.decode(): Conversion to Utf8 failed '+this.id+'; err='+JSON.stringify(e));
        }
        return result;
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
        let result = [];
        const arr = data.split('.');
        for (const v of Object.values(arr)) result = result.concat(val2byteArr(v,2,1,false));
        if (result.length > this.string_len) throw new Error('O3ESoftVers.encode() result too long: '+this.id+' - '+String(result.length)+' > '+String(this.string_len));
        return result.concat(Array.from(Array(this.string_len-result.length), () => 0));
    }
    decode(string_bin) {
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
        return(data.split('-').map(function(str) {return parseInt('0x'+str);}));
    }
    decode(string_bin) {
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
        return(data.split('.').map(function(str) {return parseInt(str);}));
    }
    decode(string_bin) {
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
        const dt = new Date(data);
        if (!dt.valueOf()) throw new Error('could not convert date value');
        return [dt.getDate(),dt.getMonth()+1,dt.getFullYear()%100];

    }
    decode(string_bin) {
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
        if (this.string_len == 1) data += ':00';        // Date() needs at least hour:minute
        const now = new Date();
        const dt = new Date(now.toDateString()+' '+data);
        if (!dt.valueOf()) throw new Error('could not convert time value');
        const retVal = [dt.getHours(),dt.getMinutes(),dt.getSeconds()];
        return retVal.slice(0,this.string_len);

    }
    decode(string_bin) {
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
        if (this.timeformat == 'VM') {
            const dt = new Date(data.Timestamp);
            if (!dt.valueOf()) throw new Error('could not convert datetime value');
            const fill = 0x05;  // Unknown byte between date and time. Known values are 0x05 and 0x06
            return([Math.floor(dt.getFullYear()/100),dt.getFullYear()%100,dt.getMonth()+1,dt.getDate(),fill,
                dt.getHours(),dt.getMinutes(),dt.getSeconds()]);
        } else {
            return(val2byteArr(data.Timestamp,this.string_len,0.001,false));
        }

    }
    decode(string_bin) {
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
            dt = new Date(uint32toVal(string_bin.slice(0,4))*1000);
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
        const dt = new Date(data);
        if (!dt) throw new Error('could not convert Utc date value');
        return val2byteArr(dt.getTime(),this.string_len,0.001,false);

    }
    decode(string_bin) {
        const dt = new Date(uint32toVal(string_bin.slice(0,4))*1000);
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
        return val2byteArr(data.ID, this.string_len, 1, false);
    }
    decode(string_bin) {
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
    encode(_data) {
        throw new Error('not implemented yet');
    }
    decode(string_bin) {
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
        let result = [];
        for (const cdi of Object.values(this.subTypes)) {
            const subT = new O3Ecodecs[cdi.codec](cdi.len, cdi.id, cdi.args);
            result = result.concat(subT.encode(data[cdi.id]));
        }
        if (result.length > this.string_len) throw new Error('O3EComplexType.encode() result too long: '+this.id+' - '+String(result.length)+' > '+String(this.string_len));
        return result.concat(Array.from(Array(this.string_len-result.length), () => 0));
    }
    decode(string_bin) {
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
        this.scale = _args.scale;
    }
    encode(_data) {
        throw new Error('not implemented yet');
    }

    decode(string_bin) {
        let val = string_bin[1];
        if (string_bin[0] == 0x04) {
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
    'O3EInt64':O3EInt64,
    'O3EByteVal':O3EByteVal,
    'O3EFloat32':O3EFloat32,
    'O3EBool':O3EBool,
    'O3EStateEM':O3EStateEM,
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
    val2byteArr
};
