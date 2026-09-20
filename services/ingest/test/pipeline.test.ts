import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { db, sqlClient, telemetry } from "@predioon/db";
import { parseTelemetryTopic, telemetryTopic } from "@predioon/shared";
import { matches } from "../src/rules/evaluate.js";
import { handleTelemetry } from "../src/pipeline/telemetry.js";
import { initialState, nextState } from "../src/simulator/state.js";

const BUILDING = "bld_001";
const DEVICE = "water_01";

function payload(eventId: string, value: number): Buffer {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      eventId,
      buildingId: BUILDING,
      deviceId: DEVICE,
      metric: "water_level_percent",
      value,
      unit: "%",
      quality: "GOOD",
      timestamp: new Date().toISOString(),
    }),
  );
}

describe("motor de regras", () => {
  it("avalia cada operador", () => {
    assert.equal(matches("LT", 18, 20), true);
    assert.equal(matches("LT", 22, 20), false);
    assert.equal(matches("GTE", 20, 20), true);
    assert.equal(matches("NEQ", 1, 0), true);
    assert.equal(matches("DESCONHECIDO", 1, 0), false, "operador inválido nunca dispara alerta");
  });
});

describe("contrato de tópicos", () => {
  it("faz o ida e volta do tópico de telemetria", () => {
    const topic = telemetryTopic(BUILDING, DEVICE);
    assert.deepEqual(parseTelemetryTopic(topic), { buildingId: BUILDING, deviceId: DEVICE });
  });

  it("recusa tópicos fora do contrato", () => {
    assert.equal(parseTelemetryTopic("predio/bld_001/device/water_01"), null);
    assert.equal(parseTelemetryTopic("outro/bld_001/device/water_01/telemetry"), null);
  });
});

describe("simulador de campo", () => {
  it("esvazia a caixa quando a bomba está desligada", () => {
    const state = nextState({ ...initialState(), pumpRunning: false }, 1, "normal");
    assert.ok(state.waterLevelPercent < initialState().waterLevelPercent);
  });

  it("mantém o valor constante no cenário de sensor travado", () => {
    const start = initialState();
    const state = nextState(start, 1, "stuck-sensor");
    assert.equal(state.waterLevelPercent, start.waterLevelPercent);
  });

  it("zera a fase L3 na queda de energia", () => {
    assert.equal(nextState(initialState(), 1, "power-loss").voltageL3, 0);
  });
});

/** Precisa da infraestrutura local: `pnpm infra:up && pnpm db:seed`. */
describe("ingestão", () => {
  after(async () => {
    await db.execute(sql`delete from telemetry where metric = 'water_level_percent' and unit = '%' and value::text = '42'`);
    // Sem fechar o pool, o processo de teste nunca encerra.
    await sqlClient.end();
  });

  it("descarta telemetria cujo payload não bate com o tópico", async () => {
    const eventId = randomUUID();
    // Tópico de outro prédio, payload apontando para bld_001.
    await handleTelemetry(telemetryTopic("bld_outro", DEVICE), payload(eventId, 42));

    const rows = await db.select().from(telemetry).where(eq(telemetry.eventId, eventId));
    assert.equal(rows.length, 0);
  });

  it("grava uma única linha mesmo recebendo o mesmo eventId três vezes", async () => {
    const eventId = randomUUID();
    const topic = telemetryTopic(BUILDING, DEVICE);

    await handleTelemetry(topic, payload(eventId, 42));
    await handleTelemetry(topic, payload(eventId, 42));
    await handleTelemetry(topic, payload(eventId, 42));

    const rows = await db
      .select()
      .from(telemetry)
      .where(and(eq(telemetry.eventId, eventId), eq(telemetry.buildingId, BUILDING)));

    assert.equal(rows.length, 1, "QoS 1 é at-least-once: o eventId precisa deduplicar");
  });
});
