import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
const run = (changes: Record<string,string | undefined> = {}) => spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "await import('./src/config.ts')"], { cwd: new URL('../', import.meta.url), encoding: "utf8", env: { ...process.env, DATABASE_URL: undefined, DATABASE_URL_INGEST: "postgres://predioon_ingest:fixture@localhost:5434/runtime_test", DATABASE_URL_ACCESS_SERVICE: "postgres://predioon_access_service:fixture@localhost:5434/runtime_test", ...changes } });
test("configuration accepts only the explicit runtime identities without owner credentials", () => { const result = run(); assert.equal(result.status, 0, result.stderr); });
test("configuration rejects different database targets before any pool opens", () => { const result = run({ DATABASE_URL_ACCESS_SERVICE: "postgres://predioon_access_service:fixture@localhost:5434/other" }); assert.notEqual(result.status, 0); assert.match(result.stderr, /mesmo banco/); });
test("configuration rejects owner username and redacts credentials", () => { const result = run({ DATABASE_URL_INGEST: "postgres://owner:private-secret@localhost:5434/runtime_test" }); assert.notEqual(result.status, 0); assert.doesNotMatch(result.stderr, /private-secret/); });
