'use strict';

const { expect } = require('@iobroker/testing/node_modules/chai');
const { storageDids, storage } = require('./storage');

// storageDids and storage share the same utility methods (toHex, arr2Hex,
// toByteArray, getDidStr, mergeDids). We test them through storageDids since
// that's where mergeDids lives, and the hex utilities are defined there too.

function makeStorageDids(device = 'default') {
    return new storageDids({ stateBase: 'test', device });
}

// ── toHex ─────────────────────────────────────────────────────────────────────

describe('storage.js => storageDids.toHex()', () => {
    const s = makeStorageDids();

    it('formats 0 as "00"', () => {
        expect(s.toHex(0)).to.equal('00');
    });
    it('formats 255 as "ff"', () => {
        expect(s.toHex(255)).to.equal('ff');
    });
    it('formats a single-digit value with leading zero', () => {
        expect(s.toHex(10)).to.equal('0a');
    });
    it('formats 127 correctly', () => {
        expect(s.toHex(127)).to.equal('7f');
    });
    it('accepts a numeric string', () => {
        expect(s.toHex('16')).to.equal('10');
    });
});

// ── arr2Hex ───────────────────────────────────────────────────────────────────

describe('storage.js => storageDids.arr2Hex()', () => {
    const s = makeStorageDids();

    it('returns empty string for empty array', () => {
        expect(s.arr2Hex([])).to.equal('');
    });
    it('converts a single byte', () => {
        expect(s.arr2Hex([0x21])).to.equal('21');
    });
    it('converts multiple bytes', () => {
        expect(s.arr2Hex([0x21, 0xfa, 0x01, 0xb3])).to.equal('21fa01b3');
    });
    it('pads single-digit bytes with leading zero', () => {
        expect(s.arr2Hex([0x00, 0x0f])).to.equal('000f');
    });
});

// ── toByteArray ───────────────────────────────────────────────────────────────

describe('storage.js => storageDids.toByteArray()', () => {
    const s = makeStorageDids();

    it('returns empty array for empty string', () => {
        expect(s.toByteArray('')).to.deep.equal([]);
    });
    it('converts a two-char hex string', () => {
        expect(s.toByteArray('21')).to.deep.equal([0x21]);
    });
    it('converts a multi-byte hex string', () => {
        expect(s.toByteArray('21fa01b3')).to.deep.equal([0x21, 0xfa, 0x01, 0xb3]);
    });
    it('is case-insensitive', () => {
        expect(s.toByteArray('FF')).to.deep.equal([255]);
        expect(s.toByteArray('ff')).to.deep.equal([255]);
    });
});

// ── arr2Hex / toByteArray round-trip ─────────────────────────────────────────

describe('storage.js => arr2Hex / toByteArray round-trip', () => {
    const s = makeStorageDids();

    it('arr2Hex → toByteArray restores original array', () => {
        const original = [0x00, 0x21, 0x7f, 0x80, 0xff];
        expect(s.toByteArray(s.arr2Hex(original))).to.deep.equal(original);
    });
    it('toByteArray → arr2Hex restores original string', () => {
        const hex = '00217f80ff';
        expect(s.arr2Hex(s.toByteArray(hex))).to.equal(hex);
    });
});

// ── getDidStr ─────────────────────────────────────────────────────────────────

describe('storage.js => storageDids.getDidStr()', () => {
    it('formats DID as 4-digit string with leading zeros for standard devices', () => {
        const s = makeStorageDids('default');
        expect(s.getDidStr(1)).to.equal('0001');
        expect(s.getDidStr(256)).to.equal('0256');
        expect(s.getDidStr(1289)).to.equal('1289');
    });
    it('returns plain string without padding for e3100cb', () => {
        const s = makeStorageDids('e3100cb');
        expect(s.getDidStr(1)).to.equal('1');
        expect(s.getDidStr(256)).to.equal('256');
    });
    it('truncates to last 4 digits for large DID values on standard devices', () => {
        const s = makeStorageDids('default');
        expect(s.getDidStr(12345)).to.equal('2345');
    });
});

// ── mergeDids ─────────────────────────────────────────────────────────────────

describe('storage.js => storageDids.mergeDids()', () => {
    const s = makeStorageDids();

    it('returns a copy of common DIDs when device-specific list is empty', async () => {
        const common = { '0100': { codec: 'O3EInt8' }, '0200': { codec: 'O3EUtf8' } };
        const result = await s.mergeDids(common, {});
        expect(result).to.deep.equal(common);
        // Must be a copy, not the same reference
        expect(result).to.not.equal(common);
    });
    it('device-specific DID overwrites common DID with same key', async () => {
        const common = { '0100': { codec: 'O3EInt8' } };
        const specific = { '0100': { codec: 'O3EUtf8' } };
        const result = await s.mergeDids(common, specific);
        expect(result['0100'].codec).to.equal('O3EUtf8');
    });
    it('device-specific DID is added when not in common list', async () => {
        const common = { '0100': { codec: 'O3EInt8' } };
        const specific = { '0999': { codec: 'O3EFloat32' } };
        const result = await s.mergeDids(common, specific);
        expect(result).to.have.property('0100');
        expect(result).to.have.property('0999');
    });
    it('Version key from device-specific list is not carried over', async () => {
        const common = { '0100': { codec: 'O3EInt8' }, Version: '20240101' };
        const specific = { Version: '20250101', '0999': { codec: 'O3EFloat32' } };
        const result = await s.mergeDids(common, specific);
        // Version from specific must not overwrite or be added
        expect(result.Version).to.equal('20240101');
    });
});
