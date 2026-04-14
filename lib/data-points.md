![Logo](admin/e3oncan_small.png)
# ioBroker.e3oncan

## Handling of Data Points

### Table of contents

- [What is a data point?](#what-is-a-data-point)
- [Generic and variant data points](#generic-and-variant-data-points)
- [Metadata](#metadata)
- [Data formats for temperature, date and time](#data-formats-for-temperature-date-and-time)
- [Writability of data points](#writability-of-data-points)
- [What happens on adapter start and after updates](#what-happens-on-adapter-start-and-after-updates)
- [Running a data point scan](#running-a-data-point-scan)
- [Changelog of data point definitions](#changelog-of-data-point-definitions)

---

### What is a data point?

On E3 series devices, all information is organised into data points. Each data point has:

- a numeric ID (e.g. `256`)
- a name (e.g. `BusIdentification`)
- a length in bytes
- an internal structure described by a codec

Reading and writing always transfers raw bytes over the CAN bus. The codec translates between those bytes and human-readable values. If the structure of a data point is not yet known, the `RawCodec` is used, which passes through the unmodified byte stream.

The database of known data points is maintained in the [open3e](https://github.com/open3e) project. This adapter and the [E3onCAN](https://github.com/MyHomeMyData/E3onCAN) project share the same database, derived from open3e. Updates are incorporated periodically. Users are welcome to contribute via the open3e discussion forum, issues, or pull requests.

---

### Generic and variant data points

Some data points have different lengths and structures on different devices. To handle this, data points are organised into two categories:

- **Generic data points** – a single definition that fits most devices.
- **Variant data points** – alternative definitions for devices where the generic definition does not apply.

The adapter automatically selects the correct variant for each device during the data point scan.

An overview of all known data points including their variants is available in the [open3e project](https://github.com/open3e/open3e/blob/develop/src/open3e/Open3Edatapoints.md).

---

### Metadata

Starting with open3e version 0.6.1 and adapter version 0.11.0, many data points carry additional metadata:

| Metadata field | Description |
|---|---|
| Description | Short human-readable explanation of the data point |
| Physical unit | e.g. °C, kWh, W (where applicable) |
| Notes / link | Further information or reference |
| Access | Whether the data point is read-only or read-and-write |

Metadata is added to data point objects during the data point scan. For data points that existed before the scan, metadata is added on first launch of the new adapter version. To add metadata to all data points at once, run a new data point scan.

---

### Data formats for temperature, date and time

Data point `382` contains the device's data format configuration, including:

- **Physical format:** Metric (°C) or Imperial (°F)
- **Date format:** DayMonthYear, MonthDayYear, YearMonthDay
- **Time format:** TwentyFourHours or TwelveHours

The default configuration is: `Metric / DayMonthYear / TwentyFourHours`.

Starting with adapter version 0.11.0, this information is read during the device scan and stored per device. The stored configuration is then applied as follows:

- **During a data point scan:** temperature unit labels are set to °C (Metric) or °F (Imperial). No conversion of the numerical values is performed.
- **When reading and writing:** date and time values are interpreted according to the stored format. For example, in MonthDayYear format a date is expected and stored as month-day-year rather than day-month-year.

> **Note:** Processing of non-default date/time formats is experimental. Please verify results carefully if your device is not configured with the default.

If data point `382` is not present for a device, the configuration of the master device (CAN address `0x680`) is used as a fallback. If no configuration is available at all, the adapter behaves the same as versions prior to 0.11.0.

---

### Writability of data points

A data point is treated as writable if either of the following is true:

- Its ID is included in the whitelist `e3oncan.0.<DEVICE>.info.udsDidsWritable`.
- It is marked as read-and-write in its metadata (available from adapter version 0.11.0 onwards).

Both conditions are evaluated; the whitelist continues to work as before.

---

### What happens on adapter start and after updates

Each time the adapter starts, the versions of existing data point definitions are compared against the versions bundled with the current adapter. If newer definitions are available (e.g. after an adapter update), the affected data points are updated automatically. This process is logged in detail.

**What to expect during an update:**

- If the structure of a data point changes, the entire `tree` sub-object for that data point is deleted and recreated with the new structure. This is necessary for the adapter to function correctly, but has side effects:
  - **Archived data** for elements of the affected `tree` sub-object may be lost.
  - **References** to those elements in scripts, visualisations, or other adapters may need to be updated.
- If a device-specific data point was modified by the user, a backup of the original structure is created before the update is applied.

> **Recommendation if you work on ioBroker beta repository:** Before starting the adapter for the first time after an update, back up all objects of the adapter instance (e.g. `e3oncan.0`) or at least the objects of individual devices.

---

### Running a data point scan

A data point scan discovers all available data points on each device and creates or updates the corresponding objects in ioBroker.

**What a scan does:**

- Saves all found data points and creates any that are missing.
- Adds or updates metadata (description, unit, access information) for each data point.
- Sets temperature unit labels based on the device format configuration (data point `382`).

**When to run a scan:**

- During initial setup (strongly recommended, required for writing).
- After an adapter update that introduces new data point definitions.
- After a software update of Viessmann devices.

> **Recommendation:** Perform a device scan first (go to the **List of UDS Devices** tab, press **Start scan …**).

**How to start a scan:**

Open the adapter configuration dialog, go to the **List of Data Points** tab, press **Start scan …** and confirm with **OK**. The scan may take up to 5 minutes. Progress is visible in the adapter log (open a second browser tab).

---

## Changelog of Data Point Definitions

### v0.11.0 (2026-04-14)

Updated structure of the following data points:
268, 269, 271, 274, 279, 282, 284, 285, 286, 287, 288, 289, 290, 291, 318, 320, 321, 324, 531, 1659, 1684, 1768, 1769, 1770, 1771, 1772, 2084, 2085, 2087, 2088, 2090, 2091, 2093, 2094, 2096, 2097, 2099, 2100, 2102, 2103, 2105, 2106, 2108, 2109, 2111, 2112, 2114, 2115, 2117, 2118, 2120, 2121, 2123, 2124, 2126, 2127, 2129, 2130, 2132, 2133, 2135, 2136, 2138, 2139, 2141, 2142, 2240, 2260, 2261, 2263, 2264, 2266, 2267, 2269, 2270, 2272, 2273, 2275, 2276, 2278, 2279, 2281, 2282, 2284, 2285, 2287, 2288, 2290, 2291, 2293, 2294, 2296, 2297, 2299, 2300, 2302, 2303, 2305, 2306, 2308, 2309, 2311, 2312, 2314, 2315, 2317, 2318, 2320, 2333, 2334, 2351, 2352, 2593, 2735, 2806, 3014, 3015, 3016, 3017, 3018, 3032, 3034, 3035, 3036

**Notes:**
- For all sensor data points the last entry `Unknown` was renamed to `SensorStatus`. This is the reason for the large number of changed data points.
- For the frequently used data points 531, 1415–1418, 2351, 2532 and 2735 the numerical value has been moved to a sub-state `ID`:
  - `0531_DomesticHotWaterOperationState.ID`
  - `1415_MixerOneCircuitOperationState.State.ID`
  - `2351_HeatPumpCompressor.PowerState.ID`
  - `2352_AdditionalElectricHeater.PowerState.ID`
  - `2735_FourThreeWayValveValveCurrentPosition.ID`