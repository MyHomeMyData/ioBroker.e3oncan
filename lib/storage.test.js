'use strict';

const { expect } = require('@iobroker/testing/node_modules/chai');
const { storageDids, storage, variableLengthDef } = require('./storage');

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

// ── Data points with variable length (variant with len 0) ─────────────────────

describe('storage.js => variableLengthDef()', () => {
    it('returns the variant with len 0 of a circuit name', () => {
        const def = variableLengthDef(627);
        expect(def).to.include({ codec: 'O3EUtf8', len: 0, id: 'CentralHeatingOneCircuitName' });
        expect(variableLengthDef('634')).to.include({ len: 0, id: 'CentralHeatingEightCircuitName' });
    });
    it('accepts lengths from 1 up to the common length', () => {
        expect(variableLengthDef(627, 1)).to.not.equal(null);
        expect(variableLengthDef(627, 4)).to.not.equal(null);
        expect(variableLengthDef(627, 40)).to.not.equal(null);
        expect(variableLengthDef(631, 40)).to.not.equal(null);
        expect(variableLengthDef(627, 41)).to.equal(null);
        expect(variableLengthDef(627, 0)).to.equal(null);
    });
    it('returns null for data points without such a variant', () => {
        expect(variableLengthDef(268)).to.equal(null);
        expect(variableLengthDef(504, 10)).to.equal(null);
        expect(variableLengthDef(99999)).to.equal(null);
    });
});

/**
 * storage instance in the given mode with stubbed state storage; records the stored states.
 *
 * @param {string} opMode  Mode of operation
 * @param {object} dids  Known data points of the device
 */
function makeStorage(opMode, dids) {
    const st = new storage({ stateBase: 'vitodens', device: 'default' });
    st.opMode = opMode;
    st.storageDids.dids = dids;
    const stored = [];
    st.storageDids.storeObjectTree = async (_ctx, _did, _idStr, stateId, val) => stored.push([stateId, val]);
    st.storageDids.storeObjectJson = async (_ctx, _did, _idStr, stateId, val) => stored.push([stateId, val]);
    st.storeStatistics = async () => {};
    return { st, stored };
}

const fakeCtx = {
    FORBIDDEN_CHARS: /[\][*,;'"`<>\\?]/g,
    udsMasterDevUnits: '',
    log: { warn: () => {}, debug: () => {}, silly: () => {}, error: () => {}, info: () => {} },
};
const fakeWorker = { config: { stateBase: 'vitodens', devUnits: '' } };
const HK1 = [0x48, 0x4b, 0x31, 0x00];
const HK11 = [0x48, 0x4b, 0x31, 0x31, 0x00];
const common627 = { codec: 'O3EUtf8', len: 40, id: 'CentralHeatingOneCircuitName', args: {} };
const varLen627 = { codec: 'O3EUtf8', len: 0, id: 'CentralHeatingOneCircuitName', args: {} };

describe('storage.js => storage.decodeDataCAN() with variable length', () => {
    it('decodes a data point known with len 0 with the actual length', async () => {
        const { st, stored } = makeStorage('normal', { 627: varLen627 });
        await st.decodeDataCAN(fakeCtx, fakeWorker, '627', HK1);
        expect(stored).to.deep.include(['vitodens.tree.0627_CentralHeatingOneCircuitName', 'HK1']);
        stored.length = 0;
        await st.decodeDataCAN(fakeCtx, fakeWorker, '627', HK11);
        expect(stored).to.deep.include(['vitodens.tree.0627_CentralHeatingOneCircuitName', 'HK11']);
        expect(stored).to.deep.include(['vitodens.raw.0627_CentralHeatingOneCircuitName', '484b313100']);
    });
    it('decodes a data point known with fixed length when the device sends another length', async () => {
        const { st, stored } = makeStorage('normal', { 627: common627 });
        await st.decodeDataCAN(fakeCtx, fakeWorker, '627', HK1);
        expect(stored).to.deep.include(['vitodens.tree.0627_CentralHeatingOneCircuitName', 'HK1']);
    });
    it('keeps decoding the fixed length with the known definition', async () => {
        const { st, stored } = makeStorage('normal', { 627: common627 });
        await st.decodeDataCAN(fakeCtx, fakeWorker, '627', HK1.concat(Array(36).fill(0)));
        expect(stored).to.deep.include(['vitodens.tree.0627_CentralHeatingOneCircuitName', 'HK1']);
    });
    it('stores a response longer than the common length as DeviceSpecific', async () => {
        const { st, stored } = makeStorage('normal', { 627: varLen627 });
        await st.decodeDataCAN(fakeCtx, fakeWorker, '627', Array(41).fill(0x41));
        expect(stored.map(s => s[0])).to.include('vitodens.tree.0627_DeviceSpecific');
    });
    it('leaves the selection of the variant to the scan callback during a data point scan', async () => {
        const { st } = makeStorage('udsDidScan', { 627: common627 });
        let result;
        const worker = { ...fakeWorker, callback: async (_ctx, _w, args) => (result = args[1]) };
        await st.decodeDataCAN(fakeCtx, worker, '627', HK1);
        expect(result.common).to.equal(false);
        expect(result.val).to.equal('484b3100');
    });
});

describe('storage.js => storage.encodeDataCAN() with variable length', () => {
    it('writes the name and one terminating zero for a data point with len 0', async () => {
        const { st } = makeStorage('normal', { 627: varLen627 });
        expect(await st.encodeDataCAN(fakeCtx, fakeWorker, '627', 'HK11')).to.deep.equal(HK11);
    });
    it('pads to the fixed length for a data point with fixed length', async () => {
        const { st } = makeStorage('normal', { 627: common627 });
        const val = await st.encodeDataCAN(fakeCtx, fakeWorker, '627', 'HK1');
        expect(val).to.have.length(40);
        expect(val.slice(0, 4)).to.deep.equal(HK1);
    });
    it('rejects a name longer than the common length', async () => {
        const { st } = makeStorage('normal', { 627: varLen627 });
        expect(await st.encodeDataCAN(fakeCtx, fakeWorker, '627', 'x'.repeat(40))).to.equal(null);
        expect(await st.encodeDataCAN(fakeCtx, fakeWorker, '627', 'x'.repeat(39))).to.have.length(40);
    });
});
