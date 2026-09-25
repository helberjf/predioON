import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sensorReadingState, TelemetrySchema, telemetryTopic } from "@predioon/shared";
import { normalizeTelemetry } from "../src/pipeline/normalize.js";
import { initialState, nextState } from "../src/simulator/state.js";

const envelope = (metric: string, value: unknown, unit?: string) => ({
  schemaVersion: 1, eventId: "sensor-test-event", buildingId: "bld_001", deviceId: "sensor_01",
  metric, value, ...(unit ? { unit } : {}), timestamp: "2026-09-22T12:00:00.000Z",
});

describe("contratos tipados dos sensores", () => {
  it("aceita detecções booleanas e recusa strings/números antes da ingestão", () => {
    for (const metric of ["pump_running", "gas_detected", "smoke_detected", "leak_detected", "water_leak_detected", "sewage_leak_detected"]) {
      for (const value of [true, false]) assert.equal(TelemetrySchema.safeParse(envelope(metric, value)).success, true, metric);
      for (const value of ["false", "true", 0, 1, null]) {
        const result = normalizeTelemetry(telemetryTopic("bld_001", "sensor_01"), Buffer.from(JSON.stringify(envelope(metric, value))));
        assert.deepEqual(result, [], `${metric}: ${value}`);
      }
    }
  });

  it("recusa unidade errada, números não finitos e valores fisicamente impossíveis", () => {
    for (const [metric, value, unit] of [
      ["gas_ppm", -1, "ppm"], ["gas_ppm", 1_000_001, "ppm"], ["gas_ppm", 100, "V"],
      ["energy_total_kwh", -1, "kWh"], ["water_total_m3", -1, "m³"],
      ["voltage_l1", -1, "V"], ["voltage_l2", 1001, "V"], ["current_l3", -1, "A"],
      ["frequency_hz", 101, "Hz"], ["temperature_c", -274, "°C"],
      ["temperature_c", "28", "°C"], ["water_level_percent", 101, "%"],
      ["volume_liters", -1, "L"], ["pump_running", true, "V"], ["voltage_l3", Infinity, "V"],
    ] as const) assert.equal(TelemetrySchema.safeParse(envelope(metric, value, unit)).success, false, `${metric}: ${value} ${unit}`);
  });

  it("aceita as unidades canônicas e mantém métricas personalizadas compatíveis", () => {
    for (const [metric, value, unit] of [
      ["gas_ppm", 150, "ppm"], ["energy_total_kwh", 1024.55, "kWh"], ["water_total_m3", 302.2, "m³"],
      ["voltage_l1", 0, "V"], ["current_l2", 12, "A"], ["frequency_hz", 60, "Hz"],
      ["temperature_c", -20, "°C"], ["water_level_percent", 100, "%"],
      ["custom_status", "waiting", "custom"],
    ] as const) assert.equal(TelemetrySchema.safeParse(envelope(metric, value, unit)).success, true, metric);
    assert.equal(TelemetrySchema.safeParse(envelope("gas_ppm", 0)).success, true, "unidade pode ser omitida quando implícita no contrato");
  });
});

describe("simulação dos sensores e medidores", () => {
  it("escala o avanço físico pelo intervalo sem criar relógio de telemetria fictício", () => {
    const initial = initialState();
    const short = nextState(initial, 1, "normal", 5);
    const long = nextState(initial, 1, "normal", 50);
    assert.ok(Math.abs((long.energyTotalKwh - initial.energyTotalKwh) / (short.energyTotalKwh - initial.energyTotalKwh) - 10) < 1e-6);
    assert.ok(Math.abs((long.waterTotalM3 - initial.waterTotalM3) / (short.waterTotalM3 - initial.waterTotalM3) - 10) < 1e-6);
    for (const seconds of [0, -1, Infinity, NaN]) assert.throws(() => nextState(initial, 1, "normal", seconds));
  });
  it("acumula energia e consumo de água sem derivar consumo do nível da caixa", () => {
    const initial = initialState();
    const normal = nextState(initial, 1, "normal");
    const refill = nextState({ ...initial, pumpRunning: true }, 1, "normal");
    assert.ok(normal.energyTotalKwh > initial.energyTotalKwh);
    assert.ok(normal.waterTotalM3 > initial.waterTotalM3);
    assert.ok(refill.waterLevelPercent > initial.waterLevelPercent);
    assert.ok(refill.waterTotalM3 > initial.waterTotalM3, "hidrômetro avança mesmo durante a reposição do reservatório");
  });

  it("representa gás, fumaça e vazamentos como detecções independentes", () => {
    const gas = nextState(initialState(), 1, "gas");
    assert.equal(gas.gasDetected, true);
    assert.ok(gas.gasPpm > 0);
    assert.equal(gas.smokeDetected, false);
    assert.equal(nextState(initialState(), 1, "smoke").smokeDetected, true);
    const sewage = nextState(initialState(), 1, "sewage-leak");
    assert.equal(sewage.sewageLeakDetected, true);
    assert.equal(sewage.leakDetected, false);
    assert.equal(nextState(initialState(), 1, "leak").leakDetected, true);
  });

  it("exercita consumo elevado e bomba continuamente ligada", () => {
    const initial = initialState();
    const normal = nextState(initial, 1, "normal");
    assert.ok(nextState(initial, 1, "high-energy").energyTotalKwh - initial.energyTotalKwh > 3 * (normal.energyTotalKwh - initial.energyTotalKwh));
    assert.ok(nextState(initial, 1, "high-water-consumption").waterTotalM3 - initial.waterTotalM3 > 3 * (normal.waterTotalM3 - initial.waterTotalM3));
    assert.equal(nextState({ ...initial, waterLevelPercent: 99 }, 1, "pump-overrun").pumpRunning, true);
    assert.equal(nextState(initial, 1, "power-loss").energyTotalKwh, initial.energyTotalKwh);
  });

  it("mantém acumuladores monotônicos e valores físicos nos limites em ciclos longos", () => {
    let state = initialState();
    for (let tick = 1; tick < 500; tick++) {
      const next = nextState(state, tick, tick % 2 ? "normal" : "high-water-consumption");
      assert.ok(next.energyTotalKwh >= state.energyTotalKwh);
      assert.ok(next.waterTotalM3 >= state.waterTotalM3);
      assert.ok(next.waterLevelPercent >= 0 && next.waterLevelPercent <= 100);
      state = next;
    }
  });
});

describe("estado exibido dos sensores", () => {
  it("nunca transforma ausência de leitura, qualidade ruim ou leitura antiga em ausência de detecção", () => {
    const state = sensorReadingState;
    const now = Date.parse("2026-09-22T12:00:00Z");
    const reading = { value: false, time: new Date(now).toISOString(), quality: "GOOD" };
    assert.equal(state(reading, now).status, "clear");
    assert.equal(state({ ...reading, value: true }, now).status, "detected");
    assert.equal(state({ ...reading, value: 28 }, now).status, "reading");
    assert.equal(state(undefined, now).status, "missing");
    assert.equal(state(reading, now + 16 * 60_000).status, "stale");
    assert.equal(state({ ...reading, time: "inválido" }, now).status, "invalid");
    assert.equal(state({ ...reading, quality: "BAD" }, now).status, "invalid");
    assert.equal(state({ ...reading, time: new Date(now + 61_000).toISOString() }, now).status, "invalid");
    assert.equal(state({ ...reading, value: "false" }, now).status, "invalid");
    assert.equal(state(reading, now, false).status, "disabled");
  });
});
