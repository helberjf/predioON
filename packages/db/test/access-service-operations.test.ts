import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, describe, it, type TestContext } from "node:test";
import postgres from "postgres";
import { verifyRestrictedDatabaseRole } from "../src/runtime-connection.js";
import {
  assertServiceCatalogue, codeIs, createRuntimeServicesFixture,
  parseRuntimeServicesEnvironment, runtimeServicesSkipReason, safeDatabaseOperation,
  type RuntimeServicesFixture,
} from "./fixtures/runtime-services.js";
import {
  assertBoundedPermissionDenied as assertPermissionDenied, boundedTransaction,
  commandAudits, commandState, requestHumanAccess, retirePendingCommands, seedRuntimeServiceData,
  verifyRuntimeServiceData, waitForDatabaseBlock, waitForDatabaseDeadline, withRuntimeOwnerTrigger,
  type AccessRequest, type RuntimeServiceData, type ServiceQuery,
} from "./fixtures/runtime-service-data.js";

const configuration = parseRuntimeServicesEnvironment(process.env);

// SQL state-transition boundaries only. MQTT QoS, publication, reconnects and
// crash behavior remain later transport integration work, not claims of this suite.
describe("physical access operations on real restricted PostgreSQL", {
  concurrency: false, skip: configuration ? false : runtimeServicesSkipReason,
}, () => {
  let fixture: RuntimeServicesFixture | undefined;
  let data: RuntimeServiceData;
  let authenticated = false;
  before(async () => { fixture = await createRuntimeServicesFixture(configuration!); });
  afterEach(async () => { if (authenticated) await retirePendingCommands(fixture!.owner); });
  after(async () => { await fixture?.cleanup(); });
  const ready = (context: TestContext) => {
    if (authenticated) return true;
    context.skip("operations require the preceding 052 catalogue and real-login positive control");
    return false;
  };
  const request = () => requestHumanAccess(fixture!.owner, data);
  const state = (command: AccessRequest) => commandState(fixture!.observer, command.id);
  const audits = (command: AccessRequest) => commandAudits(fixture!.observer, command.id);

  async function service<T>(label: string, operation: (tx: postgres.TransactionSql) => Promise<T>) {
    return safeDatabaseOperation(label, () => boundedTransaction(fixture!.access, async tx => {
      await tx`select pg_advisory_xact_lock_shared(814772,1)`;
      return operation(tx);
    }));
  }
  async function sent(command: AccessRequest) {
    return service("private physical SENT checkpoint", async tx => {
      const [row] = await tx`select public.access_service_mark_sent(${command.id}::uuid) as reason`;
      return row?.reason;
    });
  }
  async function ack(client: ServiceQuery, command: AccessRequest, result = "EXECUTED", override: {
    id?: string; building?: string; gateway?: string; gate?: string; device?: string;
  } = {}) {
    const [row] = await client`select public.access_service_apply_ack(${override.id ?? command.id}::uuid,
      ${override.building ?? command.building_id},${override.gateway ?? command.gateway_id},
      ${override.gate ?? command.gate_id},${override.device ?? command.device_id},${result}) as changed`;
    return row?.changed;
  }
  async function failPending(command: AccessRequest, reason: string | null) {
    return service("private pending failure transition", async tx => {
      const [row] = await tx`select public.access_service_fail_pending(${command.id}::uuid,${reason}) as changed`;
      return row?.changed;
    });
  }
  async function failPublish(command: AccessRequest, reason: string | null) {
    return service("private sent publish-failure transition", async tx => {
      const [row] = await tx`select public.access_service_fail_publish(${command.id}::uuid,${reason}) as changed`;
      return row?.changed;
    });
  }

  async function derivedAudit(command: AccessRequest, action: string) {
    const rows = (await audits(command)).filter(row => row.action === action);
    assert.equal(rows.length, 1, "exactly one derived result audit is persisted");
    const row = rows[0]!;
    assert.equal(row.building_id, command.building_id);
    assert.equal(row.user_id, command.requested_by);
    assert.equal(row.actor_type, "SYSTEM");
    assert.equal(row.resource_type, "gate");
    assert.equal(row.resource_id, command.gate_id);
    assert.equal(row.metadata.commandId, command.id);
    assert.ok(Object.keys(row.metadata).every(key => key === "commandId" || key === "reason"), "result audit contains only closed derived metadata");
    return row;
  }

  async function extraAccessClient() {
    const client = await safeDatabaseOperation("construct bounded second physical client", async () => postgres(fixture!.urls.access, {
      max: 1, connect_timeout: 5, idle_timeout: 0, onnotice: () => {},
    }));
    try {
      await safeDatabaseOperation("second physical connection real-login positive control", () => verifyRestrictedDatabaseRole(client, "predioon_access_service"));
      return client;
    } catch (error) {
      await safeDatabaseOperation("close failed second physical client", () => client.end({ timeout: 5 }));
      throw error;
    }
  }

  it("owner exercises all domain seed SQL, enabled physical features and real human admission on canonical 051", async () => {
    data = await seedRuntimeServiceData(fixture!);
    await verifyRuntimeServiceData(fixture!, data);
  });

  it("052 supplies private physical transitions before actual restricted authentication", async () => {
    await assertServiceCatalogue(fixture!, "predioon_access_service");
    await fixture!.provisionRuntime();
    await safeDatabaseOperation("physical operations real-login control", () => verifyRestrictedDatabaseRole(fixture!.access, "predioon_access_service"));
    authenticated = true;
  });

  it("reads feature state and holds the shared barrier without direct command, audit, request or observation authority", async context => {
    if (!ready(context)) return;
    await service("physical feature-state positive control", async tx => {
      const global = await tx`select feature_key,enabled,version,updated_at from public.global_feature_settings`;
      const local = await tx`select building_id,feature_key,enabled,version,updated_at from public.building_feature_settings`;
      const runtime = await tx`select building_id,feature_key,resumed_at,paused_at,generation from public.feature_runtime`;
      assert.ok(global.some(row => row.feature_key === "GARAGE_ACCESS" && row.enabled));
      assert.ok(local.some(row => row.building_id === data.building && row.feature_key === "GARAGE_ACCESS" && row.enabled));
      assert.ok(runtime.some(row => row.building_id === data.building && row.feature_key === "GARAGE_ACCESS"));
    });
    await safeDatabaseOperation("physical identity before direct privilege negatives", () => verifyRestrictedDatabaseRole(fixture!.access, "predioon_access_service"));
    for (const statement of ["select * from public.gate_commands", "update public.gate_commands set status='SENT'",
      "insert into public.gate_commands(request_id) values(gen_random_uuid())", "delete from public.gate_commands",
      "select * from public.gates", "select id from public.devices", "select * from public.audit_logs",
      "insert into public.audit_logs(action,resource_type) values('FORGED','gate')", "select * from public.telemetry",
      "insert into public.ingest_events(event_id,building_id,device_id) values('forged','forged','forged')",
      "update public.parking_lots set occupied=0", "select * from public.users", "select * from public.outbox_events",
      "update public.global_feature_settings set enabled=true", "update public.building_feature_settings set enabled=true",
      "update public.feature_runtime set generation=generation+1", "select public.app_request_access(null::uuid,null::uuid)",
      "select public.app_mark_access_sent(null::uuid)", "select public.identity_lock_account_active('fixture-account')",
      "select public.notification_enqueue_alert(null::uuid)", "select public.notification_claim(1)",
      "select public.ingest_count_rejection('INVALID_ENVELOPE','')"]) await assertPermissionDenied(fixture!.access, statement, true);
  });

  it("next_pending locks one ordered PENDING row, SKIP LOCKED separates two real logins, and commit leaves no reservation", async context => {
    if (!ready(context)) return;
    const first = await request(), second = await request();
    await safeDatabaseOperation("give pending candidates the same deterministic ordering timestamp", () => boundedTransaction(fixture!.owner, tx => tx`
      with stamp as materialized(select clock_timestamp() as at)
      update public.gate_commands c set created_at=stamp.at-interval '1 second',expires_at=stamp.at+interval '10 seconds'
      from stamp where c.id in (${first.id}::uuid,${second.id}::uuid)`));
    const expected = [first.id, second.id].sort();
    const other = await extraAccessClient();
    try {
      await service("hold first restricted pending row", async tx => {
        const rows = await tx`select * from public.access_service_next_pending()`;
        assert.equal(rows.length, 1); assert.equal(rows[0]?.id, expected[0]);
        assert.deepEqual(Object.keys(rows[0]!).sort(), ["id", "building_id", "gateway_id", "gate_id", "device_id", "created_at", "expires_at", "gate_kind"].sort());
        assert.equal(rows[0]?.gate_kind, "GARAGE");
        await safeDatabaseOperation("second real physical connection skips locked candidate", () => boundedTransaction(other, async competing => {
          await competing`set local statement_timeout='2s'`;
          await competing`select pg_advisory_xact_lock_shared(814772,1)`;
          const next = await competing`select * from public.access_service_next_pending()`;
          assert.equal(next.length, 1); assert.equal(next[0]?.id, expected[1]);
          assert.equal((await competing`select * from public.access_service_next_pending()`)[0]?.id, expected[1], "same caller holds a row lock, not a durable claim");
        }));
        assert.equal((await state(first))?.status, "PENDING");
        assert.equal((await state(second))?.status, "PENDING");
        await assert.rejects(safeDatabaseOperation("owner NOWAIT confirms selected command lock", () => boundedTransaction(fixture!.observer, owner => owner`
          select id from public.gate_commands where id=${expected[0]!}::uuid for update nowait`)), codeIs("55P03"));
      });
      await service("pending candidate remains available after commit", async tx => {
        assert.equal((await tx`select * from public.access_service_next_pending()`)[0]?.id, expected[0]);
      });
    } finally {
      await safeDatabaseOperation("close bounded second physical connection", () => other.end({ timeout: 5 }));
    }
  });

  it("expires only overdue PENDING/SENT commands with one derived audit and preserves terminal/live rows", async context => {
    if (!ready(context)) return;
    const pending = await request(), sending = await request(), terminal = await request(), live = await request();
    await safeDatabaseOperation("seed bounded overdue and terminal command states", () => boundedTransaction(fixture!.owner, async tx => {
      await tx`update public.gate_commands set status='SENT',sent_at=clock_timestamp() where id=${sending.id}::uuid`;
      await tx`update public.gate_commands set status='ACKNOWLEDGED',acknowledged_at=clock_timestamp() where id=${terminal.id}::uuid`;
      await tx`update public.gate_commands set created_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second'
        where id in (${pending.id}::uuid,${sending.id}::uuid,${terminal.id}::uuid)`;
    }));
    const terminalBefore = await state(terminal), liveBefore = await state(live);
    const expire = () => service("restricted expiration sweep", async tx => (await tx`select public.access_service_expire_commands() as count`)[0]?.count);
    assert.equal(await expire(), 2);
    for (const command of [pending, sending]) {
      const current = await state(command);
      assert.equal(current?.status, "EXPIRED");
      assert.equal(current?.requested_by, data.actor);
      await derivedAudit(command, "ACCESS_COMMAND_EXPIRED");
    }
    assert.deepEqual(await state(terminal), terminalBefore);
    assert.deepEqual(await state(live), liveBefore);
    assert.equal(await expire(), 0, "expiration is not replayed");
  });

  it("accepts only three pending-failure codes and preserves SENT/terminal states", async context => {
    if (!ready(context)) return;
    for (const code of ["NO_LIVE_CONNECTION", "BEFORE_CONNECTION", "FEATURE_PAUSED"]) {
      const command = await request();
      assert.equal(await failPending(command, code), true);
      const current = await state(command);
      assert.equal(current?.status, "FAILED"); assert.equal(current?.sent_at, null);
      assert.ok(typeof current?.failure_reason === "string" && current.failure_reason.length > 0);
      const audit = await derivedAudit(command, "ACCESS_COMMAND_FAILED");
      assert.equal(audit.metadata.reason, current.failure_reason);
      const before = await audits(command);
      assert.equal(await failPending(command, code), false);
      assert.deepEqual(await audits(command), before);
    }
    const command = await request();
    for (const reason of ["arbitrary driver message with private payload", "DISCONNECTED", "", null])
      await assert.rejects(failPending(command, reason), codeIs("22023"));
    assert.equal((await state(command))?.status, "PENDING");
    assert.equal(await sent(command), null);
    const before = await state(command);
    assert.equal(await failPending(command, "NO_LIVE_CONNECTION"), false);
    assert.deepEqual(await state(command), before);
  });

  it("marks SENT using the persisted requester, preserves caller GUCs and derives its SYSTEM audit", async context => {
    if (!ready(context)) return;
    const command = await request();
    await service("SENT checkpoint derives persisted actor under forged caller context", async tx => {
      await tx`select set_config('app.user_id',${data.admin},true),set_config('app.role','PLATFORM_ADMIN',true)`;
      const [row] = await tx`select public.access_service_mark_sent(${command.id}::uuid) as reason`;
      assert.equal(row?.reason, null);
      const [context] = await tx`select current_setting('app.user_id') as actor,current_setting('app.role') as role`;
      assert.deepEqual(context, { actor: data.admin, role: "PLATFORM_ADMIN" });
    });
    const current = await state(command);
    assert.equal(current?.status, "SENT"); assert.ok(current?.sent_at);
    assert.equal(current?.requested_by, command.requested_by);
    assert.equal(current?.failure_reason, null);
    await derivedAudit(command, "ACCESS_COMMAND_SENT");
    const before = await state(command), beforeAudit = await audits(command);
    assert.ok(typeof await sent(command) === "string", "repeat SENT does not create a new send decision");
    assert.deepEqual(await state(command), before); assert.deepEqual(await audits(command), beforeAudit);
  });

  it("refuses and atomically fails a still-PENDING request after its scoped capability is revoked before SENT", async context => {
    if (!ready(context)) return;
    const command = await request();
    await safeDatabaseOperation("revoke persisted command actor scoped binding", () => boundedTransaction(fixture!.owner, tx => tx`
      update public.role_bindings set active=false where user_id=${data.actor} and resource_type='gate' and resource_id=${command.gate_id}`));
    const reason = await service("fresh capability refusal ignores forged administrator GUC", async tx => {
      await tx`select set_config('app.user_id',${data.admin},true),set_config('app.role','PLATFORM_ADMIN',true)`;
      return (await tx`select public.access_service_mark_sent(${command.id}::uuid) as reason`)[0]?.reason;
    });
    assert.ok(typeof reason === "string" && reason.length > 0);
    const current = await state(command);
    assert.equal(current?.status, "FAILED"); assert.equal(current?.sent_at, null);
    assert.equal(current?.failure_reason, reason);
    await derivedAudit(command, "ACCESS_COMMAND_FAILED");
    assert.equal((await audits(command)).filter(row => row.action === "ACCESS_COMMAND_SENT").length, 0);
  });

  it("accepts only six publish-failure codes for SENT and persists closed public reasons", async context => {
    if (!ready(context)) return;
    for (const code of ["DISCONNECTED", "OFFLINE_QUEUE", "DEADLINE", "BEFORE_CONNECTION", "SEND_TIMEOUT", "PUBLISH_FAILURE"]) {
      const command = await request();
      assert.equal(await sent(command), null);
      assert.equal(await failPublish(command, code), true);
      const current = await state(command);
      assert.equal(current?.status, "FAILED"); assert.ok(current?.sent_at);
      assert.ok(typeof current?.failure_reason === "string" && current.failure_reason.length > 0);
      const audit = await derivedAudit(command, "ACCESS_COMMAND_FAILED");
      assert.equal(audit.metadata.reason, current.failure_reason);
      const before = await state(command), beforeAudit = await audits(command);
      assert.equal(await failPublish(command, code), false);
      assert.deepEqual(await state(command), before); assert.deepEqual(await audits(command), beforeAudit);
    }
    const pending = await request();
    assert.equal(await failPublish(pending, "DISCONNECTED"), false);
    for (const code of ["private arbitrary publisher exception", "FEATURE_PAUSED", "", null])
      await assert.rejects(failPublish(pending, code), codeIs("22023"));
    assert.equal((await state(pending))?.status, "PENDING");
  });

  for (const result of ["EXECUTED", "REJECTED"] as const) {
    it(`applies ${result} only to a correlated SENT command and derives its audit without renewed human authorization`, async context => {
      if (!ready(context)) return;
      const command = await request();
      assert.equal(await sent(command), null);
      await safeDatabaseOperation("revoke human grant only after the physical SENT checkpoint", () => boundedTransaction(fixture!.owner, tx => tx`
        update public.role_bindings set active=false where user_id=${data.actor} and resource_type='gate' and resource_id=${command.gate_id}`));
      assert.equal(await service("correlated restricted physical ACK", async tx => {
        await tx`select set_config('app.user_id',${data.admin},true),set_config('app.role','PLATFORM_ADMIN',true)`;
        return ack(tx, command, result);
      }), true);
      const current = await state(command);
      assert.equal(current?.status, result === "EXECUTED" ? "ACKNOWLEDGED" : "FAILED");
      assert.ok(current?.acknowledged_at); assert.equal(current?.requested_by, data.actor);
      assert.equal(current?.failure_reason, result === "EXECUTED" ? null : "Abertura recusada pelo controlador");
      await derivedAudit(command, result === "EXECUTED" ? "ACCESS_COMMAND_ACKNOWLEDGED" : "ACCESS_COMMAND_REJECTED");
      const before = await state(command), beforeAudit = await audits(command);
      assert.equal(await service("duplicate physical ACK has no effect", tx => ack(tx, command, result)), false);
      assert.deepEqual(await state(command), before); assert.deepEqual(await audits(command), beforeAudit);
      assert.equal(await failPublish(command, "PUBLISH_FAILURE"), false, "a result that won the race cannot be overwritten by a later publisher failure");
      assert.deepEqual(await state(command), before); assert.deepEqual(await audits(command), beforeAudit);
    });
  }

  it("closes malformed/foreign/PENDING/terminal/expired ACK paths without effects and rejects unknown result codes", async context => {
    if (!ready(context)) return;
    const command = await request();
    assert.equal(await service("PENDING command is not a physical ACK target", tx => ack(tx, command)), false);
    assert.equal(await sent(command), null);
    const before = await state(command), beforeAudit = await audits(command);
    for (const override of [{ id: randomUUID() }, { building: data.otherBuilding }, { gateway: data.otherGateway },
      { gate: "not-a-uuid" }, { gate: randomUUID() }, { device: data.foreignDevice }]) {
      assert.equal(await service("foreign or malformed ACK target has no effect", tx => ack(tx, command, "EXECUTED", override)), false);
      assert.deepEqual(await state(command), before); assert.deepEqual(await audits(command), beforeAudit);
    }
    for (const result of ["UNKNOWN", "", "EXECUTED with private payload"])
      await assert.rejects(service("unknown physical ACK result code rejected", tx => ack(tx, command, result)), codeIs("22023"));
    await safeDatabaseOperation("disable ACK gateway after SENT", () => boundedTransaction(fixture!.owner, tx => tx`update public.gateways set enabled=false where id=${command.gateway_id}`));
    try {
      assert.equal(await service("disabled gateway cannot confirm a physical ACK", tx => ack(tx, command)), false);
      assert.deepEqual(await state(command), before); assert.deepEqual(await audits(command), beforeAudit);
    } finally {
      await safeDatabaseOperation("restore ACK gateway", () => boundedTransaction(fixture!.owner, tx => tx`update public.gateways set enabled=true where id=${command.gateway_id}`));
    }
    for (const status of ["FAILED", "EXPIRED", "ACKNOWLEDGED"]) {
      await safeDatabaseOperation("seed terminal ACK negative control", () => boundedTransaction(fixture!.owner, tx => tx`
        update public.gate_commands set status=${status} where id=${command.id}::uuid`));
      const terminalBefore = await state(command), auditBefore = await audits(command);
      assert.equal(await service("terminal ACK target has no effect", tx => ack(tx, command)), false);
      assert.deepEqual(await state(command), terminalBefore); assert.deepEqual(await audits(command), auditBefore);
    }
    await safeDatabaseOperation("seed already-expired SENT ACK negative control", () => boundedTransaction(fixture!.owner, tx => tx`
      update public.gate_commands set status='SENT',created_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second'
      where id=${command.id}::uuid`));
    const expiredBefore = await state(command), expiredAudit = await audits(command);
    assert.equal(await service("expired SENT ACK target has no effect", tx => ack(tx, command)), false);
    assert.deepEqual(await state(command), expiredBefore); assert.deepEqual(await audits(command), expiredAudit);
  });

  it("rechecks the ACK deadline after a specific held parent lock and commits no success audit after expiry", async context => {
    if (!ready(context)) return;
    const command = await request();
    assert.equal(await sent(command), null);
    const worker = await extraAccessClient();
    let operation: Promise<unknown> | undefined;
    try {
      const [identity] = await safeDatabaseOperation("identify actual restricted ACK backend", () => boundedTransaction(worker, tx => tx`select pg_backend_pid() as pid`));
      const [timing] = await safeDatabaseOperation("set bounded ACK deadline after the worker is authenticated", () => boundedTransaction(fixture!.owner, tx => tx`
        with stamp as materialized(select clock_timestamp() as at)
        update public.gate_commands c set created_at=stamp.at-interval '1 second',expires_at=stamp.at+interval '1 second'
        from stamp where c.id=${command.id}::uuid returning expires_at`));
      assert.ok(timing?.expires_at);
      const before = await state(command), beforeAudit = await audits(command);
      await safeDatabaseOperation("hold specific physical parent until ACK deadline passes", () => boundedTransaction(fixture!.owner, async owner => {
        const [blocker] = await owner`select pg_backend_pid() as pid`;
        await owner`select id from public.devices where id=${command.device_id} for update`;
        operation = safeDatabaseOperation("restricted ACK waits on real locked parent", () => boundedTransaction(worker, async tx => {
          await tx`select pg_advisory_xact_lock_shared(814772,1)`;
          return ack(tx, command);
        }));
        // Attach rejection handling immediately while the owner holds its barrier.
        void operation.catch(() => {});
        await waitForDatabaseBlock(fixture!.observer, identity!.pid, blocker!.pid);
        await waitForDatabaseDeadline(fixture!.observer, new Date(timing.expires_at));
      }));
      assert.equal(await operation, false);
      assert.deepEqual(await state(command), before, "expired ACK changes neither state nor timestamps after its parent wait");
      assert.deepEqual(await audits(command), beforeAudit, "expired ACK commits no success audit");
    } finally {
      // The owner transaction has ended before waiting or closing the worker.
      if (operation) await operation.catch(() => {});
      await safeDatabaseOperation("close bounded ACK worker connection", () => worker.end({ timeout: 5 }));
    }
  });

  it("rolls back ACK state and audit together when a controlled writer skips or rewrites persistence", async context => {
    if (!ready(context)) return;
    for (const [table, body] of [
      ["gate_commands", "IF OLD.status='SENT' AND NEW.status='ACKNOWLEDGED' THEN RETURN NULL; END IF; RETURN NEW;"],
      ["gate_commands", "IF OLD.status='SENT' AND NEW.status='ACKNOWLEDGED' THEN NEW.acknowledged_at:=NEW.acknowledged_at+interval '1 second'; END IF; RETURN NEW;"],
      ["audit_logs", "IF NEW.action='ACCESS_COMMAND_ACKNOWLEDGED' THEN RETURN NULL; END IF; RETURN NEW;"],
      ["audit_logs", "IF NEW.action='ACCESS_COMMAND_ACKNOWLEDGED' THEN NEW.actor_type:='USER'; NEW.user_id:=NULL; NEW.resource_type:='parking'; NEW.metadata:='{}'::jsonb; END IF; RETURN NEW;"],
    ] as const) {
      const command = await request();
      assert.equal(await sent(command), null);
      const before = await state(command), beforeAudit = await audits(command);
      const [auditCountBefore] = await safeDatabaseOperation("count ACK audits independently of rewritable metadata", () => boundedTransaction(fixture!.observer, tx => tx`
        select count(*)::int as total from public.audit_logs where resource_id=${command.gate_id}`));
      await withRuntimeOwnerTrigger(fixture!.owner, table, "before", table === "gate_commands" ? "update" : "insert", body, async () => {
        await assert.rejects(service("physical ACK persistence interference", tx => ack(tx, command)), codeIs("40001"));
      });
      assert.deepEqual(await state(command), before); assert.deepEqual(await audits(command), beforeAudit);
      const [auditCountAfter] = await safeDatabaseOperation("confirm ACK interference rolled back every audit", () => boundedTransaction(fixture!.observer, tx => tx`
        select count(*)::int as total from public.audit_logs where resource_id=${command.gate_id}`));
      assert.equal(auditCountAfter?.total, auditCountBefore?.total);
    }
  });

  it("private physical helpers reject owner disguises and opposite-service execution despite forged human GUCs", async context => {
    if (!ready(context)) return;
    await safeDatabaseOperation("physical identity before private helper guard negatives", () => verifyRestrictedDatabaseRole(fixture!.access, "predioon_access_service"));
    for (const disguise of ["set local role predioon_access_service", "set local session authorization predioon_access_service"]) {
      for (const statement of ["select public.access_service_next_pending()", "select public.access_service_expire_commands()",
        "select public.access_service_fail_pending(null::uuid,'NO_LIVE_CONNECTION')",
        "select public.access_service_mark_sent(null::uuid)", "select public.access_service_fail_publish(null::uuid,'DISCONNECTED')",
        "select public.access_service_apply_ack(null::uuid,null::text,null::text,null::text,null::text,'EXECUTED')"]) {
        await assert.rejects(safeDatabaseOperation("owner disguise cannot invoke any authenticated physical helper", () => boundedTransaction(fixture!.owner, async tx => {
          await tx.unsafe(disguise);
          await tx`select set_config('app.user_id',${data.admin},true),set_config('app.role','PLATFORM_ADMIN',true)`;
          await tx.unsafe(statement);
        })), codeIs("42501"));
      }
    }
    await safeDatabaseOperation("opposite observational real-login positive control", () => verifyRestrictedDatabaseRole(fixture!.ingest, "predioon_ingest"));
    await assertPermissionDenied(fixture!.ingest, "select public.access_service_next_pending()", true);
    await assertPermissionDenied(fixture!.access, "select public.service_runtime_guard('predioon_access_service'::name)", true);
  });
});
