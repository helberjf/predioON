import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { appSqlClient, closeAppDb, withUserContext } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { pgErrorCode } from "../src/http/errors.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

type Rule = { id: string; version: number; enabled: boolean; publishedVersion: number | null; latestVersion: number; ordersCreated: number; [key: string]: unknown };

describe("automations open work orders from alerts through published versions only", () => {
  const suffix = randomUUID(), org = `auto-org-${suffix}`, building = `auto-a-${suffix}`, other = `auto-b-${suffix}`;
  const people = Object.fromEntries(["manager", "technician", "resident", "stranger"].map(kind => [kind, `auto-${kind}-${suffix}`])) as
    Record<"manager" | "technician" | "resident" | "stranger", string>;
  const tokens = {} as Record<keyof typeof people, string>;
  const device = `auto-dev-${suffix}`, otherDevice = `auto-dev2-${suffix}`, foreignDevice = `auto-dev-foreign-${suffix}`;
  let server: TestServer, teamId: string, assetId: string;

  const api = (path: string, who: keyof typeof people, method = "GET", body?: unknown) => call(server.url, `/v1/automations${path}`, { method, body, token: tokens[who] });
  async function ok<T = Rule>(path: string, who: keyof typeof people, method = "GET", body?: unknown, status = 200): Promise<T> {
    const response = await api(path, who, method, body);
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data as T;
  }
  const definition = (extra: object = {}) => ({ alertTypes: ["PUMP_CONTINUOUS_LIMIT"], minSeverity: "HIGH", orderTitle: "Verificar bomba", orderPriority: "URGENT", cooldownMinutes: 60, ...extra });
  const create = (extra: object = {}, label = "Bomba em funcionamento contínuo") => ok("", "manager", "POST", { buildingId: building, name: label, definition: definition(extra) }, 201);
  /** Publishes version 1 and enables the rule, as a manager would. */
  async function live(extra: object = {}, label?: string): Promise<Rule> {
    const rule = await create(extra, label);
    const published = await ok(`/${rule.id}/publish`, "manager", "POST", { version: rule.version, number: 1 });
    return ok(`/${rule.id}/state`, "manager", "POST", { version: published.version, enabled: true });
  }
  /** Alerts are stored by the ingestion service on the owner connection, outside any user context. */
  const alert = async (extra: { type?: string; severity?: string; deviceId?: string | null; target?: string; status?: string } = {}) => (await sqlClient`
    insert into alerts(building_id,device_id,severity,type,status,message) values(${extra.target ?? building},${extra.deviceId === undefined ? device : extra.deviceId},
      ${extra.severity ?? "HIGH"},${extra.type ?? "PUMP_CONTINUOUS_LIMIT"},${extra.status ?? "OPEN"},'Bomba ligada há 4 horas') returning id`)[0]!.id as string;
  const runs = async (ruleId: string) => (await sqlClient`select alert_id,outcome,work_order_id,version_number from automation_runs where automation_id=${ruleId} order by created_at`).map(row => ({ ...row }));
  const orders = async () => (await sqlClient`select id,title,priority,status,assigned_team_id,asset_id,created_by,description from work_orders where building_id=${building} order by created_at`).map(row => ({ ...row }));

  before(async () => {
    const password = await hashPassword("predioon123");
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Automation fixture',${org})`;
    for (const id of [building, other]) await sqlClient`insert into buildings(id,organization_id,name,code) values(${id},${org},${id},${id})`;
    for (const id of Object.values(people)) await sqlClient`insert into users(id,name,email,password_hash) values(${id},${id},${`${id}@test.local`},${password})`;
    await sqlClient`insert into memberships(user_id,building_id,role) values (${people.manager},${building},'BUILDING_ADMIN'),(${people.resident},${building},'RESIDENT'),(${people.stranger},${other},'BUILDING_ADMIN')`;
    await sqlClient`insert into role_bindings(building_id,user_id,role_key,granted_by,reason) values(${building},${people.technician},'MAINTENANCE',${people.manager},'Equipe contratada')`;
    await sqlClient`insert into devices(id,building_id,name,type) values(${device},${building},'Bomba 1','PUMP'),(${otherDevice},${building},'Bomba 2','PUMP'),(${foreignDevice},${other},'Foreign','PUMP')`;
    teamId = (await sqlClient`insert into teams(building_id,name) values(${building},'Manutenção') returning id`)[0]!.id;
    assetId = (await sqlClient`insert into assets(building_id,name,created_by) values(${building},'Bomba de recalque',${people.manager}) returning id`)[0]!.id;
    server = await startTestServer();
    for (const [kind, id] of Object.entries(people)) tokens[kind as keyof typeof people] = (await login(server.url, `${id}@test.local`)).accessToken;
  });
  after(async () => {
    await server?.close();
    await sqlClient`delete from audit_logs where building_id in (${building},${other})`;
    await sqlClient`delete from buildings where id in (${building},${other})`;
    await sqlClient`delete from users where id in ${sqlClient(Object.values(people))}`;
    await sqlClient`delete from organizations where id=${org}`;
    await closeAppDb(); await sqlClient.end();
  });

  it("starts disabled, versions are immutable and numbered, and only a published version can be enabled", async () => {
    const rule = await create({ assignedTeamId: teamId, assetId, deviceId: device });
    assert.deepEqual({ enabled: rule.enabled, published: rule.publishedVersion, latest: rule.latestVersion, version: rule.version }, { enabled: false, published: null, latest: 1, version: 1 });
    assert.equal((await api(`/${rule.id}/state`, "manager", "POST", { version: 1, enabled: true })).status, 409, "nothing is published yet");
    await alert();
    assert.deepEqual(await runs(rule.id), [], "an unpublished, disabled rule ignores alerts");
    const second = await ok(`/${rule.id}/versions`, "manager", "POST", { version: 1, definition: definition({ orderTitle: "Verificar bomba e quadro", cooldownMinutes: 0 }) }, 201);
    assert.deepEqual({ latest: second.latestVersion, version: second.version, published: second.publishedVersion }, { latest: 2, version: 2, published: null });
    assert.equal((await api(`/${rule.id}/versions`, "manager", "POST", { version: 1, definition: definition() })).status, 409, "stale editor");
    assert.equal((await api(`/${rule.id}/publish`, "manager", "POST", { version: 2, number: 9 })).status, 400, "unknown version");
    const published = await ok(`/${rule.id}/publish`, "manager", "POST", { version: 2, number: 2 });
    const enabled = await ok(`/${rule.id}/state`, "manager", "POST", { version: published.version, enabled: true });
    assert.deepEqual({ enabled: enabled.enabled, published: enabled.publishedVersion }, { enabled: true, published: 2 });
    const detail = await ok<Rule & { versions: Array<{ number: number; orderTitle: string; alertTypes: string[]; createdAt: string }> }>(`/${rule.id}`, "technician");
    assert.deepEqual(detail.versions.map(item => [item.number, item.orderTitle]), [[2, "Verificar bomba e quadro"], [1, "Verificar bomba"]]);
    assert.equal(new Date(detail.versions[0]!.createdAt).toISOString(), detail.versions[0]!.createdAt);
    assert.deepEqual((await sqlClient`select action,user_id from audit_logs where resource_id=${rule.id} order by created_at`).map(row => row.action),
      ["AUTOMATION_CREATED", "AUTOMATION_VERSION_ADDED", "AUTOMATION_PUBLISHED", "AUTOMATION_ENABLED"]);
    await ok(`/${rule.id}/state`, "manager", "POST", { version: enabled.version, enabled: false });
  });

  it("opens exactly one work order per matching alert, honours the cooldown and ignores what does not match", async () => {
    const rule = await live({ assignedTeamId: teamId, assetId, deviceId: device });
    const before = (await orders()).length;
    for (const miss of [{ type: "WATER_LEAK" }, { severity: "MEDIUM" }, { deviceId: otherDevice }, { deviceId: null }, { status: "RESOLVED" }]) await alert(miss);
    assert.deepEqual(await runs(rule.id), []);
    const first = await alert({ severity: "CRITICAL" });
    const created = (await orders()).slice(before);
    assert.deepEqual(created.map(order => ({ ...order, id: null })), [{ id: null, title: "Verificar bomba", priority: "URGENT", status: "OPEN", assigned_team_id: teamId, asset_id: assetId,
      created_by: people.manager, description: "Bomba ligada há 4 horas" }]);
    assert.deepEqual(await runs(rule.id), [{ alert_id: first, outcome: "CREATED", work_order_id: created[0]!.id, version_number: 1 }]);
    const [event] = await sqlClient`select actor_id,kind,note from work_order_events where work_order_id=${created[0]!.id}`;
    assert.deepEqual({ ...event }, { actor_id: null, kind: "CREATED", note: "Aberta pela automação Bomba em funcionamento contínuo" });
    const second = await alert();
    assert.deepEqual((await runs(rule.id)).map(run => [run.alert_id, run.outcome, run.work_order_id]), [[first, "CREATED", created[0]!.id], [second, "SKIPPED_COOLDOWN", null]]);
    assert.equal((await orders()).length, before + 1);
    // The manager sees the order like any other and the technician through the team.
    const listed = await (await call(server.url, `/v1/work-orders?buildingId=${building}&limit=100`, { token: tokens.manager })).json() as { items: Array<{ id: string }> };
    assert.ok(listed.items.some(item => item.id === created[0]!.id));
    const summary = await ok<{ items: Rule[] }>(`?buildingId=${building}`, "manager");
    assert.equal(summary.items.find(item => item.id === rule.id)?.ordersCreated, 1);
    await ok(`/${rule.id}/state`, "manager", "POST", { version: rule.version, enabled: false });
    await alert();
    assert.equal((await runs(rule.id)).length, 2, "a disabled rule stops reacting");
  });

  it("never loses the alert when an automation fails, and records the failure", async () => {
    const rule = await live({ cooldownMinutes: 0 }, "Falha isolada");
    const healthy = await live({ cooldownMinutes: 0, orderTitle: "Outra automação" }, "Automação saudável");
    const name = `auto_fail_${randomUUID().replaceAll("-", "")}`;
    try {
      await sqlClient.unsafe(`create function ${name}() returns trigger language plpgsql as $$ begin
        if new.title='Verificar bomba' then raise exception 'Fixture work order failure'; end if; return new; end $$`);
      await sqlClient.unsafe(`create trigger ${name} before insert on work_orders for each row execute function ${name}()`);
      const stored = await alert();
      assert.equal((await sqlClient`select status from alerts where id=${stored}`)[0]!.status, "OPEN");
      assert.deepEqual((await runs(rule.id)).map(run => [run.outcome, run.work_order_id]), [["FAILED", null]]);
      assert.deepEqual((await runs(healthy.id)).map(run => run.outcome), ["CREATED"], "one failing rule does not stop the others");
    } finally {
      await sqlClient.unsafe(`drop trigger if exists ${name} on work_orders`);
      await sqlClient.unsafe(`drop function if exists ${name}()`);
    }
    for (const item of [rule, healthy]) await ok(`/${item.id}/state`, "manager", "POST", { version: item.version, enabled: false });
  });

  it("simulates against recent alerts without creating anything", async () => {
    const rule = await create({ alertTypes: [], minSeverity: "CRITICAL", deviceId: device });
    const critical = await alert({ severity: "CRITICAL", type: "WATER_LEAK" });
    await alert({ severity: "HIGH" });
    const before = (await orders()).length;
    const result = await ok<{ number: number; matches: Array<{ alertId: string; type: string; severity: string; triggeredAt: string }> }>(`/${rule.id}/simulate`, "manager", "POST", { number: 1 });
    assert.ok(result.matches.some(match => match.alertId === critical) && result.matches.every(match => match.severity === "CRITICAL"));
    assert.equal(new Date(result.matches[0]!.triggeredAt).toISOString(), result.matches[0]!.triggeredAt);
    assert.equal((await orders()).length, before);
    assert.deepEqual(await runs(rule.id), []);
    assert.equal((await api(`/${rule.id}/simulate`, "manager", "POST", { number: 7 })).status, 404);
    assert.equal((await api(`/${rule.id}/simulate`, "technician", "POST", { number: 1 })).status, 200, "readers may simulate");
  });

  it("refuses readers, strangers, foreign targets and anything beyond opening a work order", async () => {
    const rule = await create();
    const body = { buildingId: building, name: "Recusada", definition: definition() };
    assert.equal((await api("", "technician", "POST", body)).status, 403);
    assert.equal((await api(`/${rule.id}/publish`, "technician", "POST", { version: 1, number: 1 })).status, 403);
    assert.equal((await api(`/${rule.id}/versions`, "technician", "POST", { version: 1, definition: definition() })).status, 403);
    assert.equal((await api(`?buildingId=${building}`, "technician")).status, 200);
    for (const who of ["resident", "stranger"] as const) {
      assert.equal((await api(`?buildingId=${building}`, who)).status, 403, who);
      assert.equal((await api(`/${rule.id}`, who)).status, 404, who);
    }
    assert.equal((await api("", "manager", "POST", { ...body, buildingId: other })).status, 403);
    const [foreignTeam] = await sqlClient`insert into teams(building_id,name) values(${other},'Foreign') returning id`;
    for (const [extra, status] of [[{ deviceId: foreignDevice }, 400], [{ assignedTeamId: foreignTeam!.id }, 400], [{ assetId: randomUUID() }, 400],
      [{ orderTitle: " " }, 400], [{ cooldownMinutes: -1 }, 400], [{ minSeverity: "EXTREME" }, 400], [{ action: "OPEN_GATE" }, 400], [{ command: { gateId: "g1" } }, 400]] as const) {
      assert.equal((await api("", "manager", "POST", { ...body, definition: definition(extra) })).status, status, JSON.stringify(extra));
    }
    assert.equal((await api("", "manager", "POST", { ...body, enabled: true })).status, 400);
  });

  it("keeps versions immutable and the runs read-only at the SQL boundary", async () => {
    const rule = await live();
    const as = <T>(who: keyof typeof people, role: "BUILDING_ADMIN" | "RESIDENT", run: Parameters<typeof withUserContext<T>>[1]) => withUserContext({ userId: people[who], role }, run);
    const refused = (promise: Promise<unknown>, code = "42501") => assert.rejects(promise, error => pgErrorCode(error) === code);
    assert.equal((await as("resident", "RESIDENT", tx => tx.execute(sql`select id from automation_rules`))).length, 0);
    assert.equal((await appSqlClient`select id from automation_rules`).length, 0);
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`update automation_versions set order_title='Rewritten' where automation_id=${rule.id}`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`delete from automation_versions where automation_id=${rule.id}`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`insert into automation_runs(automation_id,building_id,version_number,alert_id,outcome) values(${rule.id},${building},1,${randomUUID()},'CREATED')`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`delete from automation_rules where id=${rule.id}`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`insert into automation_rules(building_id,name,created_by,enabled) values(${building},'Forged',${people.manager},true)`)));
    await refused(as("technician", "RESIDENT", tx => tx.execute(sql`insert into automation_rules(building_id,name,created_by) values(${building},'Forged',${people.technician})`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`update automation_rules set enabled=false where id=${rule.id}`)), "P0409");
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`update automation_rules set version=version+1, published_version=5 where id=${rule.id}`)), "23514");
    await refused(sqlClient`update automation_versions set order_title='Owner rewrite' where automation_id=${rule.id}`, "42501");
    await refused(sqlClient`update automation_versions set assigned_team_id=${teamId} where automation_id=${rule.id}`, "42501");
    assert.equal((await as("technician", "RESIDENT", tx => tx.execute(sql`update automation_rules set version=version+1, enabled=false where id=${rule.id} returning id`))).length, 0);
    assert.equal((await sqlClient`select enabled from automation_rules where id=${rule.id}`)[0]!.enabled, true);
    await ok(`/${rule.id}/state`, "manager", "POST", { version: rule.version, enabled: false });
  });

  it("clears a removed team from published versions and still lets the condominium be deleted", async () => {
    const [team] = await sqlClient`insert into teams(building_id,name) values(${building},'Equipe temporária') returning id`;
    const rule = await create({ assignedTeamId: team!.id });
    await sqlClient`delete from teams where id=${team!.id}`;
    assert.equal((await sqlClient`select assigned_team_id from automation_versions where automation_id=${rule.id}`)[0]!.assigned_team_id, null);
    const doomed = `auto-doomed-${suffix}`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${doomed},${org},${doomed},${doomed})`;
    await sqlClient`insert into automation_rules(id,building_id,name,created_by) values(gen_random_uuid(),${doomed},'Doomed',${people.manager})`;
    await sqlClient`insert into automation_versions(automation_id,building_id,number,order_title,created_by)
      select id,building_id,1,'Doomed',${people.manager} from automation_rules where building_id=${doomed}`;
    await sqlClient`delete from buildings where id=${doomed}`;
    assert.equal((await sqlClient`select 1 from automation_versions where building_id=${doomed}`).length, 0);
  });

  it("reapplies 045 without changing functions, policies or grants", async () => {
    // 057 redefines the guard and the matcher; migrations run in order, so 045 is reapplied followed by it.
    const migration = (await Promise.all(["045-automations.sql", "057-automation-schedules.sql"].map(file =>
      readFile(new URL(`../../../infrastructure/${file}`, import.meta.url), "utf8")))).join(";\n");
    const rollback = new Error("045 reapplication rollback");
    await assert.rejects(sqlClient.begin(async owner => {
      const invariant = async () => ({
        functions: await owner`select p.oid::regprocedure::text as signature,p.prosrc,p.proacl::text,p.proowner,p.proconfig,p.prosecdef
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by signature`,
        policies: await owner`select * from pg_policies where schemaname='public' order by tablename,policyname`,
        tables: await owner`select c.relname,c.relrowsecurity,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname`,
        triggers: await owner`select tgrelid::regclass::text as relation,tgname,tgtype,tgfoid::regproc::text as fn from pg_trigger where not tgisinternal order by 1,2`,
      });
      const before = await invariant();
      await owner.unsafe(migration);
      assert.deepEqual(await invariant(), before);
      throw rollback;
    }), error => error === rollback);
  });
});
