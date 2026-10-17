import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import ts from "typescript";
import type { ApiClient } from "@predioon/api-client";
import { MFA_REQUIRED_MESSAGE } from "@predioon/contracts/auth";

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
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
    };
    return nextLoad(url, context);
  },
});
const { Login } = await import("../src/login.tsx");
const host = await import(hostUrl) as { resetHost(os: string): void; changeAppState(state: string): void };
type Tree = ReturnType<typeof create>;
function field(tree: Tree, label: string) {
  return tree.root.findAllByType("NativeTextInput").find((node: any) => node.props.accessibilityLabel === label);
}
function button(tree: Tree, label: string) {
  return tree.root.findAllByType("NativePressable").find((node: any) => node.findAllByType("NativeText").some((text: any) => text.props.children === label));
}
const user = { id: "fixture-user", name: "Fixture", email: "fixture@example.test", role: "RESIDENT" as const, memberships: [] };
function deferred() {
  let resolve!: () => void; let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const success = "Se este e-mail tiver uma conta, você receberá um link para criar uma nova senha. Ele vale por 60 minutos. Confira também a caixa de spam.";

for (const product of ["resident", "operations"] as const) for (const os of ["android", "ios"]) {
  test(`${product}/${os}: normal sign-in preserves exact password and returns the authenticated profile`, async () => {
    host.resetHost(os);
    const calls: unknown[][] = []; let signed: unknown;
    const api = { login: async (...args: unknown[]) => { calls.push(args); return { user }; } } as unknown as ApiClient;
    let tree!: Tree;
    await act(() => { tree = create(React.createElement(Login, { api, product, requestPasswordRecovery: async () => {}, beginSignIn() {}, signedIn(value) { signed = value; } })); });
    try {
      await act(() => { field(tree, "E-mail").props.onChangeText(" person@example.test "); field(tree, "Senha").props.onChangeText(" Literal password "); });
      await act(async () => { field(tree, "Senha").props.onSubmitEditing(); });
      assert.deepEqual(calls, [["person@example.test", " Literal password ", undefined]]);
      assert.equal(signed, user); assert.equal(field(tree, "Senha").props.value, "");
      assert.equal(field(tree, "Código de verificação"), undefined);
    } finally { await act(() => { tree.unmount(); }); }
  });
  test(`${product}/${os}: replacing request context aborts and isolates the old response`, async () => {
    host.resetHost(os);
    const old = deferred(), next = deferred(); let oldSignal: AbortSignal | undefined;
    const previous = (_email: string, signal?: AbortSignal) => { oldSignal = signal; return old.promise; };
    const current = () => next.promise;
    const render = (requestPasswordRecovery: typeof previous) => React.createElement(Login, { api: {} as ApiClient, product, requestPasswordRecovery, beginSignIn() {}, signedIn() {} });
    let tree!: Tree;
    await act(() => { tree = create(render(previous)); });
    try {
      await act(() => { button(tree, "Esqueci minha senha").props.onPress(); });
      await act(() => { field(tree, "E-mail").props.onChangeText("old@example.test"); });
      await act(() => { field(tree, "E-mail").props.onSubmitEditing(); });
      await act(() => { tree.update(render(current)); });
      assert.equal(oldSignal?.aborted, true); assert.equal(field(tree, "E-mail").props.value, "");
      await act(() => { field(tree, "E-mail").props.onChangeText("next@example.test"); });
      await act(() => { field(tree, "E-mail").props.onSubmitEditing(); });
      await act(async () => { old.resolve(); await old.promise; });
      assert.equal(field(tree, "E-mail").props.value, "next@example.test");
      assert.equal(button(tree, "Solicitando…").props.disabled, true);
      await act(async () => { next.resolve(); await next.promise; });
      assert.ok(JSON.stringify(tree.toJSON()).includes(success));
    } finally { await act(() => { tree.unmount(); }); }
  });
  test(`${product}/${os}: opens recovery from the rendered login`, async () => {
    host.resetHost(os);
    let tree!: Tree;
    await act(() => { tree = create(React.createElement(Login, { api: {} as ApiClient, product, requestPasswordRecovery: async () => {}, beginSignIn() {}, signedIn() {} })); });
    try {
      assert.ok(button(tree, "Esqueci minha senha"), "the shared login needs a recovery entry");
      await act(() => { button(tree, "Esqueci minha senha").props.onPress(); });
      assert.equal(field(tree, "Senha"), undefined);
      assert.equal(field(tree, "E-mail").props.maxLength, 254);
      assert.equal(field(tree, "E-mail").props.autoCapitalize, "none");
      assert.equal(field(tree, "E-mail").props.keyboardType, "email-address");
      assert.ok(button(tree, "Voltar para entrar"));
    } finally { await act(() => { tree.unmount(); }); }
  });
  test(`${product}/${os}: actual handlers validate, guard simultaneous send/edit and show account-independent feedback`, async () => {
    host.resetHost(os);
    const work = deferred(); const calls: string[] = []; let begins = 0; let signed = 0;
    let tree!: Tree;
    await act(() => { tree = create(React.createElement(Login, { api: {} as ApiClient, product, beginSignIn() { begins++; }, signedIn() { signed++; }, requestPasswordRecovery: (email: string) => { calls.push(email); return work.promise; } })); });
    try {
      assert.ok(button(tree, "Esqueci minha senha"));
      await act(() => { button(tree, "Esqueci minha senha").props.onPress(); });
      await act(() => { field(tree, "E-mail").props.onChangeText("invalid"); });
      await act(async () => { field(tree, "E-mail").props.onSubmitEditing(); });
      assert.deepEqual(calls, []); assert.ok(JSON.stringify(tree.toJSON()).includes("Informe um e-mail válido."));
      await act(() => { field(tree, "E-mail").props.onChangeText(" Person@Example.test "); });
      const submit = field(tree, "E-mail").props.onSubmitEditing;
      const send = button(tree, "Enviar link de recuperação").props.onPress;
      const edit = field(tree, "E-mail").props.onChangeText;
      await act(() => { submit(); send(); edit("edited@example.test"); });
      assert.deepEqual(calls, ["person@example.test"]);
      assert.equal(field(tree, "E-mail").props.value, " Person@Example.test ");
      assert.equal(field(tree, "E-mail").props.editable, false);
      assert.equal(button(tree, "Solicitando…").props.disabled, true);
      await act(async () => { work.resolve(); await work.promise; });
      assert.ok(JSON.stringify(tree.toJSON()).includes(success));
      assert.ok(JSON.stringify(tree.toJSON()).includes("portal"));
      assert.equal(field(tree, "E-mail"), undefined);
      assert.equal(begins, 0); assert.equal(signed, 0);
      await act(() => { button(tree, "Voltar para entrar").props.onPress(); });
      assert.equal(field(tree, "E-mail").props.value, ""); assert.equal(field(tree, "Senha").props.value, "");
      await act(() => { button(tree, "Esqueci minha senha").props.onPress(); });
      assert.equal(field(tree, "E-mail").props.value, ""); assert.equal(JSON.stringify(tree.toJSON()).includes(success), false);
    } finally { await act(() => { tree.unmount(); }); }
  });
  test(`${product}/${os}: same-tick login submission locks recovery navigation and preserves pending MFA`, async () => {
    host.resetHost(os);
    const work = deferred(); let logins = 0; let recoveries = 0;
    const api = { login: () => { logins++; return work.promise.then(() => { throw new Error(MFA_REQUIRED_MESSAGE); }); } } as unknown as ApiClient;
    let tree!: Tree;
    await act(() => { tree = create(React.createElement(Login, { api, product, requestPasswordRecovery: async () => { recoveries++; }, beginSignIn() {}, signedIn() {} })); });
    try {
      assert.ok(button(tree, "Esqueci minha senha"));
      await act(() => { field(tree, "E-mail").props.onChangeText("person@example.test"); field(tree, "Senha").props.onChangeText("literal-password"); });
      const enter = button(tree, "Entrar").props.onPress;
      const recover = button(tree, "Esqueci minha senha").props.onPress;
      await act(() => { enter(); recover(); enter(); });
      assert.equal(logins, 1); assert.equal(recoveries, 0); assert.ok(field(tree, "Senha"));
      assert.equal(button(tree, "Esqueci minha senha").props.disabled, true);
      await act(async () => { work.resolve(); await work.promise; });
      assert.ok(field(tree, "Código de verificação"));
      await act(() => { field(tree, "Código de verificação").props.onChangeText("private-code"); button(tree, "Esqueci minha senha").props.onPress(); });
      assert.equal(field(tree, "Senha"), undefined); assert.equal(field(tree, "Código de verificação"), undefined);
      await act(() => { button(tree, "Voltar para entrar").props.onPress(); });
      assert.equal(field(tree, "Senha").props.value, ""); assert.equal(field(tree, "Código de verificação"), undefined);
      assert.equal(JSON.stringify(tree.toJSON()).includes("private-code"), false);
    } finally { await act(() => { tree.unmount(); }); }
  });
  test(`${product}/${os}: back aborts and old responses cannot fill a reopened recovery screen`, async () => {
    host.resetHost(os);
    const work = deferred(); let signal: AbortSignal | undefined;
    let tree!: Tree;
    await act(() => { tree = create(React.createElement(Login, { api: {} as ApiClient, product, requestPasswordRecovery: (_email: string, value?: AbortSignal) => { signal = value; return work.promise; }, beginSignIn() {}, signedIn() {} })); });
    try {
      assert.ok(button(tree, "Esqueci minha senha"));
      await act(() => { button(tree, "Esqueci minha senha").props.onPress(); });
      await act(() => { field(tree, "E-mail").props.onChangeText("old@example.test"); });
      await act(() => { field(tree, "E-mail").props.onSubmitEditing(); });
      await act(() => { button(tree, "Voltar para entrar").props.onPress(); });
      assert.equal(signal?.aborted, true);
      await act(() => { button(tree, "Esqueci minha senha").props.onPress(); });
      await act(async () => { work.resolve(); await work.promise; });
      assert.equal(field(tree, "E-mail").props.value, ""); assert.equal(JSON.stringify(tree.toJSON()).includes(success), false);
    } finally { await act(() => { tree.unmount(); }); }
  });
  test(`${product}/${os}: background and unmount cancel request; StrictMode and replacement context stay usable`, async () => {
    host.resetHost(os);
    const work = deferred(); let signal: AbortSignal | undefined;
    let tree!: Tree;
    const render = (key: string, request: (email: string, signal?: AbortSignal) => Promise<void>) => React.createElement(React.StrictMode, {}, React.createElement(Login, { key, api: {} as ApiClient, product, requestPasswordRecovery: request, beginSignIn() {}, signedIn() {} }));
    const request = (_email: string, value?: AbortSignal) => { signal = value; return work.promise; };
    await act(() => { tree = create(render("first", request)); });
    try {
      assert.ok(button(tree, "Esqueci minha senha"));
      await act(() => { button(tree, "Esqueci minha senha").props.onPress(); });
      await act(() => { field(tree, "E-mail").props.onChangeText("old@example.test"); });
      await act(() => { field(tree, "E-mail").props.onSubmitEditing(); });
      await act(() => { host.changeAppState("background"); });
      assert.equal(signal?.aborted, true); assert.equal(field(tree, "E-mail").props.value, "");
      await act(() => { host.changeAppState("active"); });
      await act(async () => { work.resolve(); await work.promise; });
      assert.equal(JSON.stringify(tree.toJSON()).includes(success), false);
      const replacement = deferred(); const next = (_email: string, value?: AbortSignal) => { signal = value; return replacement.promise; };
      await act(() => { tree.update(render("second", next)); });
      await act(() => { button(tree, "Esqueci minha senha").props.onPress(); });
      await act(() => { field(tree, "E-mail").props.onChangeText("next@example.test"); });
      await act(() => { field(tree, "E-mail").props.onSubmitEditing(); });
      assert.equal(signal?.aborted, false, "effect reactivation must permit requests");
      await act(() => { tree.unmount(); });
      assert.equal(signal?.aborted, true);
      await act(async () => { replacement.reject(new Error("SQL secret")); await replacement.promise.catch(() => {}); });
      tree = null;
    } finally { if (tree) await act(() => { tree.unmount(); }); }
  });
  test(`${product}/${os}: rendered recovery displays sanitized errors`, async () => {
    host.resetHost(os);
    for (const status of [400, 401, 403, 429, 503, 0]) {
      let tree!: Tree;
      await act(() => { tree = create(React.createElement(Login, { api: {} as ApiClient, product, requestPasswordRecovery: async () => { throw { status, message: "SQL secret-token person@example.test" }; }, beginSignIn() {}, signedIn() {} })); });
      try {
        assert.ok(button(tree, "Esqueci minha senha"));
        await act(() => { button(tree, "Esqueci minha senha").props.onPress(); });
        await act(() => { field(tree, "E-mail").props.onChangeText("person@example.test"); });
        await act(async () => { button(tree, "Enviar link de recuperação").props.onPress(); });
        const text = JSON.stringify(tree.toJSON());
        assert.equal(text.includes("SQL"), false); assert.equal(text.includes("secret-token"), false);
        assert.ok(text.includes(status === 400 ? "Informe um e-mail válido." : status === 429 ? "Muitas tentativas." : "Não foi possível solicitar a recuperação."));
        assert.equal(field(tree, "E-mail").props.editable, true); assert.equal(button(tree, "Enviar link de recuperação").props.disabled, false);
      } finally { await act(() => { tree.unmount(); }); }
    }
  });
  test(`${product}/${os}: existing login preserves the password and MFA code protocol`, async () => {
    host.resetHost(os);
    const calls: unknown[][] = []; let begins = 0; let signed: unknown;
    const api = { baseUrl: "https://api.example.test", login: async (...args: unknown[]) => {
      calls.push(args);
      if (calls.length === 1) throw new Error(MFA_REQUIRED_MESSAGE);
      return { user };
    } } as unknown as ApiClient;
    let tree!: Tree;
    await act(() => { tree = create(React.createElement(Login, { api, product, requestPasswordRecovery: async () => {}, beginSignIn: () => { begins++; }, signedIn: value => { signed = value; } })); });
    try {
      assert.equal(tree.root.findByType("NativeKeyboardAvoidingView").props.behavior, os === "ios" ? "padding" : undefined);
      assert.equal(field(tree, "Código de verificação"), undefined);
      await act(() => { field(tree, "E-mail").props.onChangeText(" Fixture@example.test "); field(tree, "Senha").props.onChangeText(" Literal password "); });
      await act(async () => { button(tree, "Entrar").props.onPress(); });
      assert.deepEqual(calls, [["Fixture@example.test", " Literal password ", undefined]]);
      assert.equal(field(tree, "Senha").props.value, " Literal password ");
      assert.equal(field(tree, "Código de verificação").props.maxLength, 16);
      await act(() => { field(tree, "Código de verificação").props.onChangeText(" recovery-code "); });
      await act(async () => { field(tree, "Código de verificação").props.onSubmitEditing(); });
      assert.deepEqual(calls[1], ["Fixture@example.test", " Literal password ", "recovery-code"]);
      assert.equal(begins, 2); assert.equal(signed, user);
      assert.equal(field(tree, "Senha").props.value, ""); assert.equal(field(tree, "Código de verificação").props.value, "");
    } finally { await act(() => { tree.unmount(); }); }
  });
}
