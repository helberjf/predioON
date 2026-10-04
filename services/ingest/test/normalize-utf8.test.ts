import { test } from "node:test";
import assert from "node:assert/strict";
import { telemetryTopic, waterTelemetryTopic } from "@predioon/shared";
import { normalizeTelemetry } from "../src/pipeline/normalize.js";

const marker = "_INVALID_UTF8_";
const generic = {
  schemaVersion: 1, eventId: "utf8-event-0001", buildingId: "building-utf8", deviceId: "device-utf8",
  metric: "vendor_note", value: "Leitura", unit: "txt", quality: "GOOD", timestamp: "2026-10-03T12:30:00Z",
};
const topic = telemetryTopic(generic.buildingId, generic.deviceId);
const water = {
  device_id: "caixa-漢-😀", type: "nivel_caixa_agua", nivel_percentual: 72,
  distancia_mm: 240, volume_litros: 1250.5, timestamp: "2026-10-03T09:30:00-03:00",
};
const waterTopic = waterTelemetryTopic("condomínio-á", water.device_id);

/** Keep valid JSON delimiters around bytes that a replacement decoder would accept. */
function withInvalidBytes(body: unknown, bytes: number[]): Buffer {
  const encoded = Buffer.from(JSON.stringify(body));
  const needle = Buffer.from(marker);
  const index = encoded.indexOf(needle);
  assert.notEqual(index, -1);
  assert.equal(encoded.indexOf(needle, index + needle.length), -1);
  return Buffer.concat([encoded.subarray(0, index), Buffer.from(bytes), encoded.subarray(index + needle.length)]);
}

const malformedSequences: Array<[string, number[]]> = [
  ["isolated continuation", [0x80]],
  ["invalid leading byte", [0xff]],
  ["two-byte overlong encoding", [0xc0, 0xaf]],
  ["three-byte overlong encoding", [0xe0, 0x80, 0xaf]],
  ["four-byte overlong encoding", [0xf0, 0x80, 0x80, 0xaf]],
  ["UTF-8 encoded high surrogate", [0xed, 0xa0, 0x80]],
  ["UTF-8 encoded low surrogate", [0xed, 0xbf, 0xbf]],
  ["code point beyond Unicode maximum", [0xf4, 0x90, 0x80, 0x80]],
  ["invalid four-byte leading range", [0xf5, 0x80, 0x80, 0x80]],
  ["truncated two-byte sequence", [0xc2]],
  ["truncated three-byte sequence", [0xe2, 0x82]],
  ["truncated four-byte sequence", [0xf0, 0x9f, 0x98]],
  ["non-continuation inside a sequence", [0xc2, 0x20]],
];

for (const [name, bytes] of malformedSequences) {
  test(`rejects ${name} inside a vendor value instead of substituting text`, () => {
    const raw = withInvalidBytes({ ...generic, value: marker }, bytes);
    // The original lossy path produces a schema-valid vendor string.
    assert.equal(typeof JSON.parse(raw.toString("utf8")).value, "string");
    assert.deepEqual(normalizeTelemetry(topic, raw), []);
  });
}

for (const field of ["buildingId", "deviceId"] as const) {
  test(`invalid UTF-8 cannot alias a literal replacement character in ${field}`, () => {
    const body = { ...generic, [field]: `source-${marker}` };
    const raw = withInvalidBytes(body, [0xff]);
    const identity = { ...generic, [field]: "source-\uFFFD" };
    assert.equal(JSON.parse(raw.toString("utf8"))[field], identity[field]);
    assert.deepEqual(normalizeTelemetry(telemetryTopic(identity.buildingId, identity.deviceId), raw), []);
  });
}

test("invalid UTF-8 cannot alias a water device with a literal replacement character", () => {
  const raw = withInvalidBytes({ ...water, device_id: `caixa-${marker}` }, [0xff]);
  assert.equal(JSON.parse(raw.toString("utf8")).device_id, "caixa-\uFFFD");
  assert.deepEqual(normalizeTelemetry(waterTelemetryTopic("condomínio-á", "caixa-\uFFFD"), raw), []);
});

test("rejects malformed bytes in an otherwise ignored extra JSON field", () => {
  const raw = withInvalidBytes({ ...generic, ignoredVendorField: marker }, [0x80]);
  assert.deepEqual(normalizeTelemetry(topic, raw), []);
});

for (const [name, target, body] of [["generic", topic, generic], ["water", waterTopic, water]] as const) {
  test(`preserves rejection of a leading UTF-8 BOM in ${name} JSON`, () => {
    const raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(body))]);
    assert.throws(() => JSON.parse(raw.toString("utf8")), SyntaxError);
    assert.deepEqual(normalizeTelemetry(target, raw), []);
  });
}

test("preserves literal accents, CJK, emoji, combining text and valid replacement characters", () => {
  const body = { ...generic, value: "Medição: Água 漢字 😀 e\u0301 É \uFFFD \uFEFF" };
  assert.deepEqual(normalizeTelemetry(topic, Buffer.from(JSON.stringify(body))), [body]);
});

test("accepts valid UTF-8 code points on encoding and Unicode range boundaries", () => {
  const body = { ...generic, value: "\u0080\u07FF\u0800\uD7FF\uE000\uFFFF\u{10000}\u{10FFFF}" };
  assert.deepEqual(normalizeTelemetry(topic, Buffer.from(JSON.stringify(body))), [body]);
});

test("keeps identities, event IDs, metric and unit literal without trim or NFC/case normalization", () => {
  const body = {
    ...generic, buildingId: " Condomínio-e\u0301 ", deviceId: " Sensor-İ-漢-😀 ", eventId: " EVENT-e\u0301-0001 ",
    metric: "Vendor-e\u0301", unit: " u\u0301 ", value: " valor ",
  };
  assert.deepEqual(normalizeTelemetry(telemetryTopic(body.buildingId, body.deviceId), Buffer.from(JSON.stringify(body))), [body]);
});

for (const [name, identity, mismatched] of [
  ["NFC", "source-e\u0301", "source-é"], ["case", "Source-ABC", "source-abc"], ["trim", " source ", "source"],
] as const) {
  test(`preserves exact topic identity comparison for ${name} differences`, () => {
    const body = { ...generic, deviceId: mismatched };
    assert.deepEqual(normalizeTelemetry(telemetryTopic(body.buildingId, identity), Buffer.from(JSON.stringify(body))), []);
  });
}

for (const value of [42.5, false, "10", "false", "null"] as const) {
  test(`preserves vendor value ${JSON.stringify(value)} with its original type`, () => {
    const body = { ...generic, value };
    const [reading] = normalizeTelemetry(topic, Buffer.from(JSON.stringify(body)));
    assert.deepEqual(reading, body);
    assert.equal(typeof reading.value, typeof value);
  });
}

test("does not broaden byte validation into a new policy for existing JSON string escapes", () => {
  const body = { ...generic, value: "\uD800" };
  const raw = Buffer.from(JSON.stringify(body));
  assert.ok(raw.includes(Buffer.from("\\ud800")));
  assert.deepEqual(normalizeTelemetry(topic, raw), [body]);
});

for (const length of [16_383, 16_384, 16_385]) {
  test(`retains the ${length}-byte envelope boundary for valid multi-byte text`, () => {
    const body = { ...generic, value: "漢".repeat(500) };
    const json = Buffer.from(JSON.stringify(body));
    const raw = Buffer.concat([json, Buffer.alloc(length - json.length, 0x20)]);
    assert.equal(raw.length, length);
    assert.deepEqual(normalizeTelemetry(topic, raw), length <= 16_384 ? [body] : []);
  });
}

test("preserves rejection of empty or malformed JSON even when its bytes are valid UTF-8", () => {
  for (const raw of [Buffer.alloc(0), Buffer.from("{"), Buffer.from("null"), Buffer.from("[]")]) {
    assert.deepEqual(normalizeTelemetry(topic, raw), []);
  }
});

test("preserves water offsets, derived event IDs, units and numeric values", () => {
  const result = normalizeTelemetry(waterTopic, Buffer.from(JSON.stringify(water)));
  const equivalent = normalizeTelemetry(waterTopic, Buffer.from(JSON.stringify({ ...water, timestamp: "2026-10-03T12:30:00Z" })));
  assert.deepEqual(result, equivalent);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map(reading => [reading.metric, reading.value, reading.unit, reading.quality, reading.timestamp]), [
    ["water_level_percent", 72, "%", "GOOD", "2026-10-03T12:30:00.000Z"],
    ["distance_mm", 240, "mm", "GOOD", "2026-10-03T12:30:00.000Z"],
    ["volume_liters", 1250.5, "L", "GOOD", "2026-10-03T12:30:00.000Z"],
  ]);
  assert.ok(result.every(reading => /^[0-9a-f]{64}$/.test(reading.eventId)));
  assert.equal(new Set(result.map(reading => reading.eventId)).size, 3);
});
