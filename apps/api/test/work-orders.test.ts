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

type Order = { id: string; status: string; version: number; assignedUserId: string | null; assignedTeamId: string | null; assignedToMe: boolean; [key: string]: unknown };

describe("work orders are distributed by managers and executed by their assignees", () => {
  const suffix = randomUUID(), org = `wo-org-${suffix}`, building = `wo-a-${suffix}`, other = `wo-b-${suffix}`;
  const people = Object.fromEntries(["manager", "worker", "teammate", "idle", "resident", "stranger"].map(kind => [kind, `wo-${kind}-${suffix}`])) as
    Record<"manager" | "worker" | "teammate" | "idle" | "resident" | "stranger", string>;
  const tokens = {} as Record<keyof typeof people, string>;
  let server: TestServer, teamId: string, foreignTeamId: string, foreignOrderId: string;

  const api = (path: string, who: keyof typeof people, method = "GET", body?: unknown) => call(server.url, `/v1/work-orders${path}`, { method, body, token: tokens[who] });
  async function ok<T = Order>(path: string, who: keyof typeof people, method = "GET", body?: unknown, status = 200): Promise<T> {
    const response = await api(path, who, method, body);
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    assert.equal(response.status, status, JSON.stringify(data));
    return data as T;
  }
  const create = (extra: object = {}) => ok("", "manager", "POST", { buildingId: building, title: "Trocar lâmpada da garagem", ...extra }, 201);
  const audits = async (id: string) => (await sqlClient`select action,user_id from audit_logs where resource_id=${id} and resource_type='work_order' order by created_at`).map(row => `${row.action}:${row.user_id}`);

  before(async () => {
    const password = await hashPassword("predioon123");
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Work order fixture',${org})`;
    for (const id of [building, other]) await sqlClient`insert into buildings(id,organization_id,name,code) values(${id},${org},${id},${id})`;
    for (const id of Object.values(people)) await sqlClient`insert into users(id,name,email,password_hash) values(${id},${id},${`${id}@test.local`},${password})`;
    await sqlClient`insert into memberships(user_id,building_id,role) values (${people.manager},${building},'BUILDING_ADMIN'),(${people.resident},${building},'RESIDENT'),(${people.stranger},${other},'BUILDING_ADMIN')`;
    teamId = (await sqlClient`insert into teams(building_id,name) values(${building},'Manutenção') returning id`)[0]!.id;
    foreignTeamId = (await sqlClient`insert into teams(building_id,name) values(${other},'Foreign') returning id`)[0]!.id;
    for (const id of [people.worker, people.teammate, people.idle]) {
      await sqlClient`insert into role_bindings(building_id,user_id,role_key,granted_by,reason) values(${building},${id},'MAINTENANCE',${people.manager},'Equipe contratada')`;
    }
    await sqlClient`insert into team_members(building_id,team_id,user_id) values(${building},${teamId},${people.worker}),(${building},${teamId},${people.teammate})`;
    foreignOrderId = (await sqlClient`insert into work_orders(building_id,title,created_by) values(${other},'Foreign order',${people.stranger}) returning id`)[0]!.id;
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

  it("creates, edits and assigns with history, audit and optimistic concurrency", async () => {
    const order = await create({ description: "Setor B", priority: "HIGH", dueAt: "2026-12-01T12:00:00.000Z" });
    assert.deepEqual({ status: order.status, version: order.version, priority: order.priority, createdBy: order.createdBy, assignedToMe: order.assignedToMe, startedAt: order.startedAt, closedAt: order.closedAt },
      { status: "OPEN", version: 1, priority: "HIGH", createdBy: people.manager, assignedToMe: false, startedAt: null, closedAt: null });
    // Strict ISO-8601: the mobile JavaScript engine rejects PostgreSQL's text format.
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    assert.equal(order.dueAt, "2026-12-01T12:00:00.000Z");
    for (const key of ["createdAt", "updatedAt"]) assert.match(String(order[key]), iso, key);
    const edited = await ok(`/${order.id}`, "manager", "PATCH", { version: 1, title: "Trocar lâmpadas", assignedTeamId: teamId });
    assert.deepEqual({ title: edited.title, team: edited.assignedTeamId, user: edited.assignedUserId, version: edited.version }, { title: "Trocar lâmpadas", team: teamId, user: null, version: 2 });
    assert.equal((await api(`/${order.id}`, "manager", "PATCH", { version: 1, priority: "LOW" })).status, 409, "stale version");
    const personal = await ok(`/${order.id}`, "manager", "PATCH", { version: 2, assignedUserId: people.worker });
    assert.deepEqual({ team: personal.assignedTeamId, user: personal.assignedUserId }, { team: null, user: people.worker }, "choosing a person clears the team");
    const cleared = await ok(`/${order.id}`, "manager", "PATCH", { version: 3, assignedUserId: null, dueAt: null });
    assert.deepEqual({ team: cleared.assignedTeamId, user: cleared.assignedUserId, dueAt: cleared.dueAt }, { team: null, user: null, dueAt: null });
    const detail = await ok<Order & { events: Array<{ kind: string; actorId: string; createdAt: string }> }>(`/${order.id}`, "manager");
    assert.ok(detail.events.every(event => iso.test(event.createdAt)));
    assert.deepEqual(detail.events.map(event => `${event.kind}:${event.actorId}`), ["CREATED", "ASSIGNED", "ASSIGNED", "ASSIGNED"].map(kind => `${kind}:${people.manager}`));
    assert.deepEqual(await audits(order.id), ["WORK_ORDER_CREATED", "WORK_ORDER_UPDATED", "WORK_ORDER_UPDATED", "WORK_ORDER_UPDATED"].map(action => `${action}:${people.manager}`));
  });

  it("shows executors only their own and their team's orders", async () => {
    const mine = await create({ title: "Do executor", assignedUserId: people.worker });
    const teams = await create({ title: "Da equipe", assignedTeamId: teamId });
    const idle = await create({ title: "De outra pessoa", assignedUserId: people.idle });
    const unassigned = await create({ title: "Sem responsável" });
    const seen = async (who: keyof typeof people) => (await ok<{ items: Order[]; canDistribute: boolean }>(`?buildingId=${building}&limit=100`, who));
    const worker = await seen("worker");
    assert.equal(worker.canDistribute, false);
    assert.deepEqual(worker.items.map(order => order.id).sort(), [mine.id, teams.id].sort());
    assert.ok(worker.items.every(order => order.assignedToMe));
    assert.deepEqual((await seen("teammate")).items.map(order => order.id), [teams.id]);
    assert.deepEqual((await seen("idle")).items.map(order => order.id), [idle.id]);
    const manager = await seen("manager");
    assert.equal(manager.canDistribute, true);
    for (const order of [mine, teams, idle, unassigned]) assert.ok(manager.items.some(item => item.id === order.id));
    assert.ok(!manager.items.some(item => item.id === foreignOrderId));
    assert.equal((await api(`?buildingId=${building}`, "resident")).status, 403);
    assert.equal((await api(`?buildingId=${building}`, "stranger")).status, 403);
    assert.equal((await api(`?buildingId=${other}`, "manager")).status, 403);
    for (const who of ["teammate", "resident", "stranger"] as const) assert.equal((await api(`/${mine.id}`, who)).status, 404, who);
    assert.equal((await api(`/${foreignOrderId}`, "manager")).status, 404);
    assert.equal((await api("/not-a-uuid", "manager")).status, 404);
    const page = await ok<{ items: Order[]; nextCursor: string | null }>(`?buildingId=${building}&limit=2`, "manager");
    assert.equal(page.items.length, 2);
    const next = await ok<{ items: Order[] }>(`?buildingId=${building}&limit=100&after=${page.nextCursor}`, "manager");
    assert.ok(next.items.length > 0 && !next.items.some(item => page.items.some(first => first.id === item.id)));
    const open = await ok<{ items: Order[] }>(`?buildingId=${building}&status=DONE`, "manager");
    assert.deepEqual(open.items, []);
  });

  it("lets the assignee execute and annotate, but not edit, reassign or cancel", async () => {
    const order = await create({ assignedTeamId: teamId });
    assert.equal((await api(`/${order.id}`, "worker", "PATCH", { version: 1, title: "Outro título" })).status, 403);
    assert.equal((await api(`/${order.id}`, "worker", "PATCH", { version: 1, assignedUserId: people.worker })).status, 403);
    assert.equal((await api(`/${order.id}/status`, "worker", "POST", { version: 1, status: "CANCELLED" })).status, 403);
    assert.equal((await api(`/${order.id}/status`, "worker", "POST", { version: 1, status: "DONE" })).status, 409, "cannot skip execution");
    assert.equal((await api("", "worker", "POST", { buildingId: building, title: "Criada pelo executor" })).status, 403);
    const started = await ok(`/${order.id}/status`, "worker", "POST", { version: 1, status: "IN_PROGRESS" });
    assert.ok(started.startedAt && !started.closedAt && started.version === 2);
    assert.equal(new Date(String(started.startedAt)).toISOString(), started.startedAt);
    assert.equal((await api(`/${order.id}/status`, "teammate", "POST", { version: 1, status: "DONE" })).status, 409, "stale version from a teammate");
    const noted = await ok<{ kind: string; actorId: string; note: string }>(`/${order.id}/notes`, "teammate", "POST", { note: "Peça solicitada ao fornecedor" }, 201);
    assert.equal(new Date((noted as unknown as { createdAt: string }).createdAt).toISOString(), (noted as unknown as { createdAt: string }).createdAt);
    assert.deepEqual({ kind: noted.kind, actorId: noted.actorId, note: noted.note }, { kind: "NOTE", actorId: people.teammate, note: "Peça solicitada ao fornecedor" });
    const paused = await ok(`/${order.id}/status`, "teammate", "POST", { version: 2, status: "OPEN", note: "Aguardando peça" });
    assert.equal(paused.startedAt, null);
    await ok(`/${order.id}/status`, "worker", "POST", { version: 3, status: "IN_PROGRESS" });
    const done = await ok(`/${order.id}/status`, "worker", "POST", { version: 4, status: "DONE", note: "Concluído" });
    assert.ok(done.closedAt && done.status === "DONE");
    for (const who of ["worker", "manager"] as const) {
      assert.equal((await api(`/${order.id}/status`, who, "POST", { version: 5, status: "IN_PROGRESS" })).status, 409, "closed orders stay closed");
    }
    assert.equal((await api(`/${order.id}`, "manager", "PATCH", { version: 5, title: "Depois de fechada" })).status, 409);
    assert.equal((await api(`/${order.id}/status`, "idle", "POST", { version: 5, status: "OPEN" })).status, 404);
    assert.equal((await api(`/${order.id}/notes`, "resident", "POST", { note: "x" })).status, 404);
    const detail = await ok<Order & { events: Array<{ kind: string; actorId: string; fromStatus: string | null; toStatus: string | null; note: string }> }>(`/${order.id}`, "worker");
    assert.deepEqual(detail.events.map(event => [event.kind, event.actorId, event.fromStatus, event.toStatus, event.note]), [
      ["CREATED", people.manager, null, null, ""], ["STATUS_CHANGED", people.worker, "OPEN", "IN_PROGRESS", ""], ["NOTE", people.teammate, null, null, "Peça solicitada ao fornecedor"],
      ["STATUS_CHANGED", people.teammate, "IN_PROGRESS", "OPEN", "Aguardando peça"], ["STATUS_CHANGED", people.worker, "OPEN", "IN_PROGRESS", ""], ["STATUS_CHANGED", people.worker, "IN_PROGRESS", "DONE", "Concluído"],
    ]);
    assert.deepEqual((await audits(order.id)).slice(1), [people.worker, people.teammate, people.worker, people.worker].map(actor => `WORK_ORDER_STATUS_CHANGED:${actor}`));
  });

  it("ends the executor's access when the order is reassigned, the team is deactivated or the grant is revoked", async () => {
    const order = await create({ assignedUserId: people.worker });
    await ok(`/${order.id}`, "manager", "PATCH", { version: 1, assignedUserId: people.idle });
    assert.equal((await api(`/${order.id}`, "worker")).status, 404);
    assert.equal((await api(`/${order.id}/status`, "worker", "POST", { version: 2, status: "IN_PROGRESS" })).status, 404);
    const shared = await create({ assignedTeamId: teamId });
    await sqlClient`update teams set active=false where id=${teamId}`;
    try { assert.equal((await api(`/${shared.id}`, "teammate")).status, 404); }
    finally { await sqlClient`update teams set active=true where id=${teamId}`; }
    assert.equal((await api(`/${shared.id}`, "teammate")).status, 200);
    await sqlClient`update role_bindings set active=false where user_id=${people.teammate} and building_id=${building}`;
    try {
      assert.equal((await api(`/${shared.id}`, "teammate")).status, 404);
      assert.equal((await api(`?buildingId=${building}`, "teammate")).status, 403);
    } finally { await sqlClient`update role_bindings set active=true where user_id=${people.teammate} and building_id=${building}`; }
    const cancelled = await ok(`/${shared.id}/status`, "manager", "POST", { version: 1, status: "CANCELLED", note: "Duplicada" });
    assert.ok(cancelled.closedAt);
  });

  it("rejects foreign or unlinked assignees, foreign requests and malformed bodies without creating anything", async () => {
    const count = async () => (await sqlClient`select count(*)::int as count from work_orders where building_id=${building}`)[0]!.count;
    const before = await count();
    const body = { buildingId: building, title: "Inválida" };
    const [occurrence] = await sqlClient`select id from occurrences where building_id<>${building} limit 1`;
    for (const [extra, status] of [
      [{ assignedUserId: people.stranger }, 400], [{ assignedTeamId: foreignTeamId }, 400], [{ assignedUserId: "missing-user" }, 400],
      [{ assignedUserId: people.worker, assignedTeamId: teamId }, 400], [{ title: " " }, 400], [{ priority: "CRITICAL" }, 400],
      [{ status: "DONE" }, 400], [{ createdBy: people.worker }, 400], [{ buildingId: other }, 403],
      ...(occurrence ? [[{ occurrenceId: occurrence.id }, 400] as const] : []),
    ] as const) assert.equal((await api("", "manager", "POST", { ...body, ...extra })).status, status, JSON.stringify(extra));
    assert.equal(await count(), before);
    const order = await create();
    for (const invalid of [{}, { version: 1 }, { version: 0, title: "x" }, { version: 1, status: "DONE" }, { version: 1, buildingId: other }]) {
      assert.equal((await api(`/${order.id}`, "manager", "PATCH", invalid)).status, 400, JSON.stringify(invalid));
    }
    assert.equal((await api(`/${order.id}/status`, "manager", "POST", { version: 1, status: "OPEN" })).status, 409, "same state");
    assert.equal((await api(`/${order.id}/status`, "manager", "POST", { version: 1, status: "ARCHIVED" })).status, 400);
    assert.equal((await api(`/${order.id}/notes`, "manager", "POST", { note: "  " })).status, 400);
  });

  it("enforces visibility, fields, transitions and audit proof at the SQL boundary", async () => {
    const order = await create({ assignedUserId: people.worker });
    const as = <T>(who: keyof typeof people, role: "BUILDING_ADMIN" | "RESIDENT", run: Parameters<typeof withUserContext<T>>[1]) => withUserContext({ userId: people[who], role }, run);
    const refused = (promise: Promise<unknown>, code = "42501") => assert.rejects(promise, error => pgErrorCode(error) === code);
    assert.equal((await as("resident", "RESIDENT", tx => tx.execute(sql`select id from work_orders`))).length, 0);
    assert.equal((await as("stranger", "BUILDING_ADMIN", tx => tx.execute(sql`select id from work_orders where building_id=${building}`))).length, 0);
    assert.equal((await as("idle", "RESIDENT", tx => tx.execute(sql`select id from work_order_events where work_order_id=${order.id}`))).length, 0);
    assert.equal((await appSqlClient`select id from work_orders`).length, 0, "pool outside an actor context sees nothing");
    await refused(as("worker", "RESIDENT", tx => tx.execute(sql`insert into work_orders(building_id,title,created_by) values(${building},'Forged',${people.worker})`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`insert into work_orders(building_id,title,created_by) values(${building},'Forged',${people.worker})`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`insert into work_orders(building_id,title,created_by,status) values(${building},'Forged',${people.manager},'DONE')`)));
    await refused(as("worker", "RESIDENT", tx => tx.execute(sql`update work_orders set version=version+1, title='Hijacked' where id=${order.id}`)));
    await refused(as("worker", "RESIDENT", tx => tx.execute(sql`update work_orders set version=version+1, assigned_user_id=${people.idle} where id=${order.id}`)));
    await refused(as("worker", "RESIDENT", tx => tx.execute(sql`update work_orders set version=version+1, status='CANCELLED' where id=${order.id}`)));
    await refused(as("worker", "RESIDENT", tx => tx.execute(sql`update work_orders set closed_at=clock_timestamp() where id=${order.id}`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`update work_orders set building_id=${other} where id=${order.id}`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`delete from work_orders where id=${order.id}`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`update work_orders set status='IN_PROGRESS' where id=${order.id}`)), "P0409");
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`update work_orders set version=version+1, status='DONE' where id=${order.id}`)), "55000");
    await refused(as("idle", "RESIDENT", tx => tx.execute(sql`insert into work_order_events(work_order_id,building_id,actor_id,kind,note) values(${order.id},${building},${people.idle},'NOTE','x')`)));
    await refused(as("worker", "RESIDENT", tx => tx.execute(sql`insert into work_order_events(work_order_id,building_id,actor_id,kind,note) values(${order.id},${building},${people.manager},'NOTE','x')`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`update work_order_events set note='rewritten' where work_order_id=${order.id}`)));
    const audit = (who: keyof typeof people, action: string, target: string, scope = building) => as(who, "RESIDENT", tx => tx.execute(
      sql`insert into audit_logs(building_id,user_id,action,resource_type,resource_id) values(${scope},${people[who]},${action},'work_order',${target})`));
    await refused(audit("idle", "WORK_ORDER_STATUS_CHANGED", order.id));
    await refused(audit("worker", "WORK_ORDER_UPDATED", order.id));
    await refused(audit("worker", "WORK_ORDER_CREATED", order.id));
    await refused(audit("manager", "WORK_ORDER_STATUS_CHANGED", foreignOrderId));
    await refused(audit("manager", "WORK_ORDER_STATUS_CHANGED", foreignOrderId, other));
    await refused(audit("manager", "WORK_ORDER_DELETED", order.id));
    const [row] = await sqlClient`select title,status,version,assigned_user_id from work_orders where id=${order.id}`;
    assert.deepEqual({ ...row }, { title: "Trocar lâmpada da garagem", status: "OPEN", version: 1, assigned_user_id: people.worker });
  });

  it("reapplies 043 without changing functions, policies or grants", async () => {
    const migration = await readFile(new URL("../../../infrastructure/043-work-orders.sql", import.meta.url), "utf8");
    const rollback = new Error("043 reapplication rollback");
    await assert.rejects(sqlClient.begin(async owner => {
      const invariant = async () => ({
        functions: await owner`select p.oid::regprocedure::text as signature,p.prosrc,p.proacl::text,p.proowner,p.proconfig,p.prosecdef
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by signature`,
        policies: await owner`select * from pg_policies where schemaname='public' order by tablename,policyname`,
        tables: await owner`select c.relname,c.relrowsecurity,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname`,
        columns: await owner`select a.attrelid::regclass::text as relation,a.attname,a.attacl::text from pg_attribute a join pg_class c on c.oid=a.attrelid
          join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attacl is not null order by 1,2`,
      });
      const before = await invariant();
      await owner.unsafe(migration);
      assert.deepEqual(await invariant(), before);
      throw rollback;
    }), error => error === rollback);
  });
});
