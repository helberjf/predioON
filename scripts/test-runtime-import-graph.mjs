import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkBoundaries } from "./check-boundaries.mjs";
import { runtimeImports } from "./runtime-import-graph.mjs";

async function fixture(source, files, run) {
  const temporaryDirectory = resolve(tmpdir());
  const root = await mkdtemp(join(temporaryDirectory, "predioon-graph-audit-"));
  try {
    const defaults = {
      "services/ingest/package.json": JSON.stringify({ name: "@predioon/ingest", main: "./src/index.ts" }),
      "services/ingest/src/index.ts": source,
      "packages/db/package.json": JSON.stringify({ name: "@predioon/db", exports: { ".": "./src/index.ts", "./ingest": "./src/ingest.ts", "./access-service": "./src/access-service.ts" } }),
      "packages/db/src/index.ts": "export const db = {};",
      "packages/db/src/ingest.ts": "export {};",
      "packages/db/src/access-service.ts": "export {};",
      "packages/db/src/context.ts": "export {};",
    };
    for (const [path, contents] of Object.entries({ ...defaults, ...files })) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), contents);
    }
    await run(root);
  } finally {
    assert.equal(dirname(root), temporaryDirectory);
    assert.ok(basename(root).startsWith("predioon-graph-audit-"));
    await rm(root, { recursive: true, force: true });
  }
}
const rejects = async root => assert.ok((await checkBoundaries(root)).some(message => /Ingest .*boundary/.test(message)));

test("checks both dedicated exports even if the index does not import them", async () => {
  await fixture("export {};", { "packages/db/src/access-service.ts": "import './index.js';" }, rejects);
});
test("follows conditional and wildcard workspace exports to owner", async () => {
  await fixture("import '@predioon/helper/a';", {
    "packages/helper/package.json": JSON.stringify({ name: "@predioon/helper", exports: { "./*": { types: "./types/*.d.ts", import: "./src/*.ts" } } }),
    "packages/helper/src/a.ts": "import '@predioon/db';",
  }, rejects);
});
test("follows workspace package main to owner", async () => {
  await fixture("import '@predioon/helper';", {
    "packages/helper/package.json": JSON.stringify({ name: "@predioon/helper", main: "./lib/helper.js" }),
    "packages/helper/lib/helper.ts": "import '@predioon/db';",
  }, rejects);
});
test("follows cycles once while retaining outgoing owner edges", async () => {
  await fixture("import './a.js';", {
    "services/ingest/src/a.ts": "import './b.js';",
    "services/ingest/src/b.ts": "import './a.js'; import '@predioon/db';",
  }, rejects);
});
test("ignores inline erased import and export types and import type expressions", async () => {
  await fixture("import { type Secret } from '../../../packages/db/src/context.js'; export { type Secret } from '../../../packages/db/src/context.js'; type A = import('../../../packages/db/src/context.js').Secret;", {}, async root => assert.deepEqual(await checkBoundaries(root), []));
});
test("blocks aliases that escape the supplied root", async () => {
  await fixture("import '#outside';", {
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "#outside": ["../outside.ts"] } } }),
  }, rejects);
});
test("blocks relative runtime source paths that escape the supplied root", async () => {
  await fixture("import '../../../../outside.ts';", {}, rejects);
});
test("blocks symlinked workspace source that escapes the supplied root", async () => {
  await fixture("import './escape/index.js';", {}, async root => {
    const outside = await mkdtemp(join(resolve(tmpdir()), "predioon-graph-audit-outside-"));
    try {
      await writeFile(join(outside, "index.ts"), "export {};");
      await symlink(outside, join(root, "services/ingest/src/escape"), "junction");
      await rejects(root);
    } finally {
      assert.equal(dirname(outside), resolve(tmpdir()));
      assert.ok(basename(outside).startsWith("predioon-graph-audit-outside-"));
      await rm(outside, { recursive: true, force: true });
    }
  });
});
test("blocks non-exported database source subpaths", async () => {
  await fixture("import '@predioon/db/src/context.js';", {}, rejects);
});
test("blocks a sibling restricted pool imported by a dedicated adapter", async () => {
  await fixture("export {};", {
    "packages/db/src/ingest.ts": "import './access-service.js';",
  }, rejects);
});

test("does not omit an ingestion package symlink that escapes the supplied root", async () => {
  await fixture("export {};", {}, async root => {
    const outside = await mkdtemp(join(resolve(tmpdir()), "predioon-graph-audit-outside-"));
    try {
      await mkdir(join(outside, "src"));
      await writeFile(join(outside, "package.json"), JSON.stringify({ name: "@predioon/ingest" }));
      await writeFile(join(outside, "src/index.ts"), "import '@predioon/db';");
      await symlink(outside, join(root, "services/escaped-ingest"), "junction");
      // Remove the regular package after validating the exact fixture target.
      const regularPackage = join(root, "services/ingest");
      assert.equal(dirname(regularPackage), join(root, "services"));
      await rm(regularPackage, { recursive: true });
      await rejects(root);
    } finally {
      assert.equal(dirname(outside), resolve(tmpdir()));
      assert.ok(basename(outside).startsWith("predioon-graph-audit-outside-"));
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("retains owner classification through an internal database package symlink", async () => {
  await fixture("import '../../../packages/zzz-db-alias/src/index.js';", {}, async root => {
    await symlink(join(root, "packages/db"), join(root, "packages/zzz-db-alias"), "junction");
    assert.ok((await checkBoundaries(root)).some(message => /Ingest owner boundary/.test(message)));
  });
});

test("blocks direct service access to a constructor capable of creating another pool", async () => {
  await fixture("import { createRuntimeSqlClient } from '../../../packages/db/src/runtime-connection.js'; createRuntimeSqlClient('DATABASE_URL_APP', 'predioon_app', 10);", {
    "packages/db/src/runtime-connection.ts": "export function createRuntimeSqlClient() {}",
  }, rejects);
});
test("blocks a workspace helper reaching the private pool constructor", async () => {
  await fixture("import '@predioon/helper';", {
    "packages/helper/package.json": JSON.stringify({ name: "@predioon/helper", main: "./src/index.ts" }),
    "packages/helper/src/index.ts": "import { createRuntimeSqlClient } from '../../db/src/runtime-connection.js'; createRuntimeSqlClient('DATABASE_URL_APP', 'predioon_app', 10);",
    "packages/db/src/runtime-connection.ts": "export function createRuntimeSqlClient() {}",
  }, rejects);
});
test("blocks a database helper that constructs another pool behind the dedicated export", async () => {
  await fixture("import '@predioon/db/ingest';", {
    "packages/db/src/ingest.ts": "import './pool-helper.js';",
    "packages/db/src/pool-helper.ts": "import { createRuntimeSqlClient } from './runtime-connection.js'; createRuntimeSqlClient('DATABASE_URL_APP', 'predioon_app', 10);",
    "packages/db/src/runtime-connection.ts": "export function createRuntimeSqlClient() {}",
  }, rejects);
});

test("does not let a safe TS file hide an existing runtime JS owner import", async () => {
  await fixture("import './runtime.js';", {
    "services/ingest/src/runtime.ts": "export {};",
    "services/ingest/src/runtime.js": "import '@predioon/db';",
  }, rejects);
});

// Exercise real fixture files without executing the sources being inspected.
async function helperFixture(source, run, file = "helper.cjs") {
  await fixture(`import './${file}';`, {
    [`services/ingest/src/${file}`]: source,
  }, run);
}

function assertEdge(source, specifier, kind = "require") {
  const parsed = runtimeImports(source, "fixture.ts");
  assert.equal(parsed.invalid, false, source);
  assert.deepEqual(parsed.edges.map(edge => ({ specifier: edge.specifier, kind: edge.kind })), [{ specifier, kind }], source);
}

const requireCallees = [
  ["direct require", "require"],
  ["module.require", "module.require"],
  ["parenthesized require", "(require)"],
  ["nested parenthesized require", "((require))"],
  ["parenthesized module.require", "(module.require)"],
  ["single quoted require property", "module['require']"],
  ["double quoted require property", 'module["require"]'],
  ["static template require property", "module[`require`]"],
  ["parenthesized module receiver", "(module).require"],
  ["parenthesized property name", "module[('require')]"],
  ["require as assertion", "(require as typeof require)", "helper.cts"],
  ["require type assertion", "(<typeof require>require)", "helper.cts"],
  ["require non-null assertion", "require!", "helper.cts"],
  ["require satisfies expression", "(require satisfies typeof require)", "helper.cts"],
  ["nested erased require wrappers", "((require as typeof require)!)", "helper.cts"],
  ["module as assertion", "(module as typeof module).require", "helper.cts"],
  ["module type assertion", "(<typeof module>module).require", "helper.cts"],
  ["module non-null assertion", "module!.require", "helper.cts"],
  ["module.require as assertion", "(module.require as typeof require)", "helper.cts"],
  ["require property as assertion", "module['require' as const]", "helper.cts"],
];

for (const [name, callee, file] of requireCallees) {
  test(`routes ${name} literals to the owner boundary`, async () => {
    const source = `const db = ${callee}('@predioon/db');`;
    assertEdge(source, "@predioon/db");
    await helperFixture(source, async root => {
      const errors = await checkBoundaries(root);
      assert.ok(errors.some(error => /Ingest owner boundary/.test(error)), JSON.stringify({ source, errors }));
    }, file);
  });

  test(`fails closed for ${name} with a computed argument`, async () => {
    const source = `const db = ${callee}(variable);`;
    assertEdge(source, undefined);
    await helperFixture(source, async root => {
      const errors = await checkBoundaries(root);
      assert.ok(errors.some(error => /Ingest unresolved import boundary/.test(error)), JSON.stringify({ source, errors }));
    }, file);
  });
}

for (const [name, source] of [
  ["computed template", "module.require(`@predioon/${variable}`);"],
  ["string concatenation", "module['require']('@predioon/' + variable);"],
  ["parenthesized variable", "(require)((variable));"],
  ["asserted variable", "(require as typeof require)(variable as string);"],
  ["spread argument", "module.require(...['@predioon/db']);"],
  ["missing argument", "module.require();"],
]) {
  test(`fails closed for a require ${name}`, async () => {
    assertEdge(source, undefined);
    await helperFixture(source, rejects, "helper.cts");
  });
}

for (const [name, argument] of [
  ["parenthesized literal", "('@predioon/db')"],
  ["literal as assertion", "'@predioon/db' as const"],
  ["literal type assertion", "<string>'@predioon/db'"],
  ["literal non-null assertion", "'@predioon/db'!"],
  ["literal satisfies expression", "'@predioon/db' satisfies string"],
]) {
  test(`preserves owner routing for an erased ${name}`, async () => {
    const source = `require(${argument});`;
    assertEdge(source, "@predioon/db");
    await helperFixture(source, rejects, "helper.cts");
  });
}

for (const [name, source] of [
  ["direct require.resolve", "require.resolve('@predioon/db');"],
  ["parenthesized require.resolve", "(require).resolve('@predioon/db');"],
  ["module.require.resolve", "module.require.resolve(variable);"],
  ["property literal require.resolve", "module['require'].resolve('@predioon/db');"],
  ["another module method", "module.resolve('@predioon/db');"],
  ["another property literal method", "module['resolve'](variable);"],
  ["another receiver require", "other.require('@predioon/db');"],
  ["another receiver property literal require", "other['require'](variable);"],
  ["erased receiver followed by resolve", "(module as typeof module).require.resolve('@predioon/db');"],
  ["comments and strings", "// module.require('@predioon/db');\n/* (require)(variable); */\nconst example = \"module['require']('@predioon/db')\";"],
]) {
  test(`does not treat ${name} as an executable import`, async () => {
    assert.deepEqual(runtimeImports(source, "fixture.ts"), { edges: [], invalid: false });
    await helperFixture(source, async root => assert.deepEqual(await checkBoundaries(root), []));
  });
}

test("preserves literal dynamic import routing", async () => {
  assertEdge("import('@predioon/db');", "@predioon/db", "dynamic import");
  await helperFixture("import('@predioon/db');", rejects);
});

test("fails closed for a computed dynamic import", async () => {
  assertEdge("import(variable);", undefined, "dynamic import");
  await helperFixture("import(variable);", rejects);
});

test("accepts dedicated exports through require calls", async () => {
  await helperFixture("module.require('@predioon/db/ingest'); (require)('@predioon/db/access-service');", async root => {
    assert.deepEqual(await checkBoundaries(root), []);
  });
});

test("follows an alias reached through module.require", async () => {
  await fixture("module.require('#owner');", {
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "#owner": ["packages/db/src/index.ts"] } } }),
  }, rejects);
});

test("reports the AST line of a computed import", async () => {
  await helperFixture("// preceding line\n\nrequire(variable);", async root => {
    const errors = await checkBoundaries(root);
    assert.ok(errors.some(error => /Ingest unresolved import boundary:.*require in services\/ingest\/src\/helper.cjs:3\)/.test(error)), JSON.stringify(errors));
  });
});

test("reports the AST line when a literal source cannot be resolved", async () => {
  await helperFixture("// preceding line\nrequire('./missing.js');", async root => {
    const errors = await checkBoundaries(root);
    assert.ok(errors.some(error => /Ingest unresolved import boundary:.*runtime source cannot be resolved; services\/ingest\/src\/helper.cjs:2\)/.test(error)), JSON.stringify(errors));
  });
});

async function resolutionFixture(specifier, files, run) {
  await fixture("import './helper.cjs';", {
    "services/ingest/src/helper.cjs": `require(${JSON.stringify(specifier)});`,
    ...files,
  }, run);
}

function assertNativeResolution(root, specifier, target) {
  // resolve inspects paths and manifests; it never loads the fixture source.
  const resolver = createRequire(join(root, "services/ingest/src/helper.cjs"));
  assert.equal(resolver.resolve(specifier), join(root, "services/ingest/src", target));
}

const ownerSource = "require('@predioon/db');";
const safeSource = "export {};";
for (const [name, specifier, files, target] of [
  ["an extensionless JS file before a safe TS sibling", "./runtime", {
    "services/ingest/src/runtime.js": ownerSource,
    "services/ingest/src/runtime.ts": safeSource,
  }, "runtime.js"],
  ["a directory JS index before a safe TS index", "./folder", {
    "services/ingest/src/folder/index.js": ownerSource,
    "services/ingest/src/folder/index.ts": safeSource,
  }, "folder/index.js"],
  ["a directory main before a safe TS index", "./folder", {
    "services/ingest/src/folder/package.json": JSON.stringify({ main: "./owner.cjs" }),
    "services/ingest/src/folder/owner.cjs": ownerSource,
    "services/ingest/src/folder/index.ts": safeSource,
  }, "folder/owner.cjs"],
  ["a directory JS main before a safe TS sibling", "./folder", {
    "services/ingest/src/folder/package.json": JSON.stringify({ main: "./owner.js" }),
    "services/ingest/src/folder/owner.js": ownerSource,
    "services/ingest/src/folder/owner.ts": safeSource,
    "services/ingest/src/folder/index.ts": safeSource,
  }, "folder/owner.js"],
  ["an extensionless directory main", "./folder", {
    "services/ingest/src/folder/package.json": JSON.stringify({ main: "./owner" }),
    "services/ingest/src/folder/owner.js": ownerSource,
    "services/ingest/src/folder/owner.ts": safeSource,
    "services/ingest/src/folder/index.ts": safeSource,
  }, "folder/owner.js"],
  ["a nested directory main path", "./folder", {
    "services/ingest/src/folder/package.json": JSON.stringify({ main: "./nested/owner.cjs" }),
    "services/ingest/src/folder/nested/owner.cjs": ownerSource,
    "services/ingest/src/folder/index.ts": safeSource,
  }, "folder/nested/owner.cjs"],
  ["the JS index of a main directory instead of its nested package main", "./folder", {
    "services/ingest/src/folder/package.json": JSON.stringify({ main: "./nested" }),
    "services/ingest/src/folder/nested/package.json": JSON.stringify({ main: "./ignored.cjs" }),
    "services/ingest/src/folder/nested/ignored.cjs": safeSource,
    "services/ingest/src/folder/nested/index.js": ownerSource,
    "services/ingest/src/folder/index.ts": safeSource,
  }, "folder/nested/index.js"],
]) {
  test(`follows ${name} to the owner resolved by Node`, async () => {
    await resolutionFixture(specifier, files, async root => {
      assertNativeResolution(root, specifier, target);
      const errors = await checkBoundaries(root);
      assert.ok(errors.some(error => /Ingest owner boundary/.test(error)), JSON.stringify({ name, errors }));
    });
  });
}

for (const owner of ["node", "tsx"]) {
  test(`inspects the ${owner} alternative when a TS file competes with a JS directory`, async () => {
    await resolutionFixture("./runtime", {
      "services/ingest/src/runtime.ts": owner === "tsx" ? ownerSource : safeSource,
      "services/ingest/src/runtime/index.js": owner === "node" ? ownerSource : safeSource,
    }, async root => {
      assertNativeResolution(root, "./runtime", "runtime/index.js");
      const errors = await checkBoundaries(root);
      assert.ok(errors.some(error => /Ingest owner boundary/.test(error)), JSON.stringify({ owner, errors }));
    });
  });

  test(`inspects the ${owner} alternative when a TS main competes with a JS index`, async () => {
    await resolutionFixture("./folder", {
      "services/ingest/src/folder/package.json": JSON.stringify({ main: "./entry" }),
      "services/ingest/src/folder/entry.ts": owner === "tsx" ? ownerSource : safeSource,
      "services/ingest/src/folder/index.js": owner === "node" ? ownerSource : safeSource,
      "services/ingest/src/folder/index.ts": safeSource,
    }, rejects);
  });
}

for (const [name, specifier, files, target] of [
  ["a safe JS file before an unused TS owner", "./runtime", {
    "services/ingest/src/runtime.js": safeSource,
    "services/ingest/src/runtime.ts": ownerSource,
  }, "runtime.js"],
  ["a safe JS index before an unused TS owner index", "./folder", {
    "services/ingest/src/folder/index.js": safeSource,
    "services/ingest/src/folder/index.ts": ownerSource,
  }, "folder/index.js"],
  ["a safe main before unused owner indexes", "./folder", {
    "services/ingest/src/folder/package.json": JSON.stringify({ main: "./entry.cjs" }),
    "services/ingest/src/folder/entry.cjs": safeSource,
    "services/ingest/src/folder/index.js": ownerSource,
    "services/ingest/src/folder/index.ts": ownerSource,
  }, "folder/entry.cjs"],
  ["a safe file before an unused owner directory", "./runtime", {
    "services/ingest/src/runtime.js": safeSource,
    "services/ingest/src/runtime/package.json": JSON.stringify({ main: "./owner.cjs" }),
    "services/ingest/src/runtime/owner.cjs": ownerSource,
  }, "runtime.js"],
  ["a nested main index before an unused nested package owner", "./folder", {
    "services/ingest/src/folder/package.json": JSON.stringify({ main: "./nested" }),
    "services/ingest/src/folder/nested/package.json": JSON.stringify({ main: "./owner.cjs" }),
    "services/ingest/src/folder/nested/owner.cjs": ownerSource,
    "services/ingest/src/folder/nested/index.js": safeSource,
    "services/ingest/src/folder/index.ts": ownerSource,
  }, "folder/nested/index.js"],
]) {
  test(`accepts ${name}`, async () => {
    await resolutionFixture(specifier, files, async root => {
      assertNativeResolution(root, specifier, target);
      assert.deepEqual(await checkBoundaries(root), []);
    });
  });
}

test("accepts safe alternatives in both Node and TSX resolution", async () => {
  await resolutionFixture("./runtime", {
    "services/ingest/src/runtime.ts": safeSource,
    "services/ingest/src/runtime/index.js": safeSource,
  }, async root => assert.deepEqual(await checkBoundaries(root), []));
});

test("accepts safe main alternatives in both Node and TSX resolution", async () => {
  await resolutionFixture("./folder", {
    "services/ingest/src/folder/package.json": JSON.stringify({ main: "./entry" }),
    "services/ingest/src/folder/entry.ts": safeSource,
    "services/ingest/src/folder/index.js": safeSource,
    "services/ingest/src/folder/index.ts": safeSource,
  }, async root => assert.deepEqual(await checkBoundaries(root), []));
});

test("follows a TS-only main instead of an unrelated safe TS index", async () => {
  await resolutionFixture("./folder", {
    "services/ingest/src/folder/package.json": JSON.stringify({ main: "./owner.js" }),
    "services/ingest/src/folder/owner.ts": ownerSource,
    "services/ingest/src/folder/index.ts": safeSource,
  }, rejects);
});

test("preserves explicit JS to TS fallback when JS does not exist", async () => {
  await resolutionFixture("./runtime.js", {
    "services/ingest/src/runtime.ts": safeSource,
  }, async root => assert.deepEqual(await checkBoundaries(root), []));
});

for (const extension of ["json", "node"]) {
  test(`fails closed for an extensionless ${extension} source before a safe TS sibling`, async () => {
    await resolutionFixture("./runtime", {
      [`services/ingest/src/runtime.${extension}`]: "{}",
      "services/ingest/src/runtime.ts": safeSource,
    }, async root => {
      assertNativeResolution(root, "./runtime", `runtime.${extension}`);
      const errors = await checkBoundaries(root);
      assert.ok(errors.some(error => /Ingest unresolved import boundary:.*runtime source is not inspectable/.test(error)), JSON.stringify(errors));
    });
  });

  test(`fails closed for a non-inspectable ${extension} main before a safe TS index`, async () => {
    await resolutionFixture("./folder", {
      "services/ingest/src/folder/package.json": JSON.stringify({ main: `./entry.${extension}` }),
      [`services/ingest/src/folder/entry.${extension}`]: "{}",
      "services/ingest/src/folder/index.ts": safeSource,
    }, async root => {
      assertNativeResolution(root, "./folder", `folder/entry.${extension}`);
      const errors = await checkBoundaries(root);
      assert.ok(errors.some(error => /Ingest unresolved import boundary:.*runtime source is not inspectable/.test(error)), JSON.stringify(errors));
    });
  });

  test(`fails closed for a non-inspectable ${extension} index before a safe TS index`, async () => {
    await resolutionFixture("./folder", {
      [`services/ingest/src/folder/index.${extension}`]: "{}",
      "services/ingest/src/folder/index.ts": safeSource,
    }, async root => {
      assertNativeResolution(root, "./folder", `folder/index.${extension}`);
      const errors = await checkBoundaries(root);
      assert.ok(errors.some(error => /Ingest unresolved import boundary:.*runtime source is not inspectable/.test(error)), JSON.stringify(errors));
    });
  });
}

for (const [name, packageJson, pattern] of [
  ["malformed manifest", "{", /directory package.json cannot be parsed/],
  ["invalid main type", JSON.stringify({ main: 42 }), /directory main cannot be resolved/],
  ["main outside the supplied root", JSON.stringify({ main: "../../../../../outside.cjs" }), /source path escapes workspace root/],
]) {
  test(`fails closed for a directory ${name}`, async () => {
    await resolutionFixture("./folder", {
      "services/ingest/src/folder/package.json": packageJson,
      "services/ingest/src/folder/index.ts": safeSource,
    }, async root => {
      const errors = await checkBoundaries(root);
      assert.ok(errors.some(error => /Ingest unresolved import boundary/.test(error) && pattern.test(error)), JSON.stringify(errors));
    });
  });
}

test("fails closed for a main source symlink outside the supplied root", async () => {
  await resolutionFixture("./folder", {
    "services/ingest/src/folder/package.json": JSON.stringify({ main: "./linked/entry.cjs" }),
    "services/ingest/src/folder/index.ts": safeSource,
  }, async root => {
    const outside = await mkdtemp(join(resolve(tmpdir()), "predioon-graph-main-outside-"));
    try {
      await writeFile(join(outside, "entry.cjs"), safeSource);
      await symlink(outside, join(root, "services/ingest/src/folder/linked"), "junction");
      const errors = await checkBoundaries(root);
      assert.ok(errors.some(error => /Ingest unresolved import boundary:.*source symlink escapes workspace root/.test(error)), JSON.stringify(errors));
    } finally {
      assert.equal(dirname(outside), resolve(tmpdir()));
      assert.ok(basename(outside).startsWith("predioon-graph-main-outside-"));
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("does not recurse into a main cycle with no resolvable index", async () => {
  await resolutionFixture("./folder", {
    "services/ingest/src/folder/package.json": JSON.stringify({ main: "./nested" }),
    "services/ingest/src/folder/nested/package.json": JSON.stringify({ main: ".." }),
  }, async root => {
    const errors = await checkBoundaries(root);
    assert.ok(errors.some(error => /Ingest unresolved import boundary:.*runtime source cannot be resolved/.test(error)), JSON.stringify(errors));
  });
});

test("accepts a self main with a safe TS index without recursive resolution", async () => {
  await resolutionFixture("./folder", {
    "services/ingest/src/folder/package.json": JSON.stringify({ main: "." }),
    "services/ingest/src/folder/index.ts": safeSource,
  }, async root => assert.deepEqual(await checkBoundaries(root), []));
});

const tsxLoader = createRequire(new URL("../packages/db/package.json", import.meta.url)).resolve("tsx");
const probeEnvironment = Object.fromEntries(["SystemRoot", "WINDIR", "SystemDrive", "TEMP", "TMP", "PATH"].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const protectedSafeSource = "throw new Error('FIXTURE TARGET MUST NOT BE EXECUTED');";
const protectedOwnerSource = "import '@predioon/db'; throw new Error('FIXTURE TARGET MUST NOT BE EXECUTED');";
const protectedCommonJsOwnerSource = "require('@predioon/db'); throw new Error('FIXTURE TARGET MUST NOT BE EXECUTED');";

async function esmFixture(specifier, files, run, source = `import ${JSON.stringify(specifier)};`) {
  await fixture(source, {
    "services/ingest/package.json": JSON.stringify({ name: "@predioon/ingest", type: "module" }),
    // The isolated probe resolves the URL only. It never imports the target.
    "services/ingest/src/probe.ts": `console.log(JSON.stringify({ resolved: import.meta.resolve(${JSON.stringify(specifier)}) }));`,
    ...files,
  }, run);
}

function assertEsmResolution(root, target) {
  const output = execFileSync(process.execPath, ["--import", pathToFileURL(tsxLoader).href, join(root, "services/ingest/src/probe.ts")], {
    cwd: root, env: probeEnvironment, encoding: "utf8", windowsHide: true, timeout: 15000,
  });
  assert.equal(fileURLToPath(JSON.parse(output).resolved), join(root, "services/ingest/src", target));
}

const esmShadowCases = [
  ["an explicit JS import", "./runtime.js", "runtime.js", "runtime.ts"],
  ["an extensionless import", "./runtime", "runtime.js", "runtime.ts"],
  ["a directory import", "./folder", "folder/index.js", "folder/index.ts"],
  ["an explicit JS index import", "./folder/index.js", "folder/index.js", "folder/index.ts"],
];
for (const [name, specifier, javascript, typescript] of esmShadowCases) {
  for (const owner of ["javascript", "typescript"]) {
    test(`inspects the ${owner} owner alternative of ${name} from ESM TypeScript`, async () => {
      await esmFixture(specifier, {
        [`services/ingest/src/${javascript}`]: owner === "javascript" ? protectedOwnerSource : protectedSafeSource,
        [`services/ingest/src/${typescript}`]: owner === "typescript" ? protectedOwnerSource : protectedSafeSource,
      }, async root => {
        assertNativeResolution(root, specifier, javascript);
        assertEsmResolution(root, typescript);
        const errors = await checkBoundaries(root);
        assert.ok(errors.some(error => /Ingest owner boundary/.test(error)), JSON.stringify({ name, owner, errors }));
      });
    });
  }

  test(`accepts safe Node and ESM TSX alternatives of ${name}`, async () => {
    await esmFixture(specifier, {
      [`services/ingest/src/${javascript}`]: protectedSafeSource,
      [`services/ingest/src/${typescript}`]: protectedSafeSource,
    }, async root => {
      assertNativeResolution(root, specifier, javascript);
      assertEsmResolution(root, typescript);
      assert.deepEqual(await checkBoundaries(root), []);
    });
  });
}

for (const extension of ["js", "cjs"]) {
  for (const owner of ["main", "index"]) {
    test(`inspects the ${owner} owner when ESM ignores a directory ${extension} main`, async () => {
      await esmFixture("./folder", {
        "services/ingest/src/folder/package.json": JSON.stringify({ main: `./entry.${extension}` }),
        [`services/ingest/src/folder/entry.${extension}`]: owner === "main" ? (extension === "cjs" ? protectedCommonJsOwnerSource : protectedOwnerSource) : protectedSafeSource,
        "services/ingest/src/folder/index.ts": owner === "index" ? protectedOwnerSource : protectedSafeSource,
      }, async root => {
        assertNativeResolution(root, "./folder", `folder/entry.${extension}`);
        assertEsmResolution(root, "folder/index.ts");
        const errors = await checkBoundaries(root);
        assert.ok(errors.some(error => /Ingest owner boundary/.test(error)), JSON.stringify({ extension, owner, errors }));
      });
    });
  }
}

test("does not inspect an unused TS main sibling when ESM resolves a safe index", async () => {
  await esmFixture("./folder", {
    "services/ingest/src/folder/package.json": JSON.stringify({ main: "./entry.js" }),
    "services/ingest/src/folder/entry.js": protectedSafeSource,
    "services/ingest/src/folder/entry.ts": protectedOwnerSource,
    "services/ingest/src/folder/index.ts": protectedSafeSource,
  }, async root => {
    assertNativeResolution(root, "./folder", "folder/entry.js");
    assertEsmResolution(root, "folder/index.ts");
    assert.deepEqual(await checkBoundaries(root), []);
  });
});

test("accepts safe main and ESM index alternatives", async () => {
  await esmFixture("./folder", {
    "services/ingest/src/folder/package.json": JSON.stringify({ main: "./entry.js" }),
    "services/ingest/src/folder/entry.js": protectedSafeSource,
    "services/ingest/src/folder/index.ts": protectedSafeSource,
  }, async root => {
    assertNativeResolution(root, "./folder", "folder/entry.js");
    assertEsmResolution(root, "folder/index.ts");
    assert.deepEqual(await checkBoundaries(root), []);
  });
});

for (const [name, source] of [
  ["reexport", "export * from './runtime.js';"],
  ["dynamic import", "import('./runtime.js');"],
]) {
  test(`follows the ESM TSX owner of a TypeScript ${name}`, async () => {
    await esmFixture("./runtime.js", {
      "services/ingest/src/runtime.js": protectedSafeSource,
      "services/ingest/src/runtime.ts": protectedOwnerSource,
    }, async root => {
      assertEsmResolution(root, "runtime.ts");
      const errors = await checkBoundaries(root);
      assert.ok(errors.some(error => /Ingest owner boundary/.test(error)), JSON.stringify(errors));
    }, source);
  });
}

test("follows an ESM TSX owner reached through a TypeScript helper", async () => {
  await esmFixture("./runtime.js", {
    "services/ingest/src/helper.ts": "import './runtime.js';",
    "services/ingest/src/runtime.js": protectedSafeSource,
    "services/ingest/src/runtime.ts": protectedOwnerSource,
  }, async root => {
    assertEsmResolution(root, "runtime.ts");
    const errors = await checkBoundaries(root);
    assert.ok(errors.some(error => /Ingest owner boundary:.*\.\/helper.ts.*\.\/runtime.js/.test(error)), JSON.stringify(errors));
  }, "import './helper.ts';");
});

for (const [name, ownerExtension, rejected] of [
  ["TSX owner before a safe TS shadow", "tsx", true],
  ["native JSX owner with safe TS alternatives", "jsx", true],
  ["unused TS owner behind a safe TSX target", "ts", false],
  ["all safe targets", undefined, false],
]) {
  test(`ESM JSX resolution handles ${name}`, async () => {
    await esmFixture("./runtime.jsx", {
      "services/ingest/src/runtime.jsx": ownerExtension === "jsx" ? protectedOwnerSource : protectedSafeSource,
      "services/ingest/src/runtime.ts": ownerExtension === "ts" ? protectedOwnerSource : protectedSafeSource,
      "services/ingest/src/runtime.tsx": ownerExtension === "tsx" ? protectedOwnerSource : protectedSafeSource,
    }, async root => {
      assertNativeResolution(root, "./runtime.jsx", "runtime.jsx");
      assertEsmResolution(root, "runtime.tsx");
      const errors = await checkBoundaries(root);
      if (rejected) assert.ok(errors.some(error => /Ingest owner boundary/.test(error)), JSON.stringify({ name, errors }));
      else assert.deepEqual(errors, []);
    });
  });
}

for (const [extension, typescriptExtension] of [["mjs", "mts"], ["cjs", "cts"]]) {
  for (const owner of ["native", "typescript", undefined]) {
    test(`ESM ${extension.toUpperCase()} resolution inspects ${owner ?? "safe"} canonical targets`, async () => {
      await esmFixture(`./runtime.${extension}`, {
        [`services/ingest/src/runtime.${extension}`]: owner === "native" ? (extension === "cjs" ? protectedCommonJsOwnerSource : protectedOwnerSource) : protectedSafeSource,
        [`services/ingest/src/runtime.${typescriptExtension}`]: owner === "typescript" ? protectedOwnerSource : protectedSafeSource,
        "services/ingest/src/runtime.ts": protectedOwnerSource,
        "services/ingest/src/runtime.tsx": protectedOwnerSource,
      }, async root => {
        assertNativeResolution(root, `./runtime.${extension}`, `runtime.${extension}`);
        assertEsmResolution(root, `runtime.${typescriptExtension}`);
        const errors = await checkBoundaries(root);
        if (owner) assert.ok(errors.some(error => /Ingest owner boundary/.test(error)), JSON.stringify({ extension, owner, errors }));
        else assert.deepEqual(errors, []);
      });
    });
  }

  test(`ESM ${extension.toUpperCase()} resolution falls back to its native literal when the canonical TS file is absent`, async () => {
    await esmFixture(`./runtime.${extension}`, {
      [`services/ingest/src/runtime.${extension}`]: protectedSafeSource,
      "services/ingest/src/runtime.ts": protectedOwnerSource,
      "services/ingest/src/runtime.tsx": protectedOwnerSource,
    }, async root => {
      assertNativeResolution(root, `./runtime.${extension}`, `runtime.${extension}`);
      assertEsmResolution(root, `runtime.${extension}`);
      assert.deepEqual(await checkBoundaries(root), []);
    });
  });
}
