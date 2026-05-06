#!/bin/bash
# Simulate energy meter CAN messages for testing energy meter detection.
#
# Usage: simulate_energy_meter.sh [e380_97|e380_98|e3100] [can_interface]
#
# Defaults: e380_98, vcan0
#
# CAN frame IDs:
#   E380 @ address 97  -> 0x250 (data point 592, even IDs)
#   E380 @ address 98  -> 0x251 (data point 593, odd IDs)
#   E3100CB            -> 0x569 (data point 1385)

METER="${1:-e380_98}"
BUS="${2:-vcan0}"

case "$METER" in
    e380_97)
        CAN_ID="250"
        LABEL="E380 at CAN address 97"
        ;;
    e380_98)
        CAN_ID="251"
        LABEL="E380 at CAN address 98"
        ;;
    e3100)
        CAN_ID="569"
        LABEL="E3100CB"
        ;;
    *)
        echo "Unknown meter type: $METER"
        echo "Usage: $0 [e380_97|e380_98|e3100] [can_interface]"
        exit 1
        ;;
esac

echo "Simulating $LABEL on $BUS (CAN ID: 0x$CAN_ID) — press Ctrl+C to stop"

case "$METER" in
    e3100) DATA="0000000400000000" ;;
    *)     DATA="0000000000000000" ;;
esac

while true; do
    cansend "$BUS" "${CAN_ID}#${DATA}"
    sleep 1
done
