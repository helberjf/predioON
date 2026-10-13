import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import ts from "typescript";
import { ApiError, type ApiClient } from "@predioon/api-client";
import type { Feature, Grant, Product } from "../src/scope.ts";
import { createAccessIntentStore } from "../src/access-intents.ts";

// Instrumented native host exercises real React handlers and resource lifecycle.
// It does not establish Fabric, Hermes or device acceptance.
const require = createRequire(import.meta.url);
const { act, create } = require("react-test-renderer");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, __DEV__: false });
const hostUrl = new URL("./fixtures/consumption-screen-host.mjs", import.meta.url).href;
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
const appUrl = new URL("../src/app.tsx", import.meta.url).href;
const { BuildingApp } = await import(appUrl);
const host = await import(hostUrl) as { resetHost(os: string): void; changeAppState(state: string): void; listenerCount(): number; events: { kind: string; instance: number }[] };
type Tree = ReturnType<typeof create>;
function text(tree: Tree) { return JSON.stringify(tree.toJSON()); }
function button(tree: Tree, label: string) {
  return tree.root.findAllByType("NativePressable").find((node: any) => node.findAllByType("NativeText").some((node: any) => node.props.children === label));
}
function deferred<T = unknown>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const publication = (buildingId = "one") => ({ buildingId, day: "2024-03-02", items: [
  { kind: "ENERGY", unit: "kWh", today: 0, history: [{ day: "2024-02-29", quantity: 1.25, incomplete: true }, { day: "2024-03-02", quantity: 0, incomplete: false }] },
  { kind: "WATER", unit: "m³", today: null, history: [] },
] });
const user = { id: "resident-one", name: "Fixture", email: "fixture@example.test", role: "RESIDENT", memberships: [] };
function fixture() {
  const paths: string[] = [];
  const state = { capabilities: ["gates:read", "monitoring:read-published"] as Grant[], features: [{ key: "ENERGY_CONSUMPTION", enabled: true, version: 1 }, { key: "WATER_CONSUMPTION", enabled: true, version: 1 }] as Feature[], read: (_buildingId: string): Promise<unknown> => Promise.resolve(publication(_buildingId)) };
  const api = { async get<T>(path: string): Promise<T> {
    paths.push(path);
    if (path.startsWith("/features/")) return { items: state.features } as T;
    const buildingId = new URL(path, "https://fixture.invalid").searchParams.get("buildingId")!;
    if (path.startsWith("/v1/authorization")) return { buildingId, capabilities: state.capabilities } as T;
    if (path.startsWith("/overview/")) return null as T;
    if (path.startsWith("/monitoring/published?")) return await state.read(buildingId) as T;
    throw new Error(`unexpected fixture route: ${path}`);
  } } as ApiClient;
  const count = () => paths.filter(path => path.startsWith("/monitoring/published?")).length;
  const render = (options: { product?: Product; buildingId?: string; userId?: string; client?: ApiClient; strict?: boolean; session?: string } = {}) => {
    const buildingId = options.buildingId ?? "one"; const userId = options.userId ?? user.id;
    const child = React.createElement(BuildingApp, { key: `${options.session ?? "session"}:${userId}:${buildingId}`, api: options.client ?? api, product: options.product ?? "resident", user: { ...user, id: userId }, building: { id: buildingId, name: `Prédio ${buildingId}`, code: "CI" }, chooseBuilding() {}, accessIntents: createAccessIntentStore(() => "fixture-id") });
    return options.strict ? React.createElement(React.StrictMode, null, child) : child;
  };
  return { state, paths, api, count, render };
}

for (const os of ["android", "ios"]) {
  test(`${os}: menu and screen share one validated GET per cycle, preserving null, zero, civil days and partial readings`, async (t) => {
    host.resetHost(os); t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture(); const pending = deferred(); f.state.read = () => pending.promise;
    let tree!: Tree;
    await act(async () => { tree = create(f.render()); });
    try {
      assert.equal(f.count(), 1, "authorized resident must probe the real public route");
      assert.equal(button(tree, "Consumo"), undefined, "first pending response must not create navigation");
      assert.equal(text(tree).includes("Energia das áreas comuns"), false);
      await act(async () => { pending.resolve(publication()); await pending.promise; });
      assert.ok(button(tree, "Consumo"));
      await act(async () => { button(tree, "Consumo").props.onPress(); });
      assert.equal(f.count(), 1, "entering the screen must reuse navigation's response");
      for (const value of ["Consumo do condomínio", "Últimos 7 dias", "Energia das áreas comuns", "Água do condomínio", "Sem medição", "Parcial", "0,0 kWh", "25/02", "29/02", "02/03"]) assert.ok(text(tree).includes(value), value);
      assert.equal(tree.root.findAllByType("NativeScrollView").length, 2, "only existing menu and building scroll hosts");
      const oldView = host.events.find(event => event.kind === "view-mount")!.instance;
      f.state.read = async () => publication();
      await act(async () => { tree.update(f.render()); });
      assert.equal(f.count(), 1, "ordinary render must keep reader identity stable");
      await act(async () => { t.mock.timers.tick(15_000); });
      assert.equal(f.count(), 2, "one public GET at the next shared poll");
      if (os === "android") assert.equal(host.events.some(event => event.kind === "view-unmount" && event.instance === oldView), false);
      const before = f.count(); await act(async () => { button(tree, "Atualizar").props.onPress(); });
      assert.equal(f.count(), before + 1);
    } finally { await act(async () => { tree.unmount(); }); }
    assert.equal(host.listenerCount(), 0);
  });

  test(`${os}: denial removes the menu and quantities, re-release requires a new validated read`, async (t) => {
    host.resetHost(os); t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture(); f.state.read = async () => { throw new ApiError(403, "secret denied"); };
    let tree!: Tree; await act(async () => { tree = create(f.render()); });
    try {
      assert.equal(f.count(), 1); assert.equal(button(tree, "Consumo"), undefined);
      assert.equal(text(tree).includes("secret"), false); assert.equal(button(tree, "Tentar novamente"), undefined);
      f.state.read = async () => publication(); await act(async () => { t.mock.timers.tick(15_000); });
      assert.ok(button(tree, "Consumo")); assert.ok(text(tree).includes("0,0 kWh"));
      f.state.read = async () => { throw new ApiError(403, "secret revoked"); }; await act(async () => { t.mock.timers.tick(15_000); });
      assert.equal(button(tree, "Consumo"), undefined); assert.equal(text(tree).includes("0,0 kWh"), false);
      assert.ok(text(tree).includes("Sem módulos disponíveis"));
      const again = deferred(); f.state.read = () => again.promise; await act(async () => { t.mock.timers.tick(15_000); });
      assert.equal(button(tree, "Consumo"), undefined);
      await act(async () => { again.resolve(publication()); await again.promise; }); assert.ok(button(tree, "Consumo"));
    } finally { await act(async () => { tree.unmount(); }); }
    assert.equal(host.listenerCount(), 0);
  });

  test(`${os}: failures before first availability remain sanitized errors with real retry in building context`, async () => {
    host.resetHost(os); const f = fixture(); f.state.read = async () => { throw new ApiError(500, "secret tariff meter and reservoir"); };
    let tree!: Tree; await act(async () => { tree = create(f.render()); });
    try {
      assert.equal(f.count(), 1); assert.equal(button(tree, "Consumo"), undefined);
      assert.ok(text(tree).includes("Não foi possível carregar o consumo do condomínio."));
      assert.equal(text(tree).includes("secret"), false); assert.equal(text(tree).includes("não liberado"), false);
      f.state.read = async () => publication(); await act(async () => { button(tree, "Tentar novamente").props.onPress(); });
      assert.equal(f.count(), 2); assert.ok(button(tree, "Consumo"));
      f.state.read = async () => ({ ...publication(), buildingId: "other" }); await act(async () => { button(tree, "Atualizar").props.onPress(); });
      assert.equal(button(tree, "Consumo"), undefined); assert.equal(text(tree).includes("0,0 kWh"), false);
      assert.ok(button(tree, "Tentar novamente"));
    } finally { await act(async () => { tree.unmount(); }); }
  });
}

test("technical gates and the operations product never request or expose resident consumption", async () => {
  for (const variant of ["operations", "technical", "pump", "water-tank", "disabled"]) {
    host.resetHost("android"); const f = fixture();
    if (variant === "technical") f.state.capabilities = ["gates:read", "telemetry:read", "buildings:manage"];
    if (variant === "pump" || variant === "water-tank") f.state.features = [{ key: variant === "pump" ? "PUMP" : "WATER_TANK", enabled: true }];
    if (variant === "disabled") f.state.features = [{ key: "ENERGY_CONSUMPTION", enabled: false }];
    let tree!: Tree; await act(async () => { tree = create(f.render({ product: variant === "operations" ? "operations" : "resident" })); });
    try { assert.equal(f.count(), 0, variant); assert.equal(button(tree, "Consumo"), undefined); }
    finally { await act(async () => { tree.unmount(); }); }
    assert.equal(host.listenerCount(), 0);
  }
});

for (const os of ["android", "ios"]) {
test(`${os}: module revision changes clear previous publication and require another response even while enabled`, async (t) => {
  host.resetHost(os); t.mock.timers.enable({ apis: ["setTimeout"] }); const f = fixture();
  let tree!: Tree; await act(async () => { tree = create(f.render()); });
  try {
    assert.ok(button(tree, "Consumo"));
    for (const patch of [{ version: 2 }, { globalVersion: 3 }, { resumedAt: "2024-03-02T00:00:00Z" }]) {
      const before = f.count(); const pending = deferred(); f.state.read = () => pending.promise;
      f.state.features = f.state.features.map(feature => feature.key === "ENERGY_CONSUMPTION" ? { ...feature, ...patch } : feature);
      await act(async () => { t.mock.timers.tick(15_000); });
      assert.ok(f.count() > before, "a current feature revision must start a fresh public read");
      assert.equal(button(tree, "Consumo"), undefined); assert.equal(text(tree).includes("0,0 kWh"), false);
      await act(async () => { pending.resolve(publication()); await pending.promise; }); assert.ok(button(tree, "Consumo"));
    }
  } finally { await act(async () => { tree.unmount(); }); }
});

test(`${os}: capability or feature revocation removes publication on the current authorization render`, async (t) => {
  host.resetHost(os); t.mock.timers.enable({ apis: ["setTimeout"] }); const f = fixture();
  let tree!: Tree; await act(async () => { tree = create(f.render()); });
  try {
    assert.ok(button(tree, "Consumo"));
    f.state.features = [{ key: "ENERGY_CONSUMPTION", enabled: false }, { key: "WATER_CONSUMPTION", enabled: false }];
    await act(async () => { t.mock.timers.tick(15_000); });
    assert.equal(button(tree, "Consumo"), undefined); assert.equal(text(tree).includes("0,0 kWh"), false);
    f.state.features = [{ key: "ENERGY_CONSUMPTION", enabled: true }]; await act(async () => { t.mock.timers.tick(15_000); }); assert.ok(button(tree, "Consumo"));
    f.state.capabilities = ["gates:read"]; await act(async () => { t.mock.timers.tick(15_000); });
    assert.equal(button(tree, "Consumo"), undefined); assert.equal(text(tree).includes("0,0 kWh"), false);
  } finally { await act(async () => { tree.unmount(); }); }
});

test(`${os}: background clears publication and ignores late errors until a fresh foreground read`, async () => {
  host.resetHost(os); const f = fixture(); const pending = deferred(); f.state.read = () => pending.promise;
  let tree!: Tree; await act(async () => { tree = create(f.render()); });
  try {
    assert.equal(f.count(), 1);
    await act(async () => { host.changeAppState("background"); }); assert.equal(button(tree, "Consumo"), undefined);
    f.state.read = async () => publication();
    await act(async () => { host.changeAppState("active"); });
    await act(async () => { pending.reject(new ApiError(500, "secret late error")); await pending.promise.catch(() => {}); });
    assert.ok(button(tree, "Consumo")); assert.equal(text(tree).includes("Não foi possível"), false);
    await act(async () => { host.changeAppState("background"); }); assert.equal(button(tree, "Consumo"), undefined); assert.equal(text(tree).includes("0,0 kWh"), false);
    const foreground = deferred(); f.state.read = () => foreground.promise; await act(async () => { host.changeAppState("active"); });
    assert.equal(button(tree, "Consumo"), undefined);
    await act(async () => { foreground.resolve(publication()); await foreground.promise; }); assert.ok(button(tree, "Consumo"));
  } finally { await act(async () => { tree.unmount(); }); }
  assert.equal(host.listenerCount(), 0);
});

test(`${os}: building, user and session replacements isolate old success/error and dispose every listener`, async () => {
  for (const replacement of [{ buildingId: "two" }, { userId: "resident-two" }, { session: "new-session" }]) for (const outcome of ["success", "error"]) {
    host.resetHost(os); const f = fixture(); const old = deferred(); f.state.read = () => old.promise;
    let tree!: Tree; await act(async () => { tree = create(f.render()); });
    try {
      assert.equal(f.count(), 1); const next = deferred(); f.state.read = () => next.promise;
      await act(async () => { tree.update(f.render(replacement)); });
      await act(async () => { if (outcome === "success") old.resolve(publication()); else old.reject(new ApiError(500, "secret late context")); await old.promise.catch(() => {}); });
      assert.equal(button(tree, "Consumo"), undefined); assert.equal(text(tree).includes("0,0 kWh"), false);
      assert.equal(text(tree).includes("Não foi possível carregar o consumo"), false);
      await act(async () => { next.resolve(publication(replacement.buildingId ?? "one")); await next.promise; });
      assert.ok(button(tree, "Consumo"));
    } finally { await act(async () => { tree.unmount(); }); }
    assert.equal(host.listenerCount(), 0);
    assert.equal(host.events.filter(event => event.kind === "listener-add").length, host.events.filter(event => event.kind === "listener-remove").length);
  }
});

test(`${os}: StrictMode cleanup does not poison the next consumption response`, async () => {
  host.resetHost(os); const f = fixture(); let tree!: Tree;
  await act(async () => { tree = create(f.render({ strict: true })); });
  try { assert.equal(f.count(), 1); assert.ok(button(tree, "Consumo")); assert.ok(text(tree).includes("0,0 kWh")); }
  finally { await act(async () => { tree.unmount(); }); }
  assert.equal(host.listenerCount(), 0);
});

test(`${os}: empty or incompatible publication removes destination while an enabled empty item keeps Sem medição`, async () => {
  host.resetHost(os); const f = fixture();
  f.state.features = [{ key: "WATER_CONSUMPTION", enabled: true }];
  let tree!: Tree; await act(async () => { tree = create(f.render()); });
  try {
    assert.ok(button(tree, "Consumo")); assert.ok(text(tree).includes("Água do condomínio"));
    assert.equal(text(tree).includes("Energia das áreas comuns"), false); assert.ok(text(tree).includes("Sem medição"));
    const waterZero = { buildingId: "one", day: "2024-03-02", items: [{ kind: "WATER", unit: "m³", today: 0, history: [{ day: "2024-03-02", quantity: 0, incomplete: true }] }] };
    f.state.read = async () => waterZero; await act(async () => { button(tree, "Atualizar").props.onPress(); }); assert.ok(text(tree).includes("0,0 m³"));
    f.state.read = async () => ({ ...publication(), items: [] }); await act(async () => { button(tree, "Atualizar").props.onPress(); });
    assert.equal(button(tree, "Consumo"), undefined); assert.equal(text(tree).includes("0,0 m³"), false);
  } finally { await act(async () => { tree.unmount(); }); }
  const incompatible = fixture(); incompatible.state.features = [{ key: "WATER_CONSUMPTION", enabled: true }]; incompatible.state.read = async () => ({ ...publication(), items: [publication().items[0]] });
  await act(async () => { tree = create(incompatible.render()); });
  try { assert.equal(button(tree, "Consumo"), undefined); assert.equal(text(tree).includes("Energia das áreas comuns"), false); }
  finally { await act(async () => { tree.unmount(); }); }
});

test(`${os}: success and error from an old enabled feature revision cannot replace current publication`, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const outcome of ["success", "error"]) {
    host.resetHost(os); const f = fixture(); let tree!: Tree;
    await act(async () => { tree = create(f.render()); });
    try {
      const old = deferred(), current = deferred(); let read = 0;
      f.state.read = () => (++read === 1 ? old.promise : current.promise);
      f.state.features = f.state.features.map(feature => ({ ...feature, version: 2 }));
      await act(async () => { t.mock.timers.tick(15_000); });
      assert.equal(read, 2, "a changed authority must replace the preceding generation");
      assert.equal(button(tree, "Consumo"), undefined);
      await act(async () => { current.resolve(publication()); await current.promise; });
      assert.ok(button(tree, "Consumo"));
      await act(async () => {
        if (outcome === "error") old.reject(new ApiError(500, "secret old feature"));
        else { const value = publication(); value.items[0]!.today = 999; value.items[0]!.history[1]!.quantity = 999; old.resolve(value); }
        await old.promise.catch(() => {});
      });
      assert.ok(button(tree, "Consumo")); assert.ok(text(tree).includes("0,0 kWh"));
      assert.equal(text(tree).includes("999,0"), false); assert.equal(text(tree).includes("Não foi possível carregar o consumo"), false);
    } finally { await act(async () => { tree.unmount(); }); }
    assert.equal(host.listenerCount(), 0);
  }
});
}
