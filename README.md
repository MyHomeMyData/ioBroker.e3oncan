![Logo](admin/e3oncan_small.png)
# ioBroker.e3oncan

[![NPM version](https://img.shields.io/npm/v/iobroker.e3oncan.svg)](https://www.npmjs.com/package/iobroker.e3oncan)
[![Downloads](https://img.shields.io/npm/dm/iobroker.e3oncan.svg)](https://www.npmjs.com/package/iobroker.e3oncan)
![Number of Installations](https://iobroker.live/badges/e3oncan-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/e3oncan-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.e3oncan.png?downloads=true)](https://nodei.co/npm/iobroker.e3oncan/)

**Tests:** ![Test and Release](https://github.com/MyHomeMyData/ioBroker.e3oncan/workflows/Test%20and%20Release/badge.svg)

## e3oncan adapter for ioBroker

# Basic concept
Viessmann E3 series devices (One Base) are doing a lot of data exchange on CAN bus.

This adapter can listen to this communication and extract many useful information. The often used energy meter E380 CA is also supported.

In parallel UDSonCAN service ReadByDid is supported. Informations not available via listening can be actively requested. This protocol is also used by other equipment, e.g. by well known WAGO gateway.

Important parts are based on the project [open3e](https://github.com/open3e).

A python based implementation of a pure listening approach using MQTT messaging is also availabe, see [E3onCAN](https://github.com/MyHomeMyData/E3onCAN).

**Present implementation supports reading and writing of datapoints via UDSonCAN (ReadByDid and WriteByDid).** By writing to datapoints it's possible to change setpoints, schedules and so on. It's even possible to add new schedules e.g. for domestic hot water circulation pump. Writing is restricted to a set of datapoints using a white list.

During first start of adapter instance a device scan will be done providing a list of all available devices for configuration dialog.
A scan for datapoints of each device is also available and should be done during first setup.

# Getting started

**Preconditions:**
* You have a (USB to) CAN bus adapter connected to external CAN bus of Viessmann E3 device
* CAN adapter is up and visible in system, e.g. as "can0" (use ifconfig to check)
* Refer to open3e project for further details
* **Make sure, open3e is not running during initial setup!** This could cause communication errors in both applications.

All services provided by this adapter are based on device list of your specific Viessmann E3 setup. Therefore you have to follow following steps for first setup:

**Configuration**
* When installation od adapter has finished a confuration dialog will show up to configure up to two CAN bus adapters (tab "CAN ADAPTER")
* Edit name of adapter and check the "Connect to adapter" checkbox at least the external adapter
* When you're done, press "SAVE" button to apply the changes. This step is **mandatory**. The instance will restart, connect to the CAN adapter and do a scan for devices available on bus. **Please be patient** - this may take up to 20 seconds. You may watch the activities in a 2nd browser tab by looking on the logging info of the adapter.
* When scan was successful new tabs will get visible in adapter confuration: "LIST OF UDS DEVICES", "LIST OF DATAPOINTS" and "ASSIGNMENTS TO EXTERNAL CAN ADAPTER".
* Go to the "LIST OF UDS DEVICES" and check the list of devices. You may change the naming on 2nd column. Those names will be used to store all collected data in ioBoker's object tree. Again press "SAVE" button when you did your changes. Again this step is **mandatory**.
* Instance will restart again and after a few seconds you are ready to a scan for available datapoints. Go to tab "LIST OF DATAPOINTS", press button "Start scan ..." and confirm with "OK" to start the scan. Again, **please be patient** - this may take **up to 5 minutes**. You may watch the progress in a 2nd browser tab by looking on the logging info of the adapter.
This step is not mandatory but strongly recomended. If you would like to write to datapoints you need to do a datapoint scan first.
* When datapoint scan was completed successfully, the datapoints are available in object tree for each device. You may view the datapoints in configuration by selecting a device and pressing button "Update". Press filter symbol and type search pattern to filter for name and/or codec. This is for your information only. Please deactivate filtering before selecting another device to avoid error messages.
* Last step is to configure schedules for collecting data on tab "ASSIGNMENTS TO EXTERNAL CAN ADAPTER".
* For **energy meter E380** (if available in your setup) you just can activate or not. Please notice the value "Min. update time (s)". Updates to single datapoints are done no faster than the given value (default is 5 seconds). By choosing zero every received data will be stored. Since E380 is sending data very fast (more than 20 values per second), it's recommended not to use zero here. This would put a high load on the ioBroker system.
* If you have connected E3 devices via CAN bus, e.g. Vitocal and VX3, you can collect data exchanged between those devices in realtime by listening. Press "+" to add a line, check "active" chackbox, select a device and edit "Min. update time (s)". It's feasable to use 0s here, however, I recommend to keep to the 5s.
* Finally, you may add schedules for requesting data via UDSonCAN protocol. Again press "+" button and edit the setting. You may have several schedules with different (!) timings. By this you can request some datapoints more often than others. Default value of 0 for "Schedule (s)" means, those datapoints will be requested just once during startup of the instance.
You may use datapoints informations on tab "LIST OF DATAPOINTS" for reference (opening on 2nd tab could help).
* If you have configured a CAN adapter connected to the **internal CAN bus**, a tab "ASSIGNMENTS TO INTERNAL CAN ADAPTER" is visible. Please configure the devices for colletion there. UDSonCAN is not supported on internal CAN bus by E3 devices.
* That's it. Press "SAVE & CLOSE" button and check the data collected in object tree.

# E380 data and units

| ID | Data| Unit |
| ------|:--- |------|
| 0x250 | Active Power L1, L2, L3, Total |  W |
| 0x252 | Reactive Power L1, L2, L3, Total | W |
| 0x254 | Current, L1, L2, L3, cosPhi | A, - |
| 0x256 | Voltage, L1, L2, L3, Frequency | V, Hz |
| 0x258 | Cumulated Import, Export | kWh |
| 0x25A | Total Active Power, Total Reactive Power | W |
| 0x25C | Cumulated Import | kWh |

# Hints and limitations

## This ioBroker adapter is under development and *beta stage*
* Please don't use this adapter in productive environment!
* Data structure and functionality is subject to change
* You're welcome to test the adapter in your environment. Please give me feedback about your experience and findings.

## Why using data collection (listening only) and UDSonCAN (ReadByDid) in parallel?
* When you have connected E3 devices you can benefit of the exchanged data. By just listening you will receive available data in realtime right on changing. So you can get fast changing data (e.g. energy flow values) and slowly changing data (e.g. temperatures) directly on each change. You're up do date all time for those values.
* Other data, not or rarely available via collection, you can add via UDSonCAN ReadByDid. Typically for setpoint data this is best approach.
* Therfore from my point of view, combination of both methods is best approach.

## Limitation of collecting data
* At present, the communication protocol is known only for Vitocal (listener on CAN id 0x693) and Vitocharge VX3 (listener on CAN id 0x451).

## What is different to open3e project?
* Obviously, the main differece is the direct integration to ioBroker. Configuration can be done via dialogs, data get's directly listed in object tree.
* **WriteByDid is supported for all data types** but restricted to datapoints on device specific white list, see info section of device. You need to do a datapoint scan to enable writing. Writing of data is triggered by storing the datapoint with ack=false - yes, it's that simple! The datapoint will be read again from device two seconds after writing. If datapoint not get's acknowledged, please take a look to the logs.
* A scan for datapoints per device (as depict tool of open3e is doing) is available now. After a successful scan, device specific datapoints are listed in object tree.
* In addation to open3e real time collecting of data via listening is supported.

## May open3 be used in parallel?
Yes, that is possible under certain conditions:
* If you only use data collecting here, you can use open3e with no limitiations.
* If you use UDSonCAN here, it's important not to do this for the same devices as open3e does. If you would do so, you will have sporadic communications errors.

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
* This is beta stage!
* Improve usability for tab "LIST OF DATAPOINTS"

## License
MIT License

Copyright (c) 2023 MyHomeMyData

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.