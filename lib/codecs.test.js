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

// Integer DECODER:
describe('codecs.js => O3EInt8().decode()', () => {
    codecDecode('Positive Number, scale=10, signed=true ', 5,           E3.O3Ecodecs.O3EInt8, 1, 'test1', {scale:10.0,signed:true, offset: 0}, [0x32]);
    codecDecode('Positive Number, scale=10, signed=true ', (2**7-1)/10, E3.O3Ecodecs.O3EInt8, 1, 'test2', {scale:10.0,signed:true, offset: 0}, [0x7f]);
    codecDecode('Negative Number, scale=10, signed=true ', -(2**7)/10,  E3.O3Ecodecs.O3EInt8, 1, 'test3', {scale:10.0,signed:true, offset: 0}, [0x80]);
    codecDecode('Negative Number, scale= 1, signed=true ', -5,          E3.O3Ecodecs.O3EInt8, 1, 'test4', {scale:1.0, signed:true, offset: 0}, [0xfb]);
    codecDecode('Positive Number, scale=10, signed=false', 25.1,        E3.O3Ecodecs.O3EInt8, 1, 'test5', {scale:10.0,signed:false,offset: 0}, [0xfb]);
});

describe('codecs.js => O3EInt16().decode()', () => {
    codecDecode('Positive Number, scale=10, signed=true ', 5,            E3.O3Ecodecs.O3EInt16, 2, 'test1', {scale:10.0,signed:true, offset: 0}, [0x32,0x00]);
    codecDecode('Positive Number, scale=10, signed=true ', (2**15-1)/10, E3.O3Ecodecs.O3EInt16, 2, 'test2', {scale:10.0,signed:true, offset: 0}, [0xff,0x7f]);
    codecDecode('Negative Number, scale=10, signed=true ', -(2**15)/10,  E3.O3Ecodecs.O3EInt16, 2, 'test3', {scale:10.0,signed:true, offset: 0}, [0x00,0x80]);
    codecDecode('Negative Number, scale= 1, signed=true ', -5,           E3.O3Ecodecs.O3EInt16, 2, 'test4', {scale:1.0, signed:true, offset: 0}, [0xfb,0xff]);
    codecDecode('Positive Number, scale=10, signed=false', (2**16-1)/10, E3.O3Ecodecs.O3EInt16, 2, 'test5', {scale:10.0,signed:false,offset: 0}, [0xff,0xff]);
    codecDecode('Positive Number, scale=10, signed=false', 25.1,         E3.O3Ecodecs.O3EInt16, 2, 'test6', {scale:10.0,signed:false,offset: 0}, [0xfb,0x00]);
});

describe('codecs.js => O3EInt32().decode()', () => {
    codecDecode('Positive Number, scale=10, signed=true ', 5,            E3.O3Ecodecs.O3EInt32, 4, 'test1', {scale:10.0,signed:true, offset: 0}, [0x32,0x00,0x00,0x00]);
    codecDecode('Positive Number, scale=10, signed=true ', (2**31-1)/10, E3.O3Ecodecs.O3EInt32, 4, 'test2', {scale:10.0,signed:true, offset: 0}, [0xff,0xff,0xff,0x7f]);
    codecDecode('Negative Number, scale=10, signed=true ', -(2**31)/10,  E3.O3Ecodecs.O3EInt32, 4, 'test3', {scale:10.0,signed:true, offset: 0}, [0x00,0x00,0x00,0x80]);
    codecDecode('Negative Number, scale= 1, signed=true ', -5,           E3.O3Ecodecs.O3EInt32, 4, 'test4', {scale:1.0, signed:true, offset: 0}, [0xfb,0xff,0xff,0xff]);
    codecDecode('Positive Number, scale=10, signed=false', (2**32-1)/10, E3.O3Ecodecs.O3EInt32, 4, 'test5', {scale:10.0,signed:false,offset: 0}, [0xff,0xff,0xff,0xff]);
    codecDecode('Positive Number, scale=10, signed=false', 25.1,         E3.O3Ecodecs.O3EInt32, 4, 'test6', {scale:10.0,signed:false,offset: 0}, [0xfb,0x00,0x00,0x00]);
});

// Integer ENCODER:
describe('codecs.js => O3EInt8().encode()', () => {
    codecEncode('Positive Number, scale=10, signed=true ', [0x32], E3.O3Ecodecs.O3EInt8, 1, 'test1', {scale:10.0,signed:true, offset: 0}, 5);
    codecEncode('Positive Number, scale=10, signed=true ', [0x7f], E3.O3Ecodecs.O3EInt8, 1, 'test2', {scale:10.0,signed:true, offset: 0}, (2**7-1)/10);
    codecEncode('Negative Number, scale=10, signed=true ', [0x80], E3.O3Ecodecs.O3EInt8, 1, 'test3', {scale:10.0,signed:true, offset: 0}, -(2**7)/10);
    codecEncode('Negative Number, scale= 1, signed=true ', [0xfb], E3.O3Ecodecs.O3EInt8, 1, 'test4', {scale:1.0, signed:true, offset: 0}, -5);
    codecEncode('Positive Number, scale=10, signed=false', [0xfb], E3.O3Ecodecs.O3EInt8, 1, 'test5', {scale:10.0,signed:false,offset: 0}, 25.1);
});

describe('codecs.js => O3EInt16().decode()', () => {
    codecEncode('Positive Number, scale=10, signed=true ', [0x32,0x00], E3.O3Ecodecs.O3EInt16, 2, 'test1', {scale:10.0,signed:true, offset: 0}, 5);
    codecEncode('Positive Number, scale=10, signed=true ', [0xff,0x7f], E3.O3Ecodecs.O3EInt16, 2, 'test2', {scale:10.0,signed:true, offset: 0}, (2**15-1)/10);
    codecEncode('Negative Number, scale=10, signed=true ', [0x00,0x80], E3.O3Ecodecs.O3EInt16, 2, 'test3', {scale:10.0,signed:true, offset: 0}, -(2**15)/10);
    codecEncode('Negative Number, scale= 1, signed=true ', [0xfb,0xff], E3.O3Ecodecs.O3EInt16, 2, 'test4', {scale:1.0, signed:true, offset: 0}, -5);
    codecEncode('Positive Number, scale=10, signed=false', [0xff,0xff], E3.O3Ecodecs.O3EInt16, 2, 'test5', {scale:10.0,signed:false,offset: 0}, (2**16-1)/10);
    codecEncode('Positive Number, scale=10, signed=false', [0xfb,0x00], E3.O3Ecodecs.O3EInt16, 2, 'test6', {scale:10.0,signed:false,offset: 0}, 25.1);
});

describe('codecs.js => O3EInt32().encode()', () => {
    codecEncode('Positive Number, scale=10, signed=true ', [0x32,0x00,0x00,0x00], E3.O3Ecodecs.O3EInt32, 4, 'test1', {scale:10.0,signed:true, offset: 0}, 5);
    codecEncode('Positive Number, scale=10, signed=true ', [0xff,0xff,0xff,0x7f], E3.O3Ecodecs.O3EInt32, 4, 'test2', {scale:10.0,signed:true, offset: 0}, (2**31-1)/10);
    codecEncode('Negative Number, scale=10, signed=true ', [0x00,0x00,0x00,0x80], E3.O3Ecodecs.O3EInt32, 4, 'test3', {scale:10.0,signed:true, offset: 0}, -(2**31)/10);
    codecEncode('Negative Number, scale= 1, signed=true ', [0xfb,0xff,0xff,0xff], E3.O3Ecodecs.O3EInt32, 4, 'test4', {scale:1.0, signed:true, offset: 0}, -5);
    codecEncode('Positive Number, scale=10, signed=false', [0xff,0xff,0xff,0xff], E3.O3Ecodecs.O3EInt32, 4, 'test5', {scale:10.0,signed:false,offset: 0}, (2**32-1)/10);
    codecEncode('Positive Number, scale=10, signed=false', [0xfb,0x00,0x00,0x00], E3.O3Ecodecs.O3EInt32, 4, 'test6', {scale:10.0,signed:false,offset: 0}, 25.1);
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

describe('codecs.js => O3EComplexType()', () => {
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
