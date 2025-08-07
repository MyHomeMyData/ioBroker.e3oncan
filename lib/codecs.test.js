'use strict';

/**
 * Tests for codecs
 *
 * It's automatically excluded from npm and its build output is excluded from both git and npm.
 * It is advised to test all your modules with accompanying *.test.js-files
 */

// tslint:disable:no-unused-expression

const { expect } = require('chai');
const E3 = require('./codecs');
const E3DidsDict = require('./didsE3.json');

function toByteArray(hs) {
    // Convert hex string, e.g. '21A8' to byte array: [33,168]
    const ba = [];
    for (let i=0; i<hs.length/2; i++) {
        ba.push(parseInt(hs.slice(2*i,2*i+2), 16));
    }
    return ba;
}

function codecDecode(descr, expected, codec, len, id, args, val) {
    it(`${descr} ${JSON.stringify(expected)}`, () => {
        const f = new codec(len,id,args);
        const result = f.decode(val);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(expected));
    });
}

function codecEncode(descr, expected, codec, len, id, args, val) {
    it(`${descr} ${JSON.stringify(expected)}`, () => {
        const f = new codec(len,id,args);
        const result = f.encode(val);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(expected));
    });
}

// Utf8:
describe('codecs.js => O3EUtf8()', () => {
    const raw_hex1 = '4865697a6bc3b6727065720000000000000000000000000000000000000000000000000000000000';
    const raw1 = E3.toByteArray(raw_hex1);
    const txt1 = 'Heizkörper';
    it(`Decode ${JSON.stringify(txt1)}`, () => {
        const f = new E3.O3Ecodecs.O3EUtf8(raw1.length,'test1Utf08', {});
        const result = f.decode(raw1);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(txt1));
    });
    it(`Encode ${JSON.stringify(raw1)}`, () => {
        const f = new E3.O3Ecodecs.O3EUtf8(raw1.length,'test2Utf08', {});
        const result = f.encode(txt1);
        expect(JSON.stringify(raw1)).to.equal(JSON.stringify(result));
    });
    const raw_hex2 = '4675c39f626f64656e6865697a756e67000000000000000000000000000000000000000000000000';
    const raw2 = E3.toByteArray(raw_hex2);
    const txt2 = 'Fußbodenheizung';
    it(`Decode ${JSON.stringify(txt2)}`, () => {
        const f = new E3.O3Ecodecs.O3EUtf8(raw2.length,'test3Utf08', {});
        const result = f.decode(raw2);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(txt2));
    });
    it(`Encode ${JSON.stringify(raw2)}`, () => {
        const f = new E3.O3Ecodecs.O3EUtf8(raw2.length,'test4Utf08', {});
        const result = f.encode(txt2);
        expect(JSON.stringify(raw2)).to.equal(JSON.stringify(result));
    });
    const raw_hex3 = '00000000000000000000000000000000000000000000000000000000000000000000000000000000';
    const raw3 = E3.toByteArray(raw_hex3);
    const txt3 = '';
    it(`Decode ${JSON.stringify(txt3)}`, () => {
        const f = new E3.O3Ecodecs.O3EUtf8(raw3.length,'test5Utf08', {});
        const result = f.decode(raw3);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(txt3));
    });
    it(`Encode ${JSON.stringify(raw3)}`, () => {
        const f = new E3.O3Ecodecs.O3EUtf8(raw3.length,'test5Utf08', {});
        const result = f.encode(txt3);
        expect(JSON.stringify(raw3)).to.equal(JSON.stringify(result));
    });
    const raw_hex4 = '4675c39f';
    const raw4 = E3.toByteArray(raw_hex4);
    const txt4 = 'Fuß';
    it(`Decode ${JSON.stringify(txt4)}`, () => {
        const f = new E3.O3Ecodecs.O3EUtf8(raw4.length,'test6Utf08', {});
        const result = f.decode(raw4);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(txt4));
    });
    it(`Encode ${JSON.stringify(raw4)}`, () => {
        const f = new E3.O3Ecodecs.O3EUtf8(raw4.length,'test6Utf08', {});
        const result = f.encode(txt4);
        expect(JSON.stringify(raw4)).to.equal(JSON.stringify(result));
    });
});

// val2byteArray:
describe('codecs.js => val2byteArr()', () => {
    let val = -1;
    let expected = [0xff];
    it(`sint08 ${JSON.stringify(expected)}`, () => {
        const result = E3.val2byteArr(val, 4, 1, true);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(expected));
    });
    val = 2**7-1;
    expected = [0x7f];
    it(`sint08 ${JSON.stringify(expected)}`, () => {
        const result = E3.val2byteArr(val, 4, 1, true);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(expected));
    });
    val = -(2**7);
    expected = [0x80];
    it(`sint08 ${JSON.stringify(expected)}`, () => {
        const result = E3.val2byteArr(val, 4, 1, true);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(expected));
    });
    val = 2**8-1;
    expected = [0xff];
    it(`uint08 ${JSON.stringify(expected)}`, () => {
        const result = E3.val2byteArr(val, 4, 1, false);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(expected));
    });

    val = -1;
    expected = [0xff,0xff];
    it(`sint16 ${JSON.stringify(expected)}`, () => {
        const result = E3.val2byteArr(val, 4, 1, true);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(expected));
    });
    val = 2**15-1;
    expected = [0xff,0x7f];
    it(`sint16 ${JSON.stringify(expected)}`, () => {
        const result = E3.val2byteArr(val, 4, 1, true);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(expected));
    });
    val = -(2**15);
    expected = [0x00,0x80];
    it(`sint16 ${JSON.stringify(expected)}`, () => {
        const result = E3.val2byteArr(val, 4, 1, true);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(expected));
    });
    val = 2**16-1;
    expected = [0xff,0xff];
    it(`uint16 ${JSON.stringify(expected)}`, () => {
        const result = E3.val2byteArr(val, 4, 1, false);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(expected));
    });

    val = -1;
    expected = [0xff,0xff,0xff,0xff];
    it(`sint32 ${JSON.stringify(expected)}`, () => {
        const result = E3.val2byteArr(val, 4, 1, true);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(expected));
    });
    val = 2**31-1;
    expected = [0xff,0xff,0xff,0x7f];
    it(`sint32 ${JSON.stringify(expected)}`, () => {
        const result = E3.val2byteArr(val, 4, 1, true);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(expected));
    });
    val = -(2**31);
    expected = [0x00,0x00,0x00,0x80];
    it(`sint32 ${JSON.stringify(expected)}`, () => {
        const result = E3.val2byteArr(val, 4, 1, true);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(expected));
    });
    val = 2**32-1;
    expected = [0xff,0xff,0xff,0xff];
    it(`uint32 ${JSON.stringify(expected)}`, () => {
        const result = E3.val2byteArr(val, 4, 1, false);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(expected));
    });
});

// Float32 DECODER:
describe('codecs.js => O3EFloat32().decode()', () => {
    codecDecode('Float +0.0 '                        ,                           0.0, E3.O3Ecodecs.O3EFloat32, 4,  'Float32Test1', {scale: 1.0}, [0x00, 0x00, 0x00, 0x00].reverse());
    codecDecode('Float +100.5'                       ,                         100.5, E3.O3Ecodecs.O3EFloat32, 4,  'Float32Test2', {scale: 1.0}, [0x42, 0xc9, 0x00, 0x00].reverse());
    codecDecode('Float -100.5'                       ,                        -100.5, E3.O3Ecodecs.O3EFloat32, 4,  'Float32Test3', {scale: 1.0}, [0xc2, 0xc9, 0x00, 0x00].reverse());
    codecDecode('Float +4.242E8'                     ,                      +4.242e8, E3.O3Ecodecs.O3EFloat32, 4,  'Float32Test4', {scale: 1.0}, [0x4d, 0xca, 0x46, 0x3a].reverse());
    codecDecode('Float -4.242E8'                     ,                      -4.242e8, E3.O3Ecodecs.O3EFloat32, 4,  'Float32Test5', {scale: 1.0}, [0xcd, 0xca, 0x46, 0x3a].reverse());
    codecDecode('Float +425647872'                   ,                    +425647872, E3.O3Ecodecs.O3EFloat32, 4,  'Float32Test6', {scale: 1.0}, [0x4d, 0xca, 0xf6, 0xf8].reverse());
    codecDecode('Float -425647872'                   ,                    -425647872, E3.O3Ecodecs.O3EFloat32, 4,  'Float32Test7', {scale: 1.0}, [0xcd, 0xca, 0xf6, 0xf8].reverse());
    codecDecode('Float +7851817360303081791424561152', +7851817360303081791424561152, E3.O3Ecodecs.O3EFloat32, 4,  'Float32Test8', {scale: 1.0}, [0x6d, 0xca, 0xf6, 0xf8].reverse());
    codecDecode('Float -7851817360303081791424561152', -7851817360303081791424561152, E3.O3Ecodecs.O3EFloat32, 4,  'Float32Test9', {scale: 1.0}, [0xed, 0xca, 0xf6, 0xf8].reverse());
    codecDecode('Float +0.005'                       ,         +0.004999999888241291, E3.O3Ecodecs.O3EFloat32, 4,  'Float32Test9', {scale: 1.0}, [0x3b, 0xa3, 0xd7, 0x0a].reverse());
    codecDecode('Float -0.005'                       ,         -0.004999999888241291, E3.O3Ecodecs.O3EFloat32, 4, 'Float32Test10', {scale: 1.0}, [0xbb, 0xa3, 0xd7, 0x0a].reverse());
});

// Integer DECODER:
describe('codecs.js => O3EInt8().decode()', () => {
    codecDecode('Positive Number, scale=10, signed=true ', 5,           E3.O3Ecodecs.O3EInt8, 1, 'test1', {scale:10.0,signed:true}, [0x32]);
    codecDecode('Positive Number, scale=10, signed=true ', (2**7-1)/10, E3.O3Ecodecs.O3EInt8, 1, 'test2', {scale:10.0,signed:true}, [0x7f]);
    codecDecode('Negative Number, scale=10, signed=true ', -(2**7)/10,  E3.O3Ecodecs.O3EInt8, 1, 'test3', {scale:10.0,signed:true}, [0x80]);
    codecDecode('Negative Number, scale= 1, signed=true ', -5,          E3.O3Ecodecs.O3EInt8, 1, 'test4', {scale:1.0, signed:true}, [0xfb]);
    codecDecode('Positive Number, scale=10, signed=false', 25.1,        E3.O3Ecodecs.O3EInt8, 1, 'test5', {scale:10.0,signed:false}, [0xfb]);
});

describe('codecs.js => O3EInt16().decode()', () => {
    codecDecode('Positive Number, scale=10, signed=true ', 5,            E3.O3Ecodecs.O3EInt16, 2, 'test1', {scale:10.0,signed:true}, [0x32,0x00]);
    codecDecode('Positive Number, scale=10, signed=true ', (2**15-1)/10, E3.O3Ecodecs.O3EInt16, 2, 'test2', {scale:10.0,signed:true}, [0xff,0x7f]);
    codecDecode('Negative Number, scale=10, signed=true ', -(2**15)/10,  E3.O3Ecodecs.O3EInt16, 2, 'test3', {scale:10.0,signed:true}, [0x00,0x80]);
    codecDecode('Negative Number, scale= 1, signed=true ', -5,           E3.O3Ecodecs.O3EInt16, 2, 'test4', {scale:1.0, signed:true}, [0xfb,0xff]);
    codecDecode('Positive Number, scale=10, signed=false', (2**16-1)/10, E3.O3Ecodecs.O3EInt16, 2, 'test5', {scale:10.0,signed:false}, [0xff,0xff]);
    codecDecode('Positive Number, scale=10, signed=false', 25.1,         E3.O3Ecodecs.O3EInt16, 2, 'test6', {scale:10.0,signed:false}, [0xfb,0x00]);
});

describe('codecs.js => O3EInt32().decode()', () => {
    codecDecode('Positive Number, scale=10, signed=true ', 5,            E3.O3Ecodecs.O3EInt32, 4, 'test1', {scale:10.0,signed:true}, [0x32,0x00,0x00,0x00]);
    codecDecode('Positive Number, scale=10, signed=true ', (2**31-1)/10, E3.O3Ecodecs.O3EInt32, 4, 'test2', {scale:10.0,signed:true}, [0xff,0xff,0xff,0x7f]);
    codecDecode('Negative Number, scale=10, signed=true ', -(2**31)/10,  E3.O3Ecodecs.O3EInt32, 4, 'test3', {scale:10.0,signed:true}, [0x00,0x00,0x00,0x80]);
    codecDecode('Negative Number, scale= 1, signed=true ', -5,           E3.O3Ecodecs.O3EInt32, 4, 'test4', {scale:1.0, signed:true}, [0xfb,0xff,0xff,0xff]);
    codecDecode('Positive Number, scale=10, signed=false', (2**32-1)/10, E3.O3Ecodecs.O3EInt32, 4, 'test5', {scale:10.0,signed:false}, [0xff,0xff,0xff,0xff]);
    codecDecode('Positive Number, scale=10, signed=false', 25.1,         E3.O3Ecodecs.O3EInt32, 4, 'test6', {scale:10.0,signed:false}, [0xfb,0x00,0x00,0x00]);
});

describe('codecs.js => O3EInt64().decode()', () => {
    codecDecode('Positive Number, scale=10, signed=true ', 5,              E3.O3Ecodecs.O3EInt64, 8, 'test1',  {scale:10.0,signed:true}, [0x32,0x00,0x00,0x00,0x00,0x00,0x00,0x00]);
    codecDecode('Positive Number, scale=10, signed=true ', (2**63-1)/10,   E3.O3Ecodecs.O3EInt64, 8, 'test2a', {scale:10.0,signed:true}, [0xff,0xff,0xff,0xff,0xff,0xff,0xff,0x7f]);
    codecDecode('Positive Number, scale=10, signed=true ', (2**52-1)/10,   E3.O3Ecodecs.O3EInt64, 8, 'test2b', {scale:10.0,signed:true}, [0xff,0xff,0xff,0xff,0xff,0xff,0x0f,0x00]);
    codecDecode('Negative Number, scale=10, signed=true ', -(2**63)/10,    E3.O3Ecodecs.O3EInt64, 8, 'test3a',  {scale:10.0,signed:true}, [0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x80]);
    codecDecode('Negative Number, scale=10, signed=true ', -(2**52-1)/10,  E3.O3Ecodecs.O3EInt64, 8, 'test3b', {scale:10.0,signed:true}, [0x01,0x00,0x00,0x00,0x00,0x00,0xf0,0xff]);
    codecDecode('Negative Number, scale= 1, signed=true ', -5,             E3.O3Ecodecs.O3EInt64, 8, 'test4',  {scale:1.0, signed:true}, [0xfb,0xff,0xff,0xff,0xff,0xff,0xff,0xff]);
    codecDecode('Positive Number, scale=10, signed=false', (2**64-1)/10,   E3.O3Ecodecs.O3EInt64, 8, 'test5a', {scale:10.0,signed:false}, [0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff]);
    codecDecode('Positive Number, scale=10, signed=false', (2**52-1)/10,   E3.O3Ecodecs.O3EInt64, 8, 'test5b', {scale:10.0,signed:false}, [0xff,0xff,0xff,0xff,0xff,0xff,0x0f,0x00]);
    codecDecode('Positive Number, scale=10, signed=false', 25.1,           E3.O3Ecodecs.O3EInt64, 8, 'test6',  {scale:10.0,signed:false}, [0xfb,0x00,0x00,0x00,0x00,0x00,0x00,0x00]);
});

// Integer ENCODER:
describe('codecs.js => O3EInt8().encode()', () => {
    codecEncode('Positive Number, scale=10, signed=true ', [0x32], E3.O3Ecodecs.O3EInt8, 1, 'test1', {scale:10.0,signed:true}, 5);
    codecEncode('Positive Number, scale=10, signed=true ', [0x7f], E3.O3Ecodecs.O3EInt8, 1, 'test2', {scale:10.0,signed:true}, (2**7-1)/10);
    codecEncode('Negative Number, scale=10, signed=true ', [0x80], E3.O3Ecodecs.O3EInt8, 1, 'test3', {scale:10.0,signed:true}, -(2**7)/10);
    codecEncode('Negative Number, scale= 1, signed=true ', [0xfb], E3.O3Ecodecs.O3EInt8, 1, 'test4', {scale:1.0, signed:true}, -5);
    codecEncode('Positive Number, scale=10, signed=false', [0xfb], E3.O3Ecodecs.O3EInt8, 1, 'test5', {scale:10.0,signed:false}, 25.1);
});

describe('codecs.js => O3EInt16().encode()', () => {
    codecEncode('Positive Number, scale=10, signed=true ', [0x32,0x00], E3.O3Ecodecs.O3EInt16, 2, 'test1', {scale:10.0,signed:true}, 5);
    codecEncode('Positive Number, scale=10, signed=true ', [0xff,0x7f], E3.O3Ecodecs.O3EInt16, 2, 'test2', {scale:10.0,signed:true}, (2**15-1)/10);
    codecEncode('Negative Number, scale=10, signed=true ', [0x00,0x80], E3.O3Ecodecs.O3EInt16, 2, 'test3', {scale:10.0,signed:true}, -(2**15)/10);
    codecEncode('Negative Number, scale= 1, signed=true ', [0xfb,0xff], E3.O3Ecodecs.O3EInt16, 2, 'test4', {scale:1.0, signed:true}, -5);
    codecEncode('Positive Number, scale=10, signed=false', [0xff,0xff], E3.O3Ecodecs.O3EInt16, 2, 'test5', {scale:10.0,signed:false}, (2**16-1)/10);
    codecEncode('Positive Number, scale=10, signed=false', [0xfb,0x00], E3.O3Ecodecs.O3EInt16, 2, 'test6', {scale:10.0,signed:false}, 25.1);
});

describe('codecs.js => O3EInt32().encode()', () => {
    codecEncode('Positive Number, scale=10, signed=true ', [0x32,0x00,0x00,0x00], E3.O3Ecodecs.O3EInt32, 4, 'test1', {scale:10.0,signed:true}, 5);
    codecEncode('Positive Number, scale=10, signed=true ', [0xff,0xff,0xff,0x7f], E3.O3Ecodecs.O3EInt32, 4, 'test2', {scale:10.0,signed:true}, (2**31-1)/10);
    codecEncode('Negative Number, scale=10, signed=true ', [0x00,0x00,0x00,0x80], E3.O3Ecodecs.O3EInt32, 4, 'test3', {scale:10.0,signed:true}, -(2**31)/10);
    codecEncode('Negative Number, scale= 1, signed=true ', [0xfb,0xff,0xff,0xff], E3.O3Ecodecs.O3EInt32, 4, 'test4', {scale:1.0, signed:true}, -5);
    codecEncode('Positive Number, scale=10, signed=false', [0xff,0xff,0xff,0xff], E3.O3Ecodecs.O3EInt32, 4, 'test5', {scale:10.0,signed:false}, (2**32-1)/10);
    codecEncode('Positive Number, scale=10, signed=false', [0xfb,0x00,0x00,0x00], E3.O3Ecodecs.O3EInt32, 4, 'test6', {scale:10.0,signed:false}, 25.1);
});

describe('codecs.js => O3EInt64().encode()', () => {
    codecEncode('Positive Number, scale=10, signed=true ', [0x32,0x00,0x00,0x00,0x00,0x00,0x00,0x00], E3.O3Ecodecs.O3EInt64, 8, 'test1', {scale:10.0,signed:true}, 5);
    codecEncode('Positive Number, scale=10, signed=true ', [0xff,0xff,0xff,0xff,0xff,0xff,0x0f,0x00], E3.O3Ecodecs.O3EInt64, 8, 'test2', {scale:10.0,signed:true}, (2**52-1)/10);
    codecEncode('Negative Number, scale=10, signed=true ', [0x01,0x00,0x00,0x00,0x00,0x00,0xf0,0xff], E3.O3Ecodecs.O3EInt64, 8, 'test3', {scale:10.0,signed:true}, -(2**52-1)/10);
    codecEncode('Negative Number, scale= 1, signed=true ', [0xfb,0xff,0xff,0xff,0xff,0xff,0xff,0xff], E3.O3Ecodecs.O3EInt64, 8, 'test4', {scale:1.0, signed:true}, -5);
    codecEncode('Positive Number, scale=10, signed=false', [0xff,0xff,0xff,0xff,0xff,0xff,0x0f,0x00], E3.O3Ecodecs.O3EInt64, 8, 'test5', {scale:10.0,signed:false}, (2**52-1)/10);
    codecEncode('Positive Number, scale=10, signed=false', [0xfb,0x00,0x00,0x00,0x00,0x00,0x00,0x00], E3.O3Ecodecs.O3EInt64, 8, 'test6', {scale:10.0,signed:false}, 25.1);
});

// Complex data structures
// Do testing for specific dids to cover all available codecs
describe('codecs.js => O3EComplexType()', () => {
    const raw_hex = '3b0206004700fd01c30801000300f9013001020030303030303030303030303030383135';
    const raw_arr = toByteArray(raw_hex);
    const js = {'BusAddress':59,'BusType':{'ID':2,'Text':'CanInternal'},'DeviceProperty':{'ID':6,'Text':'HMI'},'DeviceFunction':{'ID':0,'Text':'NOTHING'},'SW-Version':'71.509.2243.1','HW-Version':'3.505.304.2','VIN':'0000000000000815'};
    const cdi = E3DidsDict[256];
    codecDecode('Decoding did 256 ', js,      E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, raw_arr);
    // Encoding makes no sense for this did in real life, but testing helps to improve codec robustness
    codecEncode('Encoding did 256 ', raw_arr, E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, js);
});

describe('codecs.js => O3EList()', () => {
    const raw_hex = '0a00b001f30314170b12050e3a313602f30314170b12050e390c3602f30314170b12050e2f273602f30314170b12050d2b063602f30314170b12050d2a233602f30314170b12050d27383602f30314170b12050d26033602f30314170b12050d242d3602f30314170b12050d1f043602f30314170b12050d1e133602';
    const raw_arr = toByteArray(raw_hex);
    const js = {'Count':10,'GrandTotal':432,'ListEntries':[{'Error':{'ID':1011,'Text':'FailureCompressorOutletPressureSensor'},'DateTime':{'DateTime':'18/11/2023, 14:58:49','Timestamp':1700315929000},'Unknown':566},{'Error':{'ID':1011,'Text':'FailureCompressorOutletPressureSensor'},'DateTime':{'DateTime':'18/11/2023, 14:57:12','Timestamp':1700315832000},'Unknown':566},{'Error':{'ID':1011,'Text':'FailureCompressorOutletPressureSensor'},'DateTime':{'DateTime':'18/11/2023, 14:47:39','Timestamp':1700315259000},'Unknown':566},{'Error':{'ID':1011,'Text':'FailureCompressorOutletPressureSensor'},'DateTime':{'DateTime':'18/11/2023, 13:43:06','Timestamp':1700311386000},'Unknown':566},{'Error':{'ID':1011,'Text':'FailureCompressorOutletPressureSensor'},'DateTime':{'DateTime':'18/11/2023, 13:42:35','Timestamp':1700311355000},'Unknown':566},{'Error':{'ID':1011,'Text':'FailureCompressorOutletPressureSensor'},'DateTime':{'DateTime':'18/11/2023, 13:39:56','Timestamp':1700311196000},'Unknown':566},{'Error':{'ID':1011,'Text':'FailureCompressorOutletPressureSensor'},'DateTime':{'DateTime':'18/11/2023, 13:38:03','Timestamp':1700311083000},'Unknown':566},{'Error':{'ID':1011,'Text':'FailureCompressorOutletPressureSensor'},'DateTime':{'DateTime':'18/11/2023, 13:36:45','Timestamp':1700311005000},'Unknown':566},{'Error':{'ID':1011,'Text':'FailureCompressorOutletPressureSensor'},'DateTime':{'DateTime':'18/11/2023, 13:31:04','Timestamp':1700310664000},'Unknown':566},{'Error':{'ID':1011,'Text':'FailureCompressorOutletPressureSensor'},'DateTime':{'DateTime':'18/11/2023, 13:30:19','Timestamp':1700310619000},'Unknown':566}]};
    const cdi = E3DidsDict[266];
    codecDecode('Decoding did 266 ', js,      E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, raw_arr);
    // Encoding makes no sense for this did in real life, but testing helps to improve codec robustness
    codecEncode('Encoding did 266 ', raw_arr, E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, js);
});

describe('codecs.js => O3EComplexType()', () => {
    const raw_hex = '8c01c1007a027e0100';
    const raw_arr = toByteArray(raw_hex);
    const js = {'Actual':39.6,'Minimum':19.3,'Maximum':63.4,'Average':38.2,'Unknown':0};
    const cdi = E3DidsDict[268];
    codecDecode('Decoding did 268 ', js,      E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, raw_arr);
    // Encoding makes no sense for this did in real life, but testing helps to improve codec robustness
    codecEncode('Encoding did 268 ', raw_arr, E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, js);
});

describe('codecs.js => O3EComplexType()', () => {
    const raw_hex = '160014000e0011001700180019001a00150010000400000000000000000000000000000000000000000000000000000000000000000000000000000000001b001a0017001700050007000d0011000a00070008000c00120021001b0016001900180018001800180014001a0020001d001c001d001e001b0000000000';
    const raw_arr = toByteArray(raw_hex);
    const js = {'CurrentMonth':{'10':1.6,'11':0.4,'12':0,'13':0,'14':0,'15':0,'16':0,'17':0,'18':0,'19':0,'20':0,'21':0,'22':0,'23':0,'24':0,'25':0,'26':0,'27':0,'28':0,'29':0,'30':0,'31':0,'01':2.2,'02':2,'03':1.4,'04':1.7,'05':2.3,'06':2.4,'07':2.5,'08':2.6,'09':2.1},'LastMonth':{'10':0.7,'11':0.8,'12':1.2,'13':1.8,'14':3.3,'15':2.7,'16':2.2,'17':2.5,'18':2.4,'19':2.4,'20':2.4,'21':2.4,'22':2,'23':2.6,'24':3.2,'25':2.9,'26':2.8,'27':2.9,'28':3,'29':2.7,'30':0,'31':0,'01':2.7,'02':2.6,'03':2.3,'04':2.3,'05':0.5,'06':0.7,'07':1.3,'08':1.7,'09':1}};
    const cdi = E3DidsDict[1342];
    codecDecode('Decoding did 1342 ', js,      E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, raw_arr);
    // Encoding makes no sense for this did in real life, but testing helps to improve codec robustness
    codecEncode('Encoding did 1342 ', raw_arr, E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, js);
});

describe('codecs.js => O3EComplexType()', () => {
    const raw_hex = 'f9046f022500000000000000000000000000000000000000660442035e03e00126000000000000000000d600e8029f03';
    const raw_arr = toByteArray(raw_hex);
    const js = {'CurrentYear':{'01_January':127.3,'02_February':62.3,'03_March':3.7,'04_April':0,'05_May':0,'06_June':0,'07_July':0,'08_August':0,'09_September':0,'10_October':0,'11_November':0,'12_December':0},'LastYear':{'01_January':112.6,'02_February':83.4,'03_March':86.2,'04_April':48,'05_May':3.8,'06_June':0,'07_July':0,'08_August':0,'09_September':0,'10_October':21.4,'11_November':74.4,'12_December':92.7}};
    const cdi = E3DidsDict[1343];
    codecDecode('Decoding did 1343 ', js,      E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, raw_arr);
    // Encoding makes no sense for this did in real life, but testing helps to improve codec robustness
    codecEncode('Encoding did 1343 ', raw_arr, E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, js);
});

describe('codecs.js => O3EComplexType()', () => {
    const raw_hex = '04000200040003000200060003000400000002000100000000000000000000000000000000000000000000000000000000000000000000000000000000000300040001000300000000000000000000000000000000000000030001000300040002000200030003000400060003000400050002000600020000000000';
    const raw_arr = toByteArray(raw_hex);
    const js = {'CurrentMonth':{'10':0.2,'11':0.1,'12':0,'13':0,'14':0,'15':0,'16':0,'17':0,'18':0,'19':0,'20':0,'21':0,'22':0,'23':0,'24':0,'25':0,'26':0,'27':0,'28':0,'29':0,'30':0,'31':0,'01':0.4,'02':0.2,'03':0.4,'04':0.3,'05':0.2,'06':0.6,'07':0.3,'08':0.4,'09':0},'LastMonth':{'10':0,'11':0,'12':0,'13':0,'14':0.3,'15':0.1,'16':0.3,'17':0.4,'18':0.2,'19':0.2,'20':0.3,'21':0.3,'22':0.4,'23':0.6,'24':0.3,'25':0.4,'26':0.5,'27':0.2,'28':0.6,'29':0.2,'30':0,'31':0,'01':0.3,'02':0.4,'03':0.1,'04':0.3,'05':0,'06':0,'07':0,'08':0,'09':0}};
    const cdi = E3DidsDict[1344];
    codecDecode('Decoding did 1344 ', js,      E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, raw_arr);
    // Encoding makes no sense for this did in real life, but testing helps to improve codec robustness
    codecEncode('Encoding did 1344 ', raw_arr, E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, js);
});

describe('codecs.js => O3EComplexType()', () => {
    const raw_hex = '5800400006000000000000000000000000000000000000007b00740054004900420030003c0039003800470044005800';
    const raw_arr = toByteArray(raw_hex);
    const js = {'CurrentYear':{'01_January':8.8,'02_February':6.4,'03_March':0.6,'04_April':0,'05_May':0,'06_June':0,'07_July':0,'08_August':0,'09_September':0,'10_October':0,'11_November':0,'12_December':0},'LastYear':{'01_January':12.3,'02_February':11.6,'03_March':8.4,'04_April':7.3,'05_May':6.6,'06_June':4.8,'07_July':6,'08_August':5.7,'09_September':5.6,'10_October':7.1,'11_November':6.8,'12_December':8.8}};
    const cdi = E3DidsDict[1345];
    codecDecode('Decoding did 1345 ', js,      E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, raw_arr);
    // Encoding makes no sense for this did in real life, but testing helps to improve codec robustness
    codecEncode('Encoding did 1345 ', raw_arr, E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, js);
});

describe('codecs.js => O3EList()', () => {
    const raw_hex = '020800091e0000030f001100000003000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
    const raw_arr = toByteArray(raw_hex);
    const js = {'Count':2,'Schedules':[{'Start':'08:00:00','Stop':'09:30:00','Unknown':'0000','Mode':3},{'Start':'15:00:00','Stop':'17:00:00','Unknown':'0000','Mode':3}]};
    const cdi = E3DidsDict[726];
    codecDecode('Decoding did 726 ', js,      E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, raw_arr);
    codecEncode('Encoding did 726 ', raw_arr, E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, js);
});

describe('codecs.js => O3EComplexType()', () => {
    const raw_hex = '38004f0068005c004b0045005400650059000602780090003c004c004b007400840058000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000028002f004200';
    const raw_arr = toByteArray(raw_hex);
    const js = {'CurrentMonth':{'10':51.8,'11':12,'12':14.4,'13':6,'14':7.6,'15':7.5,'16':11.6,'17':13.2,'18':8.8,'19':0,'20':0,'21':0,'22':0,'23':0,'24':0,'25':0,'26':0,'27':0,'28':0,'29':0,'30':0,'31':0,'01':5.6,'02':7.9,'03':10.4,'04':9.2,'05':7.5,'06':6.9,'07':8.4,'08':10.1,'09':8.9},'LastMonth':{'10':0,'11':0,'12':0,'13':0,'14':0,'15':0,'16':0.4,'17':0,'18':0,'19':0,'20':0,'21':0,'22':0,'23':0,'24':0,'25':0,'26':0,'27':0,'28':0,'29':4,'30':4.7,'31':6.6,'01':0,'02':0,'03':0,'04':0,'05':0,'06':0,'07':0,'08':0,'09':0}};
    const cdi = E3DidsDict[1294];
    codecDecode('Decoding did 1294 ', js,      E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, raw_arr);
    // Encoding makes no sense for this did in real life, but testing helps to improve codec robustness
    codecEncode('Encoding did 1294 ', raw_arr, E3.O3Ecodecs[cdi.codec], cdi.len, cdi.id, cdi.args, js);
});
