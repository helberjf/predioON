import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import ts from "typescript";
import type { ApiClient } from "@predioon/api-client";
import { createInvitationController } from "../src/invitation.ts";

const preview = (accountExists: boolean) => ({ email: "morador@example.test", name: "Morador", buildingName: "Residencial Sol", accountExists, expiresAt: "2026-10-20T12:00:00.000Z" });
const longPassword = "uma senha bem longa e segura";

test("code, preview and acceptance of a new account, with the password cleared at the end", async () => {
  const calls: unknown[][] = [];
  const controller = createInvitationController({
    preview: async code => { calls.push(["preview", code]); return preview(false); },
    accept: async (code, password) => { calls.push(["accept", code, password]); },
  });
  await controller.submit();
  assert.equal(controller.snapshot().error, "Informe o código do convite.");
  controller.setCode("  abc123 ");
  await controller.submit();
  assert.equal(controller.snapshot().preview?.buildingName, "Residencial Sol");
  controller.setCode("other");
  assert.equal(controller.snapshot().code, "  abc123 ", "the code is fixed once previewed");
  controller.setPassword("curta");
  await controller.submit();
  assert.equal(controller.snapshot().error, "A senha precisa ter pelo menos 15 caracteres.");
  controller.setPassword(longPassword); controller.setConfirmation(`${longPassword}!`);
  await controller.submit();
  assert.equal(controller.snapshot().error, "As senhas informadas são diferentes.");
  controller.setConfirmation(longPassword);
  await controller.submit();
  assert.deepEqual(calls, [["preview", "abc123"], ["accept", "abc123", longPassword]]);
  assert.deepEqual({ accepted: controller.snapshot().accepted, password: controller.snapshot().password, confirmation: controller.snapshot().confirmation },
    { accepted: true, password: "", confirmation: "" });
});

test("an existing account confirms only its current password, and API messages are shown", async () => {
  let attempt = 0;
  const controller = createInvitationController({
    preview: async () => preview(true),
    accept: async () => { if (++attempt === 1) throw new Error("Senha incorreta para a conta deste e-mail"); },
  });
  controller.setCode("abc"); await controller.submit();
  await controller.submit();
  assert.equal(controller.snapshot().error, "Informe a senha da sua conta.");
  controller.setPassword("x"); await controller.submit();
  assert.equal(controller.snapshot().error, "Senha incorreta para a conta deste e-mail");
  controller.setPassword("certa"); await controller.submit();
  assert.equal(controller.snapshot().accepted, true);
});

test("leaving the app cancels a pending request and forgets the draft; restart goes back to the code", async () => {
  let aborted = false;
  const controller = createInvitationController({
    preview: (_code, signal) => new Promise((_, reject) => signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); })),
    accept: async () => {},
  });
  controller.setCode("abc");
  const pending = controller.submit();
  assert.equal(controller.snapshot().pending, true);
  controller.setActive(false);
  await pending;
  assert.equal(aborted, true);
  assert.deepEqual({ code: controller.snapshot().code, error: controller.snapshot().error, pending: controller.snapshot().pending }, { code: "", error: null, pending: false });
  const again = createInvitationController({ preview: async () => preview(false), accept: async () => {} });
  again.setCode("abc"); await again.submit();
  again.setPassword(longPassword);
  again.restart();
  assert.deepEqual({ preview: again.snapshot().preview, password: again.snapshot().password }, { preview: null, password: "" });
});

// Rendered with the same host fixture as the login and recovery screens.
const require = createRequire(import.meta.url);
const { act, create } = require("react-test-renderer");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, __DEV__: false });
const hostUrl = new URL("./fixtures/auth-screen-host.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react-native") return { url: hostUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx") && !url.includes("node_modules")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    };
    return nextLoad(url, context);
  },
});
const { Login } = await import("../src/login.tsx");
const host = await import(hostUrl) as { resetHost(os: string): void };
type Tree = ReturnType<typeof create>;
const field = (tree: Tree, label: string) => tree.root.findAllByType("NativeTextInput").find((node: any) => node.props.accessibilityLabel === label);
const button = (tree: Tree, label: string) => tree.root.findAllByType("NativePressable").find((node: any) => node.findAllByType("NativeText").some((text: any) => text.props.children === label));
const texts = (tree: Tree) => tree.root.findAllByType("NativeText").map((node: any) => [node.props.children].flat().join("")).join(" | ");

for (const os of ["android", "ios"]) test(`${os}: only the resident login offers the invitation, which leads back to sign-in`, async () => {
  host.resetHost(os);
  const api = { login: async () => { throw new Error("not used"); } } as unknown as ApiClient;
  const requests = { preview: async () => preview(false), accept: async () => {} };
  let tree!: Tree;
  await act(() => { tree = create(React.createElement(Login, { api, product: "operations", requestPasswordRecovery: async () => {}, beginSignIn() {}, signedIn() {} })); });
  assert.equal(button(tree, "Tenho um convite"), undefined, "operations has no invitation entry");
  await act(() => { tree.unmount(); });
  await act(() => { tree = create(React.createElement(Login, { api, product: "resident", requestPasswordRecovery: async () => {}, invitationRequests: requests, beginSignIn() {}, signedIn() {} })); });
  try {
    await act(() => { button(tree, "Tenho um convite").props.onPress(); });
    await act(() => { field(tree, "Código do convite").props.onChangeText("abc123"); });
    await act(async () => { button(tree, "Continuar").props.onPress(); });
    assert.match(texts(tree), /Você foi convidado para o condomínio Residencial Sol com o e-mail morador@example.test/);
    assert.equal(field(tree, "Crie uma senha").props.secureTextEntry, true);
    await act(() => { field(tree, "Crie uma senha").props.onChangeText(longPassword); field(tree, "Repita a senha").props.onChangeText(longPassword); });
    await act(async () => { button(tree, "Aceitar convite").props.onPress(); });
    assert.match(texts(tree), /Convite aceito\. Entre com o e-mail morador@example.test/);
    await act(() => { button(tree, "Ir para a entrada").props.onPress(); });
    assert.ok(field(tree, "E-mail"), "back on the sign-in screen");
  } finally { await act(() => { tree.unmount(); }); }
});
