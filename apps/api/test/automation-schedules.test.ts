import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

type Rule = { id: string; version: number; enabled: boolean; publishedVersion: number | null };
const DAY = 86_400_000;

// 057: preventive maintenance — a version that opens a work order every N days.
describe("scheduled automations (057)", () => {
  const suffix = randomUUID().slice(0, 8), org = `sched-${suffix}-org`, building = `sched-${suffix}-a`;
  const manager = `sched-${suffix}-manager`, technician = `sched-${suffix}-tech`;
  const tokens: Record<string, string> = {};
  let server: TestServer, assetId: string, job: { id: number; every: string; scheduled: boolean };
  const api = (path: string, who: string, method = "GET", body?: unknown) => call(server.url, `/v1/automations${path}`, { method, body, token: tokens[who] });
  async function ok<T = Rule>(path: string, who: string, method = "GET", body?: unknown, status = 200): Promise<T> {
    const response = await api(path, who, method, body);
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data as T;
  }
  const schedule = (startsAt: Date, everyDays = 30, extra: object = {}) =>
    ({ trigger: "SCHEDULE", everyDays, startsAt: startsAt.toISOString(), orderTitle: "Limpeza da caixa d'água", orderPriority: "HIGH", assetId, ...extra });
  async function live(startsAt: Date, everyDays = 30, name = "Limpeza semestral"): Promise<Rule> {
    const rule = await ok("", manager, "POST", { buildingId: building, name, definition: schedule(startsAt, everyDays) }, 201);
    const published = await ok(`/${rule.id}/publish`, manager, "POST", { version: rule.version, number: 1 });
    return ok(`/${rule.id}/state`, manager, "POST", { version: published.version, enabled: true });
  }
  const runAt = async (at: Date) => (await sqlClient`select app_automation_run_schedules(${at.toISOString()}::timestamptz) as opened`)[0]!.opened as number;
  const runs = async (ruleId: string) => (await sqlClient`select alert_id, scheduled_for, outcome, work_order_id from automation_runs where automation_id=${ruleId} order by scheduled_for`).map(row => ({ ...row }));

  before(async () => {
    // The real job would race the fixed instants below; it is paused for the suite and restored after.
    [job] = await sqlClient`select job_id as id, schedule_interval::text as every, scheduled from timescaledb_information.jobs where proc_name='app_automation_schedule_job'` as never;
    if (job) await sqlClient`select alter_job(${job.id}, scheduled => false)`;
    const password = await hashPassword("predioon123");
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Schedules',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${building},${org},'A','A')`;
    for (const id of [manager, technician]) await sqlClient`insert into users(id,name,email,password_hash) values(${id},${id},${`${id}@sched.test`},${password})`;
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${manager},${building},'BUILDING_ADMIN'),(${technician},${building},'MAINTENANCE')`;
    assetId = (await sqlClient`insert into assets(building_id,name,created_by) values(${building},'Caixa d''água',${manager}) returning id`)[0]!.id;
    server = await startTestServer();
    for (const id of [manager, technician]) tokens[id] = (await login(server.url, `${id}@sched.test`)).accessToken;
  });
  after(async () => {
    if (job) await sqlClient`select alter_job(${job.id}, scheduled => ${job.scheduled})`;
    await server?.close();
    await sqlClient`delete from audit_logs where building_id=${building}`;
    await sqlClient`delete from buildings where id=${building}`;
    await sqlClient`delete from organizations where id=${org}`;
    await sqlClient`delete from users where id in (${manager},${technician})`;
    await closeAppDb(); await sqlClient.end();
  });

  it("opens one order per due date, never a backlog, and never twice", async () => {
    const start = new Date(Date.UTC(2026, 0, 5, 11)), rule = await live(start);
    assert.equal(await runAt(new Date(start.getTime() - DAY)), 0, "nothing before the first date");
    // Three periods passed while the scheduler was stopped: only the most recent opens.
    const late = new Date(start.getTime() + 95 * DAY);
    assert.equal(await runAt(late), 1);
    assert.equal(await runAt(late), 0, "the same date never opens a second order");
    assert.equal(await runAt(new Date(late.getTime() + DAY)), 0);
    assert.equal(await runAt(new Date(start.getTime() + 120 * DAY)), 1, "the next period opens the next order");
    const history = await runs(rule.id);
    assert.deepEqual(history.map(run => [run.alert_id, new Date(run.scheduled_for as string).toISOString(), run.outcome]), [
      [null, new Date(start.getTime() + 90 * DAY).toISOString(), "CREATED"], [null, new Date(start.getTime() + 120 * DAY).toISOString(), "CREATED"]]);
    const [order] = await sqlClient`select title, priority, asset_id, created_by, description from work_orders where id=${history[0]!.work_order_id}`;
    assert.deepEqual({ ...order }, { title: "Limpeza da caixa d'água", priority: "HIGH", asset_id: assetId, created_by: manager,
      description: "Manutenção programada a cada 30 dia(s), referente a 05/04/2026." });
    const [event] = await sqlClient`select actor_id, kind from work_order_events where work_order_id=${history[0]!.work_order_id}`;
    assert.deepEqual({ ...event }, { actor_id: null, kind: "CREATED" });

    // Disabled rules and condominiums do not run.
    const detail = await ok<Rule>(`/${rule.id}`, manager);
    await ok(`/${rule.id}/state`, manager, "POST", { version: detail.version, enabled: false });
    assert.equal(await runAt(new Date(start.getTime() + 150 * DAY)), 0);
  });

  it("alerts never trigger a schedule, and a schedule never filters alerts", async () => {
    const rule = await live(new Date(Date.now() - DAY), 7, "Revisão semanal");
    await sqlClient`insert into alerts(building_id,severity,type,status,message) values(${building},'CRITICAL','ANY','OPEN','Alerta qualquer')`;
    assert.deepEqual((await runs(rule.id)).length, 0);
    for (const definition of [
      schedule(new Date(), 7, { alertTypes: ["PUMP"] }), { ...schedule(new Date(), 7), everyDays: null }, { ...schedule(new Date(), 7), startsAt: null },
      { orderTitle: "Alerta", everyDays: 7 }, { ...schedule(new Date(), 0) }, { ...schedule(new Date(), 367) },
    ]) assert.equal((await api("", manager, "POST", { buildingId: building, name: "Inválida", definition })).status, 400, JSON.stringify(definition));
    // The database refuses the same mixtures and keeps schedule fields immutable.
    await assert.rejects(sqlClient`update automation_versions set schedule_every_days=1 where automation_id=${rule.id}`, { code: "42501" });
    await assert.rejects(sqlClient`insert into automation_versions(automation_id,building_id,number,trigger_kind,schedule_every_days,schedule_starts_at,order_title,created_by)
      values(${rule.id},${building},2,'SCHEDULE',7,null,'x',${manager})`, { code: "23514" });
  });

  it("shows the definition, the next dates and each run's date; only managers create schedules", async () => {
    const start = new Date(Date.now() + 2 * DAY), rule = await ok("", manager, "POST", { buildingId: building, name: "Futura", definition: schedule(start, 10) }, 201);
    const detail = await ok<{ versions: Array<Record<string, unknown>> }>(`/${rule.id}`, technician);
    assert.deepEqual([detail.versions[0]!.trigger, detail.versions[0]!.everyDays, detail.versions[0]!.startsAt], ["SCHEDULE", 10, start.toISOString()]);
    const simulated = await ok<{ matches: unknown[]; nextOccurrences: string[] }>(`/${rule.id}/simulate`, manager, "POST", { number: 1 });
    assert.deepEqual(simulated.matches, []);
    assert.deepEqual(simulated.nextOccurrences, [0, 10, 20, 30, 40].map(days => new Date(start.getTime() + days * DAY).toISOString()));
    assert.equal((await api("", technician, "POST", { buildingId: building, name: "Sem permissão", definition: schedule(start) })).status, 403);
  });

  it("is registered in the database's own job scheduler every five minutes", async () => {
    assert.deepEqual({ every: job?.every, scheduled: job?.scheduled }, { every: "00:05:00", scheduled: true });
    await assert.rejects(sqlClient.begin(async tx => {
      await tx`set local role predioon_app`;
      await tx`select app_automation_run_schedules()`;
    }), { code: "42501" });
  });
});
