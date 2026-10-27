import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TelemetrySchema, WaterTelemetrySchema, parseTelemetryTopic, parseWaterTelemetryTopic } from "@predioon/shared";
import { demoCycleMessages, nextParking, recoverTank, resumeField } from "../src/simulator/demo-field-plan.js";
import { initialState, nextState } from "../src/simulator/state.js";

const devices = [
  { id: "water", type: "WATER_LEVEL_SENSOR" }, { id: "meter", type: "WATER_METER" }, { id: "energy", type: "ENERGY_METER" },
  { id: "pump", type: "PUMP_MONITOR" }, { id: "phase", type: "PHASE_MONITOR" }, { id: "leak", type: "LEAK_SENSOR" },
  { id: "gate", type: "GATE_CONTROLLER" }, { id: "car", type: "PARKING_SENSOR" }, { id: "camera", type: "UNKNOWN_TYPE" },
];
const at = new Date("2026-10-26T15:00:00Z");
const metrics = (messages: ReturnType<typeof demoCycleMessages>) => messages.map(message => {
  const water = parseWaterTelemetryTopic(message.topic);
  if (water) return `${water.deviceId}:level`;
  const body = JSON.parse(message.payload);
  return `${body.deviceId}:${body.metric}`;
});

describe("gateway de demonstração", () => {
  it("publica cada tipo de equipamento no contrato real da ingestão", () => {
    const messages = demoCycleMessages("bld", devices, initialState(), new Map([["car", 7]]), at);
    for (const message of messages) {
      const water = parseWaterTelemetryTopic(message.topic);
      if (water) { assert.equal(WaterTelemetrySchema.safeParse(JSON.parse(message.payload)).success, true); continue; }
      const topic = parseTelemetryTopic(message.topic)!;
      const body = TelemetrySchema.parse(JSON.parse(message.payload));
      assert.equal(body.buildingId, "bld"); assert.equal(topic.deviceId, body.deviceId);
    }
    const sent = metrics(messages);
    assert.ok(sent.includes("water:level") && sent.includes("car:parking_occupied") && sent.includes("gate:gate_open"));
    assert.equal(sent.filter(item => item.startsWith("phase:")).length, 7);
    assert.ok(!sent.some(item => item.startsWith("camera:")), "tipo desconhecido não inventa leitura");
  });

  it("fora do ciclo completo manda só medidores, portões e o que mudou", () => {
    const sent = new Map<string, string>();
    let state = initialState();
    demoCycleMessages("bld", devices, state, new Map([["car", 7]]), at, true, sent);
    state = { ...nextState(state, 1, "normal", 15), voltageL1: state.voltageL1, voltageL2: state.voltageL2, voltageL3: state.voltageL3,
      currentL1: state.currentL1, currentL2: state.currentL2, currentL3: state.currentL3, frequencyHz: state.frequencyHz,
      waterLevelPercent: state.waterLevelPercent };
    const quiet = metrics(demoCycleMessages("bld", devices, state, new Map([["car", 7]]), at, false, sent));
    assert.deepEqual(quiet.sort(), ["energy:energy_total_kwh", "gate:gate_open", "meter:water_total_m3", "pump:pump_running"]);
    const leaking = metrics(demoCycleMessages("bld", devices, { ...state, leakDetected: true }, new Map([["car", 8]]), at, false, sent));
    assert.ok(leaking.includes("leak:water_leak_detected"), "um vazamento aparece na hora, sem esperar o ciclo completo");
    assert.ok(leaking.includes("car:parking_occupied"));
  });

  it("as vagas andam de um em um e nunca saem da capacidade", () => {
    const lots = [{ sensorId: "car", capacity: 3 }];
    let occupied = new Map([["car", 3]]);
    for (let i = 0; i < 200; i++) {
      const next = nextParking(lots, occupied, at, () => (i % 7) / 7);
      assert.ok(Math.abs(next.get("car")! - occupied.get("car")!) <= 1);
      assert.ok(next.get("car")! >= 0 && next.get("car")! <= 3);
      occupied = next;
    }
  });

  it("nunca mostra um estacionamento cheio ou vazio, nem à noite", () => {
    const lots = [{ sensorId: "car", capacity: 72 }];
    const night = new Date("2026-10-27T01:00:00Z");
    let occupied = new Map([["car", 72]]);
    for (let i = 0; i < 2000; i++) {
      occupied = nextParking(lots, occupied, night, () => 0.99);
      assert.ok(occupied.get("car")! <= 64, "sempre sobram vagas livres");
    }
    for (let i = 0; i < 2000; i++) {
      occupied = nextParking(lots, occupied, night, () => 0.5 - 0.5 * (i % 2));
      assert.ok(occupied.get("car")! >= 8, "sempre há carros");
    }
  });

  it("retoma do histórico para um reinício não parecer reinício de medidor", () => {
    const base = initialState();
    const { state, parking } = resumeField(base, [
      { deviceId: "meter", metric: "water_total_m3", value: 851.25 }, { deviceId: "energy", metric: "energy_total_kwh", value: 12999.5 },
      { deviceId: "water", metric: "water_level_percent", value: 61 }, { deviceId: "car", metric: "parking_occupied", value: 40.2 },
      { deviceId: "bad", metric: "water_total_m3", value: Number.NaN }, { deviceId: "tank", metric: "water_level_percent", value: 250 },
    ]);
    assert.equal(state.waterTotalM3, 851.25);
    assert.equal(state.energyTotalKwh, 12999.5);
    assert.equal(state.waterLevelPercent, 61);
    assert.equal(state.waterVolumeLiters, 6100);
    assert.equal(parking.get("car"), 40);
    assert.equal(resumeField(base, []).state.waterTotalM3, base.waterTotalM3, "sem histórico começa do valor inicial");
  });

  it("o tanque se recupera ao sair do cenário de nível baixo, e só então", () => {
    const low = { ...initialState(), waterLevelPercent: 18, waterVolumeLiters: 1800 };
    assert.equal(recoverTank(low, "low-water").waterLevelPercent, 18, "durante o cenário continua baixo");
    assert.equal(recoverTank(low, "normal").waterLevelPercent, 62);
    assert.equal(recoverTank({ ...low, waterLevelPercent: 40 }, "normal").waterLevelPercent, 40, "nível normal não é mexido");
  });
});
