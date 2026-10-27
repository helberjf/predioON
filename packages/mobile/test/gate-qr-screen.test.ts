import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import ts from "typescript";
import type { ApiClient } from "@predioon/api-client";
import type { AccessGateView } from "@predioon/contracts";
import { formatGateQr } from "@predioon/contracts/gate-qr";
import { createAccessIntentStore } from "../src/access-intents.ts";
import type { GateScannerProps } from "../src/access.tsx";

// Real React handlers on instrumented hosts; the camera itself is replaced by a
// prop, exactly as the operations app and these tests never load gate-scanner.tsx.
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
      const source = readFileSync(fileURLToPath(url), "utf8");
      return { format: "module", shortCircuit: true, source: ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    }
    return nextLoad(url, context);
  },
});
const { Access } = await import(new URL("../src/access.tsx", import.meta.url).href);
const host = await import(hostUrl) as {
  resetHost(os: string): void; changeAppState(state: string): void; listenerCount(): number;
  alerts: { title: string; buttons: { text: string; onPress?: () => void }[] }[];
};
type Tree = ReturnType<typeof create>;
const gateId = "03d72b85-895c-41df-b3d4-f91ae9ed7822";
const content = formatGateQr({ gateId, window: 490_000, mac: "A".repeat(22) });
function gate(changes: Partial<AccessGateView> = {}): AccessGateView {
  return { id: gateId, buildingId: "one", name: "Garagem", kind: "GARAGE", gatewayId: "gw", deviceId: "dev", enabled: true, allowResidents: true,
    requireQr: true, canManage: false, available: true, unavailableReason: null, latestCommand: null, ...changes };
}
const command = (requestId: string) => ({ id: "c3a4615e-0770-4b7c-b0d6-e4343e11cc30", requestId, gateId, status: "PENDING", expiresAt: "2026-10-25T12:00:15Z",
  createdAt: "2026-10-25T12:00:00Z", failureReason: null });
function text(tree: Tree) { return JSON.stringify(tree.toJSON()); }
function button(tree: Tree, label: string) {
  return tree.root.findAllByType("NativePressable").find((node: any) => node.findAllByType("NativeText").some((node: any) => node.props.children === label));
}
async function press(tree: Tree, label: string) { const node = button(tree, label); assert.ok(node, `button ${label} must be available`); await act(async () => { node.props.onPress(); }); }

function fixture(options: { qrFeature?: boolean; resolved?: AccessGateView | Error } = {}) {
  const calls: { method: string; path: string; body?: any }[] = [];
  let scan: GateScannerProps | null = null;
  const api = {
    async get(path: string) {
      calls.push({ method: "GET", path });
      if (path.startsWith("/access?")) return { items: [gate()], canManage: false, gateways: [], devices: [] };
      if (path.startsWith("/access/commands/")) return command("fixture-id");
      throw new Error(`unexpected route ${path}`);
    },
    async post(path: string, body: any) {
      calls.push({ method: "POST", path, body });
      if (path === "/access/qr/resolve") {
        if (options.resolved instanceof Error) throw options.resolved;
        return options.resolved ?? gate();
      }
      if (path === "/access/qr/open") return command(body.requestId);
      throw new Error(`unexpected route ${path}`);
    },
  } as unknown as ApiClient;
  function Scanner(props: GateScannerProps) { scan = props; return React.createElement("FakeCamera"); }
  const features = [{ key: "GARAGE_ACCESS", enabled: true }, { key: "GATE_QR_ACCESS", enabled: options.qrFeature ?? true }];
  const element = React.createElement(Access, { api, intents: createAccessIntentStore(() => "fixture-id"), scanner: Scanner,
    scope: { buildingId: "one", capabilities: [], features } });
  return { calls, element, read: async (value: string) => { assert.ok(scan, "the scanner must be open"); await act(async () => { scan!.onCode(value); }); } };
}
async function mount(f: ReturnType<typeof fixture>) { let tree!: Tree; await act(async () => { tree = create(f.element); }); return tree; }
async function unmount(tree: Tree) { await act(async () => { tree.unmount(); }); assert.equal(host.listenerCount(), 0); }

for (const os of ["android", "ios"]) {
  test(`${os}: a gate that requires the QR hides the list button and opens after the server checks the read`, async () => {
    host.resetHost(os); const f = fixture(); const tree = await mount(f);
    try {
      assert.ok(text(tree).includes("Este portão abre pelo QR do totem. No local, toque em “Ler QR do portão”."));
      assert.equal(button(tree, "Solicitar abertura"), undefined);
      await press(tree, "Ler QR do portão");
      assert.equal(tree.root.findAllByType("FakeCamera").length, 1);
      await f.read(content);
      assert.deepEqual(f.calls.filter(call => call.method === "POST")[0], { method: "POST", path: "/access/qr/resolve", body: { content } });
      assert.ok(text(tree).includes("QR do totem conferido"));
      await press(tree, "Abrir Garagem");
      assert.equal(host.alerts.length, 0, "the checked card is the confirmation");
      assert.deepEqual(f.calls.filter(call => call.method === "POST")[1], { method: "POST", path: "/access/qr/open", body: { content, requestId: "fixture-id" } });
    } finally { await unmount(tree); }
  });

  test(`${os}: without the add-on there is no reader, and a foreign or unrelated QR never reaches the gate`, async () => {
    host.resetHost(os);
    let f = fixture({ qrFeature: false }); let tree = await mount(f);
    try { assert.equal(button(tree, "Ler QR do portão"), undefined); } finally { await unmount(tree); }

    f = fixture({ resolved: gate({ buildingId: "two" }) }); tree = await mount(f);
    try {
      await press(tree, "Ler QR do portão"); await f.read(content);
      assert.ok(text(tree).includes("Este portão é de outro condomínio."));
      assert.equal(button(tree, "Abrir Garagem"), undefined);
      await press(tree, "Ler novamente"); await f.read("https://example.com/qualquer");
      assert.ok(text(tree).includes("Este QR não é de um portão do Prédio ON."));
      assert.equal(f.calls.filter(call => call.path === "/access/qr/resolve").length, 1, "unrelated text is refused locally");
    } finally { await unmount(tree); }

    f = fixture({ resolved: new Error("QR expirado ou inválido. Leia o QR do totem novamente") }); tree = await mount(f);
    try {
      await press(tree, "Ler QR do portão"); await f.read(content);
      assert.ok(text(tree).includes("QR expirado ou inválido. Leia o QR do totem novamente"));
      assert.equal(f.calls.some(call => call.path === "/access/qr/open"), false);
    } finally { await unmount(tree); }
  });

  test(`${os}: going to the background discards the QR that was read`, async () => {
    host.resetHost(os); const f = fixture(); const tree = await mount(f);
    try {
      await press(tree, "Ler QR do portão"); await f.read(content);
      assert.ok(button(tree, "Abrir Garagem"));
      await act(async () => { host.changeAppState("background"); });
      await act(async () => { host.changeAppState("active"); });
      assert.equal(button(tree, "Abrir Garagem"), undefined);
      assert.ok(button(tree, "Ler QR do portão"));
    } finally { await unmount(tree); }
  });
}
