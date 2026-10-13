import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import ts from "typescript";
import { ApiError, type ApiClient } from "@predioon/api-client";
import type { Grant, Product } from "../src/scope.ts";
import type { WorkOrderView } from "@predioon/contracts/work-orders";
import { createAccessIntentStore } from "../src/access-intents.ts";

// Real React handlers on instrumented Android/iOS hosts; no Fabric, Hermes or device acceptance.
const require = createRequire(import.meta.url);
const { act, create } = require("react-test-renderer");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, __DEV__: false });
const hostUrl = new URL("./fixtures/work-order-screen-host.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (["react-native", "react-native-safe-area-context", "react-native-keychain", "react-native-get-random-values"].includes(specifier)) return { url: hostUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx") && !url.includes("node_modules")) {
      const source = readFileSync(fileURLToPath(url), "utf8") + (url.endsWith("/app.tsx") ? "\nexport { BuildingApp };\n" : "");
      return { format: "module", shortCircuit: true, source: ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    }
    return nextLoad(url, context);
  },
});
const { WorkOrders } = await import(new URL("../src/work-orders-screen.tsx", import.meta.url).href);
const { WorkOrderDistributionScreen } = await import(new URL("../src/work-order-distribution-screen.tsx", import.meta.url).href);
const app = await import(new URL("../src/app.tsx", import.meta.url).href);
const BuildingApp = app.BuildingApp as React.ComponentType<any>;
const host = await import(hostUrl) as {
  resetHost(os: string): void; changeAppState(state: string): void; listenerCount(): number;
  events: { kind: string; instance: number }[]; alerts: { title: string; buttons: { text: string; onPress?: () => void }[] }[];
};
type Tree = ReturnType<typeof create>;
const id = "11111111-1111-4111-8111-111111111111", teamId = "22222222-2222-4222-8222-222222222222";
function order(changes: Partial<WorkOrderView> = {}): WorkOrderView {
  return { id, buildingId: "one", title: "Bomba", description: "Verificar", priority: "NORMAL", status: "OPEN", occurrenceId: null, assetId: null, assetName: null,
    assignedUserId: null, assignedTeamId: null, dueAt: null, createdBy: "manager", version: 1, createdAt: "2026-10-12T10:00:00Z", updatedAt: "2026-10-12T10:00:00Z", startedAt: null, closedAt: null, assignedToMe: false, ...changes };
}
function text(tree: Tree) { return JSON.stringify(tree.toJSON()); }
function button(tree: Tree, label: string) {
  return tree.root.findAllByType("NativePressable").find((node: any) => node.findAllByType("NativeText").some((node: any) => node.props.children === label));
}
function input(tree: Tree, label: string) { return tree.root.findAllByType("NativeTextInput").find((node: any) => node.props.accessibilityLabel === label); }
async function press(tree: Tree, label: string) { const node = button(tree, label); assert.ok(node, `button ${label} must be available`); await act(async () => { node.props.onPress(); }); }
async function fill(tree: Tree, label: string, value: string) { const node = input(tree, label); assert.ok(node, `field ${label} must be available`); await act(async () => { node.props.onChangeText(value); }); }
function deferred<T = unknown>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
const grants: Grant[] = ["work-orders:assign", "memberships:manage", "teams:read"];
function fixture() {
  const calls: { method: string; path: string; body?: any }[] = [];
  const state = {
    capabilities: [...grants], list: { items: [order()], nextCursor: null, canDistribute: true } as any,
    read: (): Promise<unknown> => Promise.resolve(state.list),
    directory: async (path: string): Promise<unknown> => path.includes("/people?")
      ? { items: [{ id: "person-one", name: "Pessoa", email: "private@example.test" }], nextCursor: null }
      : { items: [{ id: teamId, name: "Equipe", active: true, buildingId: "one" }], nextCursor: null },
    write: async (method: string, path: string, body: any): Promise<unknown> => path.endsWith("/notes") ? { id, kind: "NOTE", note: body.note, createdAt: "2026-10-12T10:00:00Z" }
      : order({ ...body, version: method === "PATCH" || path.endsWith("/status") ? body.version + 1 : 1 }),
  };
  const api = { async get(path: string) {
    calls.push({ method: "GET", path });
    if (path.startsWith("/features/")) return { items: [] };
    if (path.startsWith("/v1/authorization?")) return { buildingId: new URL(path, "https://fixture.invalid").searchParams.get("buildingId"), capabilities: state.capabilities };
    if (path.startsWith("/overview/")) return null;
    if (path.startsWith("/v1/work-orders?")) return state.read();
    if (path.startsWith("/v1/tenancy/")) return state.directory(path);
    if (path.startsWith("/v1/work-orders/")) return { ...state.list.items[0], events: [{ id, actorId: "manager", kind: "CREATED", note: "", fromStatus: null, toStatus: null, createdAt: "2026-10-12T10:00:00Z" }] };
    throw new Error(`unexpected route ${path}`);
  }, async post(path: string, body: unknown) { calls.push({ method: "POST", path, body }); return state.write("POST", path, body); },
    async patch(path: string, body: unknown) { calls.push({ method: "PATCH", path, body }); return state.write("PATCH", path, body); } } as unknown as ApiClient;
  const render = (options: { userId?: string; buildingId?: string; scopeBuilding?: string; api?: ApiClient; strict?: boolean; session?: string } = {}) => {
    const buildingId = options.buildingId ?? "one", userId = options.userId ?? "manager";
    const child = React.createElement(WorkOrders, { key: options.session ?? "session", api: options.api ?? api, userId, buildingId,
      scope: { buildingId: options.scopeBuilding ?? buildingId, capabilities: state.capabilities, features: [] } });
    return options.strict ? React.createElement(React.StrictMode, null, child) : child;
  };
  const building = (product: Product = "operations") => React.createElement(BuildingApp, { api, product,
    user: { id: "manager", name: "Fixture", email: "fixture@example.test", role: "MAINTENANCE_MANAGER", memberships: [] },
    building: { id: "one", name: "Prédio", code: "CI" }, chooseBuilding() {}, accessIntents: createAccessIntentStore(() => "fixture-id") });
  return { state, calls, api, render, building, writes: () => calls.filter(call => call.method !== "GET"), directories: () => calls.filter(call => call.path.startsWith("/v1/tenancy/")), reads: () => calls.filter(call => call.path.startsWith("/v1/work-orders?")).length };
}
async function mount(f: ReturnType<typeof fixture>, options: Parameters<typeof f.render>[0] = {}) { let tree!: Tree; await act(async () => { tree = create(f.render(options)); }); return tree; }
async function unmount(tree: Tree) { await act(async () => { tree.unmount(); }); assert.equal(host.listenerCount(), 0); }

for (const os of ["android", "ios"]) {
test(`${os}: validated current list gates create/assign and directories stay untouched before opening`, async () => {
  host.resetHost(os); const f = fixture(); const pending = deferred(); f.state.read = () => pending.promise; const tree = await mount(f);
  try {
    assert.equal(button(tree, "Nova ordem"), undefined); assert.equal(f.directories().length, 0);
    await act(async () => { pending.resolve(f.state.list); await pending.promise; });
    assert.ok(button(tree, "Nova ordem")); assert.ok(button(tree, "Atribuir")); assert.equal(f.directories().length, 0);
    await press(tree, "Nova ordem"); assert.equal(f.directories().length, 2);
    assert.ok(button(tree, "Pessoa: Pessoa")); assert.ok(button(tree, "Equipe: Equipe")); assert.ok(button(tree, "Sem responsável"));
    assert.equal(text(tree).includes("private@example.test"), false); assert.equal(button(tree, "Eu"), undefined);
    assert.equal(tree.root.findAllByType("NativeScrollView").length, 0);
  } finally { await unmount(tree); }
});

test(`${os}: list mismatch, absent hint, scope mismatch and assigned read-only never offer writing`, async () => {
  for (const variant of ["mismatch", "absent", "scope", "readOnly", "execution"]) {
    host.resetHost(os); const f = fixture();
    if (variant === "mismatch") f.state.list.items = [order({ buildingId: "two" })];
    if (variant === "absent") delete f.state.list.canDistribute;
    if (variant === "readOnly") { f.state.capabilities = ["work-orders:read-assigned"]; f.state.list = { ...f.state.list, canDistribute: false, items: [order({ assignedToMe: true })] }; }
    if (variant === "execution") { f.state.capabilities = ["work-orders:read-assigned", "work-orders:update-assigned"]; f.state.list = { ...f.state.list, canDistribute: false, items: [order({ assignedToMe: true })] }; }
    const tree = await mount(f, variant === "scope" ? { scopeBuilding: "two" } : {});
    try {
      assert.equal(button(tree, "Nova ordem"), undefined, variant); assert.equal(button(tree, "Atribuir"), undefined, variant); assert.equal(f.directories().length, 0);
      if (variant === "mismatch" || variant === "absent") { assert.equal(text(tree).includes("Bomba"), false); continue; }
      await press(tree, "Histórico"); assert.ok(text(tree).includes("Ordem aberta"));
      assert.equal(Boolean(input(tree, "Anotação")), variant === "execution"); assert.equal(Boolean(button(tree, "Iniciar")), variant === "execution");
    } finally { await unmount(tree); }
  }
});

test(`${os}: manager has teams only, building admin has both, and teams manage does not grant teams read`, async () => {
  for (const capabilities of [["work-orders:assign", "teams:read"], grants, ["work-orders:assign", "teams:manage"], ["work-orders:assign"]]) {
    host.resetHost(os); const f = fixture(); f.state.capabilities = capabilities as Grant[]; const tree = await mount(f);
    try {
      await press(tree, "Nova ordem"); assert.equal(f.directories().some(call => call.path.includes("/people?")), capabilities.includes("memberships:manage") || capabilities.includes("teams:manage"));
      assert.equal(f.directories().some(call => call.path.includes("/teams?")), capabilities.includes("teams:read"));
      assert.ok(button(tree, "Sem responsável"));
      if (!capabilities.includes("teams:read")) assert.ok(text(tree).includes("Equipes indisponíveis no acesso atual."));
    } finally { await unmount(tree); }
  }
});

test(`${os}: POST and PATCH select person, team or clear with exact captured payload and one send`, async () => {
  for (const [label, assignment] of [["Pessoa: Pessoa", { assignedUserId: "person-one", assignedTeamId: null }], ["Equipe: Equipe", { assignedUserId: null, assignedTeamId: teamId }], ["Sem responsável", { assignedUserId: null, assignedTeamId: null }]] as const) {
    host.resetHost(os); const f = fixture(); const tree = await mount(f);
    try {
      await press(tree, "Nova ordem"); await fill(tree, "Título", "  Bomba "); await fill(tree, "Descrição", " Verificar "); await press(tree, "Prioridade alta"); await press(tree, label);
      const wait = deferred(); f.state.write = () => wait.promise; const submit = button(tree, "Criar ordem");
      await act(async () => { submit.props.onPress(); submit.props.onPress(); }); assert.equal(f.writes().length, 1);
      assert.deepEqual(f.writes()[0], { method: "POST", path: "/v1/work-orders", body: { buildingId: "one", title: "Bomba", description: "Verificar", priority: "HIGH", ...assignment } });
      await act(async () => { wait.resolve(order({ priority: "HIGH", ...assignment })); await wait.promise; });
      assert.equal(input(tree, "Título"), undefined); assert.ok(text(tree).includes("Ordem de serviço criada.")); assert.equal(f.reads(), 2);
      f.state.write = async (_method, _path, body) => order({ ...body, version: body.version + 1 });
      await press(tree, "Atribuir"); await press(tree, label); await press(tree, "Salvar responsável");
      assert.deepEqual(f.writes().at(-1), { method: "PATCH", path: `/v1/work-orders/${id}`, body: { version: 1, ...assignment } });
    } finally { await unmount(tree); }
  }
});

test(`${os}: title and description bounds, default priority and searchable current options`, async () => {
  host.resetHost(os); const f = fixture(); const tree = await mount(f);
  try {
    await press(tree, "Nova ordem"); assert.equal(input(tree, "Título").props.maxLength, 160); assert.equal(input(tree, "Descrição").props.maxLength, 4000);
    await fill(tree, "Título", "x".repeat(161)); await press(tree, "Criar ordem"); assert.equal(f.writes().length, 0);
    await fill(tree, "Título", "Bomba"); await fill(tree, "Descrição", "x".repeat(4001)); await press(tree, "Criar ordem"); assert.equal(f.writes().length, 0);
    await fill(tree, "Descrição", "Verificar"); await fill(tree, "Buscar pessoas", "none"); assert.equal(button(tree, "Pessoa: Pessoa"), undefined);
    await fill(tree, "Buscar pessoas", "Pessoa"); assert.ok(button(tree, "Pessoa: Pessoa")); await press(tree, "Criar ordem"); assert.equal(f.writes()[0]?.body.priority, "NORMAL");
  } finally { await unmount(tree); }
});

test(`${os}: separate explicit directory pages, network feedback and 403 clear only the denied source`, async () => {
  host.resetHost(os); const f = fixture(); f.state.directory = async path => path.includes("/people?")
    ? { items: [{ id: "person-one", name: "Pessoa" }], nextCursor: "person-one" }
    : { items: [{ id: teamId, name: "Equipe", active: true, buildingId: "one" }], nextCursor: teamId };
  const tree = await mount(f);
  try {
    await press(tree, "Nova ordem"); assert.equal(f.directories().length, 2); await press(tree, "Pessoa: Pessoa");
    f.state.directory = async path => path.includes("/people?") ? { items: [{ id: "person-two", name: "Outra" }], nextCursor: null } : { items: [], nextCursor: null };
    await press(tree, "Carregar mais pessoas"); assert.equal(f.directories().length, 3); assert.ok(f.directories().at(-1)?.path.endsWith("after=person-one")); assert.ok(button(tree, "Pessoa: Outra"));
    f.state.directory = async () => { throw new TypeError("secret network"); }; await press(tree, "Carregar mais equipes");
    assert.ok(button(tree, "Equipe: Equipe")); assert.ok(text(tree).includes("Não foi possível carregar o diretório.")); assert.equal(text(tree).includes("secret"), false);
    f.state.directory = async () => { throw new ApiError(403, "secret denied"); }; await press(tree, "Tentar carregar equipes");
    assert.equal(button(tree, "Equipe: Equipe"), undefined); assert.ok(button(tree, "Pessoa: Pessoa"));
    assert.ok(text(tree).includes("Equipes indisponíveis no acesso atual."));
  } finally { await unmount(tree); }
});

test(`${os}: 400 is corrigible and 403, 404, 409 close with fixed feedback and fresh version only`, async () => {
  for (const status of [400, 403, 404, 409]) {
    host.resetHost(os); const f = fixture(); const tree = await mount(f);
    try {
      await press(tree, "Atribuir"); f.state.write = async () => { throw new ApiError(status, "SECRET BACKEND"); }; await press(tree, "Salvar responsável");
      assert.equal(text(tree).includes("SECRET"), false); assert.equal(Boolean(button(tree, "Salvar responsável")), status === 400); assert.equal(f.reads(), status === 400 ? 1 : 2);
      if (status === 400) { assert.ok(text(tree).includes("Revise os dados")); await press(tree, "Equipe: Equipe"); assert.equal(f.writes().length, 1); }
      if (status === 409) {
        await press(tree, "Atribuir"); assert.equal(button(tree, "Salvar responsável"), undefined); assert.equal(f.writes().length, 1);
        f.state.list = { ...f.state.list, items: [order({ version: 2 })] }; await press(tree, "Atualizar"); await press(tree, "Atribuir"); assert.ok(button(tree, "Salvar responsável"));
      }
    } finally { await unmount(tree); }
  }
});

test(`${os}: uncertain POST/PATCH offers list check or back without any automatic resend`, async () => {
  for (const mode of ["create", "assign"]) for (const failure of ["network", "5xx", "incompatible"]) {
    host.resetHost(os); const f = fixture(); const tree = await mount(f);
    try {
      await press(tree, mode === "create" ? "Nova ordem" : "Atribuir"); if (mode === "create") { await fill(tree, "Título", "Bomba"); await fill(tree, "Descrição", "Verificar"); }
      f.state.write = async () => { if (failure === "network") throw new TypeError("secret"); if (failure === "5xx") throw new ApiError(500, "secret"); return order({ buildingId: "two" }); };
      const label = mode === "create" ? "Criar ordem" : "Salvar responsável"; await press(tree, label);
      assert.ok(text(tree).includes("Não foi possível confirmar a gravação.")); assert.equal(button(tree, label).props.disabled, true);
      await press(tree, label); assert.equal(f.writes().length, 1); await press(tree, "Conferir lista"); assert.equal(f.reads(), 2); assert.equal(button(tree, label), undefined);
      await press(tree, mode === "create" ? "Nova ordem" : "Atribuir"); assert.ok(button(tree, label)); assert.equal(f.writes().length, 1);
    } finally { await unmount(tree); }
  }
});

test(`${os}: current capability/list revocation and scope replacement clear private drafts and stale callbacks`, async () => {
  for (const change of ["capability", "list", "api", "user", "building", "session", "version"]) {
    host.resetHost(os); const f = fixture(); const tree = await mount(f);
    try {
      await press(tree, change === "version" ? "Atribuir" : "Nova ordem");
      if (change !== "version") await fill(tree, "Título", "PRIVATE DRAFT");
      await press(tree, "Pessoa: Pessoa"); const oldSubmit = button(tree, change === "version" ? "Salvar responsável" : "Criar ordem").props.onPress;
      if (change === "capability") { f.state.capabilities = ["work-orders:read-assigned"]; await act(async () => { tree.update(f.render()); }); }
      if (change === "list") { f.state.list = { ...f.state.list, canDistribute: false }; await press(tree, "Atualizar"); }
      if (change === "api") await act(async () => { tree.update(f.render({ api: { ...f.api } })); });
      if (change === "user") await act(async () => { tree.update(f.render({ userId: "other-user" })); });
      if (change === "building") { f.state.list.items = [order({ buildingId: "two" })]; await act(async () => { tree.update(f.render({ buildingId: "two" })); }); }
      if (change === "session") await act(async () => { tree.update(f.render({ session: "new-session" })); });
      if (change === "version") { f.state.list.items = [order({ version: 2 })]; await press(tree, "Atualizar"); }
      assert.equal(text(tree).includes("PRIVATE DRAFT"), false, change); assert.equal(button(tree, "Pessoa: Pessoa"), undefined, change);
      await act(async () => { oldSubmit(); }); assert.equal(f.writes().length, 0, change);
    } finally { await unmount(tree); }
  }
});

test(`${os}: background and unmount ignore late writes; foreground reads evidence and never replays`, async () => {
  for (const outcome of ["success", "error"]) {
    host.resetHost(os); const f = fixture(); const tree = await mount(f);
    try {
      await press(tree, "Nova ordem"); await fill(tree, "Título", "Bomba"); await fill(tree, "Descrição", "Verificar");
      const pending = deferred(); f.state.write = () => pending.promise; await press(tree, "Criar ordem");
      await act(async () => { host.changeAppState("background"); }); assert.equal(input(tree, "Título"), undefined); assert.equal(button(tree, "Pessoa: Pessoa"), undefined);
      const foreground = deferred(); f.state.read = () => foreground.promise; await act(async () => { host.changeAppState("active"); }); assert.equal(button(tree, "Nova ordem"), undefined);
      await act(async () => { foreground.resolve(f.state.list); await foreground.promise; }); await press(tree, "Nova ordem"); await fill(tree, "Título", "Novo rascunho");
      const before = f.reads(); await act(async () => { if (outcome === "success") pending.resolve(order()); else pending.reject(new ApiError(500, "secret late")); await pending.promise.catch(() => {}); });
      assert.equal(input(tree, "Título").props.value, "Novo rascunho"); assert.equal(text(tree).includes("confirmar"), false); assert.equal(text(tree).includes("criada."), false); assert.equal(f.reads(), before); assert.equal(f.writes().length, 1);
    } finally { await unmount(tree); }
  }
  host.resetHost(os); const f = fixture(); const tree = await mount(f); await press(tree, "Nova ordem"); await fill(tree, "Título", "Bomba");
  const pending = deferred(); f.state.write = () => pending.promise; await press(tree, "Criar ordem"); const before = f.reads(); await unmount(tree);
  await act(async () => { pending.reject(new ApiError(500, "late unmount")); await pending.promise.catch(() => {}); }); assert.equal(f.reads(), before);
});

test(`${os}: execution, finish confirmation and history survive; finished work cannot be assigned`, async () => {
  host.resetHost(os); const f = fixture(); f.state.capabilities = ["work-orders:read-assigned", "work-orders:update-assigned"];
  f.state.list = { ...f.state.list, canDistribute: false, items: [order({ status: "IN_PROGRESS", assignedToMe: true })] }; const tree = await mount(f);
  try {
    assert.ok(button(tree, "Pausar")); await press(tree, "Concluir"); assert.equal(f.writes().length, 0); assert.equal(host.alerts.at(-1)?.title, "Concluir?");
    await act(async () => { host.alerts.at(-1)?.buttons.find(button => button.text === "Concluir")?.onPress?.(); }); assert.deepEqual(f.writes()[0]?.body, { version: 1, status: "DONE" });
    await press(tree, "Histórico"); await fill(tree, "Anotação", " Observação "); await press(tree, "Registrar anotação"); assert.deepEqual(f.writes().at(-1)?.body, { note: "Observação" });
    f.state.capabilities = [...grants]; f.state.list = { ...f.state.list, canDistribute: true, items: [order({ status: "DONE" })] }; await act(async () => { tree.update(f.render()); }); await press(tree, "Todas");
    assert.equal(button(tree, "Atribuir"), undefined); assert.equal(button(tree, "Concluir"), undefined);
  } finally { await unmount(tree); }
});

test(`${os}: BuildingApp passes current authority, preserves native hosts and resident never mounts WorkOrders`, async (t) => {
  host.resetHost(os); t.mock.timers.enable({ apis: ["setTimeout"] }); const f = fixture(); let tree!: Tree;
  await act(async () => { tree = create(f.building()); });
  try {
    await press(tree, "Ordens de serviço"); assert.ok(button(tree, "Nova ordem")); await press(tree, "Nova ordem"); await fill(tree, "Título", "PRIVATE");
    assert.equal(tree.root.findAllByType("NativeScrollView").length, 2);
    f.state.capabilities = ["work-orders:read-assigned"]; await act(async () => { t.mock.timers.tick(15_000); });
    assert.equal(button(tree, "Nova ordem"), undefined); assert.equal(text(tree).includes("PRIVATE"), false);
  } finally { await unmount(tree); }
  await act(async () => { tree = create(f.building("resident")); });
  try { assert.equal(button(tree, "Ordens de serviço"), undefined); assert.equal(tree.root.findAllByType(WorkOrders).length, 0); }
  finally { await unmount(tree); }
});

test(`${os}: StrictMode mounts remain usable and listeners are removed exactly once`, async () => {
  host.resetHost(os); const f = fixture(); const tree = await mount(f, { strict: true });
  try { await press(tree, "Nova ordem"); assert.ok(input(tree, "Título")); assert.equal(f.directories().length, 2); }
  finally { await unmount(tree); }
  assert.equal(host.events.filter(event => event.kind === "listener-add").length, host.events.filter(event => event.kind === "listener-remove").length);
});

test(`${os}: stale form handlers cannot overwrite, submit or close a newly opened draft`, async () => {
  host.resetHost(os); const f = fixture(); const tree = await mount(f);
  try {
    await press(tree, "Nova ordem"); await fill(tree, "Título", "Primeira");
    const oldChange = input(tree, "Título").props.onChangeText, oldSubmit = button(tree, "Criar ordem").props.onPress, oldClose = button(tree, "Voltar").props.onPress;
    await press(tree, "Voltar"); await press(tree, "Nova ordem"); await fill(tree, "Título", "Nova ficha");
    await act(async () => { oldChange("PRIVATE OLD CALLBACK"); oldSubmit(); oldClose(); });
    assert.ok(input(tree, "Título"), "old close must leave the current form open"); assert.equal(input(tree, "Título").props.value, "Nova ficha"); assert.equal(f.writes().length, 0);
  } finally { await unmount(tree); }
});

test(`${os}: reopening create clears both private searches and old search callbacks cannot touch the new form`, async () => {
  host.resetHost(os); const f = fixture(); const tree = await mount(f);
  try {
    await press(tree, "Nova ordem"); await fill(tree, "Buscar pessoas", "Pessoa"); await fill(tree, "Buscar equipes", "Equipe");
    const oldPeopleSearch = input(tree, "Buscar pessoas").props.onChangeText;
    const oldTeamsSearch = input(tree, "Buscar equipes").props.onChangeText;
    const initialReads = f.reads(); assert.equal(f.directories().length, 2);
    await press(tree, "Nova ordem");
    // Each explicit new opening has exactly one fresh GET per permitted source.
    assert.equal(f.directories().length, 4); assert.equal(f.reads(), initialReads); assert.equal(f.writes().length, 0);
    const afterReopen = { people: input(tree, "Buscar pessoas").props.value, teams: input(tree, "Buscar equipes").props.value };
    await fill(tree, "Título", "Nova ficha");
    await act(async () => { oldPeopleSearch("PRIVATE OLD PEOPLE QUERY"); oldTeamsSearch("PRIVATE OLD TEAMS QUERY"); });
    assert.equal(input(tree, "Buscar pessoas").props.value, ""); assert.equal(input(tree, "Buscar equipes").props.value, "");
    assert.equal(afterReopen.people, "", "new form clears the old people search");
    assert.equal(afterReopen.teams, "", "new form clears the old teams search");
    assert.equal(input(tree, "Título").props.value, "Nova ficha"); assert.ok(button(tree, "Pessoa: Pessoa")); assert.ok(button(tree, "Equipe: Equipe"));
    assert.equal(text(tree).includes("PRIVATE OLD"), false); assert.equal(f.directories().length, 4); assert.equal(f.reads(), initialReads); assert.equal(f.writes().length, 0);
  } finally { await unmount(tree); }
});

test(`${os}: an old Conferir lista callback cannot close or reload a newly opened draft`, async () => {
  host.resetHost(os); const f = fixture(); const tree = await mount(f);
  try {
    await press(tree, "Nova ordem"); await fill(tree, "Título", "Bomba");
    f.state.write = async () => { throw new TypeError("network"); }; await press(tree, "Criar ordem");
    const oldCheck = button(tree, "Conferir lista").props.onPress; await press(tree, "Conferir lista");
    await press(tree, "Nova ordem"); await fill(tree, "Título", "Nova ficha"); await press(tree, "Equipe: Equipe");
    const reads = f.reads(), directories = f.directories().length;
    await act(async () => { oldCheck(); });
    assert.ok(input(tree, "Título"), "old check must leave the new form open"); assert.equal(input(tree, "Título").props.value, "Nova ficha");
    assert.deepEqual(tree.root.findAllByType(WorkOrderDistributionScreen)[0].props.state.selection, { kind: "team", id: teamId });
    assert.equal(f.reads(), reads); assert.equal(f.directories().length, directories); assert.equal(f.writes().length, 1);
  } finally { await unmount(tree); }
});

test(`${os}: old create and assign callbacks preserve the current draft while current controls still open forms`, async () => {
  host.resetHost(os); const f = fixture(); const tree = await mount(f);
  try {
    const oldCreate = button(tree, "Nova ordem").props.onPress, oldAssign = button(tree, "Atribuir").props.onPress;
    await press(tree, "Nova ordem"); await fill(tree, "Título", "Nova ficha"); await press(tree, "Pessoa: Pessoa");
    const reads = f.reads(), directories = f.directories().length;
    await act(async () => { oldCreate(); oldAssign(); });
    assert.ok(input(tree, "Título"), "old openings must leave the current create form open"); assert.equal(input(tree, "Título").props.value, "Nova ficha");
    assert.deepEqual(tree.root.findAllByType(WorkOrderDistributionScreen)[0].props.state.selection, { kind: "person", id: "person-one" });
    assert.equal(f.reads(), reads); assert.equal(f.directories().length, directories); assert.equal(f.writes().length, 0);
    await press(tree, "Atribuir"); assert.ok(button(tree, "Salvar responsável"));
    await press(tree, "Nova ordem"); assert.ok(input(tree, "Título")); assert.equal(input(tree, "Título").props.value, "");
    assert.equal(f.directories().length, directories + 4); assert.equal(f.writes().length, 0);
  } finally { await unmount(tree); }
});
}
