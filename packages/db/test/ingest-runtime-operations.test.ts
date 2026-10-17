import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it, type TestContext } from "node:test";
import { verifyRestrictedDatabaseRole } from "../src/runtime-connection.js";
import {
  assertServiceCatalogue, codeIs, createRuntimeServicesFixture,
  parseRuntimeServicesEnvironment, runtimeServicesSkipReason, safeDatabaseOperation,
  type RuntimeServicesFixture,
} from "./fixtures/runtime-services.js";
import {
  assertBoundedPermissionDenied as assertPermissionDenied, boundedTransaction,
  insertReading, seedRuntimeServiceData, verifyRuntimeServiceData, withRuntimeOwnerTrigger,
  type RuntimeServiceData, type ServiceQuery,
} from "./fixtures/runtime-service-data.js";

const configuration = parseRuntimeServicesEnvironment(process.env);

// Direct SQL contracts for 052; these deliberately do not import eager runtime pools.
describe("observational ingest operations on real restricted PostgreSQL", {
  concurrency: false, skip: configuration ? false : runtimeServicesSkipReason,
}, () => {
  let fixture: RuntimeServicesFixture | undefined;
  let data: RuntimeServiceData;
  let authenticated = false;
  before(async () => { fixture = await createRuntimeServicesFixture(configuration!); });
  after(async () => { await fixture?.cleanup(); });
  const ready = (context: TestContext) => {
    if (authenticated) return true;
    context.skip("operations require the preceding 052 catalogue and real-login positive control");
    return false;
  };

  async function produce(client: ServiceQuery, options: {
    id?: string; building?: string; device?: string | null; gateway?: string | null; rule?: string | null;
  } = {}) {
    const id = options.id ?? randomUUID();
    const [row] = await client<{ event_id: string; signature: string }[]>`
      select * from public.ingest_persist_alert(${id}::uuid,${options.building ?? data.building},
        ${options.device === undefined ? data.meter : options.device},${options.gateway ?? null},${options.rule ?? null}::uuid,
        'HIGH'::public.alert_severity,'DEVICE_OFFLINE','Fixture communication alert','1'::jsonb,
        clock_timestamp(),clock_timestamp())`;
    assert.ok(row?.event_id && typeof row.signature === "string", "private producer returns only an event identity and opaque signature");
    assert.ok(/^[0-9a-f]{64}$/.test(row.signature), "outbox signature is opaque SHA-256");
    assert.deepEqual(Object.keys(row).sort(), ["event_id", "signature"]);
    return { id, event: row.event_id, signature: row.signature };
  }

  async function signature(client: ServiceQuery, source: string, event: string) {
    const [row] = await client`select public.ingest_alert_outbox_signature(${source}::uuid,${event}::uuid) as signature`;
    return row?.signature as string;
  }

  async function lotState() {
    const [row] = await safeDatabaseOperation("inspect private parking observation", () => boundedTransaction(fixture!.owner, tx => tx`
      select id,building_id,vehicle_type,capacity,sensor_id,stale_after_seconds,occupied,source,observed_at,updated_at,version
      from public.parking_lots where id=${data.lot}::uuid`));
    assert.ok(row);
    return row;
  }

  async function observe(client: ServiceQuery, proof: Awaited<ReturnType<typeof insertReading>>, version: number,
    options: { lot?: string; building?: string; device?: string; event?: string; occupied?: number } = {}) {
    const [row] = await client`select public.ingest_write_parking_observation(
      ${options.lot ?? data.lot}::uuid,${options.building ?? data.building},${options.device ?? data.parkingSensor},
      ${options.event ?? proof.event},${options.occupied ?? proof.occupied},${proof.time},${proof.time},${version}) as changed`;
    return row?.changed;
  }

  async function noProducedRows(id: string) {
    const [row] = await safeDatabaseOperation("inspect rolled-back producer effects", () => boundedTransaction(fixture!.observer, tx => tx`
      select (select count(*)::int from public.alerts where id=${id}::uuid) as alerts,
        (select count(*)::int from public.outbox_events where alert_id=${id}::uuid) as events`));
    assert.deepEqual(row, { alerts: 0, events: 0 });
  }

  it("owner exercises all domain seed SQL, enabled physical features and real human admission on canonical 051", async () => {
    data = await seedRuntimeServiceData(fixture!);
    await verifyRuntimeServiceData(fixture!, data);
  });

  it("052 supplies private observational operations before actual restricted authentication", async () => {
    await assertServiceCatalogue(fixture!, "predioon_ingest");
    await fixture!.provisionRuntime();
    await safeDatabaseOperation("observational operations real-login control", () => verifyRestrictedDatabaseRole(fixture!.ingest, "predioon_ingest"));
    authenticated = true;
  });

  it("reads safe inventory and features and keeps heartbeat updates working in an inactive building", async context => {
    if (!ready(context)) return;
    await safeDatabaseOperation("safe operational inventory and feature barrier", () => boundedTransaction(fixture!.ingest, async tx => {
      const devices = await tx`select id,building_id,gateway_id,name,type,status,enabled,last_seen_at,created_at,updated_at from public.devices`;
      assert.ok(devices.some(row => row.id === data.meter));
      const gateways = await tx`select id,building_id,name,serial_number,model,firmware_version,protocol_version,status,enabled,last_seen_at,created_at,updated_at from public.gateways`;
      assert.ok(gateways.some(row => row.id === data.gateway));
      const buildings = await tx`select id,active,timezone from public.buildings`;
      assert.ok(buildings.some(row => row.id === data.building));
      const rules = await tx`select id,building_id,device_id,metric,operator,threshold,severity,alert_type,message_template,cooldown_seconds,enabled from public.alert_rules`;
      assert.ok(rules.some(row => row.id === data.globalRule));
      const gates = await tx`select id,building_id,device_id,kind from public.gates`;
      assert.ok(gates.some(row => row.id === data.ownerCommand.gate_id));
      await tx`select feature_key,enabled,version,updated_at from public.global_feature_settings`;
      await tx`select building_id,feature_key,enabled,version,updated_at from public.building_feature_settings`;
      await tx`select building_id,feature_key,resumed_at,paused_at,generation from public.feature_runtime`;
      await tx`select pg_advisory_xact_lock_shared(814772,1)`;
    }));
    await safeDatabaseOperation("make only fixture building inactive", () => boundedTransaction(fixture!.owner, tx => tx`update public.buildings set active=false where id=${data.building}`));
    try {
      await safeDatabaseOperation("inactive-building operational heartbeat", () => boundedTransaction(fixture!.ingest, async tx => {
        const devices = await tx`update public.devices set status='OFFLINE',last_seen_at=clock_timestamp(),updated_at=clock_timestamp()
          where id=${data.meter} returning id`;
        const gateways = await tx`update public.gateways set status='OFFLINE',last_seen_at=clock_timestamp(),firmware_version='fixture-v2',updated_at=clock_timestamp()
          where id=${data.gateway} returning id`;
        assert.equal(devices.length, 1); assert.equal(gateways.length, 1);
      }));
      const [state] = await safeDatabaseOperation("owner confirms inactive heartbeat persistence", () => boundedTransaction(fixture!.owner, tx => tx`
        select d.status as device_status,g.status as gateway_status,g.firmware_version,d.last_seen_at is not null as contacted
        from public.devices d join public.gateways g on g.id=d.gateway_id where d.id=${data.meter}`));
      assert.deepEqual(state, { device_status: "OFFLINE", gateway_status: "OFFLINE", firmware_version: "fixture-v2", contacted: true });
    } finally {
      await safeDatabaseOperation("restore fixture operational parents", () => boundedTransaction(fixture!.owner, async tx => {
        await tx`update public.buildings set active=true where id=${data.building}`;
        await tx`update public.devices set status='ONLINE' where id=${data.meter}`;
        await tx`update public.gateways set status='ONLINE' where id=${data.gateway}`;
      }));
    }
    for (const statement of ["select metadata from public.devices", "select hardware_address from public.devices",
      "select metadata from public.gateways", "select gateway_id from public.gates",
      "update public.devices set enabled=true", "update public.gateways set building_id=building_id",
      "update public.global_feature_settings set enabled=true", "update public.building_feature_settings set enabled=true",
      "update public.feature_runtime set generation=generation+1"]) await assertPermissionDenied(fixture!.ingest, statement);
  });

  it("appends receipt/raw MQTT evidence while foreign, disabled and inactive sources cannot write either table", async context => {
    if (!ready(context)) return;
    const proof = await safeDatabaseOperation("append restricted receipt and raw reading", () => boundedTransaction(fixture!.ingest, tx => insertReading(tx, data)));
    const [visible] = await safeDatabaseOperation("read restricted evidence", () => boundedTransaction(fixture!.ingest, tx => tx`
      select e.source,t.metric,t.numeric_value from public.ingest_events e join public.telemetry t
      on t.event_id=e.event_id and t.building_id=e.building_id and t.device_id=e.device_id where e.event_id=${proof.event}`));
    assert.deepEqual(visible, { source: "MQTT", metric: "parking_occupied", numeric_value: 3 });
    for (const [building, device, source] of [[data.otherBuilding, data.meter, "MQTT"],
      [data.building, data.disabledDevice, "MQTT"], [data.building, data.meter, "HTTP"]]) {
      await assert.rejects(safeDatabaseOperation("reject invalid receipt association", () => boundedTransaction(fixture!.ingest, tx => tx`
        insert into public.ingest_events(event_id,building_id,device_id,source) values(${randomUUID()},${building!},${device!},${source!})`)), codeIs("42501"));
    }
    for (const [building, device] of [[data.otherBuilding, data.meter], [data.building, data.disabledDevice]]) {
      await assert.rejects(safeDatabaseOperation("reject invalid raw association", () => boundedTransaction(fixture!.ingest, tx => tx`
        insert into public.telemetry(event_id,building_id,device_id,metric,value,time)
        values(${randomUUID()},${building!},${device!},'parking_occupied','3'::jsonb,clock_timestamp())`)), codeIs("42501"));
    }
    await safeDatabaseOperation("disable fixture receipt/raw gateway", () => boundedTransaction(fixture!.owner, tx => tx`update public.gateways set enabled=false where id=${data.gateway}`));
    try {
      await assert.rejects(safeDatabaseOperation("disabled-gateway receipt denied", () => boundedTransaction(fixture!.ingest, tx => tx`
        insert into public.ingest_events(event_id,building_id,device_id,source) values(${randomUUID()},${data.building},${data.meter},'MQTT')`)), codeIs("42501"));
      await assert.rejects(safeDatabaseOperation("disabled-gateway raw denied", () => boundedTransaction(fixture!.ingest, tx => tx`
        insert into public.telemetry(event_id,building_id,device_id,metric,value,time)
        values(${randomUUID()},${data.building},${data.meter},'energy_total_kwh','3'::jsonb,clock_timestamp())`)), codeIs("42501"));
    } finally {
      await safeDatabaseOperation("restore fixture receipt/raw gateway", () => boundedTransaction(fixture!.owner, tx => tx`update public.gateways set enabled=true where id=${data.gateway}`));
    }
    await safeDatabaseOperation("deactivate fixture telemetry building", () => boundedTransaction(fixture!.owner, tx => tx`update public.buildings set active=false where id=${data.building}`));
    try {
      await assert.rejects(safeDatabaseOperation("inactive-building receipt denied", () => boundedTransaction(fixture!.ingest, tx => tx`
        insert into public.ingest_events(event_id,building_id,device_id,source) values(${randomUUID()},${data.building},${data.meter},'MQTT')`)), codeIs("42501"));
      await assert.rejects(safeDatabaseOperation("inactive-building raw denied", () => boundedTransaction(fixture!.ingest, tx => tx`
        insert into public.telemetry(event_id,building_id,device_id,metric,value,time)
        values(${randomUUID()},${data.building},${data.meter},'energy_total_kwh','3'::jsonb,clock_timestamp())`)), codeIs("42501"));
    } finally {
      await safeDatabaseOperation("reactivate fixture telemetry building", () => boundedTransaction(fixture!.owner, tx => tx`update public.buildings set active=true where id=${data.building}`));
    }
    for (const statement of ["update public.ingest_events set source='MQTT'", "delete from public.ingest_events",
      "update public.telemetry set numeric_value=0", "delete from public.telemetry"]) await assertPermissionDenied(fixture!.ingest, statement);
  });

  it("privately locks enabled matching profiles in stable order without configuration UPDATE authority", async context => {
    if (!ready(context)) return;
    await safeDatabaseOperation("hold real restricted monitoring-profile locks", () => boundedTransaction(fixture!.ingest, async tx => {
      const rows = await tx`select profile_id from public.ingest_lock_monitoring_profiles(${data.building},${data.meter})`;
      assert.deepEqual(rows.map(row => row.profile_id), [data.profile, data.secondProfile].sort());
      await assert.rejects(safeDatabaseOperation("owner NOWAIT confirms actual profile locks", () => boundedTransaction(fixture!.observer, owner => owner`
        select id from public.monitoring_profiles where id=${data.profile}::uuid for update nowait`)), codeIs("55P03"));
      assert.equal((await tx`select * from public.ingest_lock_monitoring_profiles(${data.otherBuilding},${data.meter})`).length, 0);
    }));
    await safeDatabaseOperation("profile lock released at restricted commit", () => boundedTransaction(fixture!.observer, tx => tx`
      select id from public.monitoring_profiles where id=${data.profile}::uuid for update nowait`));
    await assertPermissionDenied(fixture!.ingest, "select id from public.monitoring_profiles for update");
    await assertPermissionDenied(fixture!.ingest, "update public.monitoring_profiles set enabled=false");
  });

  it("privately locks only the matching parking sensor while direct row locking and writes remain forbidden", async context => {
    if (!ready(context)) return;
    await safeDatabaseOperation("hold real restricted parking lock", () => boundedTransaction(fixture!.ingest, async tx => {
      const rows = await tx`select lot_id from public.ingest_lock_parking_lot(${data.building},${data.parkingSensor})`;
      assert.deepEqual(rows.map(row => row.lot_id), [data.lot]);
      assert.equal((await tx`select * from public.ingest_lock_parking_lot(${data.building},${data.meter})`).length, 0);
      assert.equal((await tx`select * from public.ingest_lock_parking_lot(${data.otherBuilding},${data.parkingSensor})`).length, 0);
      await assert.rejects(safeDatabaseOperation("owner NOWAIT confirms actual parking lock", () => boundedTransaction(fixture!.observer, owner => owner`
        select id from public.parking_lots where id=${data.lot}::uuid for update nowait`)), codeIs("55P03"));
    }));
    await assertPermissionDenied(fixture!.ingest, "select id from public.parking_lots for update");
    await assertPermissionDenied(fixture!.ingest, "update public.parking_lots set occupied=0");
  });

  it("upserts only usage payloads and reads global-rule cooldown across devices", async context => {
    if (!ready(context)) return;
    await safeDatabaseOperation("restricted usage payload upserts", () => boundedTransaction(fixture!.ingest, async tx => {
      await tx`select * from public.monitoring_profiles where id=${data.profile}::uuid`;
      await tx`insert into public.usage_cursors(profile_id,building_id,last_at,last_value,good,continuous_seconds)
        values(${data.profile},${data.building},clock_timestamp(),2,true,10)
        on conflict(profile_id) do update set last_at=excluded.last_at,last_value=excluded.last_value,good=excluded.good,continuous_seconds=excluded.continuous_seconds`;
      await tx`insert into public.usage_cursors(profile_id,building_id,last_at,last_value,good)
        values(${data.secondProfile},${data.building},clock_timestamp(),1,true)`;
      await tx`insert into public.daily_usage(profile_id,building_id,day,quantity,estimated_cost,covered_seconds,resets,samples,incomplete,first_at,last_at)
        values(${data.profile},${data.building},'2026-01-01',2,3,10,0,2,false,clock_timestamp(),clock_timestamp())
        on conflict(profile_id,day) do update set quantity=excluded.quantity,estimated_cost=excluded.estimated_cost,
          covered_seconds=excluded.covered_seconds,resets=excluded.resets,samples=excluded.samples,
          incomplete=excluded.incomplete,first_at=excluded.first_at,last_at=excluded.last_at`;
      const [cursor] = await tx`select last_value,continuous_seconds from public.usage_cursors where profile_id=${data.profile}::uuid`;
      const [daily] = await tx`select quantity,samples from public.daily_usage where profile_id=${data.profile}::uuid and day='2026-01-01'`;
      assert.deepEqual(cursor, { last_value: 2, continuous_seconds: 10 });
      assert.deepEqual(daily, { quantity: 2, samples: 2 });
      const cooldown = await tx`select id,building_id,device_id,gateway_id,rule_id,severity,type,status,message,triggered_value,triggered_at,created_at
        from public.alerts where rule_id=${data.globalRule}::uuid order by created_at desc limit 1`;
      assert.equal(cooldown[0]?.device_id, data.peer, "global rule reads its latest alert from a different device");
    }));
    for (const statement of ["update public.usage_cursors set profile_id=profile_id", "update public.usage_cursors set building_id=building_id",
      "update public.daily_usage set profile_id=profile_id", "update public.daily_usage set building_id=building_id",
      "update public.daily_usage set day=day", "delete from public.usage_cursors", "delete from public.daily_usage"])
      await assertPermissionDenied(fixture!.ingest, statement);
    await assert.rejects(safeDatabaseOperation("foreign usage association rejected", () => boundedTransaction(fixture!.ingest, tx => tx`
      insert into public.daily_usage(profile_id,building_id,day,first_at,last_at)
      values(${data.foreignProfile},${data.building},'2026-01-02',clock_timestamp(),clock_timestamp())`)), codeIs("42501"));
    for (const target of ["building", "device", "gateway"] as const) {
      await safeDatabaseOperation("disable fixture usage source", () => boundedTransaction(fixture!.owner, async tx => {
        if (target === "building") await tx`update public.buildings set active=false where id=${data.building}`;
        if (target === "device") await tx`update public.devices set enabled=false where id=${data.meter}`;
        if (target === "gateway") await tx`update public.gateways set enabled=false where id=${data.gateway}`;
      }));
      try {
        await assert.rejects(safeDatabaseOperation("inactive or disabled usage source cannot insert", () => boundedTransaction(fixture!.ingest, tx => tx`
          insert into public.daily_usage(profile_id,building_id,day,first_at,last_at)
          values(${data.profile},${data.building},'2026-01-03',clock_timestamp(),clock_timestamp())`)), codeIs("42501"));
      } finally {
        await safeDatabaseOperation("restore fixture usage source", () => boundedTransaction(fixture!.owner, async tx => {
          if (target === "building") await tx`update public.buildings set active=true where id=${data.building}`;
          if (target === "device") await tx`update public.devices set enabled=true where id=${data.meter}`;
          if (target === "gateway") await tx`update public.gateways set enabled=true where id=${data.gateway}`;
        }));
      }
    }
  });

  it("derives five rejection counters with UTC database time and rejects unbounded category/building inputs", async context => {
    if (!ready(context)) return;
    const categories = ["INVALID_ENVELOPE", "FUTURE_TIMESTAMP", "UNKNOWN_SOURCE", "CONTENT_CONFLICT", "RETAINED_REPLAY"];
    for (const category of categories) {
      const building = category === "CONTENT_CONFLICT" || category === "RETAINED_REPLAY" ? data.building : "";
      await safeDatabaseOperation("bounded restricted rejection counter", () => boundedTransaction(fixture!.ingest, async tx => {
        await tx`select public.ingest_count_rejection(${category},${building})`;
        await tx`select public.ingest_count_rejection(${category},${building})`;
      }));
    }
    const [result] = await safeDatabaseOperation("owner confirms bounded rejection derivation", () => boundedTransaction(fixture!.owner, tx => tx`
      select count(*)::int as buckets,bool_and(total=2) as counted,
        bool_and(day=(clock_timestamp() at time zone 'UTC')::date) as utc_day,
        bool_and(last_at between clock_timestamp()-interval '10 seconds' and clock_timestamp()) as fresh
      from public.ingest_rejections`));
    assert.deepEqual(result, { buckets: 5, counted: true, utc_day: true, fresh: true });
    for (const [category, building] of [["RAW_PACKET", ""], ["UNKNOWN_SOURCE", data.building],
      ["INVALID_ENVELOPE", data.building], ["CONTENT_CONFLICT", ""], ["RETAINED_REPLAY", "missing-building"], [null, ""]]) {
      await assert.rejects(safeDatabaseOperation("invalid rejection bucket closed", () => boundedTransaction(fixture!.ingest, tx => tx`
        select public.ingest_count_rejection(${category!},${building!})`)), codeIs("22023"));
    }
    await assertPermissionDenied(fixture!.ingest, "select * from public.ingest_rejections");
    await assertPermissionDenied(fixture!.ingest, "insert into public.ingest_rejections(day,category) values(current_date,'INVALID_ENVELOPE')");
  });

  it("privately produces OPEN alerts and opaque durable outbox signatures, including inactive-building communication", async context => {
    if (!ready(context)) return;
    const produced = await safeDatabaseOperation("restricted alert and outbox producer", () => boundedTransaction(fixture!.ingest, tx => produce(tx, { rule: data.globalRule })));
    const [source] = await safeDatabaseOperation("owner confirms private alert envelope", () => boundedTransaction(fixture!.owner, tx => tx`
      select status,acknowledged_by,acknowledged_at,resolved_by,resolved_at from public.alerts where id=${produced.id}::uuid`));
    assert.deepEqual(source, { status: "OPEN", acknowledged_by: null, acknowledged_at: null, resolved_by: null, resolved_at: null });
    const again = await safeDatabaseOperation("reconfirm opaque persisted outbox signature", () => boundedTransaction(fixture!.ingest, tx => signature(tx, produced.id, produced.event)));
    assert.ok(again === produced.signature, "unchanged ordered snapshot retains its signature");
    await safeDatabaseOperation("make fixture building inactive for communication", () => boundedTransaction(fixture!.owner, tx => tx`update public.buildings set active=false where id=${data.building}`));
    try {
      await safeDatabaseOperation("inactive-building gateway communication alert", () => boundedTransaction(fixture!.ingest, tx => produce(tx, { device: null, gateway: data.gateway })));
      await safeDatabaseOperation("disable gateway without disabling device", () => boundedTransaction(fixture!.owner, tx => tx`update public.gateways set enabled=false where id=${data.gateway}`));
      await safeDatabaseOperation("device offline alert does not require an enabled gateway", () => boundedTransaction(fixture!.ingest, tx => produce(tx)));
    } finally {
      await safeDatabaseOperation("restore fixture alert parents", () => boundedTransaction(fixture!.owner, async tx => {
        await tx`update public.buildings set active=true where id=${data.building}`;
        await tx`update public.gateways set enabled=true where id=${data.gateway}`;
      }));
    }
    for (const statement of ["insert into public.alerts(building_id,severity,type,message) values('forbidden','HIGH','RULE','forbidden')",
      "update public.alerts set status='RESOLVED'", "select * from public.outbox_events", "select claim_token from public.event_deliveries",
      "select * from public.delivery_witnesses", "select * from public.delivery_witness_features", "select * from public.audit_logs"])
      await assertPermissionDenied(fixture!.ingest, statement);
  });

  it("rejects invalid alert origins/rules and duplicate producers without replacing source state", async context => {
    if (!ready(context)) return;
    for (const options of [{ device: null }, { gateway: data.gateway }, { device: data.disabledDevice },
      { device: data.foreignDevice }, { rule: data.foreignRule }, { device: data.peer, rule: data.deviceRule },
      { device: null, gateway: data.gateway, rule: data.globalRule }]) {
      const id = randomUUID();
      await assert.rejects(safeDatabaseOperation("invalid private producer source rejected", () => boundedTransaction(fixture!.ingest, tx => produce(tx, { ...options, id }))), codeIs("22023"));
      await noProducedRows(id);
    }
    const first = await safeDatabaseOperation("original private producer source", () => boundedTransaction(fixture!.ingest, tx => produce(tx)));
    await assert.rejects(safeDatabaseOperation("duplicate private producer rejected", () => boundedTransaction(fixture!.ingest, tx => produce(tx, { id: first.id }))), codeIs("23505"));
    assert.ok(await safeDatabaseOperation("duplicate retained original outbox", () => boundedTransaction(fixture!.ingest, tx => signature(tx, first.id, first.event))) === first.signature);
    for (const [source, event] of [[randomUUID(), first.event], [first.id, randomUUID()]]) {
      await assert.rejects(safeDatabaseOperation("unassociated signature target rejected", () => boundedTransaction(fixture!.ingest, tx => signature(tx, source!, event!))), codeIs("40001"));
    }
  });

  it("keeps source and outbox invisible until commit and rolls both back together", async context => {
    if (!ready(context)) return;
    const id = randomUUID();
    await assert.rejects(safeDatabaseOperation("deliberate source/outbox transaction rollback", () => boundedTransaction(fixture!.ingest, async tx => {
      await produce(tx, { id });
      await noProducedRows(id);
      throw Object.assign(new Error("controlled operational rollback"), { code: "PZ001" });
    })), codeIs("PZ001"));
    await noProducedRows(id);
  });

  it("detects a later writer through the opaque snapshot and lets the caller roll back all operational writes", async context => {
    if (!ready(context)) return;
    const id = randomUUID(), before = await lotState();
    await withRuntimeOwnerTrigger(fixture!.owner, "audit_logs", "after", "insert", `
      IF NEW.action='PARKING_SENSOR_UPDATED' THEN
        UPDATE public.event_deliveries SET available_at=available_at+interval '1 second'
          WHERE event_id=nullif(current_setting('runtime.test_event',true),'')::uuid;
      END IF; RETURN NEW;`, async () => {
      await assert.rejects(safeDatabaseOperation("caller final opaque-snapshot check rolls back late writer", () => boundedTransaction(fixture!.ingest, async tx => {
        const proof = await insertReading(tx, data);
        const first = await produce(tx, { id });
        await tx`select set_config('runtime.test_event',${first.event},true)`;
        assert.equal(await observe(tx, proof, before.version), true);
        const after = await signature(tx, id, first.event);
        assert.ok(after !== first.signature, "late private delivery mutation changes the ordered opaque snapshot");
        // The future adapter's final persistence check compares these two values.
        throw Object.assign(new Error("controlled final persistence mismatch"), { code: "40001" });
      })), codeIs("40001"));
    });
    await noProducedRows(id);
    assert.deepEqual(await lotState(), before, "observation and audit are in the same rolled-back unit as the alert/outbox");
  });

  it("rolls back producer skips, RETURNING rewrites and a late source rewrite with 40001", async context => {
    if (!ready(context)) return;
    for (const [table, timing, body] of [
      ["alerts", "before", "RETURN NULL;"],
      ["alerts", "before", "NEW.message:='controlled rewrite'; RETURN NEW;"],
      ["outbox_events", "after", "UPDATE public.alerts SET message='late controlled rewrite' WHERE id=NEW.alert_id; RETURN NEW;"],
    ] as const) {
      const id = randomUUID();
      await withRuntimeOwnerTrigger(fixture!.owner, table, timing, "insert", body, async () => {
        await assert.rejects(safeDatabaseOperation("private alert persistence interference", () => boundedTransaction(fixture!.ingest, tx => produce(tx, { id }))), codeIs("40001"));
      });
      await noProducedRows(id);
    }
  });

  it("writes only a proven parking observation with a derived SYSTEM audit and restores ambient human GUCs", async context => {
    if (!ready(context)) return;
    const before = await lotState();
    const proof = await safeDatabaseOperation("proven restricted parking observation", () => boundedTransaction(fixture!.ingest, async tx => {
      const reading = await insertReading(tx, data);
      await tx`select set_config('app.user_id',${data.admin},true),set_config('app.role','PLATFORM_ADMIN',true)`;
      assert.equal(await observe(tx, reading, before.version), true);
      const [context] = await tx`select current_setting('app.user_id') as actor,current_setting('app.role') as role`;
      assert.deepEqual(context, { actor: data.admin, role: "PLATFORM_ADMIN" });
      return reading;
    }));
    const after = await lotState();
    for (const key of ["id", "building_id", "vehicle_type", "capacity", "sensor_id", "stale_after_seconds"])
      assert.equal(after[key], before[key], `observation preserves parking configuration ${key}`);
    assert.equal(after.occupied, proof.occupied); assert.equal(after.source, "SENSOR");
    assert.equal(after.version, before.version + 1);
    assert.equal(new Date(after.observed_at).getTime(), proof.time.getTime());
    const [audit] = await safeDatabaseOperation("owner confirms closed parking audit", () => boundedTransaction(fixture!.owner, tx => tx`
      select building_id,user_id,actor_type,action,resource_type,resource_id,metadata from public.audit_logs
      where action='PARKING_SENSOR_UPDATED' and metadata->>'eventId'=${proof.event}`));
    assert.deepEqual(audit, { building_id: data.building, user_id: null, actor_type: "SYSTEM",
      action: "PARKING_SENSOR_UPDATED", resource_type: "parking", resource_id: data.lot,
      metadata: { eventId: proof.event, deviceId: data.parkingSensor, occupied: proof.occupied, previousOccupied: before.occupied } });
  });

  it("rejects parking proof/version/association mismatches and rolls back silently skipped or rewritten observations/audits", async context => {
    if (!ready(context)) return;
    const before = await lotState();
    const [auditBefore] = await safeDatabaseOperation("inspect parking negative-control audit count", () => boundedTransaction(fixture!.owner, tx => tx`
      select count(*)::int as total from public.audit_logs where resource_id=${data.lot}`));
    await safeDatabaseOperation("parking proof mismatch matrix", () => boundedTransaction(fixture!.ingest, async tx => {
      const proof = await insertReading(tx, data);
      for (const options of [{ event: randomUUID() }, { occupied: proof.occupied + 1 },
        { building: data.otherBuilding }, { device: data.meter }, { lot: randomUUID() }])
        assert.equal(await observe(tx, proof, before.version, options), false);
      assert.equal(await observe(tx, proof, before.version - 1), false);
      for (const options of [{ metric: "other_metric" }, { quality: "BAD" }, { device: data.meter }]) {
        const invalid = await insertReading(tx, data, options);
        assert.equal(await observe(tx, invalid, before.version), false);
      }
    }));
    assert.deepEqual(await lotState(), before);
    const [auditAfter] = await safeDatabaseOperation("confirm parking mismatches wrote no audit", () => boundedTransaction(fixture!.owner, tx => tx`
      select count(*)::int as total from public.audit_logs where resource_id=${data.lot}`));
    assert.equal(auditAfter?.total, auditBefore?.total);
    await assert.rejects(safeDatabaseOperation("parking capacity CHECK remains active", () => boundedTransaction(fixture!.ingest, async tx => {
      const proof = await insertReading(tx, data, { occupied: before.capacity + 1 });
      await observe(tx, proof, before.version);
    })), codeIs("23514"));
    assert.deepEqual(await lotState(), before);
    for (const [table, body] of [["parking_lots", "RETURN NULL;"],
      ["parking_lots", "NEW.occupied:=NEW.occupied+1; RETURN NEW;"],
      ["audit_logs", "IF NEW.action='PARKING_SENSOR_UPDATED' THEN RETURN NULL; END IF; RETURN NEW;"],
      ["audit_logs", "IF NEW.action='PARKING_SENSOR_UPDATED' THEN NEW.actor_type:='USER'; NEW.resource_type:='gate'; NEW.metadata:='{}'::jsonb; END IF; RETURN NEW;"]] as const) {
      await withRuntimeOwnerTrigger(fixture!.owner, table, "before", table === "parking_lots" ? "update" : "insert", body, async () => {
        await assert.rejects(safeDatabaseOperation("private parking persistence interference", () => boundedTransaction(fixture!.ingest, async tx => {
          const proof = await insertReading(tx, data);
          await observe(tx, proof, before.version);
        })), codeIs("40001"));
      });
      assert.deepEqual(await lotState(), before);
      const [auditCount] = await safeDatabaseOperation("confirm parking interference rolled back every audit", () => boundedTransaction(fixture!.observer, tx => tx`
        select count(*)::int as total from public.audit_logs where resource_id=${data.lot}`));
      assert.equal(auditCount?.total, auditBefore?.total);
    }
  });

  it("private helpers reject owner disguises and remain inaccessible through forged GUCs, opposite service and human/worker APIs", async context => {
    if (!ready(context)) return;
    await safeDatabaseOperation("observational identity before private helper negatives", () => verifyRestrictedDatabaseRole(fixture!.ingest, "predioon_ingest"));
    for (const disguise of ["set local role predioon_ingest", "set local session authorization predioon_ingest"]) {
      for (const statement of ["select public.ingest_count_rejection('INVALID_ENVELOPE','')",
        "select public.ingest_lock_monitoring_profiles(null::text,null::text)",
        "select public.ingest_lock_parking_lot(null::text,null::text)",
        "select public.ingest_persist_alert(null::uuid,null::text,null::text,null::text,null::uuid,'HIGH'::public.alert_severity,'DEVICE_OFFLINE','fixture','1'::jsonb,clock_timestamp(),clock_timestamp())",
        "select public.ingest_alert_outbox_signature(null::uuid,null::uuid)",
        "select public.ingest_write_parking_observation(null::uuid,null::text,null::text,null::text,1,clock_timestamp(),clock_timestamp(),1)"]) {
        await assert.rejects(safeDatabaseOperation("owner disguise cannot invoke any authenticated observational helper", () => boundedTransaction(fixture!.owner, async tx => {
          await tx.unsafe(disguise);
          await tx`select set_config('app.user_id',${data.admin},true),set_config('app.role','PLATFORM_ADMIN',true)`;
          await tx.unsafe(statement);
        })), codeIs("42501"));
      }
    }
    await safeDatabaseOperation("opposite service real-login positive control", () => verifyRestrictedDatabaseRole(fixture!.access, "predioon_access_service"));
    await assertPermissionDenied(fixture!.access, "select public.ingest_count_rejection('INVALID_ENVELOPE','')", true);
    for (const statement of ["select public.service_runtime_guard('predioon_ingest'::name)",
      "select public.access_service_next_pending()", "select public.app_request_access(null::uuid,null::uuid)",
      "select public.app_mark_access_sent(null::uuid)", "select public.app_has_global_capability('features:manage')",
      "select public.identity_lock_account_active('fixture-account')", "select public.notification_enqueue_alert(null::uuid)",
      "select public.notification_claim(1)"]) {
      // Every denied statement has its own BEGIN; an aborted transaction is never evidence.
      await assertPermissionDenied(fixture!.ingest, statement, true);
    }
  });
});
