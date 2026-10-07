import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { telemetryTopic, waterTelemetryTopic } from "@predioon/shared";
import { handleTelemetry, readingFingerprint } from "../src/pipeline/telemetry.js";
import { RULE_FRESHNESS_MS } from "../src/rules/evaluate.js";

/** Needs the local database with every infrastructure migration applied. */
describe("telemetry receipt: scoped identity, content conflict, retained replay and freshness", () => {
  const suffix = randomUUID(), org = `receipt-${suffix}`;
  const buildingA = `receipt-a-${suffix}`, buildingB = `receipt-b-${suffix}`;
  // The same device name in two condominiums: identifiers are only unique inside one.
  const deviceA = `sensor-a-${suffix}`, deviceB = `sensor-b-${suffix}`, gatewayA = `gw-a-${suffix}`, gatewayB = `gw-b-${suffix}`;
  const seenAt = new Date(Date.now() - 86_400_000);

  type Body = { eventId?: string; value?: number | string | boolean; time?: Date; metric?: string; unit?: string };
  const body = (building: string, device: string, { eventId = randomUUID(), value = 50, time = new Date(), metric = "water_level_percent", unit = "%" }: Body = {}) =>
    Buffer.from(JSON.stringify({ schemaVersion: 1, eventId, buildingId: building, deviceId: device, metric, value, unit, quality: "GOOD", timestamp: time.toISOString() }));
  const send = (building: string, device: string, options: Body = {}, delivery: { retain?: boolean } = {}) =>
    handleTelemetry(telemetryTopic(building, device), body(building, device, options), delivery);
  const readings = async (building: string, eventId: string) => (await sqlClient`select value::text as value from telemetry where building_id=${building} and event_id=${eventId}`).map(row => JSON.parse(row.value));
  const alerts = async (building: string) => (await sqlClient`select count(*)::int as total from alerts where building_id=${building}`)[0]!.total as number;
  const rejected = async (category: string, building = "") => Number((await sqlClient`select coalesce(sum(total),0) as total from ingest_rejections where category=${category} and building_id=${building}`)[0]!.total);
  const lastSeen = async (device: string) => new Date((await sqlClient`select last_seen_at from devices where id=${device}`)[0]!.last_seen_at).getTime();
  const rewind = () => sqlClient`update devices set last_seen_at=${seenAt.toISOString()}::timestamptz, status='OFFLINE' where id in (${deviceA},${deviceB})`;

  before(async () => {
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Receipt fixture',${org})`;
    for (const [building, gateway, device] of [[buildingA, gatewayA, deviceA], [buildingB, gatewayB, deviceB]] as const) {
      await sqlClient`insert into buildings(id,organization_id,name,code) values(${building},${org},'Receipt',${building})`;
      await sqlClient`insert into gateways(id,building_id,name,serial_number,status,last_seen_at) values(${gateway},${building},'Gateway',${gateway},'ONLINE',clock_timestamp())`;
      await sqlClient`insert into devices(id,building_id,gateway_id,name,type,status,last_seen_at) values(${device},${building},${gateway},'Sensor','WATER_LEVEL_SENSOR','ONLINE',clock_timestamp())`;
      await sqlClient`insert into alert_rules(building_id,device_id,name,metric,operator,threshold,severity,alert_type,message_template,cooldown_seconds)
        values(${building},${device},${`Nível baixo ${building}`},'water_level_percent','LT',20,'HIGH','FIXTURE_LOW','Nível {value}',0)`;
    }
  });
  after(async () => {
    await sqlClient`delete from ingest_rejections where building_id in (${buildingA},${buildingB})`;
    await sqlClient`delete from buildings where id in (${buildingA},${buildingB})`;
    await sqlClient`delete from organizations where id=${org}`;
    await sqlClient.end();
  });

  it("claims an event per condominium and device, so a homonym elsewhere is another reading", async () => {
    const eventId = `evento-${suffix}`;
    await send(buildingA, deviceA, { eventId, value: 41 });
    await send(buildingB, deviceB, { eventId, value: 77 });
    assert.deepEqual(await readings(buildingA, eventId), [41]);
    assert.deepEqual(await readings(buildingB, eventId), [77], "before 048 the second condominium's reading was discarded");
    const ledger = await sqlClient`select building_id, fingerprint from ingest_events where event_id=${eventId} order by building_id`;
    assert.deepEqual(ledger.map(row => row.building_id), [buildingA, buildingB].sort());
    assert.ok(ledger.every(row => /^[0-9a-f]{64}$/.test(row.fingerprint)) && ledger[0]!.fingerprint !== ledger[1]!.fingerprint);
  });

  it("applies a redelivery once and refuses a different body under the same identity", async () => {
    const eventId = randomUUID(), time = new Date(), conflicts = await rejected("CONTENT_CONFLICT", buildingA);
    await send(buildingA, deviceA, { eventId, value: 10, time });
    await send(buildingA, deviceA, { eventId, value: 10, time });
    assert.deepEqual(await readings(buildingA, eventId), [10]);
    assert.equal(await rejected("CONTENT_CONFLICT", buildingA), conflicts, "an identical redelivery is not a conflict");
    const before = await alerts(buildingA);
    // Each variant is a valid envelope on its own; only the claimed identity is the same.
    for (const changed of [{ value: 99 }, { time: new Date(time.getTime() + 1000) }, { metric: "volume_liters", unit: "L" }]) {
      await send(buildingA, deviceA, { eventId, value: 10, time, ...changed });
    }
    assert.deepEqual(await readings(buildingA, eventId), [10], "the first body stands");
    assert.equal(await rejected("CONTENT_CONFLICT", buildingA), conflicts + 3);
    assert.equal(await alerts(buildingA), before);
    assert.equal((await sqlClient`select count(*)::int as total from ingest_rejections where building_id=${buildingA}`)[0]!.total, 1, "one counter per day and category, never one row per packet");
  });

  it("tells the text 10 from the number 10 and ignores transport-only differences", () => {
    const base = { schemaVersion: 1 as const, eventId: "evento-1234", buildingId: "b", deviceId: "d", metric: "m", value: 10 as number | string, quality: "GOOD" as const, timestamp: "2026-10-07T12:00:00.000Z" };
    assert.notEqual(readingFingerprint(base), readingFingerprint({ ...base, value: "10" }));
    assert.equal(readingFingerprint(base), readingFingerprint({ ...base, timestamp: "2026-10-07T09:00:00-03:00" }), "the same instant written with an offset is the same reading");
    assert.notEqual(readingFingerprint(base), readingFingerprint({ ...base, unit: "%" }));
  });

  it("keeps suppressing an identity recorded before the fingerprint existed", async () => {
    const eventId = randomUUID(), conflicts = await rejected("CONTENT_CONFLICT", buildingA);
    await sqlClient`insert into ingest_events(event_id,building_id,device_id) values(${eventId},${buildingA},${deviceA})`;
    await send(buildingA, deviceA, { eventId, value: 5 });
    assert.deepEqual(await readings(buildingA, eventId), [], "an old receipt cannot be compared, so the reading is not counted twice");
    assert.equal(await rejected("CONTENT_CONFLICT", buildingA), conflicts);
    assert.equal((await sqlClient`select fingerprint from ingest_events where event_id=${eventId}`)[0]!.fingerprint, null, "no fingerprint is invented for history");
  });

  it("stores a retained replay as history only: no contact, no alert, and only once", async () => {
    await rewind();
    const eventId = randomUUID(), before = await alerts(buildingA), replays = await rejected("RETAINED_REPLAY", buildingA);
    await send(buildingA, deviceA, { eventId, value: 5 }, { retain: true });
    await send(buildingA, deviceA, { eventId, value: 5 }, { retain: true });
    assert.deepEqual(await readings(buildingA, eventId), [5]);
    assert.equal(await alerts(buildingA), before, "a value below the threshold would have fired if it were live");
    assert.equal(await lastSeen(deviceA), seenAt.getTime(), "the broker replaying its stored message proves nothing about the source");
    assert.equal((await sqlClient`select status from gateways where id=${gatewayA}`)[0]!.status, "ONLINE", "the gateway row is left exactly as it was");
    assert.equal(await rejected("RETAINED_REPLAY", buildingA), replays + 1);
    // The live reading that follows behaves normally.
    await send(buildingA, deviceA, { value: 5 });
    assert.equal(await alerts(buildingA), before + 1);
    assert.ok(await lastSeen(deviceA) > seenAt.getTime());
  });

  it("keeps an old reading as history without raising an incident about the past", async () => {
    await rewind();
    const before = await alerts(buildingB), stale = randomUUID(), edge = randomUUID();
    await send(buildingB, deviceB, { eventId: stale, value: 3, time: new Date(Date.now() - RULE_FRESHNESS_MS - 5000) });
    assert.deepEqual(await readings(buildingB, stale), [3], "history is kept");
    assert.equal(await alerts(buildingB), before, "a gateway emptying its buffer does not page anyone");
    assert.ok(await lastSeen(deviceB) > seenAt.getTime(), "the packet itself is live contact");
    await send(buildingB, deviceB, { eventId: edge, value: 3, time: new Date(Date.now() - RULE_FRESHNESS_MS + 5000) });
    assert.equal(await alerts(buildingB), before + 1, "inside the window the rule fires as before");
  });

  it("counts what it refuses without keeping the payload", async () => {
    const [invalid, future, unknown] = [await rejected("INVALID_ENVELOPE"), await rejected("FUTURE_TIMESTAMP"), await rejected("UNKNOWN_SOURCE")];
    const marker = `segredo-${suffix}`;
    await handleTelemetry(telemetryTopic(buildingA, deviceA), Buffer.from(`{"quebrado": "${marker}"`));
    await handleTelemetry(telemetryTopic(buildingA, deviceA), body(buildingB, deviceB), {});
    await handleTelemetry(waterTelemetryTopic(buildingA, deviceA), Buffer.from(JSON.stringify({ device_id: "outro", timestamp: new Date().toISOString(), nivel_percentual: 10 })));
    assert.equal(await rejected("INVALID_ENVELOPE"), invalid + 3);
    await send(buildingA, deviceA, { time: new Date(Date.now() + 120_000) });
    assert.equal(await rejected("FUTURE_TIMESTAMP"), future + 1);
    await send(buildingA, `fantasma-${suffix}`, {});
    await sqlClient`update devices set enabled=false where id=${deviceB}`;
    await send(buildingB, deviceB, {});
    await sqlClient`update devices set enabled=true where id=${deviceB}`;
    assert.equal(await rejected("UNKNOWN_SOURCE"), unknown + 2);
    const stored = JSON.stringify(await sqlClient`select * from ingest_rejections`);
    assert.ok(!stored.includes(marker) && !stored.includes(`fantasma-${suffix}`) && !stored.includes(deviceA));
  });

  it("leaves the counters out of reach of the API runtime roles", async () => {
    const acl = await sqlClient`select grantee from information_schema.role_table_grants where table_name='ingest_rejections' and grantee like 'predioon\\_%'`;
    assert.deepEqual(acl.map(row => row.grantee), []);
    const [key] = await sqlClient`select array_agg(a.attname::text order by k.ordinality) as columns from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ordinality) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
      where c.conrelid='public.ingest_events'::regclass and c.contype='p'`;
    assert.deepEqual(key!.columns, ["building_id", "device_id", "event_id"]);
  });
});
