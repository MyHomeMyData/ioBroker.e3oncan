'use strict';

const { expect } = require('@iobroker/testing/node_modules/chai');
const {
    buildTopologySummary,
    _swBuild,
    _s,
    _extractUdsDevices,
    _buildDevPropNames,
    _collectTopologyElements,
    _buildEnergyMeterList,
} = require('./topologyAnalysis');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BUS_ID_A = {
    DeviceProperty: { ID: 101, Text: 'HPMUMASTER' },
    BusAddress: 1,
    'SW-Version': '1.2.2301.4',
    'HW-Version': '2.0',
    VIN: 'AAAA000000000001',
};

const BUS_ID_B = {
    DeviceProperty: { ID: 201, Text: 'EMCUMASTER' },
    BusAddress: 2,
    'SW-Version': '1.0.2210.1',
    'HW-Version': '1.0',
    VIN: 'BBBB000000000002',
};

/** One topology element reported by device A */
const ELEM_INT = {
    NodeID: 1,
    DeviceProperty: 101,
    BusType: { ID: 2, Text: 'CanInternal' },
    'SW-Version': '1.2.2301.4',
    'HW-Version': '2.0',
    VIN: 'AAAA000000000001',
};

/** Same element as ELEM_INT but with a newer SW build */
const ELEM_INT_NEWER = {
    NodeID: 1,
    DeviceProperty: 101,
    BusType: { ID: 2, Text: 'CanInternal' },
    'SW-Version': '1.2.2402.1',
    'HW-Version': '2.1',
    VIN: 'AAAA000000000099',
};

const ELEM_EXT = {
    NodeID: 3,
    DeviceProperty: 201,
    BusType: { ID: 3, Text: 'CanExternal' },
    'SW-Version': '1.0.2210.1',
    'HW-Version': '1.0',
    VIN: 'BBBB000000000002',
};

function makeTopologyData(entries) {
    // entries: array of { addr, busId?, matrices? }
    const data = {};
    for (const e of entries) {
        data[e.addr] = {
            busId: e.busId ?? null,
            matrices: e.matrices ?? [],
        };
    }
    return data;
}

function makeMatrix(elements) {
    return { Count: elements.length, TopologyElement: elements };
}

// ── _swBuild ─────────────────────────────────────────────────────────────────

describe('topologyAnalysis.js => _swBuild()', () => {
    it('returns 0 for empty string', () => {
        expect(_swBuild('')).to.equal(0);
    });
    it('returns 0 for undefined', () => {
        expect(_swBuild(undefined)).to.equal(0);
    });
    it('returns 0 when third segment is missing', () => {
        expect(_swBuild('1.2')).to.equal(0);
    });
    it('extracts third version segment as integer', () => {
        expect(_swBuild('1.2.2301.4')).to.equal(2301);
    });
    it('works when segment value is zero', () => {
        expect(_swBuild('1.0.0.0')).to.equal(0);
    });
});

// ── _s ───────────────────────────────────────────────────────────────────────

describe('topologyAnalysis.js => _s()', () => {
    it('returns em-dash for null', () => {
        expect(_s(null)).to.equal('—');
    });
    it('returns em-dash for undefined', () => {
        expect(_s(undefined)).to.equal('—');
    });
    it('returns em-dash for empty string', () => {
        expect(_s('')).to.equal('—');
    });
    it('returns "0" for numeric zero (falsy but valid)', () => {
        expect(_s(0)).to.equal('0');
    });
    it('stringifies a number', () => {
        expect(_s(42)).to.equal('42');
    });
    it('returns a string unchanged', () => {
        expect(_s('hello')).to.equal('hello');
    });
});

// ── _extractUdsDevices ───────────────────────────────────────────────────────

describe('topologyAnalysis.js => _extractUdsDevices()', () => {
    it('returns empty array for null input', () => {
        expect(_extractUdsDevices(null)).to.deep.equal([]);
    });
    it('skips devices without busId', () => {
        const data = makeTopologyData([{ addr: '0x680' }]); // busId defaults to null
        expect(_extractUdsDevices(data)).to.deep.equal([]);
    });
    it('extracts device fields correctly', () => {
        const data = makeTopologyData([{ addr: '0x680', busId: BUS_ID_A }]);
        const result = _extractUdsDevices(data);
        expect(result).to.have.length(1);
        expect(result[0].canAddr).to.equal('0x680');
        expect(result[0].devType).to.equal('HPMUMASTER');
        expect(result[0].devPropId).to.equal(101);
        expect(result[0].nodeId).to.equal(1);
        expect(result[0].swVersion).to.equal('1.2.2301.4');
        expect(result[0].vin).to.equal('AAAA000000000001');
    });
    it('sorts devices by CAN address ascending', () => {
        const data = makeTopologyData([
            { addr: '0x6a1', busId: BUS_ID_B },
            { addr: '0x680', busId: BUS_ID_A },
        ]);
        const result = _extractUdsDevices(data);
        expect(result[0].canAddr).to.equal('0x680');
        expect(result[1].canAddr).to.equal('0x6a1');
    });
    it('uses DeviceProperty ID as devType when Text is absent', () => {
        const busId = { DeviceProperty: { ID: 99 }, BusAddress: 5, 'SW-Version': '', 'HW-Version': '', VIN: '' };
        const data = makeTopologyData([{ addr: '0x6c0', busId }]);
        const result = _extractUdsDevices(data);
        expect(result[0].devType).to.equal('99');
    });
});

// ── _buildDevPropNames ───────────────────────────────────────────────────────

describe('topologyAnalysis.js => _buildDevPropNames()', () => {
    it('returns empty map for null input', () => {
        expect(_buildDevPropNames(null)).to.deep.equal({});
    });
    it('builds name map from busId entries', () => {
        const data = makeTopologyData([
            { addr: '0x680', busId: BUS_ID_A },
            { addr: '0x6a1', busId: BUS_ID_B },
        ]);
        const map = _buildDevPropNames(data);
        expect(map[101]).to.equal('HPMUMASTER');
        expect(map[201]).to.equal('EMCUMASTER');
    });
    it('skips devices without busId', () => {
        const data = makeTopologyData([{ addr: '0x680' }]);
        expect(_buildDevPropNames(data)).to.deep.equal({});
    });
    it('skips DeviceProperty entries missing ID or Text', () => {
        const busId = { DeviceProperty: { ID: 5 } }; // no Text
        const data = makeTopologyData([{ addr: '0x680', busId }]);
        expect(_buildDevPropNames(data)).to.deep.equal({});
    });
});

// ── _collectTopologyElements ─────────────────────────────────────────────────

describe('topologyAnalysis.js => _collectTopologyElements()', () => {
    it('returns empty array for null input', () => {
        expect(_collectTopologyElements(null, {})).to.deep.equal([]);
    });
    it('skips matrices with Count = 0', () => {
        const data = makeTopologyData([{
            addr: '0x680',
            busId: BUS_ID_A,
            matrices: [{ Count: 0, TopologyElement: [ELEM_INT] }],
        }]);
        expect(_collectTopologyElements(data, {})).to.deep.equal([]);
    });
    it('skips matrices where TopologyElement is not an array', () => {
        const data = makeTopologyData([{
            addr: '0x680',
            busId: BUS_ID_A,
            matrices: [{ Count: 1, TopologyElement: null }],
        }]);
        expect(_collectTopologyElements(data, {})).to.deep.equal([]);
    });
    it('collects a single element with correct fields', () => {
        const data = makeTopologyData([{
            addr: '0x680',
            busId: BUS_ID_A,
            matrices: [makeMatrix([ELEM_INT])],
        }]);
        const devPropNames = { 101: 'HPMUMASTER' };
        const result = _collectTopologyElements(data, devPropNames);
        expect(result).to.have.length(1);
        expect(result[0].nodeId).to.equal(1);
        expect(result[0].busTypeId).to.equal(2);
        expect(result[0].busType).to.equal('CanInternal');
        expect(result[0].devType).to.equal('HPMUMASTER');
        expect(result[0].swVersion).to.equal('1.2.2301.4');
        expect(result[0].reportedBy).to.deep.equal(['0x680']);
    });
    it('deduplicates identical element reported by two devices', () => {
        const data = makeTopologyData([
            { addr: '0x680', busId: BUS_ID_A, matrices: [makeMatrix([ELEM_INT])] },
            { addr: '0x6a1', busId: BUS_ID_B, matrices: [makeMatrix([ELEM_INT])] },
        ]);
        const result = _collectTopologyElements(data, {});
        expect(result).to.have.length(1);
        expect(result[0].reportedBy).to.include('0x680');
        expect(result[0].reportedBy).to.include('0x6a1');
    });
    it('keeps the newer SW build when deduplicating', () => {
        const data = makeTopologyData([
            { addr: '0x680', busId: BUS_ID_A, matrices: [makeMatrix([ELEM_INT])] },       // SW 2301
            { addr: '0x6a1', busId: BUS_ID_B, matrices: [makeMatrix([ELEM_INT_NEWER])] }, // SW 2402
        ]);
        const result = _collectTopologyElements(data, {});
        expect(result).to.have.length(1);
        expect(result[0].swVersion).to.equal('1.2.2402.1');
        expect(result[0].vin).to.equal('AAAA000000000099');
    });
    it('does not replace existing entry with an older SW build', () => {
        const data = makeTopologyData([
            { addr: '0x680', busId: BUS_ID_A, matrices: [makeMatrix([ELEM_INT_NEWER])] }, // SW 2402 first
            { addr: '0x6a1', busId: BUS_ID_B, matrices: [makeMatrix([ELEM_INT])] },       // SW 2301 second
        ]);
        const result = _collectTopologyElements(data, {});
        expect(result).to.have.length(1);
        expect(result[0].swVersion).to.equal('1.2.2402.1');
    });
    it('sorts by busTypeId then by nodeId', () => {
        const elemA = { NodeID: 5, DeviceProperty: 10, BusType: { ID: 3, Text: 'CanExternal' }, 'SW-Version': '', 'HW-Version': '', VIN: '' };
        const elemB = { NodeID: 2, DeviceProperty: 20, BusType: { ID: 2, Text: 'CanInternal' }, 'SW-Version': '', 'HW-Version': '', VIN: '' };
        const elemC = { NodeID: 1, DeviceProperty: 30, BusType: { ID: 3, Text: 'CanExternal' }, 'SW-Version': '', 'HW-Version': '', VIN: '' };
        const data = makeTopologyData([{
            addr: '0x680',
            matrices: [makeMatrix([elemA, elemB, elemC])],
        }]);
        const result = _collectTopologyElements(data, {});
        expect(result[0].busTypeId).to.equal(2); // CanInternal first
        expect(result[1].nodeId).to.equal(1);     // CanExternal nodeId 1 before 5
        expect(result[2].nodeId).to.equal(5);
    });
    it('uses KNOWN_DEV_PROP_NAMES for DeviceProperty ID 27 (E380)', () => {
        const elem = { NodeID: 10, DeviceProperty: 27, BusType: { ID: 3, Text: 'CanExternal' }, 'SW-Version': '', 'HW-Version': '', VIN: '' };
        const data = makeTopologyData([{ addr: '0x680', matrices: [makeMatrix([elem])] }]);
        const result = _collectTopologyElements(data, {}); // devPropNames empty
        expect(result[0].devType).to.equal('E380');
    });
});

// ── _buildEnergyMeterList ────────────────────────────────────────────────────

describe('topologyAnalysis.js => _buildEnergyMeterList()', () => {
    it('returns empty array for empty input', () => {
        expect(_buildEnergyMeterList({})).to.deep.equal([]);
    });
    it('returns empty array for null input', () => {
        expect(_buildEnergyMeterList(null)).to.deep.equal([]);
    });
    it('includes E380 at address 97 when present', () => {
        const result = _buildEnergyMeterList({ e380_97: 'ext' });
        expect(result).to.have.length(1);
        expect(result[0].type).to.equal('E380');
        expect(result[0].canAddr).to.equal(97);
        expect(result[0].channel).to.equal('ext');
        expect(result[0].channelLabel).to.equal('UDS CAN');
    });
    it('includes E380 at address 98 when present', () => {
        const result = _buildEnergyMeterList({ e380_98: 'int' });
        expect(result).to.have.length(1);
        expect(result[0].canAddr).to.equal(98);
        expect(result[0].channelLabel).to.equal('2nd CAN');
    });
    it('includes both E380 devices when both present', () => {
        const result = _buildEnergyMeterList({ e380_97: 'ext', e380_98: 'int' });
        expect(result).to.have.length(2);
        expect(result.map(m => m.canAddr)).to.deep.equal([97, 98]);
    });
    it('includes E3100CB with null canAddr', () => {
        const result = _buildEnergyMeterList({ e3100cb: 'ext' });
        expect(result).to.have.length(1);
        expect(result[0].type).to.equal('E3100CB');
        expect(result[0].canAddr).to.be.null;
    });
    it('handles all three meters simultaneously', () => {
        const result = _buildEnergyMeterList({ e380_97: 'ext', e380_98: 'int', e3100cb: 'ext' });
        expect(result).to.have.length(3);
    });
    it('uses raw channel string as label when unknown channel key', () => {
        const result = _buildEnergyMeterList({ e380_97: 'unknown' });
        expect(result[0].channelLabel).to.equal('unknown');
    });
});

// ── buildTopologySummary ─────────────────────────────────────────────────────

describe('topologyAnalysis.js => buildTopologySummary()', () => {
    const topologyData = makeTopologyData([
        {
            addr: '0x680',
            busId: BUS_ID_A,
            matrices: [makeMatrix([ELEM_INT, ELEM_EXT])],
        },
    ]);
    const detectedEnergyMeters = { e380_97: 'ext' };

    it('returns an object with json and html properties', () => {
        const result = buildTopologySummary(topologyData, detectedEnergyMeters);
        expect(result).to.have.property('json');
        expect(result).to.have.property('html');
    });
    it('json contains required top-level fields', () => {
        const { json } = buildTopologySummary(topologyData, detectedEnergyMeters);
        expect(json).to.have.property('scanTime');
        expect(json).to.have.property('udsDevices');
        expect(json).to.have.property('topologyElements');
        expect(json).to.have.property('energyMeters');
    });
    it('json.udsDevices contains the scanned device', () => {
        const { json } = buildTopologySummary(topologyData, detectedEnergyMeters);
        expect(json.udsDevices).to.have.length(1);
        expect(json.udsDevices[0].canAddr).to.equal('0x680');
    });
    it('json.topologyElements contains both elements', () => {
        const { json } = buildTopologySummary(topologyData, detectedEnergyMeters);
        expect(json.topologyElements).to.have.length(2);
    });
    it('json.energyMeters contains the detected E380', () => {
        const { json } = buildTopologySummary(topologyData, detectedEnergyMeters);
        expect(json.energyMeters).to.have.length(1);
        expect(json.energyMeters[0].type).to.equal('E380');
    });
    it('scanTime is a valid ISO date string', () => {
        const { json } = buildTopologySummary(topologyData, {});
        expect(new Date(json.scanTime).toISOString()).to.equal(json.scanTime);
    });
    it('html contains table markup', () => {
        const { html } = buildTopologySummary(topologyData, detectedEnergyMeters);
        expect(html).to.include('<table');
        expect(html).to.include('</table>');
    });
    it('html contains UDS badge for device present in both UDS and topology', () => {
        const { html } = buildTopologySummary(topologyData, {});
        expect(html).to.include('UDS</span>');
    });
    it('handles null topologyData gracefully', () => {
        const result = buildTopologySummary(null, {});
        expect(result.json.udsDevices).to.deep.equal([]);
        expect(result.json.topologyElements).to.deep.equal([]);
    });
});
