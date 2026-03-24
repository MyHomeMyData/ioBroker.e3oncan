![Logo](admin/e3oncan_small.png)
# ioBroker.e3oncan

## Handling of Data Points

### Background

On E3 series devices, information is organized into so-called data points. Each data point has the following properties:

* Numeric identification, e.g., 256
* Name, e.g., "BusIdentification"
* Length in bytes
* An internal structure, represented by codecs

Reading and writing data points always occurs as a sequence of bytes via the CAN bus.

The structure of many data points is known. If the structure is not yet known, "RawCodec" is used. This codec outputs the unaltered byte stream.

A further complication arises because some data points have different lengths and structures on different devices. Therefore, the known data points are organized into two lists:

* Generic data points that fit most devices
* Variant data points that have different lengths and only occur on some devices

An overview of all known data points, including variants, is maintained in the open3e project and is available here.

The information about data points is continuously maintained and expanded. Users are warmly invited to contribute. This can be done via the discussion forum, issues, or pull requests.

The latest version of the data points is developed in the open3e project. This ioBroker adapter, as well as the E3onCAN project, uses the same database derived from open3e. Updates to open3e are implemented periodically.

### Behavior when starting and updating the adapter

Each time the adapter starts, the versions of the existing data points are checked against the version stored in the adapter. If newer versions are available, for example, after an adapter update, the existing data point structures are updated. This process is documented in detail in the log. The following should be noted during this process:

* If the structure of a data point changes, the object structure as `tree` is likely no longer valid. Therefore, in this case, the entire structure under `tree` for the affected data point is deleted and recreated with the new structure. This procedure is necessary for the adapter to function correctly, but can lead to undesirable effects:
    + If elements of the affected structure under `tree` were archived, this data may be lost.
    + If elements are referenced elsewhere, e.g., in the vis, the references to the data point may need to be adjusted.
* If a device-specific data point is affected and has already been modified by the user, a backup of the data point structure is created, and the structure is then updated.

### Data Point Scan

If a data point scan is performed (again), all found data points are saved, and missing ones are created.

### Save objects before starting new version of adapter and before performing scans

Before starting the adapter for the first time after an update and before performing a device or data point scan, it is recommended to back up all objects of the instance, e.g., `e3oncan.0` or individual devices.

### Data Point Metadata

Starting with open3e version 0.6.1 and the adapter version 0.11.0, additional metadata is provided for many data points:

* Description
* Physical unit, if applicable
* Notes and/or link to further information
* Information regarding access to the data point (read-only or read-and-write)

For modified data point structures, this information is added to the object trees upon first launch of the new adapter version. To add the information for all data points, a new data point scan must be performed.

The unit of the temperature values ​​is derived from the configuration of the Viessmann device (data point 382). If data point 382 is missing for a device, the configuration of the master device (CAN address 0x680) is used.

### Writability of Data Points

A data point is treated as writable if its ID is included in the whitelist `e3oncan.0.<DEVICE>.info.udsDidsWritable`, or if it is marked as read-and-write in the metadata.