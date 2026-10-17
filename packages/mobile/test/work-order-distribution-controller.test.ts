import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { URL } from "node:url";
import { ApiError, type ApiClient } from "@predioon/api-client";
import type { WorkOrderView } from "@predioon/contracts/work-orders";

const url = new URL("../src/work-order-distribution-controller.ts", import.meta.url);
const moduleApi: Record<string, any> = existsSync(url) ? await import(url.href) : {};
const id = "11111111-1111-4111-8111-111111111111", teamId = "22222222-2222-4222-8222-222222222222";
function order(changes: Partial<WorkOrderView> = {}): WorkOrderView {
  return { id, buildingId: "one", title: "Bomba", description: "Verificar", priority: "NORMAL", status: "OPEN", occurrenceId: null, assetId: null, assetName: null,
    assignedUserId: null, assignedTeamId: null, dueAt: null, createdBy: "manager", version: 1, createdAt: "2026-10-12T10:00:00Z", updatedAt: "2026-10-12T10:00:00Z", startedAt: null, closedAt: null, assignedToMe: false, ...changes };
}
function deferred<T = unknown>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(beforeSend?: () => Promise<void>) {
  assert.equal(typeof moduleApi.createWorkOrderDistributionController, "function", "controller must implement isolated distribution");
  const calls: { method: string; path: string; body?: any }[] = [];
  let reloads = 0;
  const state = { directory: async (path: string): Promise<unknown> => path.includes("/people?")
    ? { items: [{ id: "person-one", name: "Pessoa", email: "secret" }], nextCursor: null }
    : { items: [{ id: teamId, name: "Equipe", buildingId: "one", active: true }], nextCursor: null },
    write: async (_method: string, _path: string, body: any): Promise<unknown> => order({ ...body, version: body.version ? body.version + 1 : 1 }) };
  const api = { async get(path: string) { calls.push({ method: "GET", path }); return state.directory(path); },
    async post(path: string, body: unknown) { calls.push({ method: "POST", path, body }); return state.write("POST", path, body); },
    async patch(path: string, body: unknown) { calls.push({ method: "PATCH", path, body }); return state.write("PATCH", path, body); } } as unknown as ApiClient;
  let context: any = { api, userId: "manager", buildingId: "one", scope: { buildingId: "one", capabilities: ["work-orders:assign", "memberships:manage", "teams:read"] }, list: { items: [order()], nextCursor: null, canDistribute: true } };
  const controller = moduleApi.createWorkOrderDistributionController({ reload() { reloads++; }, beforeSend });
  controller.sync(context); controller.setActive(true);
  const sync = (changes: any) => { context = { ...context, ...changes }; controller.sync(context); };
  return { controller, calls, state, sync, context: () => context, reloads: () => reloads };
}

test("directories load only on opening a gated form, with exact source capabilities", async () => {
  const f = fixture(); assert.equal(f.calls.length, 0); assert.equal(f.controller.openCreate(), true); await settle();
  assert.deepEqual(f.calls.map(call => call.path), ["/v1/tenancy/people?buildingId=one&limit=100", "/v1/tenancy/teams?buildingId=one&limit=100"]);
  f.controller.close(); assert.equal(f.controller.snapshot().people.items.length, 0);
  for (const capabilities of [["work-orders:assign", "teams:read"], ["work-orders:assign", "teams:manage"], ["work-orders:assign"]]) {
    const g = fixture(); g.sync({ scope: { buildingId: "one", capabilities } }); g.controller.openCreate(); await settle();
    assert.equal(g.calls.some(call => call.path.includes("/people?")), capabilities.includes("teams:manage"));
    assert.equal(g.calls.some(call => call.path.includes("/teams?")), capabilities.includes("teams:read"));
  }
  for (const changes of [{ list: null }, { list: { items: [order()], canDistribute: false, nextCursor: null } }, { scope: { buildingId: "one", capabilities: ["work-orders:read-assigned"] } }]) {
    const g = fixture(); g.sync(changes); assert.equal(g.controller.openCreate(), false); assert.equal(g.controller.openAssign(id), false); assert.equal(g.calls.length, 0);
  }
});

test("create and captured assignment have a synchronous one-send barrier and exact payloads", async () => {
  const f = fixture(); f.controller.openCreate(); await settle(); f.controller.setDraft({ title: "  Bomba ", description: " Verificar ", priority: "HIGH" });
  f.controller.select({ kind: "person", id: "person-one" }); const wait = deferred(); f.state.write = () => wait.promise;
  const first = f.controller.submit(), second = f.controller.submit(); await settle();
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1); assert.equal(f.controller.snapshot().pending, true);
  assert.deepEqual(f.calls.at(-1)?.body, { buildingId: "one", title: "Bomba", description: "Verificar", priority: "HIGH", assignedUserId: "person-one", assignedTeamId: null });
  wait.resolve(order({ priority: "HIGH", assignedUserId: "person-one" })); await Promise.all([first, second]);
  assert.equal(f.controller.snapshot().mode, null); assert.equal(f.controller.snapshot().draft.title, ""); assert.equal(f.reloads(), 1);
  f.state.write = async (_method, _path, body) => order({ ...body, version: body.version + 1 });
  f.controller.openAssign(id); await settle(); f.controller.select({ kind: "team", id: teamId }); await f.controller.submit();
  assert.deepEqual(f.calls.at(-1), { method: "PATCH", path: `/v1/work-orders/${id}`, body: { version: 1, assignedUserId: null, assignedTeamId: teamId } });
});

test("400 leaves editable data with fixed feedback; 403/404 invalidate and reload without API details", async () => {
  for (const status of [400, 403, 404]) {
    const f = fixture(); f.controller.openCreate(); f.controller.setDraft({ title: "Bomba", description: "Verificar" });
    f.state.write = async () => { throw new ApiError(status, "secret API body"); }; await f.controller.submit();
    const snapshot = f.controller.snapshot(); assert.equal(JSON.stringify(snapshot).includes("secret"), false); assert.equal(snapshot.pending, false);
    assert.equal(snapshot.mode, status === 400 ? "create" : null); assert.equal(f.reloads(), status === 400 ? 0 : 1);
    assert.match(snapshot.feedback, status === 400 ? /Revise/ : /acesso atual/);
    if (status !== 400) {
      assert.equal(f.controller.openCreate(), false, "denied evidence cannot immediately reopen");
      f.sync({ list: { ...f.context().list } }); assert.equal(f.controller.openCreate(), true);
    }
  }
});

test("an already sent write holds a separate barrier across close, authority change and background", async () => {
  for (const change of ["close", "authority", "background"]) {
    const f = fixture(); f.controller.openCreate(); f.controller.setDraft({ title: "Bomba", description: "Verificar" });
    const pending = deferred(); f.state.write = () => pending.promise; const first = f.controller.submit(); await settle();
    assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
    if (change === "close") f.controller.close();
    if (change === "authority") f.sync({ scope: { buildingId: "one", capabilities: ["work-orders:assign"] } });
    if (change === "background") { f.controller.setActive(false); f.controller.setActive(true); f.sync({ list: { ...f.context().list } }); }
    f.controller.openCreate(); f.controller.setDraft({ title: "Nova ficha" }); const second = f.controller.submit(); await settle();
    try {
      assert.equal(f.calls.filter(call => call.method === "POST").length, 1, change);
      assert.equal(f.controller.snapshot().pending, true, "the in-flight write must remain visible as pending");
    } finally { pending.resolve(order()); await Promise.all([first, second]); }
    assert.equal(f.controller.snapshot().feedback, null); assert.equal(f.reloads(), 0);
    assert.equal(f.controller.snapshot().pending, false);
  }
});

test("a selected directory option revoked during a deferred send is revalidated before transport", async () => {
  const before = deferred<void>(), page = deferred(); const f = fixture(() => before.promise);
  f.state.directory = async path => path.includes("/people?") ? { items: [{ id: "person-one", name: "Pessoa" }], nextCursor: "person-one" }
    : { items: [], nextCursor: null };
  f.controller.openCreate(); await settle(); f.controller.select({ kind: "person", id: "person-one" }); f.controller.setDraft({ title: "Bomba" });
  f.state.directory = () => page.promise; const loading = f.controller.loadMore("people"), submitted = f.controller.submit();
  page.reject(new ApiError(403, "secret")); await loading; before.resolve(); await submitted;
  assert.equal(f.calls.filter(call => call.method !== "GET").length, 0); assert.equal(f.controller.snapshot().pending, false);
});

test("an abandoned pre-send task cannot release a later generation's active transport barrier", async () => {
  const firstGate = deferred<void>(), response = deferred(); let gatedSend = 0;
  const f = fixture(() => ++gatedSend === 1 ? firstGate.promise : Promise.resolve());
  f.controller.openCreate(); f.controller.setDraft({ title: "Bomba" }); const first = f.controller.submit();
  f.sync({ userId: "replacement" }); f.controller.openCreate(); f.controller.setDraft({ title: "Bomba" }); f.state.write = () => response.promise;
  const second = f.controller.submit(); await settle(); firstGate.resolve(); await first;
  f.controller.close(); f.controller.openCreate(); f.controller.setDraft({ title: "Terceira" }); const third = f.controller.submit(); await settle();
  try { assert.equal(f.calls.filter(call => call.method === "POST").length, 1); assert.equal(f.controller.snapshot().pending, true); }
  finally { response.resolve(order({ createdBy: "replacement" })); await Promise.all([second, third]); }
});

test("409 captures a stale version and cannot silently retry or reopen before a fresh version", async () => {
  const f = fixture(); f.controller.openAssign(id); await settle(); f.state.write = async () => { throw new ApiError(409, "secret conflict"); };
  await f.controller.submit(); assert.equal(f.controller.snapshot().mode, null); assert.equal(f.reloads(), 1);
  assert.equal(f.controller.openAssign(id), false); assert.equal(f.calls.filter(call => call.method === "PATCH").length, 1);
  f.sync({ list: { items: [order({ version: 2 })], nextCursor: null, canDistribute: true } }); assert.equal(f.controller.openAssign(id), true);
  assert.equal(f.controller.snapshot().target.version, 2);
});

test("network, 5xx and incompatible responses lock resend until explicit list check and a fresh opening", async () => {
  for (const error of [new TypeError("secret network"), new ApiError(503, "secret server"), null]) {
    const f = fixture(); f.controller.openCreate(); f.controller.setDraft({ title: "Bomba", description: "Verificar" });
    f.state.write = async () => { if (error) throw error; return order({ buildingId: "two" }); };
    await f.controller.submit(); assert.equal(f.controller.snapshot().uncertain, true); assert.match(f.controller.snapshot().feedback, /confirmar/);
    await f.controller.submit(); assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
    f.controller.close(); assert.equal(f.controller.openCreate(), false); f.controller.checkList(); assert.equal(f.reloads(), 1);
    assert.equal(f.controller.openCreate(), false); f.sync({ list: { ...f.context().list } }); assert.equal(f.controller.openCreate(), true);
    assert.equal(f.controller.snapshot().draft.title, ""); assert.equal(JSON.stringify(f.controller.snapshot()).includes("secret"), false);
  }
});

test("uncertain confirmation remains reachable after an authority revision clears private form state", async () => {
  const f = fixture(); f.controller.openCreate(); f.controller.setDraft({ title: "Bomba" });
  f.state.write = async () => { throw new TypeError("network"); }; await f.controller.submit();
  f.sync({ scope: { buildingId: "one", capabilities: ["work-orders:read-assigned"] } });
  assert.equal(f.controller.snapshot().feedback, null); assert.equal(f.controller.snapshot().mode, null);
  f.sync({ scope: { buildingId: "one", capabilities: ["work-orders:assign"] }, list: { ...f.context().list } });
  assert.equal(f.controller.snapshot().uncertain, true, "offer list verification after clearing private state");
  assert.equal(f.controller.openCreate(), false); f.controller.checkList();
  f.sync({ list: { ...f.context().list } }); assert.equal(f.controller.openCreate(), true);
});

test("each directory paginates explicitly and denial clears prior private options and selection", async () => {
  const f = fixture(); f.state.directory = async path => path.includes("/people?")
    ? { items: [{ id: "person-one", name: "Pessoa" }], nextCursor: "person-one" }
    : { items: [{ id: teamId, name: "Equipe", buildingId: "one", active: true }], nextCursor: null };
  f.controller.openCreate(); await settle(); assert.equal(f.calls.length, 2); f.controller.select({ kind: "person", id: "person-one" });
  f.state.directory = async () => { throw new TypeError("secret network"); }; await f.controller.loadMore("people");
  assert.equal(f.controller.snapshot().people.items.length, 1); assert.equal(f.controller.snapshot().people.state, "error"); assert.equal(f.controller.snapshot().selection.kind, "person");
  f.state.directory = async () => { throw new ApiError(403, "secret denied"); }; await f.controller.loadMore("people");
  assert.equal(f.controller.snapshot().people.items.length, 0); assert.equal(f.controller.snapshot().people.state, "denied"); assert.equal(f.controller.snapshot().selection.kind, "none");
  assert.equal(f.controller.snapshot().teams.items.length, 1); assert.equal(JSON.stringify(f.controller.snapshot()).includes("secret"), false);
});

test("revocation, list gate, client, identity, building, target version and lifecycle invalidate deferred sends", async () => {
  for (const invalidation of ["capability", "gate", "client", "user", "building", "version", "background", "dispose"]) {
    const before = deferred<void>(); const f = fixture(() => before.promise); f.controller.openAssign(id); await settle();
    f.controller.select({ kind: "person", id: "person-one" }); const submitted = f.controller.submit();
    if (invalidation === "capability") f.sync({ scope: { buildingId: "one", capabilities: ["work-orders:read-assigned"] } });
    if (invalidation === "gate") f.sync({ list: { ...f.context().list, canDistribute: false } });
    if (invalidation === "client") f.sync({ api: { ...f.context().api } });
    if (invalidation === "user") f.sync({ userId: "new-user" });
    if (invalidation === "building") f.sync({ buildingId: "two" });
    if (invalidation === "version") f.sync({ list: { ...f.context().list, items: [order({ version: 2 })] } });
    if (invalidation === "background") f.controller.setActive(false);
    if (invalidation === "dispose") f.controller.dispose();
    before.resolve(); await submitted;
    assert.equal(f.calls.filter(call => call.method !== "GET").length, 0, invalidation);
    assert.equal(f.controller.snapshot().mode, null); assert.equal(f.controller.snapshot().people.items.length, 0); assert.equal(f.controller.snapshot().feedback, null);
  }
});

test("late writes and directory callbacks cannot clear a new draft, publish feedback or trigger reload", async () => {
  for (const outcome of ["success", "error"]) {
    const f = fixture(); f.controller.openCreate(); await settle(); f.controller.setDraft({ title: "Bomba", description: "Verificar" });
    const old = deferred(); f.state.write = () => old.promise; const submitted = f.controller.submit(); await settle();
    f.controller.setActive(false); assert.equal(f.controller.snapshot().draft.title, ""); f.controller.setActive(true);
    // Fresh foreground evidence, explicit new opening, no automatic replay.
    f.sync({ list: { ...f.context().list } }); f.controller.openCreate(); await settle(); f.controller.setDraft({ title: "Novo rascunho" });
    if (outcome === "success") old.resolve(order()); else old.reject(new ApiError(500, "secret late write"));
    await submitted; assert.equal(f.controller.snapshot().draft.title, "Novo rascunho"); assert.equal(f.controller.snapshot().feedback, null); assert.equal(f.reloads(), 0);
  }
  const f = fixture(); const late = deferred(); f.state.directory = () => late.promise; f.controller.openCreate(); f.controller.close();
  f.state.directory = async () => ({ items: [], nextCursor: null }); f.controller.openCreate(); await settle();
  late.resolve({ items: [{ id: "person-one", name: "Private late" }], nextCursor: null }); await settle();
  assert.equal(f.controller.snapshot().people.items.length, 0); assert.equal(f.controller.snapshot().teams.items.length, 0);
});

test("closed targets and vanished selections never submit; session replacement clears all private state", async () => {
  const f = fixture(); for (const status of ["DONE", "CANCELLED"]) { f.sync({ list: { ...f.context().list, items: [order({ status: status as any })] } }); assert.equal(f.controller.openAssign(id), false); }
  f.controller.openCreate(); f.controller.setDraft({ title: "Bomba" }); f.controller.select({ kind: "person", id: "typed" }); await f.controller.submit();
  assert.equal(f.calls.filter(call => call.method !== "GET").length, 0);
  f.controller.setDraft({ title: "PRIVATE" }); f.sync({ userId: "another-session-user" });
  assert.equal(f.controller.snapshot().draft.title, ""); assert.equal(f.controller.snapshot().selection.kind, "none");
});

test("captured form handlers cannot edit, close or submit a later form generation", async () => {
  const f = fixture(); f.controller.openCreate(); await settle();
  assert.equal(typeof f.controller.captureForm, "function", "form handlers must capture their generation");
  const old = f.controller.captureForm(); f.controller.close(); f.controller.openCreate(); await settle();
  f.controller.setDraft({ title: "Nova ficha" }); old.setDraft({ title: "Old private data" }); old.select({ kind: "person", id: "person-one" }); await old.submit(); old.close();
  assert.equal(f.controller.snapshot().draft.title, "Nova ficha"); assert.equal(f.controller.snapshot().selection.kind, "none");
  assert.equal(f.calls.filter(call => call.method !== "GET").length, 0); assert.equal(f.controller.snapshot().mode, "create");
});

test("snapshot exposes a new form generation when create is reopened without closing", async () => {
  const f = fixture(); f.controller.openCreate(); await settle(); const first = f.controller.snapshot().generation;
  assert.equal(typeof first, "number", "the view must receive the captured form generation");
  f.controller.setDraft({ title: "Private draft" }); f.controller.openCreate(); await settle();
  assert.ok(f.controller.snapshot().generation > first); assert.equal(f.controller.snapshot().draft.title, "");
});

test("workflow callbacks capture their generation without requiring an open form", async () => {
  const f = fixture(); assert.equal(typeof f.controller.captureWorkflow, "function", "external actions must capture their workflow generation");
  const old = f.controller.captureWorkflow(); assert.equal(old.openCreate(), true); await settle();
  f.controller.setDraft({ title: "Nova ficha" }); f.controller.select({ kind: "person", id: "person-one" });
  const calls = f.calls.length, generation = f.controller.snapshot().generation;
  assert.equal(old.openCreate(), false); assert.equal(old.openAssign(id), false); old.checkList(); await settle();
  assert.equal(f.controller.snapshot().draft.title, "Nova ficha"); assert.deepEqual(f.controller.snapshot().selection, { kind: "person", id: "person-one" });
  assert.equal(f.controller.snapshot().generation, generation); assert.equal(f.calls.length, calls); assert.equal(f.reloads(), 0);
  assert.equal(f.controller.captureWorkflow().openAssign(id), true); await settle(); assert.equal(f.controller.snapshot().mode, "assign");
});

test("an old list-check callback cannot clear a new draft after uncertain confirmation was checked", async () => {
  const f = fixture(); assert.equal(typeof f.controller.captureWorkflow, "function", "list verification needs a captured workflow callback");
  f.controller.openCreate(); f.controller.setDraft({ title: "Bomba" });
  f.state.write = async () => { throw new TypeError("network"); }; await f.controller.submit();
  // Verification remains available after Voltar, while no form is open.
  f.controller.close(); const old = f.controller.captureWorkflow(); old.checkList(); assert.equal(f.reloads(), 1);
  f.sync({ list: { ...f.context().list } }); assert.equal(f.controller.captureWorkflow().openCreate(), true); await settle();
  f.controller.setDraft({ title: "Nova ficha" }); f.controller.select({ kind: "team", id: teamId });
  const calls = f.calls.length; old.checkList(); old.openCreate(); old.openAssign(id); await settle();
  assert.equal(f.controller.snapshot().mode, "create"); assert.equal(f.controller.snapshot().draft.title, "Nova ficha");
  assert.deepEqual(f.controller.snapshot().selection, { kind: "team", id: teamId }); assert.equal(f.calls.length, calls); assert.equal(f.reloads(), 1);
});

test("workflow callbacks from replaced context or lifecycle cannot open forms or reload the current list", async () => {
  for (const change of ["api", "user", "authority", "gate", "lifecycle"]) {
    const f = fixture(); assert.equal(typeof f.controller.captureWorkflow, "function", "workflow context must invalidate old external callbacks");
    const old = f.controller.captureWorkflow();
    if (change === "api") f.sync({ api: { ...f.context().api } });
    if (change === "user") f.sync({ userId: "replacement" });
    if (change === "authority") f.sync({ scope: { buildingId: "one", capabilities: ["work-orders:assign"] } });
    if (change === "gate") { f.sync({ list: { ...f.context().list, canDistribute: false } }); f.sync({ list: { ...f.context().list, canDistribute: true } }); }
    if (change === "lifecycle") { f.controller.setActive(false); f.controller.setActive(true); f.sync({ list: { ...f.context().list } }); }
    assert.equal(old.openCreate(), false, change); assert.equal(old.openAssign(id), false, change); old.checkList();
    assert.equal(f.controller.snapshot().mode, null); assert.equal(f.calls.length, 0); assert.equal(f.reloads(), 0);
  }
});
