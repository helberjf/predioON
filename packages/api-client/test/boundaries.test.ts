import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { it } from "node:test";
import { checkBoundaries } from "../../../scripts/check-boundaries.mjs";

it("allows root Metro tooling but rejects importing that tooling into the mobile runtime", async () => {
  await fixture({ "apps/resident-mobile": { name: "@predioon/resident-mobile" } }, async root => {
    await writeFile(join(root, "apps/resident-mobile/metro.config.js"), "const path = require('node:path');");
    assert.deepEqual(await checkBoundaries(root), []);
    await writeFile(join(root, "apps/resident-mobile/src/index.ts"), "import '../metro.config.js';");
    assert.ok((await checkBoundaries(root)).some(message => /configuration imported at runtime/.test(message)));
  });
});

type FixturePackage = { name: string; version?: string; type?: string; main?: string; exports?: Record<string, string>;
  dependencies?: Record<string, string>; source?: string };

async function fixture(packages: Record<string, FixturePackage>, run: (root: string) => Promise<void>) {
  const temporaryDirectory = resolve(tmpdir());
  const root = await mkdtemp(join(temporaryDirectory, "predioon-boundaries-"));
  try {
    for (const [directory, { source = "export {};", ...manifest }] of Object.entries(packages)) {
      await mkdir(join(root, directory, "src"), { recursive: true });
      await writeFile(join(root, directory, "package.json"), JSON.stringify(manifest));
      await writeFile(join(root, directory, "src/index.ts"), source);
    }
    await run(root);
  } finally {
    assert.equal(dirname(root), temporaryDirectory);
    assert.ok(basename(root).startsWith("predioon-boundaries-"));
    await rm(root, { recursive: true, force: true });
  }
}

it("blocks direct and transitive client dependencies on server-only packages", async () => {
  await fixture({
    "apps/resident-web": { name: "@predioon/resident-web", dependencies: { "@predioon/ui": "workspace:*" } },
    "packages/ui": { name: "@predioon/ui", source: "export { value } from '@predioon/helper';" },
    "packages/helper": { name: "@predioon/helper", dependencies: { "@predioon/db": "workspace:*" } },
    "packages/db": { name: "@predioon/db" },
  }, async root => {
    const violations = await checkBoundaries(root);
    assert.ok(violations.some(message => /resident-web.*ui.*helper.*db/.test(message)), violations.join("\n"));
  });
});

it("blocks client imports of server source through relative paths", async () => {
  await fixture({
    "apps/resident-web": { name: "@predioon/resident-web", source: "import type { Secret } from '../../api/src/private.js';" },
    "apps/api": { name: "@predioon/api" },
  }, async root => assert.ok((await checkBoundaries(root)).some(message => /resident-web.*api/.test(message))));
});

it("blocks domain imports of framework, transport and ORM dependencies", async () => {
  for (const dependency of ["express", "react/jsx-runtime", "mqtt", "drizzle-orm/pg-core"]) {
    await fixture({
      "packages/domain": { name: "@predioon/domain", source: `import * as value from '${dependency}';` },
    }, async root => assert.ok((await checkBoundaries(root)).some(message => message.includes(dependency)), dependency));
  }
});

it("blocks client imports of Node builtins with bare and node-prefixed specifiers", async () => {
  for (const dependency of ["fs/promises", "http", "node:fs/promises"]) {
    await fixture({
      "apps/resident-web": { name: "@predioon/resident-web", source: `import * as value from '${dependency}';` },
    }, async root => assert.ok((await checkBoundaries(root)).some(message => message.includes(dependency)), dependency));
  }
});

it("blocks indirect domain framework dependencies and public contract ORM exports", async () => {
  await fixture({
    "packages/domain": { name: "@predioon/domain", dependencies: { "@predioon/helper": "workspace:*" } },
    "packages/helper": { name: "@predioon/helper", dependencies: { express: "^5.0.0" } },
    "packages/contracts": { name: "@predioon/contracts", source: "export * from 'drizzle-orm';" },
  }, async root => {
    const violations = await checkBoundaries(root);
    assert.ok(violations.some(message => /domain.*helper.*express/.test(message)));
    assert.ok(violations.some(message => /contracts.*drizzle-orm/.test(message)));
  });
});

it("detects require and literal dynamic imports without treating comments as imports", async () => {
  await fixture({
    "apps/resident-web": { name: "@predioon/resident-web", source: "const runtime = import('@predioon/runtime'); const db = require('@predioon/db'); // import '@predioon/domain';" },
    "packages/runtime": { name: "@predioon/runtime" },
    "packages/db": { name: "@predioon/db" },
    "packages/domain": { name: "@predioon/domain" },
  }, async root => {
    const violations = await checkBoundaries(root);
    assert.ok(violations.some(message => /runtime/.test(message)));
    assert.ok(violations.some(message => /db/.test(message)));
    assert.ok(violations.every(message => !/domain/.test(message)));
  });
});

it("accepts browser contracts and domain dependencies on public contracts", async () => {
  await fixture({
    "apps/resident-web": { name: "@predioon/resident-web", dependencies: { "@predioon/api-client": "workspace:*" } },
    "packages/api-client": { name: "@predioon/api-client", dependencies: { "@predioon/contracts": "workspace:*" } },
    "packages/contracts": { name: "@predioon/contracts", dependencies: { "@predioon/shared": "workspace:*" } },
    "packages/shared": { name: "@predioon/shared", dependencies: { zod: "^4.0.0" } },
    "packages/domain": { name: "@predioon/domain", dependencies: { "@predioon/contracts": "workspace:*" } },
    "apps/api": { name: "@predioon/api", dependencies: { "@predioon/domain": "workspace:*", "@predioon/db": "workspace:*" } },
    "packages/db": { name: "@predioon/db", dependencies: { "drizzle-orm": "^0.44.0" } },
  }, async root => assert.deepEqual(await checkBoundaries(root), []));
});

it("blocks API imports of the owner entrypoint, including relative and dynamic imports", async () => {
  for (const source of ["import { db } from '@predioon/db';", "const db = import('@predioon/db');", "import '../../../packages/db/src/index.js';", "import '@predioon/db/src/index.js';"]) {
    await fixture({
      "apps/api": { name: "@predioon/api", source },
      "packages/db": { name: "@predioon/db" },
    }, async root => assert.ok((await checkBoundaries(root)).some(message => /API.*owner/.test(message)), source));
  }
});

it("accepts the three restricted API entrypoints", async () => {
  await fixture({
    "apps/api": { name: "@predioon/api", source: "import '@predioon/db/runtime'; import '@predioon/db/identity'; import '@predioon/db/broker-auth';", dependencies: { "@predioon/db": "workspace:*" } },
    "packages/db": { name: "@predioon/db" },
  }, async root => assert.deepEqual(await checkBoundaries(root), []));
});

it("accepts only the dedicated notification entrypoint in the worker", async () => {
  await fixture({
    "services/notifications": { name: "@predioon/notifications", source: "import '@predioon/db/notifications'; import type postgres from 'postgres';", dependencies: { "@predioon/db": "workspace:*", postgres: "3.4.9" } },
    "packages/db": { name: "@predioon/db" },
  }, async root => assert.deepEqual(await checkBoundaries(root), []));
});

it("blocks notification owner and other runtime imports through direct, relative and dynamic edges", async () => {
  for (const source of ["import '@predioon/db';", "import '@predioon/db/runtime';", "import '@predioon/db/identity';",
    "import '@predioon/db/broker-auth';", "import '@predioon/db/src/notifications.js';",
    "import '../../../packages/db/src/index.js';", "const db = import('@predioon/db');", "import postgres from 'postgres';",
    "const sql = require('postgres');", "const sql = import('postgres');", "import postgres from 'postgres'; import type SQL from 'postgres';"]) {
    await fixture({
      "services/notifications": { name: "@predioon/notifications", source },
      "packages/db": { name: "@predioon/db" },
    }, async root => assert.ok((await checkBoundaries(root)).some(message => /Notification.*boundary/.test(message)), source));
  }
});

it("blocks notification transitive owner imports and dependencies on ingestion transports", async () => {
  await fixture({
    "services/notifications": { name: "@predioon/notifications", dependencies: { "@predioon/helper": "workspace:*", "@predioon/ingest": "workspace:*" } },
    "packages/helper": { name: "@predioon/helper", source: "export * from '@predioon/db';" },
    "packages/db": { name: "@predioon/db" },
    "services/ingest": { name: "@predioon/ingest" },
  }, async root => {
    const messages = await checkBoundaries(root);
    assert.ok(messages.some(message => /Notification.*helper.*db/.test(message)), messages.join("\n"));
    assert.ok(messages.some(message => /Notification.*ingest/.test(message)), messages.join("\n"));
  });
});

it("keeps notification helpers outside the API and browser entrypoints", async () => {
  await fixture({
    "apps/api": { name: "@predioon/api", source: "import '@predioon/db/notifications';" },
    "apps/resident-web": { name: "@predioon/resident-web", source: "import '@predioon/db/notifications';" },
    "packages/db": { name: "@predioon/db" },
  }, async root => {
    const messages = await checkBoundaries(root);
    assert.ok(messages.some(message => /API.*owner/.test(message)));
    assert.ok(messages.some(message => /Client.*db/.test(message)));
  });
});

it("blocks a dedicated notification export that indirectly imports the owner barrel", async () => {
  await fixture({
    "services/notifications": { name: "@predioon/notifications", source: "import '@predioon/db/notifications';" },
    "packages/db": { name: "@predioon/db" },
  }, async root => {
    await writeFile(join(root, "packages/db/src/notifications.ts"), "export * from './notification-helper.js';");
    await writeFile(join(root, "packages/db/src/notification-helper.ts"), "export * from './index.js';");
    assert.ok((await checkBoundaries(root)).some(message => /Notification.*owner.*notification-helper/.test(message)));
  });
});

const databaseFixture: FixturePackage = {
  name: "@predioon/db", version: "0.1.0", type: "module", main: "./src/index.ts",
  exports: { ".": "./src/index.ts", "./runtime": "./src/runtime.ts", "./identity": "./src/identity.ts",
    "./broker-auth": "./src/broker-auth.ts", "./notifications": "./src/notifications.ts",
    "./ingest": "./src/ingest.ts", "./access-service": "./src/access-service.ts" },
  source: "import './env.js'; export const owner = true;",
};

async function ingestFixture(source: string, files: Record<string, string>, run: (root: string) => Promise<void>) {
  await fixture({
    "services/ingest": { name: "@predioon/ingest", version: "0.1.0", type: "module", main: "./src/index.ts",
      dependencies: { "@predioon/db": "workspace:*", "@predioon/helper": "workspace:*" }, source },
    "packages/db": databaseFixture,
    "packages/helper": { name: "@predioon/helper", version: "0.1.0", type: "module", main: "./src/index.ts",
      exports: { ".": "./src/index.ts" } },
  }, async root => {
    const defaults = {
      "packages/db/src/ingest.ts": "export {};",
      "packages/db/src/access-service.ts": "export {};",
      "packages/db/src/runtime.ts": "import './context.js'; export {};",
      "packages/db/src/identity.ts": "export {};",
      "packages/db/src/broker-auth.ts": "export {};",
      "packages/db/src/notifications.ts": "export {};",
      "packages/db/src/context.ts": "import './index.js'; export type AppTransaction = unknown;",
      "packages/db/src/env.ts": "export const administrativeUrl = process.env.DATABASE_URL;",
      "packages/db/src/schema.ts": "export const schema = {};",
    };
    for (const [path, contents] of Object.entries({ ...defaults, ...files })) {
      const target = resolve(root, path);
      assert.ok(target.startsWith(root + sep), "fixture writes stay inside its temporary root");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
    await run(root);
  });
}

async function assertIngestBoundary(root: string, pattern = /Ingest .*boundary/) {
  const errors = await checkBoundaries(root);
  assert.ok(errors.some(error => pattern.test(error)), errors.join("\n") || "ingest runtime graph was accepted");
}

it("accepts both dedicated ingestion pools and neutral schema modules", async () => {
  await ingestFixture("import '@predioon/db/ingest'; import '@predioon/db/access-service';", {
    "packages/db/src/ingest.ts": "import './schema.js'; export {};",
    "packages/db/src/access-service.ts": "import './schema.js'; export {};",
  }, async root => assert.deepEqual(await checkBoundaries(root), []));
});

it("follows the ingest adapter to a transitive owner import", async () => {
  await ingestFixture("import '@predioon/db/ingest';", {
    "packages/db/src/ingest.ts": "export * from './unsafe.js';",
    "packages/db/src/unsafe.ts": "import './index.js';",
  }, root => assertIngestBoundary(root, /Ingest owner boundary/));
});

for (const [reason, source] of [
  ["owner package", "import '@predioon/db';"],
  ["app pool", "import '@predioon/db/runtime';"],
  ["identity pool", "import '@predioon/db/identity';"],
  ["broker pool", "import '@predioon/db/broker-auth';"],
  ["notification pool", "import '@predioon/db/notifications';"],
  ["relative owner", "import '../../../packages/db/src/index.js';"],
  ["relative human context", "import '../../../packages/db/src/context.js';"],
  ["relative administrative environment", "import '../../../packages/db/src/env.js';"],
  ["require owner", "const owner = require('@predioon/db');"],
  ["literal dynamic owner", "const owner = import('@predioon/db');"],
  ["literal dynamic app pool", "const owner = import('@predioon/db/runtime');"],
] as const) {
  it(`blocks ingestion runtime ${reason}`, async () => {
    await ingestFixture(source, {}, assertIngestBoundary);
  });
}

for (const [reason, source] of [
  ["owner reexport", "export * from '@predioon/db';"],
  ["app pool reexport", "export * from '@predioon/db/runtime';"],
  ["relative owner reexport", "export * from '../../db/src/index.js';"],
  ["require owner", "const owner = require('@predioon/db'); export { owner };"],
  ["literal dynamic owner", "export const owner = import('@predioon/db');"],
] as const) {
  it(`blocks ${reason} through a workspace helper reached by ingestion`, async () => {
    await ingestFixture("import '@predioon/helper';", { "packages/helper/src/index.ts": source }, assertIngestBoundary);
  });
}

for (const entrypoint of ["ingest", "access-service"]) {
  for (const forbidden of ["index", "context", "env"]) {
    it(`blocks a relative ${forbidden} import reached from the ${entrypoint} adapter`, async () => {
      await ingestFixture(`import '@predioon/db/${entrypoint}';`, {
        [`packages/db/src/${entrypoint}.ts`]: "export * from './unsafe.js';",
        "packages/db/src/unsafe.ts": `import './${forbidden}.js';`,
      }, assertIngestBoundary);
    });
  }

  it(`follows a workspace reexport reached from the ${entrypoint} adapter`, async () => {
    await ingestFixture(`import '@predioon/db/${entrypoint}';`, {
      [`packages/db/src/${entrypoint}.ts`]: "export * from '@predioon/helper';",
      "packages/helper/src/index.ts": "export * from '@predioon/db';",
    }, assertIngestBoundary);
  });

  for (const syntax of ["const owner = require('./index.js');", "const owner = import('./index.js');"]) {
    it(`follows ${syntax.startsWith("const owner = require") ? "require" : "literal dynamic import"} inside the ${entrypoint} adapter`, async () => {
      await ingestFixture(`import '@predioon/db/${entrypoint}';`, {
        [`packages/db/src/${entrypoint}.ts`]: syntax,
      }, assertIngestBoundary);
    });
  }
}

it("resolves a root tsconfig alias to the owner from the ingestion entrypoint", async () => {
  await ingestFixture("import '@database-owner';", {
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@database-owner": ["packages/db/src/index.ts"] } } }),
  }, assertIngestBoundary);
});

it("resolves a service tsconfig alias to an administrative environment module", async () => {
  await ingestFixture("import '#administrative-env';", {
    "services/ingest/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: {
      baseUrl: "./src", paths: { "#administrative-env": ["../../../packages/db/src/env.ts"] } } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext" } }),
  }, assertIngestBoundary);
});

for (const [reason, source] of [
  ["service dynamic import", "const target = process.argv[2]; const module = import(target);"],
  ["service computed require", "const target = process.argv[2]; const module = require(target);"],
  ["service template import", "const target = process.argv[2]; const module = import(`@predioon/${target}`);"],
] as const) {
  it(`rejects an unresolved ${reason} in the productive graph`, async () => {
    await ingestFixture(source, {}, assertIngestBoundary);
  });
}

it("rejects an unresolved dynamic import reached through the access-service adapter", async () => {
  await ingestFixture("import '@predioon/db/access-service';", {
    "packages/db/src/access-service.ts": "const target = process.argv[2]; export const module = import(target);",
  }, assertIngestBoundary);
});

it("ignores comments and strings that mention administrative imports", async () => {
  await ingestFixture("import '@predioon/db/ingest';", {
    "packages/db/src/ingest.ts": "// import '@predioon/db';\n/* require('./index.js') */\nconst example = \"import './env.js';\"; const dynamicExample = \"import(target)\"; export { example, dynamicExample };",
  }, async root => assert.deepEqual(await checkBoundaries(root), []));
});

it("ignores erased type-only context edges while following neutral schema imports", async () => {
  await ingestFixture("import '@predioon/db/ingest'; import type { AppTransaction } from '../../../packages/db/src/context.js';", {
    "packages/db/src/ingest.ts": "import './schema.js'; import type { AppTransaction } from './context.js'; export type { AppTransaction };",
  }, async root => assert.deepEqual(await checkBoundaries(root), []));
});

it("allows the administrative demo-data CLI outside the productive ingestion graph", async () => {
  await ingestFixture("import '@predioon/db/ingest'; import '@predioon/db/access-service';", {
    "services/ingest/src/demo-data.ts": "import '@predioon/db'; import '../../../packages/db/src/env.js';",
  }, async root => assert.deepEqual(await checkBoundaries(root), []));
});

it("rejects the administrative demo-data CLI when imported by the productive entrypoint", async () => {
  await ingestFixture("import './demo-data.js';", {
    "services/ingest/src/demo-data.ts": "import '@predioon/db'; import '../../../packages/db/src/env.js';",
  }, assertIngestBoundary);
});
