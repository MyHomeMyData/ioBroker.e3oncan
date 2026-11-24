'use strict';

const { expect } = require('@iobroker/testing/node_modules/chai');
const {
    PLANT_DIDS,
    PLANT_PENDING_NOTE,
    buildPlantProfile,
    buildPlantHtml,
    _listDevices,
    _findRoles,
    _componentDids,
    _modelName,
} = require('./plantProfile');
const { buildTopologySummary } = require('./topologyAnalysis');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const sensor = (actual, statusId = 0) => ({
    Actual: actual,
    Minimum: 0,
    Maximum: 0,
    Average: 0,
    SensorStatus: { ID: statusId, Text: statusId === 0 ? 'no_error' : 'not_available' },
});
const busId = text => ({ busId: { DeviceProperty: { ID: 0, Text: text } } });

// DID 1238 of a Vitocal 252-A (open3e-esp32 docs/anlage.md)
const COMPONENTS_252A = {
    Count: 7,
    Components: [381, 1842, 1774, 1775, 388, 390, 491].map(Did => ({ Did })),
};

/** Split heat pump: HPMUMASTER indoor, VCMU outdoor, plus a backend gateway answering everything. */
function heatPumpData() {
    const gatewayFound = Array.from({ length: 1200 }, (_, i) => 256 + i);
    return {
        topologyData: {
            '0x680': busId('HPMUMASTER'),
            '0x68c': busId('VCMU'),
            '0x6a1': busId('BACKENDGATEWAY'),
        },
        plantData: {
            '0x680': {
                found: new Set([256, 268, 271, 274, 284, 286, 318, 376, 381, 377, 1238, 2342, 933, 1415, 1416, 627, 281]),
                vals: {
                    268: sensor(35),
                    271: sensor(48),
                    274: sensor(5),
                    284: sensor(35),
                    286: sensor(-3276.8, 4),
                    281: sensor(-3276.8, 4),
                    318: sensor(1.7),
                    377: '7994220123456789',
                    1238: COMPONENTS_252A,
                    2342: 6000,
                    933: { MixerCircuitType: { ID: 1, Text: 'UnderFloorCentralHeating' } },
                    1415: { Mode: { ID: 1, Text: 'Heating' }, State: { ID: 2, Text: 'Heating Normal' } },
                    1416: { Mode: { ID: 0, Text: 'Off' }, State: { ID: 0, Text: 'Off' } },
                    627: 'Ground floor   ',
                },
            },
            '0x68c': {
                found: new Set([256, 2346, 2569, 1775, 1776, 388, 390, 1773, 321, 322, 324, 325, 377, 2568]),
                vals: { 1776: 255, 377: '7994308000000001', 2568: 6 },
            },
            '0x6a1': { found: new Set(gatewayFound), vals: {} },
        },
    };
}

/** Gas condensing boiler: HMUMASTER with burner data points, a BCU, no outdoor unit. */
function boilerData() {
    return {
        topologyData: { '0x680': busId('HMUMASTER'), '0x690': busId('BCU') },
        plantData: {
            '0x680': {
                found: new Set([256, 268, 271, 274, 526, 331, 365, 1346, 1043, 1238, 1415]),
                vals: {
                    271: sensor(50),
                    1238: { Count: 1, Components: [{ Did: 274 }] },
                    // A Vitodens reports "Heating" with state 255 for a circuit it does not have
                    1415: { Mode: { ID: 1, Text: 'Heating' }, State: { ID: 255, Text: 'unknown' } },
                },
            },
            '0x690': { found: new Set([256, 374]), vals: {} },
        },
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('plantProfile.js => PLANT_DIDS', () => {
    it('contains the identification and the component list', () => {
        expect(PLANT_DIDS.has(377)).to.equal(true);
        expect(PLANT_DIDS.has(1238)).to.equal(true);
    });
});

describe('plantProfile.js => _componentDids()', () => {
    it('returns the data point numbers of DID 1238', () => {
        expect(_componentDids(COMPONENTS_252A)).to.deep.equal([381, 1842, 1774, 1775, 388, 390, 491]);
    });
    it('returns an empty list for missing or raw values', () => {
        expect(_componentDids(undefined)).to.deep.equal([]);
        expect(_componentDids('077d01')).to.deep.equal([]);
    });
});

describe('plantProfile.js => _findRoles()', () => {
    it('assigns indoor and outdoor unit and ignores a gateway answering everything', () => {
        const { plantData, topologyData } = heatPumpData();
        const roles = _findRoles(_listDevices(plantData, topologyData));
        expect(roles.indoor.addr).to.equal('0x680');
        expect(roles.outdoor.addr).to.equal('0x68c');
    });
    it('takes the master as outdoor unit of a monoblock', () => {
        const roles = _findRoles(
            _listDevices({ '0x680': { found: [2346, 268, 271] } }, { '0x680': busId('HPMUMASTER') }),
        );
        expect(roles.outdoor.addr).to.equal('0x680');
        expect(roles.indoor.addr).to.equal('0x680');
    });
    it('does not take a gateway as outdoor unit', () => {
        const roles = _findRoles(
            _listDevices(
                { '0x680': { found: [268, 271, 526] }, '0x6a1': { found: [2346, 2569] } },
                { '0x680': busId('HMUMASTER'), '0x6a1': busId('BACKENDGATEWAY') },
            ),
        );
        expect(roles.outdoor).to.equal(undefined);
    });
});

describe('plantProfile.js => _modelName()', () => {
    it('falls back to a generic name with the nominal capacity', () => {
        expect(_modelName('heatPump', '7994220123', '', 6000)).to.equal('Heat pump, 6 kW');
        expect(_modelName('gasBoiler', '', '', 0)).to.equal('Gas condensing boiler');
    });
});

describe('plantProfile.js => buildPlantProfile()', () => {
    it('returns null without heat generator and energy storage system', () => {
        expect(buildPlantProfile({ '0x6a1': { found: [256] } }, { '0x6a1': busId('BACKENDGATEWAY') })).to.equal(
            null,
        );
    });

    it('describes an energy storage system on a bus of its own', () => {
        const p = buildPlantProfile({ '0x680': { found: [256, 1836] } }, { '0x680': busId('EMCUMASTER') });
        expect(p.kind).to.equal('energyStorageOnly');
        expect(p.energyStorageSystem).to.deep.equal({ canAddr: '0x680', type: 'EMCUMASTER' });
        expect(p.hydraulics).to.equal(null);
        const html = buildPlantHtml(p);
        expect(html).to.contain('none on this bus');
        expect(html).to.contain('EMCUMASTER (0x680), inverter and battery');
        expect(html).not.to.contain('Heating circuits');
    });

    it('lists the energy storage system next to a heat pump', () => {
        const { plantData, topologyData } = heatPumpData();
        plantData['0x6a1'] = { found: new Set([256, 1836]), vals: {} };
        topologyData['0x6a1'] = busId('EMCUMASTER');
        const p = buildPlantProfile(plantData, topologyData);
        expect(p.kind).to.equal('heatPump');
        expect(p.devices.energyStorage).to.deep.equal({ canAddr: '0x6a1', type: 'EMCUMASTER' });
        expect(p.energyStorageSystem).to.deep.equal({ canAddr: '0x6a1', type: 'EMCUMASTER' });
    });

    it('derives the profile of a split heat pump', () => {
        const { plantData, topologyData } = heatPumpData();
        const p = buildPlantProfile(plantData, topologyData, { 1774: 'CompressorCrankCaseHeater' });
        expect(p.kind).to.equal('heatPump');
        expect(p.model).to.equal('Heat pump, 6 kW');
        expect(p.serialIndoor).to.equal('7994220123456789');
        expect(p.serialOutdoor).to.equal('7994308000000001');
        expect(p.devices.indoor).to.deep.equal({ canAddr: '0x680', type: 'HPMUMASTER' });
        expect(p.refrigerantCircuit.fans).to.equal(1); // fan 2 reports 255
        expect(p.refrigerantCircuit.expansionValves).to.equal(2);
        expect(p.refrigerantCircuit.refrigerantType).to.equal(6);
        expect(p.boiler).to.equal(null);
        expect(p.hydraulics.flowSensorDid).to.equal(376);
        expect(p.hydraulics.diverterValveDid).to.equal(1842);
        expect(p.hydraulics.circulationPump).to.equal(true);
        expect(p.hydraulics.domesticHotWaterSensors).to.deep.equal([271]);
        expect(p.hydraulics.bufferSensors).to.deep.equal([]); // 281 not_available
        expect(p.circuits).to.have.length(1); // circuit 2: sensor not_available and mode off
        expect(p.circuits[0]).to.deep.equal({
            number: 1,
            name: 'Ground floor',
            type: 'UnderFloorCentralHeating',
            mode: 'Heating',
            ownPump: false,
            mixer: false,
        });
        expect(p.components.map(c => c.name)).to.include('Crankcase heater');
    });

    it('derives the profile of a gas condensing boiler', () => {
        const { plantData, topologyData } = boilerData();
        const p = buildPlantProfile(plantData, topologyData);
        expect(p.kind).to.equal('gasBoiler');
        expect(p.refrigerantCircuit).to.equal(null);
        expect(p.boiler.modulation).to.equal(true);
        expect(p.boiler.burnerFan).to.equal(true);
        expect(p.hydraulics.flowSensorDid).to.equal(1043);
        expect(p.circuits).to.have.length(0); // state 255 means not fitted
        expect(p.components).to.deep.equal([{ did: 274, name: 'Outside temperature sensor' }]);
    });

    it('accepts found DIDs as array (e.g. from JSON)', () => {
        const p = buildPlantProfile({ '0x680': { found: [268, 271] } }, { '0x680': busId('HMUMASTER') });
        expect(p.kind).to.equal('unknown');
    });
});

describe('plantProfile.js => buildPlantHtml()', () => {
    it('shows the heading and a note without profile', () => {
        const html = buildPlantHtml(null);
        expect(html).to.contain('Plant Profile');
        expect(html).to.contain(PLANT_PENDING_NOTE);
        expect(buildPlantHtml(null, 'No plant profile <here>')).to.contain('No plant profile &lt;here&gt;');
    });
    it('renders the profile and escapes text', () => {
        const { plantData, topologyData } = heatPumpData();
        plantData['0x680'].vals[627] = '<b>EG</b>';
        const html = buildPlantHtml(buildPlantProfile(plantData, topologyData));
        expect(html).to.contain('Plant Profile');
        expect(html).to.contain('Heat pump, 6 kW');
        expect(html).to.contain('&lt;b&gt;EG&lt;/b&gt;');
        expect(html).not.to.contain('<b>EG</b>');
    });
    it('is placed into the topology summary', () => {
        const { plantData, topologyData } = heatPumpData();
        const plantHtml = buildPlantHtml(buildPlantProfile(plantData, topologyData));
        const { html } = buildTopologySummary(topologyData, {}, plantHtml);
        expect(html).to.contain('Plant Profile');
        expect(html.indexOf('Plant Profile')).to.be.below(html.indexOf('UDS-Accessible Devices'));
    });
});
