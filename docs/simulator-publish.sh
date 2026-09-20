#!/usr/bin/env bash
mosquitto_pub -h localhost -p 1883 \
  -t 'predio/bld_001/device/water_01/telemetry' \
  -m '{"schemaVersion":1,"eventId":"evt_demo_0001","buildingId":"bld_001","deviceId":"water_01","metric":"water_level_percent","value":18,"unit":"%","quality":"GOOD","timestamp":"2026-09-19T23:45:00Z"}'
