'use strict';

const E3 = require('./codecs');

/*
 * Plant profile: which heat generator, circuits, sensors and actuators a plant
 * has, derived from the data collected during a data point scan.
 *
 * The detection rules follow the plant profile of open3e-esp32 by boonkerz
 * (https://github.com/boonkerz/open3e-esp32, docs/anlage.md and web/app.js,
 * Apache License 2.0). They use three sources:
 *  1. The role of each control unit, from its DeviceProperty (DID 256).
 *  2. What the scan did not find does not exist: a plant answers data points
 *     of parts it does not have with a negative response.
 *  3. What answers is not necessarily fitted: unused sensor terminals answer
 *     with SensorStatus "not_available" (ID 4), fitted ones with "no_error".
 *
 * The values are a snapshot taken during the scan. They are collected in the
 * scan callback whether or not the scan stores data point values as states.
 */

/** Data points whose values the rules need. All other found DIDs only count as "present". */
const PLANT_DIDS = new Set([
    // Identification and ratings
    377, 2342, 2568, 2574,
    // Temperature and pressure sensors with SensorStatus
    268, 269, 271, 273, 274, 275, 277, 278, 279, 281, 284, 286, 288, 290, 318, 320, 321, 324, 331, 1772, 2333, 2334,
    3016, 3017, 3018, 3232, 3233, 3234,
    // Heating circuits: property, operation state, name
    933, 934, 935, 936, 1415, 1416, 1417, 1418, 627, 628, 629, 630,
    // Second fan reports 255 if not fitted
    1776,
    // Actuators and sensors fitted to the device
    1238,
]);

/**
 * Serial number prefix (first 7 characters of DID 377) → model.
 * Empty for now; see MODEL_TABLE in web/app.js of open3e-esp32 for known entries.
 * Example: '7994220': { family: 'Vitocal 252-A', unit: 'Indoor unit AWOT-E-AC 251.A16' }
 */
const MODEL_TABLE = {};

/** Readable names for the data point numbers listed in DID 1238. Others are shown by their data point name. */
const COMPONENT_NAMES = {
    274: 'Outside temperature sensor',
    354: 'Evaporator tray heater',
    381: 'Central heating pump',
    386: 'Diverter valve',
    388: 'Expansion valve 1',
    390: 'Expansion valve 2',
    401: 'Pump heating circuit 1',
    402: 'Pump heating circuit 2',
    403: 'Pump heating circuit 3',
    404: 'Pump heating circuit 4',
    475: 'Mixer heating circuit 1',
    476: 'Mixer heating circuit 2',
    477: 'Mixer heating circuit 3',
    478: 'Mixer heating circuit 4',
    491: 'Circulation pump',
    1044: 'Secondary pump',
    1774: 'Crankcase heater',
    1775: 'Fan 1',
    1776: 'Fan 2',
    1842: 'Diverter valve',
    2852: 'Air duct heater',
};

/** Control units that answer every data point of the database (with zeroes) and must not take a role. */
const NOT_A_ROLE = /GATEWAY|SMARTROOM|HMI/;

// ─── Scan values ──────────────────────────────────────────────────────────────

/**
 * Value of a data point as the plant profile needs it. The scan callback gets a data point
 * whose length differs from the common definition still as raw hex string; the callback only
 * then selects the variant definition:
 *  - a variant of fixed length (e.g. a structure of 10 instead of 12 bytes): decode it with that definition,
 *  - a variant with variable length (len 0, e.g. the circuit name "HK1" in 4 bytes): decode it
 *    with the actual length.
 *
 * @param {unknown} val  Value passed to the scan callback
 * @param {{ codec?: string, len?: number, id?: string, args?: object }} [didInfo]  Definition selected by the scan
 * @param {boolean} [common]  true if the value was decoded with the common definition
 * @returns {unknown} Decoded value, or the value as passed if it cannot be decoded
 */
function decodeScanValue(val, didInfo, common = true) {
    if (common || typeof val !== 'string' || !/^([0-9a-f]{2})+$/i.test(val)) {
        return val;
    }
    const bytes = (val.match(/../g) || []).map(h => parseInt(h, 16));
    const len = Number(didInfo?.len) === 0 ? bytes.length : didInfo?.len;
    if (!didInfo?.codec || didInfo.codec === 'RawCodec' || len !== bytes.length || !(didInfo.codec in E3.O3Ecodecs)) {
        return val;
    }
    try {
        return new E3.O3Ecodecs[didInfo.codec](len, didInfo.id, didInfo.args, '').decode(bytes);
    } catch {
        return val;
    }
}

// ─── Device roles ─────────────────────────────────────────────────────────────

/**
 * Combine the collected plant data with the device type from the topology data.
 *
 * @param {object} plantData     { canAddrHex: { found: Set<number>|number[], vals: { did: value } } }
 * @param {object} topologyData  { canAddrHex: { busId: object } }
 * @returns {Array<object>} Devices { addr, prop, found: Set<number>, vals }
 */
function listDevices(plantData, topologyData) {
    const devices = [];
    for (const [addr, pd] of Object.entries(plantData || {})) {
        devices.push({
            addr,
            prop: topologyData?.[addr]?.busId?.DeviceProperty?.Text || '',
            found: pd?.found instanceof Set ? pd.found : new Set(pd?.found || []),
            vals: pd?.vals || {},
        });
    }
    return devices.sort((a, b) => parseInt(a.addr, 16) - parseInt(b.addr, 16));
}

/**
 * Assign the roles indoor, outdoor, burner, heater and energyStorage to the control units.
 * The energy storage system (e.g. Vitocharge VX3) consists of inverter and battery; its
 * control unit is the EMCU (energy management control unit).
 *
 * @param {Array<object>} devices  Result of listDevices()
 * @returns {object} Role → device (or undefined)
 */
function findRoles(devices) {
    const real = d => !NOT_A_ROLE.test(d.prop) && d.found.size < 1000;
    const roles = {};
    // The outdoor unit is whoever reports the compressor: the VCMU on a split system, the master on a monoblock.
    roles.outdoor =
        devices.find(d => d.prop === 'VCMU' && d.found.has(2346)) ||
        devices.find(d => real(d) && (d.found.has(2346) || d.found.has(2569)));
    roles.indoor =
        devices.find(d => d.prop === 'HPMUMASTER') ||
        devices.find(d => d.prop === 'HMUMASTER') ||
        devices.find(d => real(d) && d.found.has(268) && d.found.has(271));
    roles.burner = devices.find(d => d.prop === 'BCU');
    roles.heater = devices.find(d => d.prop === 'EHCU');
    roles.energyStorage = devices.find(d => d.prop === 'EMCUMASTER' || d.prop === 'EMCUSLAVE');
    return roles;
}

// ─── Profile ──────────────────────────────────────────────────────────────────

/**
 * Decode the value of DID 1238 into a list of data point numbers.
 *
 * @param {{ Components?: Array<{ Did?: number }> } | string | undefined} val  Decoded value { Count, Components: [{ Did }] }
 * @returns {number[]} Data point numbers
 */
function componentDids(val) {
    if (!val || typeof val !== 'object' || !Array.isArray(val.Components)) {
        return [];
    }
    return val.Components.map(c => Number(c?.Did)).filter(d => Number.isInteger(d) && d > 0);
}

/**
 * Model name from the serial number prefix, or a generic name with the nominal capacity.
 *
 * @param {string} kind          'heatPump' | 'gasBoiler' | 'unknown'
 * @param {string} serialIndoor  DID 377 of the indoor unit
 * @param {string} serialOutdoor DID 377 of the outdoor unit
 * @param {number} nominalW      Nominal thermal capacity in W
 * @returns {string} Model name
 */
function modelName(kind, serialIndoor, serialOutdoor, nominalW) {
    const i = MODEL_TABLE[String(serialIndoor || '').slice(0, 7)];
    const o = MODEL_TABLE[String(serialOutdoor || '').slice(0, 7)];
    const generic = { heatPump: 'Heat pump', gasBoiler: 'Gas condensing boiler' }[kind] || 'Heat generator';
    let name = i?.family || o?.family || generic;
    if (!i && nominalW > 0) {
        name += `, ${Math.round(nominalW / 1000)} kW`;
    }
    const units = [i?.unit, o?.unit].filter(Boolean);
    if (units.length) {
        name += ` (${units.join('; ')})`;
    }
    return name;
}

/**
 * Derive the plant profile.
 *
 * @param {object} plantData     { canAddrHex: { found: Set<number>|number[], vals: { did: value } } }
 * @param {object} topologyData  { canAddrHex: { busId: object } }
 * @param {object} [didNames]    { did: name } for data point names in the component list
 * @returns {object|null} Profile, or null if neither a heat generator nor an energy storage system was found
 */
function buildPlantProfile(plantData, topologyData, didNames = {}) {
    const devices = listDevices(plantData, topologyData);
    const roles = findRoles(devices);
    const energyStorageSystem = roles.energyStorage
        ? { canAddr: roles.energyStorage.addr, type: roles.energyStorage.prop }
        : null;
    if (!roles.indoor && !roles.outdoor) {
        // An energy storage system on a bus of its own (not connected to the heat generator)
        // appears as main device on 0x680. It still gets a profile.
        return energyStorageSystem
            ? {
                  kind: 'energyStorageOnly',
                  model: '',
                  nominalPowerW: null,
                  serialIndoor: '',
                  serialOutdoor: '',
                  devices: { energyStorage: energyStorageSystem },
                  refrigerantCircuit: null,
                  boiler: null,
                  hydraulics: null,
                  circuits: [],
                  electricHeater: null,
                  energyStorageSystem,
                  components: [],
              }
            : null;
    }
    const has = (role, did) => !!roles[role] && roles[role].found.has(did);
    const val = (role, did) => (roles[role] ? roles[role].vals[did] : undefined);
    // A sensor counts as fitted with SensorStatus "no_error"; a data point without status when it answered.
    const fitted = (role, did) => {
        if (!has(role, did)) {
            return false;
        }
        const v = val(role, did);
        if (v && typeof v === 'object' && v.SensorStatus) {
            return v.SensorStatus.ID === 0;
        }
        return true;
    };

    const components = componentDids(val('indoor', 1238));
    const boiler = !roles.outdoor && !!roles.indoor && (has('indoor', 526) || has('indoor', 331) || has('indoor', 365));
    const kind = roles.outdoor ? 'heatPump' : boiler ? 'gasBoiler' : 'unknown';
    const nominalW = Number(val('indoor', 2342) || val('outdoor', 2342) || 0);
    const serialIndoor = typeof val('indoor', 377) === 'string' ? val('indoor', 377).trim() : '';
    const serialOutdoor =
        roles.outdoor && roles.outdoor !== roles.indoor && typeof val('outdoor', 377) === 'string'
            ? val('outdoor', 377).trim()
            : '';

    const circuits = [];
    for (let i = 0; i < 4; i++) {
        const op = val('indoor', 1415 + i);
        const prop = val('indoor', 933 + i);
        const name = val('indoor', 627 + i);
        // A Vitodens reports "Heating" for circuits it does not have, with state 255 and no sensor.
        const active = op?.Mode && op.Mode.ID !== 0 && !(op.State && op.State.ID === 255);
        if (fitted('indoor', 284 + 2 * i) || active) {
            circuits.push({
                number: i + 1,
                name: typeof name === 'string' ? name.trim() : '',
                type: prop?.MixerCircuitType?.Text || '',
                mode: op?.Mode?.Text || '',
                // Its own pump (401..404) means a mixed circuit or a separating buffer; the mixer (475..478) says which.
                ownPump: components.includes(401 + i),
                mixer: components.includes(475 + i),
            });
        }
    }

    const heaterPower = val('indoor', 2574);
    const heaterW = Number(heaterPower?.Power || 0);
    const fan2 = val('outdoor', 1776);
    const dhwLayers = [3234, 3233, 3232].filter(d => fitted('indoor', d));

    const profile = {
        kind,
        model: modelName(kind, serialIndoor, serialOutdoor, nominalW),
        nominalPowerW: nominalW || null,
        serialIndoor,
        serialOutdoor,
        devices: Object.fromEntries(
            Object.entries(roles)
                .filter(([, d]) => d)
                .map(([role, d]) => [role, { canAddr: d.addr, type: d.prop }]),
        ),
        refrigerantCircuit: roles.outdoor
            ? {
                  refrigerantType: val('outdoor', 2568) ?? null,
                  compressorSpeedRps: has('outdoor', 2569),
                  fans: (has('outdoor', 1775) ? 1 : 0) + (has('outdoor', 1776) && fan2 !== 255 && fan2 != null ? 1 : 0),
                  expansionValves: [388, 390].filter(d => has('outdoor', d)).length,
                  fourWayValve: has('outdoor', 1773),
                  suctionSide: has('outdoor', 321) && has('outdoor', 322),
                  dischargeSide: has('outdoor', 324) && has('outdoor', 325),
                  oilTemperature: has('outdoor', 1772),
                  evaporator: has('outdoor', 2334),
              }
            : null,
        boiler: boiler
            ? {
                  modulation: has('indoor', 526),
                  flueGasTemperature: has('indoor', 331),
                  burnerFan: has('burner', 374) || has('burner', 373) || has('indoor', 373),
                  burnerStarts: has('indoor', 365),
                  burnerHours: has('indoor', 1346),
              }
            : null,
        hydraulics: {
            // A heat pump reports its flow on 376; a gas boiler measures with the Allengra sensor on 1043.
            flowSensorDid: has('indoor', 376) ? 376 : has('indoor', 1043) ? 1043 : null,
            pressureSensor: fitted('indoor', 318),
            pump: has('indoor', 381),
            diverterValveDid: components.includes(1842) ? 1842 : has('indoor', 386) ? 386 : null,
            circulationPump: components.includes(491),
            domesticHotWater: fitted('indoor', 271) || dhwLayers.length > 0,
            domesticHotWaterSensors: [fitted('indoor', 271) ? 271 : null, ...dhwLayers].filter(Boolean),
            bufferSensors: [281, 279, 277, 3016, 3017, 3018].filter(d => fitted('indoor', d)),
            solar: fitted('indoor', 273) || fitted('indoor', 275),
        },
        circuits,
        electricHeater: roles.heater || heaterW > 0 ? { powerW: heaterW || null } : null,
        energyStorageSystem,
        components: components.map(did => ({ did, name: COMPONENT_NAMES[did] || didNames[did] || `DID ${did}` })),
    };
    return profile;
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

/**
 * Escape text for HTML.
 *
 * @param {unknown} v  Value
 * @returns {string} Escaped text
 */
function esc(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Note shown in place of the plant profile when there is none yet. */
const PLANT_PENDING_NOTE = 'The plant profile appears here after the next data point scan.';

/** Readable names of the roles in the list of control units. */
const ROLE_LABELS = {
    indoor: 'indoor unit',
    outdoor: 'outdoor unit',
    burner: 'burner',
    heater: 'electric heater',
    energyStorage: 'energy storage system',
};

/**
 * HTML section with the heading only and a note instead of the profile.
 *
 * @param {string} note  Note text
 * @returns {string} HTML section
 */
function buildPlantNoteHtml(note) {
    return `<h4 style="margin:0 0 4px 0">Plant Profile</h4>
<p style="margin:0 0 16px 0;color:#666">${esc(note)}</p>
`;
}

/**
 * Render the plant profile as an HTML section for the topology summary.
 *
 * @param {object|null} profile  Result of buildPlantProfile()
 * @param {string} [note]  Note shown if there is no profile
 * @returns {string} HTML section
 */
function buildPlantHtml(profile, note = PLANT_PENDING_NOTE) {
    if (!profile) {
        return buildPlantNoteHtml(note);
    }
    const yesNo = b => (b ? 'yes' : 'no');
    const rows = [];
    const kv = (k, v) => {
        if (v !== undefined && v !== null && v !== '') {
            rows.push(
                `<tr><td style="padding:3px 8px;border:1px solid #ccc;background:#f4f4f4;white-space:nowrap;vertical-align:top">${esc(
                    k,
                )}</td><td style="padding:3px 8px;border:1px solid #ccc">${v}</td></tr>`,
            );
        }
    };

    kv('Heat generator', profile.kind === 'energyStorageOnly' ? 'none on this bus' : esc(profile.model));
    const roleText = Object.entries(profile.devices)
        .map(([role, d]) => `${esc(ROLE_LABELS[role] || role)}: ${esc(d.type || '?')} (${esc(d.canAddr)})`)
        .join(', ');
    kv('Control units', roleText);
    kv('Serial numbers', esc([profile.serialIndoor, profile.serialOutdoor].filter(Boolean).join(' / ')));

    const rc = profile.refrigerantCircuit;
    if (rc) {
        const parts = [
            rc.refrigerantType ? `refrigerant type ${esc(rc.refrigerantType)}` : '',
            `${rc.fans} fan(s)`,
            `${rc.expansionValves} expansion valve(s)`,
            rc.fourWayValve ? 'four-way valve' : '',
            rc.suctionSide ? 'suction side T/p' : '',
            rc.dischargeSide ? 'discharge side T/p' : '',
            rc.oilTemperature ? 'oil temperature' : '',
            rc.evaporator ? 'evaporator temperature' : '',
        ].filter(Boolean);
        kv('Refrigerant circuit', parts.join(', '));
    }
    const b = profile.boiler;
    if (b) {
        const parts = [
            b.modulation ? 'modulation' : '',
            b.flueGasTemperature ? 'flue gas temperature' : '',
            b.burnerFan ? 'burner fan' : '',
            b.burnerStarts ? 'burner starts' : '',
            b.burnerHours ? 'burner hours' : '',
        ].filter(Boolean);
        kv('Boiler', parts.join(', ') || '—');
    }

    const h = profile.hydraulics;
    if (h) {
        kv('Flow sensor', h.flowSensorDid ? `DID ${h.flowSensorDid}` : 'none');
        kv('Pressure sensor', yesNo(h.pressureSensor));
        kv('Diverter valve', h.diverterValveDid ? `DID ${h.diverterValveDid}` : 'none');
        kv(
            'Domestic hot water',
            h.domesticHotWater ? `yes (sensors: DID ${h.domesticHotWaterSensors.join(', ')})` : 'no',
        );
        kv('Circulation pump', yesNo(h.circulationPump));
        kv('Buffer', h.bufferSensors.length ? `yes (sensors: DID ${h.bufferSensors.join(', ')})` : 'no');
        kv('Solar', yesNo(h.solar));
        kv(
            'Electric heater',
            profile.electricHeater
                ? profile.electricHeater.powerW
                    ? `${profile.electricHeater.powerW} W`
                    : 'yes'
                : 'no',
        );
    }
    const ess = profile.energyStorageSystem;
    kv('Energy storage system', ess ? `${esc(ess.type)} (${esc(ess.canAddr)}), inverter and battery` : 'no');

    if (h) {
        const circuits = profile.circuits.length
            ? profile.circuits
                  .map(c => {
                      const details = [
                          c.type,
                          c.mode ? `mode ${c.mode}` : '',
                          c.mixer ? 'mixer' : '',
                          c.ownPump ? 'own pump' : '',
                      ].filter(Boolean);
                      const name = c.name ? ` "${esc(c.name)}"` : '';
                      return `${c.number}${name}${details.length ? `: ${esc(details.join(', '))}` : ''}`;
                  })
                  .join('<br>')
            : 'none detected';
        kv('Heating circuits', circuits);
    }

    if (profile.components.length) {
        kv(
            'Actuators and sensors (DID 1238)',
            profile.components.map(c => `${esc(c.name)} <span style="color:#888">(${c.did})</span>`).join(', '),
        );
    }

    return `<h4 style="margin:0 0 4px 0">Plant Profile</h4>
<table style="border-collapse:collapse;width:100%;margin-bottom:4px"><tbody>${rows.join('')}</tbody></table>
<p style="margin:0 0 16px 0;font-size:11px;color:#555">Derived from the data points found by the scan and their values at scan time. Detection rules after open3e-esp32 by boonkerz.</p>
`;
}

module.exports = {
    PLANT_DIDS,
    PLANT_PENDING_NOTE,
    MODEL_TABLE,
    decodeScanValue,
    buildPlantProfile,
    buildPlantHtml,
    // Exported for unit testing:
    _listDevices: listDevices,
    _findRoles: findRoles,
    _componentDids: componentDids,
    _modelName: modelName,
};
