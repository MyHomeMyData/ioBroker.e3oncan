# Older Changelog Entries
## 0.10.13 (2025-09-30)
* (MyHomeMyData) Fix for issue #162

## 0.10.12 (2025-09-15)
* (MyHomeMyData) Migration to ESLint 9, refer to issues #141 and #152

## 0.10.11 (2025-09-06)
* (MyHomeMyData) Fix for issue #152 (repository checker) and #126 (node.js 24)
* (MyHomeMyData) Added hint to readme regarding user action after upgrading version of node.js
* (MyHomeMyData) Update of list of data points for E3 devices to version 20250903

## 0.10.10 (2025-08-07)
* (MyHomeMyData) Fix for issue #142 (WriteByDid not working in case of specific UDS control frame)
* (MyHomeMyData) Update of list of data points for E3 devices to version 20250729
* (MyHomeMyData) Added codec for 64-bit integers. Remark: Encoding (for writing of data) is limited to values < 2^52 (4.503.599.627.370.496).

## 0.10.9 (2025-05-22)
* (MyHomeMyData) Update of list of data points for E3 devices to version 20250422
* (MyHomeMyData) Fixed version number of enum info
* (MyHomeMyData) Fix for issue #125 (findings of repository checker)

## 0.10.8 (2025-03-07)
* (MyHomeMyData) Bugfix for issue #117
* (MyHomeMyData) Updated data point 381, refer to discussion https://github.com/open3e/open3e/discussions/212
* (MyHomeMyData) Update of list of data points for E3 devices to version 20250307

## 0.10.7 (2025-02-26)
* (MyHomeMyData) Updated dependencies according to issue #111

## 0.10.6 (2025-02-19)
* (MyHomeMyData) Added missing enum info for data point 2850

## 0.10.5 (2025-02-18)
* (MyHomeMyData) Update of list of data points for E3 devices to version 20250217
* (MyHomeMyData) Updated dependencies according to issues #101 and #108

## 0.10.4 (2025-01-15)
* (MyHomeMyData) Update of list of data points for E3 devices to version 20250114

## 0.10.3 (2024-11-26)
* (MyHomeMyData) Update of list of data points for E3 devices to version 20241125

## 0.10.2 (2024-11-16)
* (MyHomeMyData) Update of list of data points for E3 devices to version 20241115
* (MyHomeMyData) Fixes for issue #81 (added missing size attributes)

## 0.10.1 (2024-10-20)
* (MyHomeMyData) Fixes for issue #79 (improvements for usability on mobile devices)

## 0.10.0 (2024-10-14)
* (MyHomeMyData) Added extended support for writing of data points.
* (MyHomeMyData) Changed naming for CAN adapter.

### 0.9.5 (2024-09-19)
* (MyHomeMyData) Update of list of data points for E3 devices to version 20240916

### 0.9.4 (2024-08-26)
* (MyHomeMyData) Start up an UDS worker for each device to allow writing of data points even when no schedule for reading is defined on this device
* (MyHomeMyData) Update of npm dependencies

### 0.9.3 (2024-08-20)
* (MyHomeMyData) Bugfix: Updating UDS communication statistics, even in case of persistent timeout events
* (MyHomeMyData) Disabled sinon should interface
* (MyHomeMyData) Fixes based on issues #55,#56
* (MyHomeMyData) Bugfix: Time delta between schedules of UDS workes was not working properly

### 0.9.2 (2024-08-09)
* (MyHomeMyData) Update of dependencies, fixes based on issue #53
* (MyHomeMyData) Update of list of data points for E3 devices to version 20240808

### 0.9.1 (2024-05-26)
* (MyHomeMyData) Updated README, added links for description of device topology and to uses cases
* (MyHomeMyData) Added info for data points 2404_BivalenceControlMode and 2831_BivalenceControlAlternativeTemperature
* (MyHomeMyData) Update of list of data points for E3 devices to version 20240505

### 0.9.0 (2024-04-21)
* (MyHomeMyData) Structure of data point 1690 (ElectricalEnergySystemPhotovoltaicStatus) changed based on issue https://github.com/MyHomeMyData/E3onCAN/issues/6. Manual adaptations may be needed, please check!
* (MyHomeMyData) Update of list of data points for E3 devices to version 20240420
* (MyHomeMyData) Added support for energy meter E3100CB
* (MyHomeMyData) Update of list of data points for E380 to version 20240418
* (MyHomeMyData) Main change for E380 id 600/601 (GridEnergy): Now using correct data format. Many thanks to @M4n197 for unveiling the right data format. Manual adaptations may be needed, please check!

### 0.8.0 (2024-03-22)
* (MyHomeMyData) Added support for energy meter E380 with CAN-address=98
* (MyHomeMyData) Update of list of data points for E380 to version 20240320

### 0.7.2 (2024-03-20)
* (MyHomeMyData) Update of data type and role added for device specific data points
* (MyHomeMyData) Update list of writable data points when updating data points to newer version
* (MyHomeMyData) Improved handling of failed CAN communication during scan for data points
* (MyHomeMyData) Update of list of data points to version 20240319

### 0.7.1 (2024-03-15)
* (MyHomeMyData) Bugfix for data point 1190: Scaling changed back to 10.0
* (MyHomeMyData) Update of list of data points to version 20240314

### 0.7.0 (2024-03-13)
* (MyHomeMyData) Store numbers in states of channel "tree" with type "Number" instead of "String"
* (MyHomeMyData) IMPORTANT: This may affect handling of tree states, e.g. in scripts, vis and history
* (MyHomeMyData) Bugfix for Energy Meter E380 data point id 0x25C
* (MyHomeMyData) Update of list of data points to version 20240309
* (MyHomeMyData) Bugfix for update of changed data point structure during start of adapter
* (MyHomeMyData) Changed default values for CAN adapters to can0 and can1
* (MyHomeMyData) Increased value for collect timeout to 2000 ms

### 0.6.19 (2024-02-19)
* (MyHomeMyData) Check for changed structure of data points during startup
* (MyHomeMyData) Update of list of data points to version 20240218
* (MyHomeMyData) Bugfix to avoid warnings on very first start of adapter

### 0.6.18 (2024-02-08)
* (MyHomeMyData) Added versioning to list of data points and check for updates on start of adapter
* (MyHomeMyData) Added optional description in configuration of UDS schedules

### 0.6.17 (2024-01-29)
* (MyHomeMyData) Added/removed data points to/from list of writable dids
* (MyHomeMyData) Preparations for device specific list of writable dids

### 0.6.16 (2024-01-27)
* (MyHomeMyData) Improvements based on findings in review as of 2024-01-25
* (MyHomeMyData) Checkbox for data collectiton on internal bus is now checked per default

### 0.6.15 (2024-01-23)
* (MyHomeMyData) Fix for Utf8 codec for handling of special characters, e.g. umlauts

### 0.6.14 (2024-01-22)
* (MyHomeMyData) Replace '.' by '_' in data point ids to avoid unwanted sub structure in data states
* (MyHomeMyData) Added more informations about white list for writables in Readme.
* (MyHomeMyData) Recognize loss of CAN connection.
* (MyHomeMyData) Improved handling of info.connection.

### 0.6.13 (2024-01-20)
* (MyHomeMyData) Now supports multiple definitions of same schedule on a device 
* (MyHomeMyData) Added unit test cases for codecs

### 0.6.12 (2024-01-19)
* (MyHomeMyData) Added data points to list writable dids
* (MyHomeMyData) Added unit test cases for codecs
* (MyHomeMyData) Improved speed of codes for numerical values
* (MyHomeMyData) Improved error messages on UDS negative response

### 0.6.11 (2024-01-17)
* (MyHomeMyData) Improved layout of configuration dialog for device scan

### 0.6.10 (2024-01-15)
* (MyHomeMyData) Removed code for Rawmode because it's never activated

### 0.6.9 (2024-01-13)
* (MyHomeMyData) Bugfix: Only Linux is supported

### 0.6.8 (2024-01-13)
* (MyHomeMyData) Initial npm version
