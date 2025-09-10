const enums = require('./enums');

const C2POW08 = 0x100;
const C2POW15 = 0x08000;
const C2POW16 = 0x10000;
const C2POW24 = 0x1000000;
const C2POW31 = 0x080000000;
const C2POW32 = 0x100000000;
const C2POW40 = 0x10000000000;
const C2POW48 = 0x1000000000000;
const C2POW52n = BigInt(0x10000000000000);
const C2POW56n = BigInt(0x100000000000000);
const C2POW63n = BigInt(0x08000000000000000);
const C2POW64n = BigInt(0x10000000000000000);

/**
 * Convert byte array to hex string
 *
 * @param {Array} arr  byte array
 */
function arr2Hex(arr) {
    let hs = '';
    for (const v in arr) {
        hs += toHex(arr[v], 2);
    }
    return hs;
}

/**
 * Convert integer to hex string of length len
 *
 * @param {number} d  integer
 * @param {number} len  Lenght of result
 */
function toHex(d, len) {
    return `00000000${Number(d).toString(16)}`.slice(-len);
}

/**
 * Convert int64 to hex string of length len
 *
 * @param {bigint} d  64-bit integer
 * @param {number} len  Lenght of result
 */
function toHex64(d, len) {
    return `0000000000000000${d.toString(16)}`.slice(-len);
}

/**
 * Convert hex string, e.g. '21A8' to byte array: [33,168]
 *
 * @param {string} hs  hex string
 */
function toByteArray(hs) {
    const ba = [];
    for (let i = 0; i < hs.length / 2; i++) {
        ba.push(parseInt(hs.slice(2 * i, 2 * i + 2), 16));
    }
    return ba;
}

/**
 * Convert unsigned 8-bit integer to hex string
 *
 * @param {Array} j  Array of byte
 */
function uint08toVal(j) {
    return j[0];
}

/**
 * Convert signed 8-bit integer to hex string
 *
 * @param {Array} j  Array of byte
 */
function sint08toVal(j) {
    return j[0] < 128 ? j[0] : j[0] - 256;
}

/**
 * Convert unsigned 16-bit integer to hex string
 *
 * @param {Array} j  Array of byte
 */
function uint16toVal(j) {
    return C2POW08 * j[1] + j[0];
}

/**
 * Convert signed 16-bit integer to hex string
 *
 * @param {Array} j  Array of byte
 */
function sint16toVal(j) {
    let v = C2POW08 * j[1] + j[0];
    if (v >= C2POW15) {
        v -= C2POW16;
    }
    return v;
}

/**
 * Convert unsigned 32-bit integer to hex string
 *
 * @param {Array} j  Array of byte
 */
function uint32toVal(j) {
    return C2POW24 * j[3] + C2POW16 * j[2] + C2POW08 * j[1] + j[0];
}

/**
 * Convert signed 32-bit integer to hex string
 *
 * @param {Array} j  Array of byte
 */
function sint32toVal(j) {
    let v = C2POW24 * j[3] + C2POW16 * j[2] + C2POW08 * j[1] + j[0];
    if (v >= C2POW31) {
        v -= C2POW32;
    }
    return v;
}

/**
 * Convert unsigned 64-bit integer to hex string
 *
 * @param {Array} j  Array of byte
 */
function uint64toVal(j) {
    return Number(
        C2POW56n * BigInt(j[7]) +
            BigInt(C2POW48) * BigInt(j[6]) +
            BigInt(C2POW40) * BigInt(j[5]) +
            BigInt(C2POW32) * BigInt(j[4]) +
            BigInt(C2POW24) * BigInt(j[3]) +
            BigInt(C2POW16) * BigInt(j[2]) +
            BigInt(C2POW08) * BigInt(j[1]) +
            BigInt(j[0]),
    );
}

/**
 * Convert signed 64-bit integer to hex string
 *
 * @param {Array} j  Array of byte
 */
function sint64toVal(j) {
    let v =
        C2POW56n * BigInt(j[7]) +
        BigInt(C2POW48) * BigInt(j[6]) +
        BigInt(C2POW40) * BigInt(j[5]) +
        BigInt(C2POW32) * BigInt(j[4]) +
        BigInt(C2POW24) * BigInt(j[3]) +
        BigInt(C2POW16) * BigInt(j[2]) +
        BigInt(C2POW08) * BigInt(j[1]) +
        BigInt(j[0]);
    if (v >= C2POW63n) {
        v -= C2POW64n;
    }
    return Number(v);
}

/**
 * Convert byte array to int08, int16, int32. Signed or unsigned.
 *
 * @param {Array} j  Array of byte
 * @param {boolean} signed  Value is signed
 */
function int2val(j, signed = false) {
    switch (j.length) {
        case 1:
            return signed ? sint08toVal(j) : uint08toVal(j);
        case 2:
            return signed ? sint16toVal(j) : uint16toVal(j);
        case 4:
            return signed ? sint32toVal(j) : uint32toVal(j);
        case 8:
            return signed ? sint64toVal(j) : uint64toVal(j);
        default:
            return null;
    }
}

/**
 * Convert int08, int16, int32 to byte array. Signed or unsigned.
 *
 * @param {string} v  Value
 * @param {number} byte_width  Byte length of value
 * @param {number} scale  Scaling factor
 * @param {boolean} signed  Signed value yes/no
 */
function val2byteArr(v, byte_width, scale = 1, signed = false) {
    let val = Math.round(eval(v) * scale);
    if (signed && val < 0) {
        val += 2 ** (8 * byte_width);
    }
    const string_bin = toByteArray(toHex(val, byte_width * 2));
    return string_bin.reverse();
}

function val2byteArr64(v, byte_width, scale = 1, signed = false) {
    // Convert int64 to byte array. Signed or unsigned.
    // Due to internal limitations of Javascript this only works correctly for values < 2^52 (4.503.599.627.370.496)
    let val = BigInt(Math.round(v * scale));
    if (val >= C2POW52n || val <= -C2POW52n) {
        throw new Error(
            'O3EInt64.encode(): Value out of range. For encoding only values in range -2**52 < value < 2**52 (4.503.599.627.370.496) are allowed!',
        );
    }
    if (signed && val < 0) {
        val += C2POW64n;
    }
    const string_bin = toByteArray(toHex64(val, byte_width * 2));
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

/**
 *  Codec for UDSonCAN: Raw Codec: Just pass raw data
 */
class O3ERawCodec {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    /**
     * @param {Array} data  Raw data
     */
    encode(data) {
        return RawEncode(data, this.string_len);
    }
    /**
     * @param {string} string_bin  Raw data (string of hex bytes)
     */
    decode(string_bin) {
        return RawDecode(string_bin);
    }
    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: Integer numbers
 */
class O3EInt {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {number} byte_width  Byte width of passed integer
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, byte_width, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.byte_width = byte_width;
        this.scale = _args.scale;
        this.signed = _args.signed;
    }
    /**
     * @param {string} data  Raw data
     */
    encode(data) {
        if (this.byte_width == 8) {
            return val2byteArr64(data, this.byte_width, this.scale, this.signed);
        }
        return val2byteArr(data, this.byte_width, this.scale, this.signed);
    }

    /**
     * @param {Array} data  Array of bytes
     */
    decode(data) {
        return int2val(data.slice(0, this.byte_width), this.signed) / this.scale;
    }

    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

// Named parameters in Javascript: https://masteringjs.io/tutorials/fundamentals/parameters
// function (parg1, parg2, { narg1 = 1, narg2 = 2, narg3 = 3 } = {} ) {}

/**
 *  Codec for UDSonCAN: 8-Bit integer
 */
class O3EInt8 extends O3EInt {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        super(string_len, idStr, 1, _args);
    }
}

/**
 *  Codec for UDSonCAN: 16-Bit integer
 */
class O3EInt16 extends O3EInt {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        super(string_len, idStr, 2, _args);
    }
}

/**
 *  Codec for UDSonCAN: 32-Bit integer
 */
class O3EInt32 extends O3EInt {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        super(string_len, idStr, 4, _args);
    }
}

/**
 *  Codec for UDSonCAN: 64-Bit integer
 */
class O3EInt64 extends O3EInt {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        super(string_len, idStr, 8, _args);
    }
}

/**
 *  Codec for UDSonCAN: Single byte
 */
class O3EByteVal {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    /**
     * @param {string} data  Raw data
     */
    encode(data) {
        return val2byteArr(data, this.string_len, 1, false);
    }

    /**
     * @param {Array} string_bin  Raw data (array of bytes)
     */
    decode(string_bin) {
        let val = 0;
        for (let i = 0; i < this.string_len; i++) {
            val += string_bin[i] << (i * 8);
        }
        return val;
    }

    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: Float32 number
 */
class O3EFloat32 {
    // IEEE-754 Converter for float32: https://www.h-schmidt.net/FloatConverter/IEEE754de.html
    // Convert byte values to float: https://stackoverflow.com/questions/4414077/read-write-bytes-of-float-in-js
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.scale = _args.scale;
    }
    /**
     * @param {any} _data  Float32 value
     */
    encode(_data) {
        throw new Error('O3EFloat32.encode(): not implemented yet');
    }

    /**
     * @param {Array} string_bin  Raw data (arry of bytes)
     */
    decode(string_bin) {
        const buffer = new ArrayBuffer(4);
        const intView = new Int32Array(buffer);
        const floatView = new Float32Array(buffer);
        intView[0] = int2val(string_bin, false);
        return floatView[0] / this.scale;
    }

    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: Boolean value
 */
class O3EBool {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    /**
     * @param {string} data  Raw data
     */
    encode(data) {
        return data == 'off' ? 0 : 1;
    }

    /**
     * @param {number} string_bin  Raw data (number)
     */
    decode(string_bin) {
        const val = string_bin[0];
        return val == 0 ? 'off' : 'on';
    }

    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: Utf8 string
 */
class O3EUtf8 {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }

    /**
     * @param {string} data  Raw data
     */
    encode(data) {
        let result;
        try {
            result = Object.values(new TextEncoder().encode(data));
        } catch (e) {
            throw new Error(`O3EUtf8.encode(): Conversion from Utf8 failed ${this.id}; err=${JSON.stringify(e)}`);
        }
        if (result.length > this.string_len) {
            throw new Error(
                `O3EUtf8.encode(): Result too long: ${this.id} - ${String(result.length)} > ${String(this.string_len)}`,
            );
        }
        return result.concat(Array.from(Array(this.string_len - result.length), () => 0));
    }
    /**
     * @param {Array} string_bin  Raw data (array of bytes)
     */
    decode(string_bin) {
        let i = string_bin.slice(0).indexOf(0);
        if (i == -1) {
            i = string_bin.length;
        }
        let result;
        try {
            result = new TextDecoder().decode(new Uint8Array(string_bin.slice(0, i)));
        } catch (e) {
            throw new Error(`O3EUtf8.decode(): Conversion to Utf8 failed ${this.id}; err=${JSON.stringify(e)}`);
        }
        return result;
    }

    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: Software version
 */
class O3ESoftVers {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    /**
     * @param {string} data  Raw data
     */
    encode(data) {
        let result = [];
        const arr = data.split('.');
        for (const v of Object.values(arr)) {
            result = result.concat(val2byteArr(v, 2, 1, false));
        }
        if (result.length > this.string_len) {
            throw new Error(
                `O3ESoftVers.encode() result too long: ${this.id} - ${String(result.length)} > ${String(
                    this.string_len,
                )}`,
            );
        }
        return result.concat(Array.from(Array(this.string_len - result.length), () => 0));
    }
    /**
     * @param {Array} string_bin  Raw data (array of bytes)
     */
    decode(string_bin) {
        const lstv = [];
        for (let i = 0; i < this.string_len; i += 2) {
            lstv.push(string_bin[i] + (string_bin[i + 1] << 8));
        }
        return lstv.join('.');
    }
    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: MAC-Address
 */
class O3EMacAddr {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    /**
     * @param {string} data  Raw data
     */
    encode(data) {
        return data.split('-').map(function (str) {
            return parseInt(`0x${str}`);
        });
    }
    /**
     * @param {Array} string_bin  Raw data (array of bytes)
     */
    decode(string_bin) {
        const lstv = [];
        for (let i = 0; i < this.string_len; i++) {
            lstv.push(toHex(string_bin[i], 2).toUpperCase());
        }
        return lstv.join('-');
    }
    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: IPv4-address
 */
class O3EIp4Addr {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    /**
     * @param {string} data  Raw data
     */
    encode(data) {
        return data.split('.').map(function (str) {
            return parseInt(str);
        });
    }
    /**
     * @param {string} string_bin  Raw data (string of hex bytes)
     */
    decode(string_bin) {
        const lstv = [];
        for (let i = 0; i < this.string_len; i++) {
            lstv.push(string_bin[i].toString().padStart(3, '0'));
        }
        return lstv.join('.');
    }
    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: Date
 */
class O3ESdate {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    /**
     * @param {any} data  Raw data
     */
    encode(data) {
        const dt = new Date(data);
        if (!dt.valueOf()) {
            throw new Error('could not convert date value');
        }
        return [dt.getDate(), dt.getMonth() + 1, dt.getFullYear() % 100];
    }
    /**
     * @param {Array} string_bin  Raw data (array of bytes)
     */
    decode(string_bin) {
        const dt = new Date(
            string_bin[2] + 2000, // year
            string_bin[1] - 1, // month
            string_bin[0], // day
        );
        return dt.toDateString();
    }
    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: Time
 */
class O3EStime {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    /**
     * @param {string} data  Raw data
     */
    encode(data) {
        if (this.string_len == 1) {
            data += ':00';
        } // Date() needs at least hour:minute
        const now = new Date();
        const dt = new Date(`${now.toDateString()} ${data}`);
        if (!dt.valueOf()) {
            throw new Error('could not convert time value');
        }
        const retVal = [dt.getHours(), dt.getMinutes(), dt.getSeconds()];
        return retVal.slice(0, this.string_len);
    }
    /**
     * @param {Array} string_bin  Raw data (array of bytes)
     */
    decode(string_bin) {
        const now = new Date();
        const dt = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            string_bin[0], // hour
            this.string_len >= 2 ? string_bin[1] : 0, // minute
            this.string_len >= 3 ? string_bin[2] : 0, // second
        );
        return dt.toLocaleTimeString();
    }
    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: Date and Time
 */
class O3EDateTime {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.timeformat = _args.timeformat;
    }
    /**
     * @param {object} data  Raw data
     */
    encode(data) {
        if (this.timeformat == 'VM') {
            const dt = new Date(data.Timestamp);
            if (!dt.valueOf()) {
                throw new Error('could not convert datetime value');
            }
            const fill = 0x05; // Unknown byte between date and time. Known values are 0x05 and 0x06
            return [
                Math.floor(dt.getFullYear() / 100),
                dt.getFullYear() % 100,
                dt.getMonth() + 1,
                dt.getDate(),
                fill,
                dt.getHours(),
                dt.getMinutes(),
                dt.getSeconds(),
            ];
        }
        return val2byteArr(data.Timestamp, this.string_len, 0.001, false);
    }
    /**
     * @param {Array} string_bin  Raw data (array of bytes)
     */
    decode(string_bin) {
        let dt = new Date();
        if (this.timeformat == 'VM') {
            dt = new Date(
                string_bin[0] * 100 + string_bin[1], // year
                string_bin[2] - 1, // month
                string_bin[3], // day
                string_bin[5], // hour
                string_bin[6], // minute
                string_bin[7], // second
            );
        }
        if (this.timeformat == 'ts') {
            dt = new Date(uint32toVal(string_bin.slice(0, 4)) * 1000);
        }
        return { DateTime: dt.toLocaleString(), Timestamp: Math.round(dt.getTime()) };
    }
    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: Utc coded Date and Time
 */
class O3EUtc {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
    }
    /**
     * @param {any} data  Raw data
     */
    encode(data) {
        const dt = new Date(data);
        if (!dt) {
            throw new Error('could not convert Utc date value');
        }
        return val2byteArr(String(dt.getTime()), this.string_len, 0.001, false);
    }
    /**
     * @param {Array} string_bin  Raw data (array of bytes)
     */
    decode(string_bin) {
        const dt = new Date(uint32toVal(string_bin.slice(0, 4)) * 1000);
        return dt.toUTCString();
    }
    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: Enumeration
 */
class O3EEnum {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.listStr = _args.listStr;
    }
    /**
     * @param {object} data  Raw data
     */
    encode(data) {
        return val2byteArr(data.ID, this.string_len, 1, false);
    }
    /**
     * @param {Array} string_bin  Raw data (string of bytes)
     */
    decode(string_bin) {
        const val = int2val(string_bin);
        let txt = '';
        if (this.listStr in enums.enums && String(val) in enums.enums[this.listStr]) {
            txt = enums.enums[this.listStr][String(val)];
        } else {
            txt = `Enum not found in ${this.listStr}`;
        }
        return { ID: val, Text: txt };
    }
    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: List of subs
 */
class O3EList {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.subTypes = _args.subTypes;
    }
    /**
     * @param {Array} data  Raw data
     */
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
        if (result.length > this.string_len) {
            throw new Error(`O3EList.encode() result too long: ${String(result.length)} > ${String(this.string_len)}`);
        }
        return result.concat(Array.from(Array(this.string_len - result.length), () => 0));
    }
    /**
     * @param {string} string_bin  Raw data (string of hex bytes)
     */
    decode(string_bin) {
        const result = {};
        let index = 0;
        let count = 0;
        for (const cdi of Object.values(this.subTypes)) {
            const subT = new O3Ecodecs[cdi.codec](cdi.len, cdi.id, cdi.args);
            if (subT.id.toLowerCase() == 'count') {
                count = subT.decode(string_bin.slice(index, index + subT.string_len));
                result[subT.id] = count;
                index += subT.string_len;
            } else {
                if ('subTypes' in subT) {
                    // O3EComplexType
                    result[subT.id] = [];
                    if (count <= 100) {
                        for (let i = 0; i < count; i++) {
                            result[subT.id].push(subT.decode(string_bin.slice(index, index + subT.string_len)));
                            index += subT.string_len;
                        }
                    } else {
                        result[subT.id] = ['Implausible number of elements. Decoding aborted.'];
                    }
                } else {
                    result[subT.id] = subT.decode(string_bin.slice(index, index + subT.string_len));
                    index += subT.string_len;
                }
            }
        }
        return result;
    }
    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: Array
 */
class O3EArray {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.subTypes = _args.subTypes;
        this.len = _args.arrayLength;
    }
    /**
     * @param {any} _data  Float32 value
     */
    encode(_data) {
        throw new Error('not implemented yet');
    }
    /**
     * @param {string} string_bin  Raw data (string of hex bytes)
     */
    decode(string_bin) {
        const result = {};
        let index = 0;
        const count = this.len;
        for (const cdi of Object.values(this.subTypes)) {
            const subT = new O3Ecodecs[cdi.codec](cdi.len, cdi.id, cdi.args);
            result[subT.id] = [];
            for (let i = 0; i < count; i++) {
                result[subT.id].push(subT.decode(string_bin.slice(index, index + subT.string_len)));
                index += subT.string_len;
            }
        }
        return result;
    }
    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: Complex DID structure
 */
class O3EComplexType {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.subTypes = _args.subTypes;
    }
    /**
     * @param {Array} data  Raw data
     */
    encode(data) {
        let result = [];
        for (const cdi of Object.values(this.subTypes)) {
            const subT = new O3Ecodecs[cdi.codec](cdi.len, cdi.id, cdi.args);
            result = result.concat(subT.encode(data[cdi.id]));
        }
        if (result.length > this.string_len) {
            throw new Error(
                `O3EComplexType.encode() result too long: ${this.id} - ${String(result.length)} > ${String(
                    this.string_len,
                )}`,
            );
        }
        return result.concat(Array.from(Array(this.string_len - result.length), () => 0));
    }
    /**
     * @param {string} string_bin  Raw data (string of hex bytes)
     */
    decode(string_bin) {
        const result = {};
        let index = 0;
        for (const cdi of Object.values(this.subTypes)) {
            const subT = new O3Ecodecs[cdi.codec](cdi.len, cdi.id, cdi.args);
            result[subT.id] = subT.decode(string_bin.slice(index, index + subT.string_len));
            index += subT.string_len;
        }
        return result;
    }
    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

/**
 *  Codec for UDSonCAN: Energy Meter: Value of Cosinus Phi
 */
class O3EcosPhi {
    /**
     * @param {number} string_len  Length of raw data
     * @param {string} idStr  Data ID (DID)
     * @param {object} _args  Additional parameters
     */
    constructor(string_len, idStr, _args) {
        this.string_len = string_len;
        this.id = idStr;
        this.scale = _args.scale;
    }
    /**
     * @param {any} _data  Float32 value
     */
    encode(_data) {
        throw new Error('not implemented yet');
    }

    /**
     * @param {Array} string_bin  Raw data (array of bytes)
     */
    decode(string_bin) {
        let val = string_bin[1];
        if (string_bin[0] == 0x04) {
            val = -1.0 * val;
        }
        return val / this.scale;
    }

    /**
     * Returns length of raw data
     */
    __len__() {
        return this.string_len;
    }
}

const O3Ecodecs = {
    RawCodec: O3ERawCodec,
    O3EInt8: O3EInt8,
    O3EInt16: O3EInt16,
    O3EInt32: O3EInt32,
    O3EInt64: O3EInt64,
    O3EByteVal: O3EByteVal,
    O3EFloat32: O3EFloat32,
    O3EBool: O3EBool,
    O3EUtf8: O3EUtf8,
    O3ESoftVers: O3ESoftVers,
    O3EMacAddr: O3EMacAddr,
    O3EIp4Addr: O3EIp4Addr,
    O3ESdate: O3ESdate,
    O3EStime: O3EStime,
    O3EDateTime: O3EDateTime,
    O3EUtc: O3EUtc,
    O3EEnum: O3EEnum,
    O3EList: O3EList,
    O3EArray: O3EArray,
    O3EComplexType: O3EComplexType,
    O3EcosPhi: O3EcosPhi,
};

module.exports = {
    O3Ecodecs,
    arr2Hex,
    toByteArray,
    val2byteArr,
};
