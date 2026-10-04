import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React, { useEffect, useState, type ReactNode } from "react";
import ts from "typescript";

// React's test renderer is deprecated. This deliberately tests React lifecycle
// with an instrumented host; only the Android CI journey can prove Fabric UI.
const require = createRequire(import.meta.url);
const { act, create } = require("react-test-renderer") as {
  act(operation: () => void | Promise<void>): Promise<void>;
  create(node: ReactNode): {
    update(node: ReactNode): void;
    unmount(): void;
    toJSON(): unknown;
  };
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const hostUrl = new URL("./fixtures/native-screen-host.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react-native") return { url: hostUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx") && !url.includes("node_modules")) {
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
          compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        }).outputText,
      };
    }
    return nextLoad(url, context);
  },
});
const { BuildingScreen } = await import("../src/building-screen.tsx");
const { useReadResource } = await import("../src/resource.ts");
const host = await import(hostUrl) as {
  resetHost(os: string): void;
  events: { kind: string; instance: number; options?: unknown }[];
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

test("Android keeps its scroll host while old domain polls are disposed and the next domain starts at the top", async () => {
  host.resetHost("android");
  const oldRead = deferred<string>();
  const newRead = deferred<string>();
  const lifecycle: string[] = [];
  let editDraft!: (value: string) => void;
  function Domain({ name, read }: { name: string; read(): Promise<string> }) {
    const resource = useReadResource(name, read);
    const [draft, setDraft] = useState(`draft:${name}`);
    editDraft = setDraft;
    useEffect(() => {
      lifecycle.push(`mount:${name}`);
      return () => { lifecycle.push(`dispose:${name}`); };
    }, []);
    return React.createElement("Domain", { name, draft }, resource.data ?? "Carregando");
  }
  const readers: Record<string, () => Promise<string>> = {
    notices: () => oldRead.promise,
    transparency: () => newRead.promise,
  };
  const render = (screen: string) => React.createElement(
    BuildingScreen,
    { screen, children: React.createElement(Domain, { name: screen, read: readers[screen]! }) },
  );
  let tree!: ReturnType<typeof create>;
  await act(() => { tree = create(render("notices")); });
  const originalHost = host.events.find(event => event.kind === "mount")!.instance;
  const originalView = host.events.find(event => event.kind === "view-mount")!.instance;
  try {
    await act(() => { editDraft("private notice draft"); });
    await act(() => { tree.update(render("transparency")); });
    assert.equal(host.events.filter(event => event.kind === "mount").length, 1, "tab changes must preserve the Android scroll container");
    assert.equal(host.events.filter(event => event.kind === "unmount").length, 0);
    assert.deepEqual(host.events.filter(event => event.kind === "view-mount"), [
      { kind: "view-mount", instance: originalView },
    ], "domain transitions must preserve the intermediate native View");
    assert.equal(host.events.filter(event => event.kind === "view-unmount").length, 0);
    assert.deepEqual(lifecycle, ["mount:notices", "dispose:notices", "mount:transparency"]);
    assert.equal(JSON.stringify(tree.toJSON()).includes("private notice draft"), false);
    assert.equal(JSON.stringify(tree.toJSON()).includes("draft:transparency"), true);
    assert.equal(host.events.filter(event => event.kind === "listener-add").length, 2);
    assert.equal(host.events.filter(event => event.kind === "listener-remove").length, 1);
    assert.deepEqual(host.events.filter(event => event.kind === "scrollTo"), [
      { kind: "scrollTo", instance: originalHost, options: { x: 0, y: 0, animated: false } },
      { kind: "scrollTo", instance: originalHost, options: { x: 0, y: 0, animated: false } },
    ]);
    await act(async () => { oldRead.resolve("old private content"); await oldRead.promise; });
    assert.equal(JSON.stringify(tree.toJSON()).includes("old private content"), false);
    await act(async () => { newRead.resolve("Contas publicadas CI"); await newRead.promise; });
    assert.equal(JSON.stringify(tree.toJSON()).includes("Contas publicadas CI"), true);
    await act(() => { tree.update(render("transparency")); });
    assert.equal(host.events.filter(event => event.kind === "scrollTo").length, 2, "poll updates must preserve the current reading position");
  } finally {
    await act(() => { tree.unmount(); });
  }
  assert.equal(lifecycle.at(-1), "dispose:transparency");
  assert.equal(host.events.filter(event => event.kind === "listener-remove").length, 2);
});

test("iOS retains its existing container remount and domain cleanup on tab changes", async () => {
  host.resetHost("ios");
  const lifecycle: string[] = [];
  function Domain() {
    useEffect(() => {
      lifecycle.push("mount");
      return () => { lifecycle.push("dispose"); };
    }, []);
    return React.createElement("Domain");
  }
  const render = (screen: string) => React.createElement(BuildingScreen, { screen, children: React.createElement(Domain) });
  let tree!: ReturnType<typeof create>;
  await act(() => { tree = create(render("notices")); });
  try {
    await act(() => { tree.update(render("transparency")); });
    assert.equal(host.events.filter(event => event.kind === "mount").length, 2);
    assert.equal(host.events.filter(event => event.kind === "unmount").length, 1);
    assert.equal(host.events.some(event => event.kind === "scrollTo"), false);
    assert.deepEqual(lifecycle, ["mount", "dispose", "mount"]);
  } finally {
    await act(() => { tree.unmount(); });
  }
});

test("replacing the user or building scope discards its domain and scroll host", async () => {
  host.resetHost("android");
  const lifecycle: string[] = [];
  const oldBuildingRead = deferred<string>();
  const oldUserRead = deferred<string>();
  const currentRead = deferred<string>();
  const readers: Record<string, () => Promise<string>> = {
    "user-a:building-one": () => oldBuildingRead.promise,
    "user-a:building-two": () => oldUserRead.promise,
    "user-b:building-two": () => currentRead.promise,
  };
  function Domain({ scope }: { scope: string }) {
    const resource = useReadResource(scope, readers[scope]!);
    const [draft] = useState(`draft:${scope}`);
    useEffect(() => {
      lifecycle.push(`mount:${scope}`);
      return () => { lifecycle.push(`dispose:${scope}`); };
    }, []);
    return React.createElement("Domain", { scope, draft }, resource.data ?? "Carregando");
  }
  function Building({ scope }: { scope: string }) {
    return React.createElement(BuildingScreen, {
      screen: "transparency",
      children: React.createElement(Domain, { scope }),
    });
  }
  const render = (scope: string) => React.createElement(Building, { key: scope, scope });
  let tree!: ReturnType<typeof create>;
  await act(() => { tree = create(render("user-a:building-one")); });
  try {
    await act(() => { tree.update(render("user-a:building-two")); });
    assert.equal(JSON.stringify(tree.toJSON()).includes("draft:user-a:building-one"), false);
    await act(() => { tree.update(render("user-b:building-two")); });
    assert.equal(JSON.stringify(tree.toJSON()).includes("draft:user-a:building-two"), false);
    assert.equal(JSON.stringify(tree.toJSON()).includes("draft:user-b:building-two"), true);
    assert.equal(host.events.filter(event => event.kind === "mount").length, 3);
    assert.equal(host.events.filter(event => event.kind === "unmount").length, 2);
    assert.equal(host.events.filter(event => event.kind === "view-mount").length, 3);
    assert.equal(host.events.filter(event => event.kind === "view-unmount").length, 2);
    assert.equal(host.events.filter(event => event.kind === "listener-add").length, 3);
    assert.equal(host.events.filter(event => event.kind === "listener-remove").length, 2);
    assert.deepEqual(lifecycle, [
      "mount:user-a:building-one", "dispose:user-a:building-one",
      "mount:user-a:building-two", "dispose:user-a:building-two",
      "mount:user-b:building-two",
    ]);
    await act(async () => {
      oldBuildingRead.resolve("old building private content");
      oldUserRead.resolve("old user private content");
      await Promise.all([oldBuildingRead.promise, oldUserRead.promise]);
    });
    assert.equal(JSON.stringify(tree.toJSON()).includes("private content"), false);
    await act(async () => { currentRead.resolve("current authorized content"); await currentRead.promise; });
    assert.equal(JSON.stringify(tree.toJSON()).includes("current authorized content"), true);
  } finally {
    await act(() => { tree.unmount(); });
  }
  assert.equal(host.events.filter(event => event.kind === "listener-remove").length, 3);
});

test("returning to a domain resets its draft while preserving the native View", async () => {
  host.resetHost("android");
  const lifecycle: string[] = [];
  let editDraft!: (value: string) => void;
  function Domain({ name }: { name: string }) {
    const [draft, setDraft] = useState(`draft:${name}`);
    editDraft = setDraft;
    useEffect(() => {
      lifecycle.push(`mount:${name}`);
      return () => { lifecycle.push(`dispose:${name}`); };
    }, []);
    return React.createElement("Domain", { name, draft });
  }
  const render = (screen: string) => React.createElement(BuildingScreen, {
    screen, children: React.createElement(Domain, { name: screen }),
  });
  let tree!: ReturnType<typeof create>;
  await act(() => { tree = create(render("notices")); });
  const originalView = host.events.find(event => event.kind === "view-mount")!.instance;
  try {
    await act(() => { editDraft("old private notice draft"); });
    await act(() => { tree.update(render("transparency")); });
    await act(() => { editDraft("old private finance draft"); });
    await act(() => { tree.update(render("notices")); });
    assert.deepEqual(host.events.filter(event => event.kind === "view-mount"), [
      { kind: "view-mount", instance: originalView },
    ]);
    assert.equal(host.events.filter(event => event.kind === "view-unmount").length, 0);
    assert.equal(JSON.stringify(tree.toJSON()).includes("old private"), false);
    assert.equal(JSON.stringify(tree.toJSON()).includes("draft:notices"), true);
    assert.deepEqual(lifecycle, ["mount:notices", "dispose:notices", "mount:transparency", "dispose:transparency", "mount:notices"]);
  } finally {
    await act(() => { tree.unmount(); });
  }
  assert.equal(host.events.filter(event => event.kind === "view-unmount").length, 1);
});

test("same-domain refresh keeps draft and native hosts without resetting scroll", async () => {
  host.resetHost("android");
  const reads = [deferred<string>(), deferred<string>()];
  let count = 0;
  const read = () => reads[count++]!.promise;
  let editDraft!: (value: string) => void;
  let reload!: () => void;
  function Domain() {
    const resource = useReadResource("finance", read);
    const [draft, setDraft] = useState("");
    editDraft = setDraft; reload = resource.reload;
    return React.createElement("Domain", { draft }, resource.data ?? "Carregando");
  }
  const render = () => React.createElement(BuildingScreen, { screen: "transparency", children: React.createElement(Domain) });
  let tree!: ReturnType<typeof create>;
  await act(() => { tree = create(render()); });
  try {
    await act(async () => { reads[0]!.resolve("first authorized value"); await reads[0]!.promise; });
    await act(() => { editDraft("current draft"); });
    await act(() => { tree.update(render()); reload(); });
    assert.equal(count, 2);
    await act(async () => { reads[1]!.resolve("fresh authorized value"); await reads[1]!.promise; });
    assert.equal(JSON.stringify(tree.toJSON()).includes("current draft"), true);
    assert.equal(JSON.stringify(tree.toJSON()).includes("fresh authorized value"), true);
    assert.equal(host.events.filter(event => event.kind === "mount").length, 1);
    assert.equal(host.events.filter(event => event.kind === "view-mount").length, 1);
    assert.equal(host.events.filter(event => event.kind === "view-unmount").length, 0);
    assert.equal(host.events.filter(event => event.kind === "scrollTo").length, 1);
    assert.equal(host.events.filter(event => event.kind === "listener-add").length, 2);
    assert.equal(host.events.filter(event => event.kind === "listener-remove").length, 1);
  } finally {
    await act(() => { tree.unmount(); });
  }
});

test("permission-null disposes domain polling and private draft without replacing the native View", async () => {
  host.resetHost("android");
  const pending = deferred<string>();
  const read = () => pending.promise;
  const lifecycle: string[] = [];
  let editDraft!: (value: string) => void;
  function Domain() {
    const resource = useReadResource("tickets", read);
    const [draft, setDraft] = useState("");
    editDraft = setDraft;
    useEffect(() => {
      lifecycle.push("mount");
      return () => { lifecycle.push("dispose"); };
    }, []);
    return React.createElement("Domain", { draft }, resource.data ?? "Carregando");
  }
  const render = (screen: string | null) => React.createElement(BuildingScreen, {
    screen, children: screen ? React.createElement(Domain) : React.createElement("NoPermissions"),
  });
  let tree!: ReturnType<typeof create>;
  await act(() => { tree = create(render("tickets")); });
  const originalView = host.events.find(event => event.kind === "view-mount")!.instance;
  try {
    await act(() => { editDraft("private ticket draft"); });
    await act(() => { tree.update(render(null)); });
    assert.deepEqual(host.events.filter(event => event.kind === "view-mount"), [
      { kind: "view-mount", instance: originalView },
    ]);
    assert.equal(host.events.filter(event => event.kind === "view-unmount").length, 0);
    assert.deepEqual(lifecycle, ["mount", "dispose"]);
    assert.equal(host.events.filter(event => event.kind === "listener-remove").length, 1);
    await act(async () => { pending.resolve("late private ticket"); await pending.promise; });
    assert.equal(JSON.stringify(tree.toJSON()).includes("private"), false);
    assert.equal(JSON.stringify(tree.toJSON()).includes("NoPermissions"), true);
    assert.equal(host.events.filter(event => event.kind === "listener-add").length, 1);
  } finally {
    await act(() => { tree.unmount(); });
  }
});
