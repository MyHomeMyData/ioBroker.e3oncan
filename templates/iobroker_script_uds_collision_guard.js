/* eslint-disable */
// @ts-nocheck
/**
 * UDS Collision Guard
 *
 * Monitors the ioBroker log for signs of UDS bus collisions (e.g. caused by
 * a 3rd-party UDS client such as a Viessmann OTA firmware update). When the
 * trigger keyword is detected, the adapter is stopped automatically and an
 * email notification is sent. A periodic bus-silence check then waits until
 * no more UDS traffic is detected before re-enabling the adapter.
 *
 * Requirements:
 *   - ioBroker JavaScript adapter (javascript.0 or javascript.1)
 *   - ioBroker email adapter (or replace sendTo calls with Telegram, Pushover, …)
 *   - candump (part of can-utils) installed and accessible to the ioBroker user
 *
 * Installation:
 *   Copy this script into the JavaScript adapter editor and enable it.
 *
 * After a stop event the adapter is re-enabled automatically once
 * REQUIRED_SILENT_CHECKS consecutive candump windows show no UDS traffic.
 * If the JavaScript adapter restarts while a stop event is being handled,
 * the guard resets and must be re-triggered by a new log entry.
 */

// ─── Configuration ───────────────────────────────────────────────────────────

/** Adapter instance to monitor and control. */
const ADAPTER_INSTANCE = 'e3oncan.0';

/** Email adapter instance used for notifications. */
const EMAIL_INSTANCE = 'email.0';

/** Recipient address for all notifications. */
const EMAIL_RECIPIENT = 'your@email.com';

/** CAN interface to monitor for UDS traffic. */
const CAN_INTERFACE = 'can0';

/**
 * Log keyword that triggers the guard.
 * The adapter is stopped when this string appears in a log message
 * from ADAPTER_INSTANCE.
 */
const LOG_TRIGGER = 'Bad frame';

/**
 * Log severity levels to monitor.
 * Include all levels at which the trigger keyword may appear.
 */
const LOG_SEVERITIES = ['info', 'warn', 'error'];

/**
 * CAN addresses used for UDS communication on the monitored bus.
 * These are the 11-bit hex IDs (without 0x prefix) of the E3 devices
 * as they appear in candump output (e.g. '680', '690', '6A0', '6B0').
 * Adjust to match your device scan results.
 *
 * Tip: run  candump -tA can0  during normal adapter operation and note
 * the IDs that appear. Typically in the range 0x680–0x6EF.
 */
const UDS_CAN_ADDRESSES = ['680', '690', '6A0', '6B0'];

/** How long candump listens for each silence check (seconds). */
const CANDUMP_DURATION_S = 60;

/** Interval between consecutive silence checks (minutes). */
const CHECK_INTERVAL_MIN = 10;

/**
 * Number of consecutive silent checks required before the adapter
 * is re-enabled. Total wait time >= REQUIRED_SILENT_CHECKS x CHECK_INTERVAL_MIN.
 */
const REQUIRED_SILENT_CHECKS = 3;

// ─── Internal state (do not modify) ──────────────────────────────────────────

let guardActive = false; // true while the adapter is stopped and being monitored
let silentCount = 0; // number of consecutive silent checks so far

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a grep -E alternation pattern from the configured address list.
 * candump output format:  "  can0  680   [8]  01 02 03 04 05 06 07 08"
 * The IDs are surrounded by spaces, so matching "  <ID>  " is specific enough.
 */
function buildGrepPattern() {
    return UDS_CAN_ADDRESSES.map(a => `  ${a}  `).join('|');
}

/** Send an email notification via the configured email adapter. */
function sendNotification(subject, body) {
    sendTo(EMAIL_INSTANCE, 'send', {
        to: EMAIL_RECIPIENT,
        subject: `[ioBroker] ${subject}`,
        text: body + `\n\nTime: ${new Date().toLocaleString('en-GB')}`,
    });
}

// ─── Bus silence check ────────────────────────────────────────────────────────

function scheduleNextCheck() {
    setTimeout(runSilenceCheck, CHECK_INTERVAL_MIN * 60 * 1000);
}

function runSilenceCheck() {
    if (!guardActive) return;

    const pattern = buildGrepPattern();
    // Use wc -l instead of grep -c to avoid non-zero exit codes on zero matches.
    const cmd =
        `bash -c "timeout ${CANDUMP_DURATION_S} candump ${CAN_INTERFACE} ` +
        `| grep -E '${pattern}' | wc -l"`;

    exec(cmd, (_err, stdout) => {
        if (!guardActive) return;

        const frameCount = parseInt(stdout) || 0;

        if (frameCount === 0) {
            silentCount++;
            log(
                `UDS Collision Guard: silence check ${silentCount}/${REQUIRED_SILENT_CHECKS} passed` +
                    ` — no UDS traffic on ${CAN_INTERFACE}.`,
                'info',
            );
        } else {
            if (silentCount > 0) {
                log(
                    `UDS Collision Guard: ${frameCount} UDS frame(s) detected — resetting counter.`,
                    'info',
                );
            }
            silentCount = 0;
        }

        if (silentCount >= REQUIRED_SILENT_CHECKS) {
            reEnableAdapter();
        } else {
            scheduleNextCheck();
        }
    });
}

// ─── Adapter control ──────────────────────────────────────────────────────────

async function stopAdapter(triggerMessage) {
    guardActive = true;
    silentCount = 0;

    log(`UDS Collision Guard: "${LOG_TRIGGER}" detected — stopping ${ADAPTER_INSTANCE}.`, 'warn');

    await extendObject(`system.adapter.${ADAPTER_INSTANCE}`, { common: { enabled: false } });

    sendNotification(
        `${ADAPTER_INSTANCE} stopped — possible 3rd-party UDS activity`,
        `Trigger keyword "${LOG_TRIGGER}" was detected in the log of ${ADAPTER_INSTANCE}.\n\n` +
            `Log message:\n  ${triggerMessage}\n\n` +
            `The adapter has been stopped automatically.\n` +
            `Bus silence is now checked every ${CHECK_INTERVAL_MIN} minute(s) ` +
            `using a ${CANDUMP_DURATION_S}-second candump window.\n` +
            `The adapter will be re-enabled after ${REQUIRED_SILENT_CHECKS} consecutive silent checks.`,
    );

    scheduleNextCheck();
}

async function reEnableAdapter() {
    guardActive = false;
    silentCount = 0;

    log(
        `UDS Collision Guard: ${REQUIRED_SILENT_CHECKS} consecutive silent checks passed` +
            ` — re-enabling ${ADAPTER_INSTANCE}.`,
        'info',
    );

    await extendObject(`system.adapter.${ADAPTER_INSTANCE}`, { common: { enabled: true } });

    sendNotification(
        `${ADAPTER_INSTANCE} re-enabled`,
        `${REQUIRED_SILENT_CHECKS} consecutive silent candump checks confirmed ` +
            `no UDS traffic on ${CAN_INTERFACE}.\n\n` +
            `${ADAPTER_INSTANCE} has been re-enabled automatically.`,
    );
}

// ─── Log monitor ─────────────────────────────────────────────────────────────

const adapterPrefix = ADAPTER_INSTANCE.split('.')[0]; // e.g. 'e3oncan'

LOG_SEVERITIES.forEach(severity => {
    onLog(severity, async info => {
        if (guardActive) return; // already handling an event
        if (!info.from.startsWith(adapterPrefix)) return; // not our adapter
        if (!info.message.includes(LOG_TRIGGER)) return; // not the trigger keyword

        await stopAdapter(info.message);
    });
});

log(`UDS Collision Guard active — monitoring ${ADAPTER_INSTANCE} for "${LOG_TRIGGER}".`, 'info');
