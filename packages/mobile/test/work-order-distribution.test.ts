import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { URL } from "node:url";
import type { ApiClient } from "@predioon/api-client";
import type { WorkOrderView } from "@predioon/contracts/work-orders";

// Absence is an assertion failure, never a module-loader RED.
const url = new URL("../src/work-order-distribution.ts", import.meta.url);
const domain: Record<string, any> = existsSync(url) ? await import(url.href) : {};
function fn(name: string) { assert.equal(typeof domain[name], "function", `${name} must implement distribution`); return domain[name]; }
const id = "11111111-1111-4111-8111-111111111111";
const teamId = "22222222-2222-4222-8222-222222222222";
function order(changes: Partial<WorkOrderView> = {}): WorkOrderView {
  return { id, buildingId: "one", title: "Bomba", description: "Verificar", priority: "NORMAL", status: "OPEN", occurrenceId: null, assetId: null, assetName: null,
    assignedUserId: null, assignedTeamId: null, dueAt: null, createdBy: "manager", version: 1, createdAt: "2026-10-12T10:00:00Z", updatedAt: "2026-10-12T10:00:00Z", startedAt: null, closedAt: null, assignedToMe: false, ...changes };
}
const options = { people: [{ id: "tenant:person/one", name: "Pessoa" }], teams: [{ id: teamId, name: "Equipe" }] };
const list = (changes = {}) => ({ items: [order()], nextCursor: null, canDistribute: true, ...changes });

test("list reader validates building, IDs, versions, enums and distribution boolean before offering actions", async () => {
  const read = fn("readWorkOrderList"); const paths: string[] = [];
  const api = (value: unknown) => ({ async get(path: string) { paths.push(path); return value; } }) as unknown as ApiClient;
  const valid = await read(api(list()), "one"); assert.equal(valid.canDistribute, true);
  assert.equal(paths[0], "/v1/work-orders?buildingId=one&limit=100");
  for (const value of [list({ canDistribute: undefined }), list({ canDistribute: 1 }), list({ items: [order({ buildingId: "two" })] }),
    list({ items: [order({ id: "typed-id" })] }), list({ items: [order({ version: 0 })] }), list({ items: [order({ version: 1.5 })] }),
    list({ items: [order({ status: "OTHER" as any })] }), list({ items: [order({ priority: "OTHER" as any })] }), list({ items: [order(), order()] })])
    await assert.rejects(read(api(value), "one"), /Não foi possível carregar as ordens/);
});

test("distribution gate requires the current building capability and a validated current list", () => {
  const gate = fn("canDistributeWorkOrders"); const scope = { buildingId: "one", capabilities: ["work-orders:assign"] };
  assert.equal(gate(scope, "one", list()), true);
  for (const [s, value] of [[scope, null], [scope, list({ canDistribute: false })], [scope, list({ canDistribute: undefined })],
    [{ ...scope, buildingId: "two" }, list()], [{ ...scope, capabilities: ["work-orders:read-assigned", "work-orders:update-assigned"] }, list()],
    [scope, list({ items: [order({ buildingId: "two" })] })]]) assert.equal(gate(s, "one", value), false);
});

test("list projection accepts omission of fields unused by rendering and distribution", async () => {
  const read = fn("readWorkOrderList"); const value: Record<string, unknown> = { ...order() };
  for (const field of ["createdBy", "updatedAt", "startedAt", "closedAt", "occurrenceId"]) delete value[field];
  const result = await read({ async get() { return { items: [value], nextCursor: null, canDistribute: true }; } }, "one");
  assert.equal(result.items[0].title, "Bomba"); assert.equal(result.canDistribute, true);
});

test("create payload trims limits, defaults priority and sends only one current directory assignee", () => {
  const payload = fn("createWorkOrderPayload");
  const draft = { title: "  Bomba  ", description: "  Verificar  " };
  assert.deepEqual(payload("one", draft, { kind: "none" }, options), { buildingId: "one", title: "Bomba", description: "Verificar", priority: "NORMAL", assignedUserId: null, assignedTeamId: null });
  assert.deepEqual(payload("one", { ...draft, priority: "URGENT" }, { kind: "person", id: options.people[0]!.id }, options),
    { buildingId: "one", title: "Bomba", description: "Verificar", priority: "URGENT", assignedUserId: options.people[0]!.id, assignedTeamId: null });
  assert.equal(payload("one", { title: "x".repeat(160), description: "x".repeat(4000), priority: "LOW" }, { kind: "team", id: teamId }, options).assignedTeamId, teamId);
  for (const invalid of [{ title: " " }, { title: "x".repeat(161) }, { title: "ok", description: "x".repeat(4001) }, { title: "ok", priority: "OTHER" }])
    assert.throws(() => payload("one", invalid, { kind: "none" }, options), /Título|Descrição|Prioridade/);
  for (const selection of [{ kind: "person", id: "me" }, { kind: "team", id: id }, { kind: "both", id: teamId }, { kind: "person", id: "" }])
    assert.throws(() => payload("one", draft, selection, options), /responsável/);
});

test("assignment payload captures the open target version and clears either kind explicitly", () => {
  const payload = fn("assignmentWorkOrderPayload");
  assert.deepEqual(payload(order({ version: 7 }), { kind: "none" }, options), { version: 7, assignedUserId: null, assignedTeamId: null });
  assert.deepEqual(payload(order({ status: "IN_PROGRESS" }), { kind: "team", id: teamId }, options), { version: 1, assignedUserId: null, assignedTeamId: teamId });
  for (const status of ["DONE", "CANCELLED"]) assert.throws(() => payload(order({ status: status as any }), { kind: "none" }, options), /encerrada/);
});

test("directory permissions mirror tenancy routes and never infer raw users access", () => {
  const sources = fn("workOrderDirectorySources");
  assert.deepEqual(sources([]), { people: false, teams: false });
  assert.deepEqual(sources(["teams:read"]), { people: false, teams: true });
  assert.deepEqual(sources(["teams:manage"]), { people: true, teams: false });
  assert.deepEqual(sources(["memberships:manage", "teams:read"]), { people: true, teams: true });
  assert.deepEqual(sources(["users:read", "memberships:read"]), { people: false, teams: false });
});

test("directory pages copy id/name only with real independent cursors, strict active teams and no duplicates", async () => {
  const read = fn("readWorkOrderDirectory"); const paths: string[] = [];
  const empty = { items: [], nextCursor: null };
  const api = (value: unknown) => ({ async get(path: string) { paths.push(path); return value; } });
  const first = await read(api({ items: [{ id: "tenant:person/one", name: "Pessoa", email: "private@secret.test" }], nextCursor: "tenant:person/one" }), "people", "one", null, empty);
  assert.deepEqual(first, { items: [options.people[0]], nextCursor: "tenant:person/one" });
  const second = await read(api({ items: [{ id: "tenant:z", name: "Outra" }], nextCursor: null }), "people", "one", first.nextCursor, first);
  assert.equal(second.items.length, 2); assert.ok(paths[1]!.includes("after=tenant%3Aperson%2Fone"));
  assert.equal(paths[0], "/v1/tenancy/people?buildingId=one&limit=100");
  const team = { id: teamId, name: "Equipe", buildingId: "one", active: true, kind: "MAINTENANCE" };
  assert.deepEqual(await read(api({ items: [team], nextCursor: null }), "teams", "one", null, empty), { items: options.teams, nextCursor: null });
  assert.equal(paths.at(-1), "/v1/tenancy/teams?buildingId=one&limit=100");
  for (const value of [{ items: [team, team], nextCursor: null }, { items: [{ ...team, active: false }], nextCursor: null }, { items: [{ ...team, buildingId: "two" }], nextCursor: null },
    { items: [{ ...team, id: "bad" }], nextCursor: null }, { items: [team], nextCursor: id }, { items: [], nextCursor: teamId }])
    await assert.rejects(read(api(value), "teams", "one", null, empty), /diretório/);
  await assert.rejects(read(api({ items: [{ id: "tenant:person/one", name: "Duplicate" }], nextCursor: "tenant:person/one" }), "people", "one", first.nextCursor, first), /diretório/);
  await assert.rejects(read(api({ items: [], nextCursor: null }), "people", "one", "invented", first), /diretório/);
});

test("text people cursors follow server collation without inventing JavaScript ordering", async () => {
  const read = fn("readWorkOrderDirectory");
  const page = await read({ async get() { return { items: [{ id: "á", name: "Uma" }, { id: "Z", name: "Outra" }], nextCursor: "Z" }; } }, "people", "one", null, { items: [], nextCursor: null });
  assert.deepEqual(page.items.map((item: { id: string }) => item.id), ["á", "Z"]); assert.equal(page.nextCursor, "Z");
});

test("dates consumed by native sort and display must be portable ISO instants", async () => {
  const read = fn("readWorkOrderList");
  for (const field of ["createdAt", "dueAt"]) for (const value of ["10/12/2026", "2026-02-30T10:00:00Z", "2026-10-12"])
    await assert.rejects(read({ async get() { return list({ items: [order({ [field]: value })] }); } }, "one"));
});

test("write transports use exact routes and validate the returned order before confirming success", async () => {
  const create = fn("createDistributedWorkOrder"), assign = fn("assignDistributedWorkOrder");
  const calls: unknown[] = []; let response: unknown = order();
  const api = { async post(path: string, body: unknown) { calls.push(["POST", path, body]); return response; }, async patch(path: string, body: unknown) { calls.push(["PATCH", path, body]); return response; } };
  const createBody = fn("createWorkOrderPayload")("one", { title: "Bomba", description: "Verificar" }, { kind: "none" }, options);
  await create(api, "manager", createBody); assert.deepEqual(calls[0], ["POST", "/v1/work-orders", createBody]);
  const patchBody = { version: 1, assignedUserId: null, assignedTeamId: teamId };
  response = order({ version: 2, assignedTeamId: teamId }); await assign(api, order(), patchBody);
  assert.deepEqual(calls[1], ["PATCH", `/v1/work-orders/${id}`, patchBody]);
  for (const changes of [{ buildingId: "two" }, { title: "different" }, { createdBy: "other" }, { version: 9 }, { status: "DONE" }]) {
    response = order(changes as Partial<WorkOrderView>); await assert.rejects(create(api, "manager", createBody), /confirmar/);
  }
  for (const changes of [{ id: teamId }, { buildingId: "two" }, { version: 1 }, { assignedTeamId: null }, { status: "DONE" }]) {
    response = order({ version: 2, assignedTeamId: teamId, ...changes } as Partial<WorkOrderView>); await assert.rejects(assign(api, order(), patchBody), /confirmar/);
  }
});
