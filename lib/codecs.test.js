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

function codecDecode(descr, expected, codec, len, id, args, val) {
    it(`${descr} ${expected}`, () => {
        const f = new codec(len,id,args);
        const result = f.decode(val);
        expect(result).to.equal(expected);
    });
}

describe('codecs.js => O3EInt8().decode()', () => {
    codecDecode('Positive Number, scale=10, signed=true ', 5, E3.O3Ecodecs.O3EInt8, 1, 'test1', {scale:10.0,signed:true,offset: 0}, [0x32]);
    codecDecode('Positive Number, scale=10, signed=true ', (2**7-1)/10, E3.O3Ecodecs.O3EInt8, 1, 'test2', {scale:10.0,signed:true,offset: 0}, [0x7f]);
    codecDecode('Negative Number, scale=10, signed=true ', -(2**7)/10, E3.O3Ecodecs.O3EInt8, 1, 'test3', {scale:10.0,signed:true,offset: 0}, [0x80]);
    codecDecode('Negative Number, scale= 1, signed=true ', -5, E3.O3Ecodecs.O3EInt8, 1, 'test4', {scale:1.0,signed:true,offset: 0}, [0xfb]);
    codecDecode('Positive Number, scale=10, signed=false', 25.1, E3.O3Ecodecs.O3EInt8, 1, 'test5', {scale:10.0,signed:false,offset: 0}, [0xfb]);
});

describe('codecs.js => O3EInt16().decode()', () => {
    codecDecode('Positive Number, scale=10, signed=true ', 5, E3.O3Ecodecs.O3EInt16, 2, 'test1', {scale:10.0,signed:true,offset: 0}, [0x32,0x00]);
    codecDecode('Positive Number, scale=10, signed=true ', (2**15-1)/10, E3.O3Ecodecs.O3EInt16, 2, 'test2', {scale:10.0,signed:true,offset: 0}, [0xff,0x7f]);
    codecDecode('Negative Number, scale=10, signed=true ', -(2**15)/10, E3.O3Ecodecs.O3EInt16, 2, 'test3', {scale:10.0,signed:true,offset: 0}, [0x00,0x80]);
    codecDecode('Negative Number, scale= 1, signed=true ', -5, E3.O3Ecodecs.O3EInt16, 2, 'test4', {scale:1.0,signed:true,offset: 0}, [0xfb,0xff]);
    codecDecode('Positive Number, scale=10, signed=false', (2**16-1)/10, E3.O3Ecodecs.O3EInt16, 2, 'test5', {scale:10.0,signed:false,offset: 0}, [0xff,0xff]);
    codecDecode('Positive Number, scale=10, signed=false', 25.1, E3.O3Ecodecs.O3EInt16, 2, 'test6', {scale:10.0,signed:false,offset: 0}, [0xfb,0x00]);
});

describe('codecs.js => O3EInt32().decode()', () => {
    codecDecode('Positive Number, scale=10, signed=true ', 5, E3.O3Ecodecs.O3EInt32, 4, 'test1', {scale:10.0,signed:true,offset: 0}, [0x32,0x00,0x00,0x00]);
    codecDecode('Positive Number, scale=10, signed=true ', (2**31-1)/10, E3.O3Ecodecs.O3EInt32, 4, 'test2', {scale:10.0,signed:true,offset: 0}, [0xff,0xff,0xff,0x7f]);
    codecDecode('Negative Number, scale=10, signed=true ', -(2**31)/10, E3.O3Ecodecs.O3EInt32, 4, 'test3', {scale:10.0,signed:true,offset: 0}, [0x00,0x00,0x00,0x80]);
    codecDecode('Negative Number, scale= 1, signed=true ', -5, E3.O3Ecodecs.O3EInt32, 4, 'test4', {scale:1.0,signed:true,offset: 0}, [0xfb,0xff,0xff,0xff]);
    codecDecode('Positive Number, scale=10, signed=false', (2**32-1)/10, E3.O3Ecodecs.O3EInt32, 4, 'test5', {scale:10.0,signed:false,offset: 0}, [0xff,0xff,0xff,0xff]);
    codecDecode('Positive Number, scale=10, signed=false', 25.1, E3.O3Ecodecs.O3EInt32, 4, 'test6', {scale:10.0,signed:false,offset: 0}, [0xfb,0x00,0x00,0x00]);
});
