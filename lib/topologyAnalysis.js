'use strict';

/** DIDs carrying bus topology matrix data with a proper (non-raw) codec */
const TOPOLOGY_DIDS = new Set([954, 1286, 1287, 1288, 1289]);

/** Bus type ID → background colour used in HTML output */
const BUS_COLOR = {
    2: '#eaf4ea', // CanInternal  – green
    3: '#eaeaf4', // CanExternal  – blue
    6: '#f4f0ea', // CanRaw       – orange
    8: '#f4eaea', // ModBus       – red
    14: '#f0eaf4', // ServiceBus   – purple
};

/** DeviceProperty ID → name for devices that are never UDS-accessible */
const KNOWN_DEV_PROP_NAMES = {
    27: 'E380', // external energy meter, Collect-only
};

/** Energy meter channel key → human-readable label */
const CHANNEL_LABEL = { ext: 'UDS CAN', int: '2nd CAN' };

/**
 * Return a display string; replace null/empty with an em-dash
 *
 * @param {*} v  Value to stringify
 * @returns {string} Display string
 */
function s(v) {
    return v != null && v !== '' ? String(v) : '—';
}

/**
 * Extract the YYWW (year-week) build number from a SW-version string for recency comparison
 *
 * @param {string} swStr  SW-version string in format major.minor.YYWW.build
 * @returns {number} Build number from third version segment
 */
function swBuild(swStr) {
    return parseInt((swStr || '').split('.')[2] || '0', 10);
}

// ─── Data extraction ──────────────────────────────────────────────────────────

function extractUdsDevices(topologyData) {
    const devices = [];
    for (const [canAddr, dev] of Object.entries(topologyData || {})) {
        if (!dev?.busId) {
            continue;
        }
        const b = dev.busId;
        devices.push({
            canAddr,
            devType: b.DeviceProperty?.Text ?? String(b.DeviceProperty?.ID ?? '?'),
            devPropId: b.DeviceProperty?.ID ?? null,
            nodeId: b.BusAddress ?? null,
            swVersion: b['SW-Version'] || '',
            hwVersion: b['HW-Version'] || '',
            vin: b.VIN || '',
        });
    }
    return devices.sort((a, b) => parseInt(a.canAddr, 16) - parseInt(b.canAddr, 16));
}

/**
 * Build DeviceProperty numeric ID → text name from BusIdentification entries
 *
 * @param {object} topologyData  Collected topology data
 * @returns {object} Name map
 */
function buildDevPropNames(topologyData) {
    const map = {};
    for (const dev of Object.values(topologyData || {})) {
        const dp = dev?.busId?.DeviceProperty;
        if (dp?.ID != null && dp?.Text) {
            map[dp.ID] = dp.Text;
        }
    }
    return map;
}

/**
 * Collect all topology elements from all topology matrices.
 * Deduplication key: busTypeId + nodeId + devProp.
 * When a duplicate is found, keep the entry with the more recent SW build number.
 *
 * @param {object} topologyData   Collected topology data
 * @param {object} devPropNames   Map from DeviceProperty ID to text name
 * @returns {Array} Sorted, deduplicated topology elements
 */
function collectTopologyElements(topologyData, devPropNames) {
    const elementMap = new Map();

    for (const [canAddr, dev] of Object.entries(topologyData || {})) {
        for (const matrix of dev?.matrices || []) {
            if (!matrix || (matrix.Count ?? 0) === 0) {
                continue;
            }
            const elements = matrix.TopologyElement;
            if (!Array.isArray(elements)) {
                continue;
            }

            for (const el of elements) {
                const nodeId = el.NodeID ?? -1;
                const devProp = el.DeviceProperty ?? -1;
                const busTypeId = el.BusType?.ID ?? -1;
                const key = `${busTypeId}_${nodeId}_${devProp}`;

                if (!elementMap.has(key)) {
                    elementMap.set(key, {
                        nodeId,
                        busType: el.BusType?.Text || String(busTypeId),
                        busTypeId,
                        devProp,
                        devType: devPropNames[devProp] ?? KNOWN_DEV_PROP_NAMES[devProp] ?? String(devProp),
                        swVersion: el['SW-Version'] || '',
                        hwVersion: el['HW-Version'] || '',
                        vin: el.VIN || '',
                        reportedBy: [canAddr],
                    });
                } else {
                    const existing = elementMap.get(key);
                    if (!existing.reportedBy.includes(canAddr)) {
                        existing.reportedBy.push(canAddr);
                    }
                    // Keep the entry with the more recent SW build (3rd version segment)
                    if (swBuild(el['SW-Version']) > swBuild(existing.swVersion)) {
                        existing.swVersion = el['SW-Version'] || '';
                        existing.hwVersion = el['HW-Version'] || '';
                        existing.vin = el.VIN || '';
                    }
                }
            }
        }
    }

    return [...elementMap.values()].sort((a, b) => a.busTypeId - b.busTypeId || a.nodeId - b.nodeId);
}

/**
 * Build a list of detected energy meters from the scan result.
 *
 * @param {object} detectedEnergyMeters  { e380_97, e380_98, e3100cb } – channel string ('ext'|'int') or ''
 * @returns {Array} Energy meter entries
 */
function buildEnergyMeterList(detectedEnergyMeters) {
    const em = detectedEnergyMeters || {};
    const meters = [];
    if (em.e380_97) {
        meters.push({
            type: 'E380',
            canAddr: 97,
            channel: em.e380_97,
            channelLabel: CHANNEL_LABEL[em.e380_97] || em.e380_97,
        });
    }
    if (em.e380_98) {
        meters.push({
            type: 'E380',
            canAddr: 98,
            channel: em.e380_98,
            channelLabel: CHANNEL_LABEL[em.e380_98] || em.e380_98,
        });
    }
    if (em.e3100cb) {
        meters.push({
            type: 'E3100CB',
            canAddr: null,
            channel: em.e3100cb,
            channelLabel: CHANNEL_LABEL[em.e3100cb] || em.e3100cb,
        });
    }
    return meters;
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function buildHtml(json) {
    const HEADER_BG = '#4a7a9b';
    const th = col =>
        `<th style="background:${HEADER_BG};color:#fff;padding:4px 8px;text-align:left;border:1px solid #888;white-space:nowrap">${col}</th>`;
    const td = (val, bg, extra) =>
        `<td style="padding:3px 8px;border:1px solid #ccc${bg ? `;background:${bg}` : ''}${extra ? `;${extra}` : ''}">${val}</td>`;
    const row = cells => `<tr>${cells}</tr>`;
    const mono = v => `<span style="font-family:monospace">${v}</span>`;
    const badge = () =>
        `<span style="background:#2196F3;color:#fff;border-radius:3px;padding:1px 5px;font-size:10px;vertical-align:middle;margin-left:4px">UDS</span>`;

    // Set of "vin_devPropId" keys for UDS-membership check (skip all-zero VINs)
    const udsKeys = new Set(
        json.udsDevices
            .filter(d => d.vin && d.vin !== '0000000000000000' && d.devPropId != null)
            .map(d => `${d.vin}_${d.devPropId}`),
    );

    // ── UDS devices table ─────────────────────────────────────────────────────
    const udsHeader = row(
        [th('CAN Addr'), th('Type'), th('NodeID'), th('SW-Version'), th('HW-Version'), th('VIN')].join(''),
    );
    const udsRows = json.udsDevices
        .map(d =>
            row(
                [
                    td(`<b>${d.canAddr}</b>`),
                    td(s(d.devType)),
                    td(s(d.nodeId)),
                    td(s(d.swVersion)),
                    td(s(d.hwVersion)),
                    td(mono(s(d.vin))),
                ].join(''),
            ),
        )
        .join('');

    // ── Topology elements table ───────────────────────────────────────────────
    const topoHeader = row(
        [th('NodeID'), th('Bus Type'), th('Type'), th('SW-Version'), th('VIN'), th('Reported by')].join(''),
    );
    const topoRows = json.topologyElements
        .map(el => {
            const bg = BUS_COLOR[el.busTypeId] || '#fff';
            const isUds = el.vin && el.vin !== '0000000000000000' && udsKeys.has(`${el.vin}_${el.devProp}`);
            const typeCell = isUds ? `${s(el.devType)}${badge()}` : s(el.devType);
            return row(
                [
                    td(s(el.nodeId), bg),
                    td(s(el.busType), bg),
                    td(typeCell, bg),
                    td(s(el.swVersion), bg),
                    td(mono(s(el.vin)), bg),
                    td(el.reportedBy.join(', '), bg, 'font-size:11px'),
                ].join(''),
            );
        })
        .join('');

    // ── Legend ────────────────────────────────────────────────────────────────
    const colorLegend = [
        ['CanInternal', BUS_COLOR[2]],
        ['CanExternal', BUS_COLOR[3]],
        ['CanRaw', BUS_COLOR[6]],
        ['ModBus', BUS_COLOR[8]],
        ['ServiceBus', BUS_COLOR[14]],
    ]
        .map(
            ([name, color]) =>
                `<span style="background:${color};padding:1px 6px;border:1px solid #bbb;font-size:11px">${name}</span>`,
        )
        .join(' ');

    // ── Energy meters section ─────────────────────────────────────────────────
    let emSection = '';
    if (json.energyMeters && json.energyMeters.length > 0) {
        const emHeader = row([th('Type'), th('CAN Address'), th('Channel')].join(''));
        const emRows = json.energyMeters
            .map(
                /** @param {{type:string,canAddr:number|null,channelLabel:string}} m Energy meter entry */ m =>
                    row([td(m.type), td(m.canAddr != null ? String(m.canAddr) : '—'), td(m.channelLabel)].join('')),
            )
            .join('');
        emSection = `<h4 style="margin:0 0 4px 0">Detected Energy Meters</h4>
<table style="border-collapse:collapse;margin-bottom:16px">
<thead>${emHeader}</thead><tbody>${emRows}</tbody>
</table>`;
    }

    const scanInfo = new Date(json.scanTime).toLocaleString();

    return `<div style="font-family:sans-serif;font-size:13px;padding:8px">
<h3 style="margin:0 0 4px 0">E3 CAN Bus Topology</h3>
<p style="margin:0 0 12px 0;color:#666;font-size:11px">Scan: ${scanInfo} &nbsp;|&nbsp; UDS devices: ${json.udsDevices.length} &nbsp;|&nbsp; Topology elements: ${json.topologyElements.length}</p>
${emSection}<h4 style="margin:0 0 4px 0">UDS-Accessible Devices</h4>
<table style="border-collapse:collapse;width:100%;margin-bottom:16px">
<thead>${udsHeader}</thead><tbody>${udsRows}</tbody>
</table>
<h4 style="margin:0 0 4px 0">Internal Bus Topology</h4>
<table style="border-collapse:collapse;width:100%;margin-bottom:8px">
<thead>${topoHeader}</thead><tbody>${topoRows}</tbody>
</table>
<p style="margin:4px 0;font-size:11px;color:#555">Bus type: ${colorLegend} &nbsp; ${badge()} = also UDS-accessible</p>
</div>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a topology summary from data collected during a UDS scan.
 *
 * @param {object} topologyData            Map { canAddrHex: { busId: object, matrices: object[] } }
 * @param {object} [detectedEnergyMeters]  { e380_97, e380_98, e3100cb } channel strings from energy meter scan
 * @returns {{ json: object, html: string }} Structured JSON and rendered HTML summary
 */
function buildTopologySummary(topologyData, detectedEnergyMeters) {
    const udsDevices = extractUdsDevices(topologyData);
    const devPropNames = buildDevPropNames(topologyData);
    const topologyElements = collectTopologyElements(topologyData, devPropNames);
    const energyMeters = buildEnergyMeterList(detectedEnergyMeters);
    const json = {
        scanTime: new Date().toISOString(),
        udsDevices,
        topologyElements,
        energyMeters,
    };
    return { json, html: buildHtml(json) };
}

module.exports = { buildTopologySummary, TOPOLOGY_DIDS };
