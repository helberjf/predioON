import assert from "node:assert/strict";
import test from "node:test";
import * as telemetry from "../src/telemetry.ts";

const sample = (device: string, metric = "water_level_percent", numeric: number | null = 64) => ({
  device_id: device, device_name: `Sensor ${device}`, metric, numeric_value: numeric,
  value: numeric ?? "unknown", unit: "%", quality: "GOOD", time: "2026-09-21T12:00:00Z",
});

test("sensor selection uses the building's real devices and keeps metrics from different tanks separate", () => {
  assert.equal(typeof telemetry.sensorChoices, "function", "sensor selection must be available");
  const readings = [sample("tank-b"), sample("tank-a"), sample("tank-a", "volume_liters", 500), sample("phase-a", "voltage_l1", 220)];
  const options = telemetry.sensorChoices(readings, ["water_level_percent", "volume_liters"]);
  assert.deepEqual(options.map((item) => item.value).sort(), ["tank-a", "tank-b"]);
  assert.equal(telemetry.findReading(readings, "tank-b", "volume_liters"), undefined);
  assert.equal(telemetry.findReading(readings, "tank-a", "volume_liters")?.numeric_value, 500);
});

test("a registered sensor without readings remains available for historical queries", () => {
  assert.equal(typeof telemetry.sensorChoices, "function");
  const options = telemetry.sensorChoices([], ["water_level_percent"], [{ id: "empty-tank", name: "Reservatório superior", type: "WATER_LEVEL_SENSOR", enabled: true }], ["WATER_LEVEL_SENSOR"]);
  assert.deepEqual(options, [{ value: "empty-tank", label: "Reservatório superior" }]);
});

test("missing, invalid, and uncertain measurements never become a zero or a normal reading", () => {
  assert.equal(typeof telemetry.numericReading, "function");
  assert.equal(telemetry.numericReading(undefined), null);
  assert.equal(telemetry.numericReading(sample("a", "water_level_percent", null)), null);
  assert.equal(telemetry.numericReading({ ...sample("a"), quality: "BAD" }), null);
  assert.equal(telemetry.numericReading({ ...sample("a"), quality: "UNCERTAIN" }), null);
  assert.equal(telemetry.numericReading(sample("a", "water_level_percent", 0)), 0);
});

test("pump values distinguish false from the truthy string false", () => {
  assert.equal(typeof telemetry.booleanReading, "function");
  assert.equal(telemetry.booleanReading({ ...sample("pump"), value: "false" }), false);
  assert.equal(telemetry.booleanReading({ ...sample("pump"), value: true }), true);
  assert.equal(telemetry.booleanReading({ ...sample("pump"), value: "unknown" }), null);
});

test("old readings are identified without marking missing readings as current", () => {
  assert.equal(typeof telemetry.readingStatus, "function");
  const now = Date.parse("2026-09-21T13:00:00Z");
  assert.equal(telemetry.readingStatus(sample("a"), now), "Leitura antiga");
  assert.equal(telemetry.readingStatus(undefined, now), "Sem leitura");
  assert.equal(telemetry.readingStatus({ ...sample("a"), time: "invalid" }, now), "Horário indisponível");
  assert.equal(telemetry.readingStatus({ ...sample("a"), time: "2026-09-21T12:59:00Z" }, now), "Leitura recente");
});

test("history URL stays stable for the same interval and safely encodes arbitrary device IDs", () => {
  assert.equal(typeof telemetry.seriesPath, "function");
  const anchor = Date.parse("2026-09-21T13:00:00Z");
  const first = telemetry.seriesPath("tank&b", "water_level_percent", "1h", anchor);
  assert.equal(first, telemetry.seriesPath("tank&b", "water_level_percent", "1h", anchor));
  const url = new URL(first!, "https://example.test");
  assert.equal(url.searchParams.get("deviceId"), "tank&b");
  assert.equal(url.searchParams.get("from"), "2026-09-20T13:00:00.000Z");
  assert.equal(url.searchParams.get("to"), "2026-09-21T13:00:00.000Z");
  assert.equal(telemetry.seriesPath("", "water_level_percent", "1h", anchor), null);
});
