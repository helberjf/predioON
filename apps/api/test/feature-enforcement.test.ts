import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { call, json, login, startTestServer, unique, type Session, type TestServer } from "./helpers.js";
import { startRealtimeBus } from "../src/modules/events/bus.js";

describe("business feature enforcement", () => {
  const buildingId = unique("feature-enforcement"), organizationId = unique("feature-org");
  const deviceId = unique("feature-water"), energyId = unique("feature-energy");
  let server: TestServer, admin: Session, resident: Session;
  const request = (path: string, method = "GET", body?: unknown, token = admin.accessToken) => call(server.url, path, { method, body, token });
  async function setFeature(key: string, enabled: boolean) {
    await sqlClient`insert into building_feature_settings (building_id, feature_key, enabled) values (${buildingId}, ${key}, ${enabled}) on conflict (building_id, feature_key) do update set enabled = excluded.enabled, version = building_feature_settings.version + 1`;
  }
  async function disabled(response: Response, feature: string) {
    assert.equal(response.status, 403, await response.clone().text());
    assert.equal((await response.json()).details.feature, feature);
  }
  before(async () => {
    await sqlClient`insert into organizations (id,name,slug) values (${organizationId}, 'Feature enforcement', ${organizationId})`;
    await sqlClient`insert into buildings (id,organization_id,name,code) values (${buildingId},${organizationId},'Feature enforcement',${buildingId})`;
    await sqlClient`insert into memberships (user_id,building_id,role) values ('building_admin',${buildingId},'BUILDING_ADMIN'),('resident_demo',${buildingId},'RESIDENT')`;
    await sqlClient`insert into devices (id,building_id,name,type) values (${deviceId},${buildingId},'Water test','WATER_LEVEL_SENSOR'),(${energyId},${buildingId},'Energy test','ENERGY_METER')`;
    server = await startTestServer();
    admin = await login(server.url, "sindico@predioon.local"); resident = await login(server.url, "morador@predioon.local");
  });
  after(async () => {
    await server?.close();
    await sqlClient`delete from buildings where id=${buildingId}`;
    await sqlClient`delete from organizations where id=${organizationId}`;
    await closeAppDb(); await sqlClient.end();
  });
  it("separates transparency from ordinary notices and restores retained history", async () => {
    const create = async (category: string) => {
      const response = await request("/notices", "POST", { buildingId, category, title: "Feature announcement", body: "Preserve this historical announcement" });
      assert.equal(response.status, 201); return response.json();
    };
    const normal = await create("COMMUNICATION"), transparency = await create("GESTAO");
    await setFeature("NOTICES", false);
    const result = await json<{ items: Array<{ id: string }> }>(await request(`/notices?buildingId=${buildingId}`));
    assert.deepEqual(result.items.map(row => row.id), [transparency.id]);
    await disabled(await request(`/notices/${normal.id}`, "PATCH", { category: "GESTAO" }), "NOTICES");
    await disabled(await request("/notices", "POST", { buildingId, title: "Blocked notice", body: "Should not be published" }), "NOTICES");
    assert.equal((await request(`/finance?buildingId=${buildingId}`)).status, 200);
    await setFeature("NOTICES", true);
    assert.ok((await (await request(`/notices?buildingId=${buildingId}`)).json()).items.some((row: { id: string }) => row.id === normal.id));
  });
  it("blocks reservations and common areas without destroying configuration", async () => {
    const created = await request("/common-areas", "POST", { buildingId, name: "Shared meeting room" });
    assert.equal(created.status, 201); const area = await created.json();
    await setFeature("RESERVATIONS", false);
    await disabled(await request(`/common-areas?buildingId=${buildingId}`), "RESERVATIONS");
    await disabled(await request(`/reservations?buildingId=${buildingId}`), "RESERVATIONS");
    await disabled(await request(`/common-areas/${area.id}`, "PATCH", { name: "New room" }), "RESERVATIONS");
    await disabled(await request("/reservations", "POST", { areaId: area.id, startsAt: new Date(Date.now()+86400000).toISOString(), endsAt: new Date(Date.now()+90000000).toISOString() }, resident.accessToken), "RESERVATIONS");
    await setFeature("RESERVATIONS", true);
  });
  it("keeps ordinary ticket actions available with grouping and priority disabled", async () => {
    await setFeature("TICKET_PRIORITY", false); await setFeature("TICKET_GROUPING", false);
    const response = await request("/occurrences", "POST", { buildingId, category: "GERAL", title: "Test feature ticket", description: "Request remains available", priority: "HIGH" }, resident.accessToken);
    assert.equal(response.status, 201); const ticket = await response.json(); assert.equal(ticket.priority, "NORMAL");
    await disabled(await request(`/occurrences/${ticket.id}`, "PATCH", { priority: "HIGH", priorityReason: "Escalation requested" }), "TICKET_PRIORITY");
    await disabled(await request(`/occurrences/duplicates?buildingId=${buildingId}`), "TICKET_GROUPING");
    await disabled(await request(`/occurrences/${ticket.id}/comments`, "POST", { message: "Group response", applyToGroup: true }), "TICKET_GROUPING");
    assert.equal((await request(`/occurrences/${ticket.id}/comments`, "POST", { message: "Individual response" })).status, 201);
    assert.equal((await request(`/occurrences/${ticket.id}`, "PATCH", { status: "IN_PROGRESS" })).status, 200);
    await setFeature("TICKETS", false);
    await disabled(await request(`/occurrences/${ticket.id}`), "TICKETS");
    await disabled(await request(`/occurrences?buildingId=${buildingId}`), "TICKETS");
    const overview = await (await request(`/overview/building?buildingId=${buildingId}`)).json(); assert.equal(Number(overview.counts.open_occurrences), 0);
    await setFeature("TICKETS", true); await setFeature("TICKET_PRIORITY", true); await setFeature("TICKET_GROUPING", true);
  });
  it("hides disabled telemetry, alerts, rules and overview counts while retaining series", async () => {
    const alertId = randomUUID(), ruleId = randomUUID();
    await sqlClient`insert into telemetry (time,event_id,building_id,device_id,metric,value,numeric_value,quality) values (now(),${randomUUID()},${buildingId},${deviceId},'water_level_percent','42',42,'GOOD'),(now(),${randomUUID()},${buildingId},${energyId},'energy_total_kwh','99',99,'GOOD')`;
    await sqlClient`insert into alert_rules (id,building_id,device_id,name,metric,operator,threshold,alert_type,message_template) values (${ruleId},${buildingId},${deviceId},'Water feature rule','water_level_percent','LT',50,'WATER_LOW','Water low')`;
    await sqlClient`insert into alerts (id,building_id,device_id,rule_id,severity,type,message) values (${alertId},${buildingId},${deviceId},${ruleId},'HIGH','WATER_LOW','Water low')`;
    await setFeature("WATER_TANK", false);
    const latest = await (await request(`/telemetry/latest?buildingId=${buildingId}`)).json();
    assert.ok(latest.items.every((row: { device_id: string }) => row.device_id !== deviceId));
    assert.ok(latest.items.some((row: { device_id: string }) => row.device_id === energyId));
    await disabled(await request(`/telemetry/series?deviceId=${deviceId}&metric=water_level_percent`), "WATER_TANK");
    assert.ok(!(await (await request(`/alerts?buildingId=${buildingId}`)).json()).items.some((row: { id: string }) => row.id === alertId));
    assert.ok(!(await (await request(`/alert-rules?buildingId=${buildingId}`)).json()).items.some((row: { id: string }) => row.id === ruleId));
    await disabled(await request(`/alerts/${alertId}/acknowledge`, "POST"), "WATER_TANK");
    const overview = await (await request(`/overview/building?buildingId=${buildingId}`)).json();
    assert.equal(Number(overview.counts.open_alerts), 0); assert.equal(overview.latestAlerts.length, 0);
    await setFeature("WATER_TANK", true);
    const series = await (await request(`/telemetry/series?deviceId=${deviceId}&metric=water_level_percent`)).json(); assert.ok(series.items.length);
  });
  it("filters cars independently from motorcycles", async () => {
    const create = async (vehicleType: string) => (await request("/parking", "POST", { buildingId, vehicleType, capacity: 8 })).json();
    const car = await create("CAR"), motorcycle = await create("MOTORCYCLE");
    await setFeature("CAR_PARKING", false);
    const result = await (await request(`/parking?buildingId=${buildingId}`)).json(); assert.deepEqual(result.items.map((row: { id: string }) => row.id), [motorcycle.id]);
    await disabled(await request(`/parking/${car.id}/occupancy`, "PATCH", { occupied: 1, version: car.version }), "CAR_PARKING");
    assert.equal((await request(`/parking/${motorcycle.id}/occupancy`, "PATCH", { occupied: 1, version: motorcycle.version })).status, 200);
    await setFeature("CAR_PARKING", true);
  });
  it("consults current membership before returning feature status", async () => {
    await setFeature("FINANCE", false);
    await sqlClient`update memberships set active=false where user_id='resident_demo' and building_id=${buildingId}`;
    const response = await request(`/finance?buildingId=${buildingId}`, "GET", undefined, resident.accessToken);
    assert.equal(response.status, 403); assert.ok(!(await response.text()).includes("FEATURE_DISABLED"));
    await sqlClient`update memberships set active=true where user_id='resident_demo' and building_id=${buildingId}`;
    await setFeature("FINANCE", true);
  });
  it("already open SSE filters paused telemetry and receives global configuration invalidation", async () => {
    await startRealtimeBus();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${server.url}/events/stream`, { headers: { Authorization: `Bearer ${resident.accessToken}` }, signal: controller.signal });
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    await reader.read(); // Initial retry frame confirms that subscription exists.
    await setFeature("WATER_TANK", false);
    const reading = { kind: "telemetry", buildingId, deviceId, metric: "water_level_percent", value: 44, time: new Date().toISOString() };
    const marker = { kind: "features-changed", buildingId: "*" };
    try {
      await sqlClient`select pg_notify('predioon_events', ${JSON.stringify(reading)})`;
      await sqlClient`select pg_notify('predioon_events', ${JSON.stringify(marker)})`;
      let text = "";
      while (!text.includes("event: features-changed")) {
        const next = await reader.read(); if (next.done) break; text += decoder.decode(next.value, { stream: true });
      }
      assert.ok(text.includes("event: features-changed"));
      assert.ok(!text.includes("water_level_percent"));
    } finally { clearTimeout(timeout); controller.abort(); await reader.cancel().catch(() => undefined); await setFeature("WATER_TANK", true); }
  });
});
