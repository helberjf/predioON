import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type postgres from "postgres";
import { codeIs, safeDatabaseOperation, type RuntimeServicesFixture } from "./runtime-services.js";

// Administrative data lives only inside the approved fixture's own UUID database.
// These are domain roles/users, never PostgreSQL roles or runtime entrypoints.
export type ServiceQuery = postgres.TransactionSql;

/** Every operational statement, including lock holders, has a local deadline. */
export function boundedTransaction<T>(client: postgres.Sql, operation: (tx: postgres.TransactionSql) => T | Promise<T>) {
  return client.begin(async tx => {
    await tx`set local statement_timeout='4s'`;
    return operation(tx);
  });
}

/** One forbidden statement per bounded transaction; aborted transactions never count. */
export async function assertBoundedPermissionDenied(client: postgres.Sql, statement: string, forgedHumanContext = false): Promise<void> {
  await assert.rejects(safeDatabaseOperation("bounded operational permission denial", () => boundedTransaction(client, async tx => {
    if (forgedHumanContext) await tx`select set_config('app.user_id','fixture-platform-admin',true),
      set_config('app.role','PLATFORM_ADMIN',true)`;
    await tx.unsafe(statement);
  })), codeIs("42501"));
}
export type RuntimeServiceData = {
  organization: string; building: string; otherBuilding: string; gateway: string; otherGateway: string;
  meter: string; peer: string; parkingSensor: string; disabledDevice: string; foreignDevice: string;
  actor: string; admin: string; role: string; profile: string; secondProfile: string; disabledProfile: string;
  foreignProfile: string; lot: string; globalRule: string; deviceRule: string; foreignRule: string;
  cooldownAlert: string; ownerCommand: AccessRequest;
};
export type AccessRequest = {
  id: string; building_id: string; gateway_id: string; gate_id: string; device_id: string;
  requested_by: string; status: string; created_at: string; expires_at: string;
};

const physicalFeatures = ["GARAGE_ACCESS", "PEDESTRIAN_ACCESS", "CAR_PARKING", "MOTORCYCLE_PARKING"] as const;

export async function seedRuntimeServiceData(fixture: RuntimeServicesFixture): Promise<RuntimeServiceData> {
  const suffix = randomUUID();
  const ids = {
    organization: `runtime-org-${suffix}`, building: `runtime-building-${suffix}`,
    otherBuilding: `runtime-other-building-${suffix}`, gateway: `runtime-gateway-${suffix}`,
    otherGateway: `runtime-other-gateway-${suffix}`, meter: `runtime-meter-${suffix}`,
    peer: `runtime-peer-${suffix}`, parkingSensor: `runtime-parking-${suffix}`,
    disabledDevice: `runtime-disabled-${suffix}`, foreignDevice: `runtime-foreign-${suffix}`,
    actor: `runtime-actor-${suffix}`, admin: `runtime-admin-${suffix}`, role: `RUNTIME_${suffix}`,
    profile: randomUUID(), secondProfile: randomUUID(), disabledProfile: randomUUID(),
    foreignProfile: randomUUID(), lot: randomUUID(), globalRule: randomUUID(), deviceRule: randomUUID(),
    foreignRule: randomUUID(), cooldownAlert: randomUUID(),
  };
  await safeDatabaseOperation("seed isolated operational domain data", () => boundedTransaction(fixture.owner, async tx => {
    await tx`insert into public.organizations(id,name,slug) values(${ids.organization},'Runtime fixture',${ids.organization})`;
    for (const building of [ids.building, ids.otherBuilding]) {
      await tx`insert into public.buildings(id,organization_id,name,code,timezone)
        values(${building},${ids.organization},'Runtime fixture',${building},'America/Sao_Paulo')`;
    }
    await tx`insert into public.users(id,name,email,is_platform_admin) values
      (${ids.admin},'Fixture administrator',${ids.admin + "@example.invalid"},true),
      (${ids.actor},'Scoped physical actor',${ids.actor + "@example.invalid"},false)`;
    await tx`insert into public.roles(key,scope,label) values(${ids.role},'BUILDING','Runtime scoped physical role')`;
    for (const permission of ["gates:read", "commands:request", "commands:read-own"]) {
      await tx`insert into public.role_permissions(role_key,permission_key) values(${ids.role},${permission})`;
    }
    for (const [gateway, building] of [[ids.gateway, ids.building], [ids.otherGateway, ids.otherBuilding]]) {
      await tx`insert into public.gateways(id,building_id,name,serial_number,status,last_seen_at)
        values(${gateway!},${building!},'Fixture gateway',${gateway!},'ONLINE',clock_timestamp())`;
    }
    for (const [device, building, gateway, type, enabled] of [
      [ids.meter, ids.building, ids.gateway, "ENERGY_METER", true],
      [ids.peer, ids.building, ids.gateway, "ENERGY_METER", true],
      [ids.parkingSensor, ids.building, ids.gateway, "PARKING_SENSOR", true],
      [ids.disabledDevice, ids.building, ids.gateway, "ENERGY_METER", false],
      [ids.foreignDevice, ids.otherBuilding, ids.otherGateway, "ENERGY_METER", true],
    ] as const) {
      await tx`insert into public.devices(id,building_id,gateway_id,name,type,status,enabled,last_seen_at)
        values(${device},${building},${gateway},'Fixture device',${type},'ONLINE',${enabled},clock_timestamp())`;
    }
    // Same administrative mechanism as feature routes: persisted administrator,
    // exclusive barrier, settings writes, then the existing audited transition.
    await tx`select set_config('app.user_id',${ids.admin},true), pg_advisory_xact_lock(814772,1)`;
    const [administrator] = await tx`select public.app_has_global_capability('features:manage') as allowed`;
    assert.equal(administrator?.allowed, true, "fixture administrator has current feature-management authority");
    for (const feature of physicalFeatures) {
      await tx`insert into public.global_feature_settings(feature_key,enabled) values(${feature},true)
        on conflict(feature_key) do update set enabled=true,version=global_feature_settings.version+1,updated_at=clock_timestamp()`;
      for (const building of [ids.building, ids.otherBuilding]) {
        await tx`insert into public.building_feature_settings(building_id,feature_key,enabled) values(${building},${feature},true)
          on conflict(building_id,feature_key) do update set enabled=true,version=building_feature_settings.version+1,updated_at=clock_timestamp()`;
        await tx`select public.app_apply_feature_transition(${building},${feature},true)`;
      }
    }
    // No ambient actor is needed for administrative inventory/proof setup.
    await tx`select set_config('app.user_id','',true)`;
    for (const [profile, building, device, kind, enabled] of [
      [ids.profile, ids.building, ids.meter, "ENERGY", true],
      [ids.secondProfile, ids.building, ids.meter, "WATER", true],
      [ids.disabledProfile, ids.building, ids.meter, "PUMP", false],
      [ids.foreignProfile, ids.otherBuilding, ids.foreignDevice, "ENERGY", true],
    ] as const) {
      await tx`insert into public.monitoring_profiles(id,building_id,device_id,kind,enabled)
        values(${profile},${building},${device},${kind},${enabled})`;
    }
    await tx`insert into public.parking_lots(id,building_id,vehicle_type,capacity,sensor_id)
      values(${ids.lot},${ids.building},'CAR',10,${ids.parkingSensor})`;
    for (const [rule, building, device] of [
      [ids.globalRule, ids.building, null], [ids.deviceRule, ids.building, ids.meter],
      [ids.foreignRule, ids.otherBuilding, ids.foreignDevice],
    ] as const) {
      await tx`insert into public.alert_rules(id,building_id,device_id,name,metric,operator,threshold,severity,alert_type,message_template)
        values(${rule},${building},${device},${rule},'energy_total_kwh','GT',1,'HIGH','RULE','Fixture threshold')`;
    }
    await tx`insert into public.usage_cursors(profile_id,building_id,last_at,last_value,good)
      values(${ids.profile},${ids.building},clock_timestamp(),1,true)`;
    await tx`insert into public.daily_usage(profile_id,building_id,day,first_at,last_at,samples)
      values(${ids.profile},${ids.building},'2026-01-01',clock_timestamp(),clock_timestamp(),1)`;
    await tx`insert into public.alerts(id,building_id,device_id,rule_id,severity,type,message)
      values(${ids.cooldownAlert},${ids.building},${ids.peer},${ids.globalRule},'HIGH','RULE','Fixture cooldown envelope')`;
    const [event] = await tx`select public.notification_enqueue_alert(${ids.cooldownAlert}::uuid) as id`;
    assert.ok(event?.id, "existing private producer can seed an outbox event on canonical SQL051");
    await insertReading(tx, { ...ids }, { event: `owner-proof-${suffix}` });
  }));
  const ownerCommand = await requestHumanAccess(fixture.owner, ids);
  return { ...ids, ownerCommand };
}

/** A real human admission, used by owner controls and later service transitions. */
export async function requestHumanAccess(owner: postgres.Sql,
  data: Pick<RuntimeServiceData, "building" | "gateway" | "actor" | "role">): Promise<AccessRequest> {
  return safeDatabaseOperation("admit current scoped human physical request", () => boundedTransaction(owner, async tx => {
    const device = `runtime-controller-${randomUUID()}`, gate = randomUUID();
    await tx`update public.gateways set status='ONLINE',enabled=true,last_seen_at=clock_timestamp() where id=${data.gateway}`;
    await tx`insert into public.devices(id,building_id,gateway_id,name,type,status,last_seen_at)
      values(${device},${data.building},${data.gateway},'Scoped controller','GATE_CONTROLLER','ONLINE',clock_timestamp())`;
    await tx`insert into public.gates(id,building_id,name,kind,gateway_id,device_id,enabled,allow_residents)
      values(${gate},${data.building},'Scoped fixture gate','GARAGE',${data.gateway},${device},true,true)`;
    await tx`insert into public.role_bindings(user_id,building_id,role_key,resource_type,resource_id)
      values(${data.actor},${data.building},${data.role},'gate',${gate})`;
    await tx`select set_config('app.user_id',${data.actor},true)`;
    const [accepted] = await tx<{ command: AccessRequest; repeated: boolean }[]>`
      select * from public.app_request_access(${gate}::uuid,${randomUUID()}::uuid)`;
    assert.ok(accepted?.command && !accepted.repeated, "fresh scoped human request is admitted exactly once");
    assert.equal(accepted.command.status, "PENDING");
    assert.equal(accepted.command.requested_by, data.actor);
    const lifetime = Date.parse(accepted.command.expires_at) - Date.parse(accepted.command.created_at);
    assert.ok(lifetime > 0 && lifetime <= 15_000, "human request retains its original bounded database TTL");
    return accepted.command;
  }));
}

export async function verifyRuntimeServiceData(fixture: RuntimeServicesFixture, data: RuntimeServiceData): Promise<void> {
  await safeDatabaseOperation("owner operational seed positive control", async () => {
    const [row] = await boundedTransaction(fixture.owner, tx => tx`
      select (select count(*)::int from public.buildings where organization_id=${data.organization}) as buildings,
        (select count(*)::int from public.devices where building_id in (${data.building},${data.otherBuilding})) as devices,
        (select count(*)::int from public.monitoring_profiles where id in (${data.profile}::uuid,${data.secondProfile}::uuid,${data.disabledProfile}::uuid,${data.foreignProfile}::uuid)) as profiles,
        (select count(*)::int from public.alert_rules where id in (${data.globalRule}::uuid,${data.deviceRule}::uuid,${data.foreignRule}::uuid)) as rules,
        (select count(*)::int from public.parking_lots where id=${data.lot}::uuid) as lots,
        (select count(*)::int from public.outbox_events where alert_id=${data.cooldownAlert}::uuid) as outbox,
        (select count(*)::int from public.event_deliveries d join public.outbox_events e on e.id=d.event_id where e.alert_id=${data.cooldownAlert}::uuid) as deliveries,
        (select count(*)::int from public.ingest_events where building_id=${data.building}) as receipts,
        (select count(*)::int from public.telemetry where building_id=${data.building}) as raw,
        (select count(*)::int from public.usage_cursors where profile_id=${data.profile}::uuid) as cursors,
        (select count(*)::int from public.daily_usage where profile_id=${data.profile}::uuid) as daily,
        (select count(*)::int from public.global_feature_settings where feature_key in ('GARAGE_ACCESS','PEDESTRIAN_ACCESS','CAR_PARKING','MOTORCYCLE_PARKING') and enabled) as global_physical,
        (select count(*)::int from public.building_feature_settings where building_id=${data.building} and enabled and feature_key in ('GARAGE_ACCESS','PEDESTRIAN_ACCESS','CAR_PARKING','MOTORCYCLE_PARKING')) as building_physical`);
    assert.deepEqual(row, { buildings: 2, devices: 6, profiles: 4, rules: 3, lots: 1, outbox: 1,
      deliveries: 1, receipts: 1, raw: 1, cursors: 1, daily: 1, global_physical: 4, building_physical: 4 });
    const command = await commandState(fixture.owner, data.ownerCommand.id);
    assert.equal(command?.status, "PENDING");
    assert.equal(command?.requested_by, data.actor);
    const audits = await commandAudits(fixture.owner, data.ownerCommand.id);
    assert.ok(audits.some(row => row.action === "ACCESS_OPEN_REQUESTED" && row.user_id === data.actor && row.actor_type === "USER"));
  });
}

/** Inserts real receipt/raw evidence. A helper cannot accept a caller's claim alone. */
export async function insertReading(client: ServiceQuery,
  data: Pick<RuntimeServiceData, "building" | "meter" | "parkingSensor">,
  options: { event?: string; building?: string; device?: string; metric?: string; occupied?: number; quality?: string; source?: string; time?: Date } = {}) {
  const event = options.event ?? `runtime-event-${randomUUID()}`;
  const time = options.time ?? new Date();
  const building = options.building ?? data.building;
  const device = options.device ?? data.parkingSensor;
  const occupied = options.occupied ?? 3;
  await client`insert into public.ingest_events(event_id,building_id,device_id,source,fingerprint)
    values(${event},${building},${device},${options.source ?? "MQTT"},${"a".repeat(64)})`;
  await client`insert into public.telemetry(event_id,building_id,device_id,metric,value,numeric_value,quality,time)
    values(${event},${building},${device},${options.metric ?? "parking_occupied"},${client.json(occupied)},${occupied},
      ${options.quality ?? "GOOD"}::public.telemetry_quality,${time})`;
  return { event, time, building, device, occupied };
}

export async function commandState(owner: postgres.Sql, id: string) {
  const [row] = await safeDatabaseOperation("inspect private physical command", () => boundedTransaction(owner, tx => tx`
    select id,building_id,gateway_id,gate_id,device_id,requested_by,status,created_at,expires_at,sent_at,acknowledged_at,failure_reason
    from public.gate_commands where id=${id}::uuid`));
  return row;
}

export async function commandAudits(owner: postgres.Sql, id: string) {
  return safeDatabaseOperation("inspect derived physical command audits", () => boundedTransaction(owner, tx => tx`
    select building_id,user_id,actor_type,action,resource_type,resource_id,metadata from public.audit_logs
    where metadata->>'commandId'=${id} order by created_at,id`));
}

export async function retirePendingCommands(owner: postgres.Sql): Promise<void> {
  await safeDatabaseOperation("isolate subsequent physical cases", () => boundedTransaction(owner, tx => tx`
    update public.gate_commands set status='EXPIRED' where status in ('PENDING','SENT')`));
}

const triggerTables = new Set(["alerts", "outbox_events", "event_deliveries", "delivery_witnesses",
  "delivery_witness_features", "parking_lots", "audit_logs", "gate_commands"]);

/** Fixed test-source bodies only; no external inputs become DDL. */
export async function withRuntimeOwnerTrigger(owner: postgres.Sql, table: string,
  timing: "before" | "after", operation: "insert" | "update", body: string, run: () => Promise<void>): Promise<void> {
  assert.ok(triggerTables.has(table));
  const name = `runtime_probe_${randomUUID().replaceAll("-", "")}`;
  await safeDatabaseOperation("install isolated controlled writer", () => boundedTransaction(owner, tx => tx.unsafe(`create function public.${name}() returns trigger
    language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $runtime_probe$ begin ${body} end $runtime_probe$`)));
  let installed = false;
  try {
    await safeDatabaseOperation("attach isolated controlled writer", () => boundedTransaction(owner, tx => tx.unsafe(`create trigger ${name} ${timing} ${operation}
      on public.${table} for each row execute function public.${name}()`)));
    installed = true;
    await run();
  } finally {
    try {
      if (installed) await safeDatabaseOperation("remove isolated controlled writer", () => boundedTransaction(owner, tx => tx.unsafe(`drop trigger ${name} on public.${table}`)));
    } finally {
      await safeDatabaseOperation("remove isolated controlled writer function", () => boundedTransaction(owner, tx => tx.unsafe(`drop function public.${name}()`)));
    }
  }
}

/** Bounded database barrier; checks a specific blocker, with no timing-only success. */
export async function waitForDatabaseBlock(observer: postgres.Sql, waiter: number, blocker: number): Promise<void> {
  for (let attempt = 0; attempt < 75; attempt++) {
    const [row] = await safeDatabaseOperation("observe controlled PostgreSQL lock barrier", () => boundedTransaction(observer, tx => tx`
      select ${blocker}::int=any(pg_catalog.pg_blocking_pids(${waiter}::int)) as blocked`));
    if (row?.blocked) return;
    await delay(20);
  }
  assert.fail("restricted operation did not reach the specific held PostgreSQL lock");
}

export async function waitForDatabaseDeadline(observer: postgres.Sql, deadline: Date): Promise<void> {
  for (let attempt = 0; attempt < 75; attempt++) {
    const [row] = await safeDatabaseOperation("observe controlled database deadline", () => boundedTransaction(observer, tx => tx`
      select clock_timestamp()>${deadline}::timestamptz as expired`));
    if (row?.expired) return;
    await delay(20);
  }
  assert.fail("controlled database deadline was not reached within the bounded wait");
}
