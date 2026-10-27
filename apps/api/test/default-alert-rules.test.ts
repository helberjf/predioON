import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { sqlClient } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { call, login, startTestServer } from "./helpers.js";

after(async () => { await closeAppDb(); await sqlClient.end(); });

test("default rules provision existing/new buildings disabled without changing saved settings", async () => {
  const migration = await readFile(new URL("../../../infrastructure/066-default-alert-rules.sql", import.meta.url), "utf8");
  await sqlClient.begin(async tx => {
    const org = `rules-${randomUUID()}`;
    const existing = `${org}-existing`, fresh = `${org}-new`;
    await tx`insert into organizations (id,name,slug) values (${org},'Rules test',${org})`;
    await tx`insert into buildings (id,organization_id,name,code) values (${existing},${org},'Existing',${existing})`;
    // A configured equipment-specific rule must survive a migration unchanged.
    await tx`delete from alert_rules where building_id=${existing}`;
    const device = `${org}-sensor`;
    await tx`insert into devices (id,building_id,name,type) values (${device},${existing},'Tank','WATER_LEVEL_SENSOR')`;
    const [custom] = await tx`insert into alert_rules (building_id,device_id,name,metric,operator,threshold,severity,alert_type,message_template,enabled,cooldown_seconds)
      values (${existing},${device},'Meu nível baixo','water_level_percent','LT',20,'HIGH','MY_WATER','Valor: {value}',true,1234) returning *`;

    await tx.unsafe(migration);
    await tx`select seed_default_alert_rules(${existing})`;
    let rules = await tx`select * from alert_rules where building_id=${existing}`;
    assert.equal(rules.length, 16);
    assert.deepEqual(rules.find(row => row.id === custom!.id), { ...custom, template_key: null });
    assert.ok(rules.filter(row => row.id !== custom!.id).every(row => row.enabled === false && row.device_id === null && row.created_by === null));
    const originalRules = await tx`select * from alert_rules where building_id=${existing} order by id`;

    await tx`insert into buildings (id,organization_id,name,code) values (${fresh},${org},'New',${fresh})`;
    const defaults = await tx`select * from alert_rules where building_id=${fresh}`;
    assert.equal(defaults.length, 16, "new buildings receive defaults through the trigger");
    assert.ok(defaults.every(row => row.enabled === false && row.device_id === null));
    assert.equal(new Set(defaults.map(row => row.template_key)).size, 16);
    for (const phase of ["l1", "l2", "l3"]) {
      assert.deepEqual(defaults.filter(row => row.metric === `voltage_${phase}`).map(row => row.threshold).sort((a, b) => a - b), [100, 180, 260]);
    }

    const changed = defaults.find(row => row.metric === "temperature_c")!;
    await tx`update alert_rules set name='Temperatura personalizada', enabled=true, threshold=52, cooldown_seconds=456 where id=${changed.id}`;
    await tx`select seed_default_alert_rules(${fresh})`;
    await tx.unsafe(migration);
    rules = await tx`select * from alert_rules where building_id=${fresh}`;
    assert.equal(rules.length, 16, "repeating provisioning and migration never duplicates defaults");
    const retained = rules.find(row => row.id === changed.id)!;
    assert.equal(retained.enabled, true);
    assert.equal(retained.threshold, 52);
    assert.equal(retained.cooldown_seconds, 456);
    assert.equal(retained.name, 'Temperatura personalizada');
    assert.deepEqual(await tx`select * from alert_rules where building_id=${existing} order by id`, originalRules);

    // The API creates buildings with a non-owner role: the trigger must work under RLS.
    const managed = `${org}-managed`;
    const platformUser = `${org}-platform`;
    await tx`insert into users(id,name,email) values(${platformUser},'Rules platform',${platformUser + '@rules.test'})`;
    await tx`insert into role_bindings(user_id,role_key) values(${platformUser},'PLATFORM_ADMIN')`;
    await tx`select set_config('app.user_id', ${platformUser}, true), set_config('app.role', 'PLATFORM_ADMIN', true)`;
    await tx`set local role predioon_app`;
    await tx`insert into buildings (id,organization_id,name,code) values (${managed},${org},'Managed',${managed})`;
    await tx`reset role`;
    const scopedDefaults = await tx`select * from alert_rules where building_id=${managed}`;
    assert.equal(scopedDefaults.length, 16);
    assert.ok(scopedDefaults.every(row => row.enabled === false));
    await assert.rejects(tx.savepoint(async scoped => {
      await scoped`select set_config('app.user_id', 'building_admin', true), set_config('app.role', 'BUILDING_ADMIN', true)`;
      await scoped`set local role predioon_app`;
      await scoped`select seed_default_alert_rules(${fresh})`;
    }), /permission denied for function/, "the API cannot invoke privileged provisioning directly");
    // Roll back all fixtures and DDL after checking the real database behavior.
    throw new Error("ROLLBACK_DEFAULT_RULES_TEST");
  }).catch(error => { if (error.message !== "ROLLBACK_DEFAULT_RULES_TEST") throw error; });
});

test("API provisions saved defaults, persists activation and enforces building access", async () => {
  const org = `rules-api-${randomUUID()}`;
  const buildingId = `${org}-building`, otherId = `${org}-other`;
  const server = await startTestServer();
  try {
    await sqlClient`insert into organizations (id,name,slug) values (${org},'Rules API',${org})`;
    await sqlClient`insert into buildings (id,organization_id,name,code) values
      (${buildingId},${org},'Managed rules',${buildingId}),(${otherId},${org},'Other rules',${otherId})`;
    await sqlClient`insert into memberships (building_id,user_id,role) values
      (${buildingId},'building_admin','BUILDING_ADMIN'),(${buildingId},'resident_demo','RESIDENT')`;
    const password = process.env.SEED_PASSWORD ?? "predioon123";
    const admin = await login(server.url, "sindico@predioon.local", password);
    const resident = await login(server.url, "morador@predioon.local", password);
    const list = async () => {
      const response = await call(server.url, `/alert-rules?buildingId=${buildingId}`, { token: admin.accessToken });
      assert.equal(response.status, 200);
      return (await response.json()).items as Array<{ id: string; enabled: boolean; metric: string }>;
    };
    const rules = await list();
    assert.equal(rules.length, 16);
    assert.ok(rules.every(rule => !rule.enabled));
    const selected = rules.find(rule => rule.metric === "water_level_percent")!;
    for (const enabled of [true, false]) {
      const response = await call(server.url, `/alert-rules/${selected.id}`, { token: admin.accessToken, method: "PATCH", body: { enabled } });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await list()).find(rule => rule.id === selected.id)?.enabled, enabled);
    }
    assert.equal((await call(server.url, `/alert-rules?buildingId=${buildingId}`, { token: resident.accessToken })).status, 403);
    const [foreign] = await sqlClient`select id from alert_rules where building_id=${otherId} limit 1`;
    const denied = await call(server.url, `/alert-rules/${foreign!.id}`, { token: admin.accessToken, method: "PATCH", body: { enabled: true } });
    assert.ok([403, 404].includes(denied.status));
    const [untouched] = await sqlClient`select enabled from alert_rules where id=${foreign!.id}`;
    assert.equal(untouched!.enabled, false);
  } finally {
    await server.close();
    await sqlClient`delete from audit_logs where scope_building_id in (${buildingId},${otherId})`;
    await sqlClient`delete from buildings where organization_id=${org}`;
    await sqlClient`delete from organizations where id=${org}`;
  }
});
