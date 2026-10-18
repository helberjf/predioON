// node --test scripts/test-eas-api-origin.mjs
// Runs the EAS hook against a copy of itself in a temporary tree; the real config.ts is never touched.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { apiOrigin, configureSource } from "./eas-api-origin.mjs";

const hook = fileURLToPath(new URL("./eas-api-origin.mjs", import.meta.url));
const committed = readFileSync(fileURLToPath(new URL("../apps/resident-mobile/config.ts", import.meta.url)), "utf8");

function sandbox(source = committed) {
  const root = mkdtempSync(join(tmpdir(), "predioon-eas-origin-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "apps", "resident-mobile"), { recursive: true });
  copyFileSync(hook, join(root, "scripts", "eas-api-origin.mjs"));
  const config = join(root, "apps", "resident-mobile", "config.ts");
  writeFileSync(config, source);
  const run = (environment, app = "resident-mobile") => spawnSync(process.execPath, [join(root, "scripts", "eas-api-origin.mjs"), "--app", app], {
    encoding: "utf8", env: { PATH: process.env.PATH, ...environment },
  });
  return { config, run, read: () => readFileSync(config, "utf8"), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("writes the HTTPS origin into the single literal on an EAS builder", () => {
  const box = sandbox();
  try {
    const result = box.run({ EAS_BUILD: "true", PRODUCTION_API_URL: "https://api.predioon.example" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(box.read(), /const PRODUCTION_API_URL = "https:\/\/api\.predioon\.example";/);
    assert.equal(box.read(), committed.replace('const PRODUCTION_API_URL = "";', 'const PRODUCTION_API_URL = "https://api.predioon.example";'));
  } finally { box.cleanup(); }
});

test("fails the build without a valid origin and leaves config.ts untouched", () => {
  const box = sandbox();
  try {
    for (const value of [undefined, "", "http://api.predioon.example", "https://api.predioon.example/v1", "https://user:secret@api.predioon.example", "https://api.predioon.example?x=1", "api.predioon.example"]) {
      const environment = { EAS_BUILD: "true", ...(value === undefined ? {} : { PRODUCTION_API_URL: value }) };
      const result = box.run(environment);
      assert.equal(result.status, 1, `accepted ${value}`);
      assert.match(result.stderr, /PRODUCTION_API_URL/);
      if (value?.includes("secret")) assert.doesNotMatch(result.stderr, /secret/);
      assert.equal(box.read(), committed);
    }
  } finally { box.cleanup(); }
});

test("refuses to run outside EAS Build or for an unknown app", () => {
  const box = sandbox();
  try {
    const local = box.run({ PRODUCTION_API_URL: "https://api.predioon.example" });
    assert.equal(local.status, 1);
    assert.match(local.stderr, /EAS Build/);
    const unknown = box.run({ EAS_BUILD: "true", PRODUCTION_API_URL: "https://api.predioon.example" }, "admin-web");
    assert.equal(unknown.status, 1);
    assert.equal(box.read(), committed);
  } finally { box.cleanup(); }
});

test("requires exactly one PRODUCTION_API_URL literal", () => {
  assert.throws(() => configureSource("export const API_URL = '';", "https://a.example"), /exatamente um/);
  const twice = `${committed}\nconst PRODUCTION_API_URL = "";\n`;
  assert.throws(() => configureSource(twice, "https://a.example"), /exatamente um/);
});

test("normalises only a bare origin, keeping an explicit port", () => {
  assert.equal(apiOrigin("https://api.predioon.example/"), "https://api.predioon.example");
  assert.equal(apiOrigin("https://api.predioon.example:8443"), "https://api.predioon.example:8443");
  assert.throws(() => apiOrigin("https://api.predioon.example#x"));
});
