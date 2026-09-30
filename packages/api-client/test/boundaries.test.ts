import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { checkBoundaries } from "../../../scripts/check-boundaries.mjs";

async function fixture(packages: Record<string, { name: string; dependencies?: Record<string, string>; source?: string }>, run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "predioon-boundaries-"));
  try {
    for (const [directory, { source = "export {};", ...manifest }] of Object.entries(packages)) {
      await mkdir(join(root, directory, "src"), { recursive: true });
      await writeFile(join(root, directory, "package.json"), JSON.stringify(manifest));
      await writeFile(join(root, directory, "src/index.ts"), source);
    }
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
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
