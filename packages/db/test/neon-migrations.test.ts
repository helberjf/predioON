import assert from "node:assert/strict";
import { it } from "node:test";
import { adaptNeonMigrations } from "../src/neon-migrations.js";
import { loadInfrastructureMigrations } from "../src/infrastructure-migrations.js";
import { migrationChecksum, pendingMigrations } from "../src/migration-runner.js";

it("adapts only reviewed Neon role statements and checks every target is not a superuser", async () => {
  const original = await loadInfrastructureMigrations();
  const adapted = adaptNeonMigrations(original);
  assert.equal(adapted.length, original.length);
  for (let index = 0; index < original.length; index++) {
    const before = original[index]!, after = adapted[index]!;
    if (["015-api-runtime-roles", "038-durable-alert-delivery", "052-ingest-runtime-roles"].includes(before.id)) {
      assert.notEqual(migrationChecksum(before.source), migrationChecksum(after.source));
      assert.ok(after.execute);
      let executed = "";
      await after.execute!({ unsafe: async (sql: string) => { executed = sql; } } as never);
      assert.ok(!executed.includes("NOSUPERUSER"));
      assert.match(executed, /rolsuper/);
      assert.match(executed, /RAISE EXCEPTION/);
      assert.match(executed, /NOBYPASSRLS/);
      assert.match(executed, /NOINHERIT/);
    } else if (before.id !== "057-automation-schedules") assert.equal(after, before);
  }
});

it("refuses unreviewed SQL and refuses to mix Neon and standard migration history", async () => {
  const original = await loadInfrastructureMigrations();
  const target = original.find(migration => migration.id === "015-api-runtime-roles")!;
  assert.throws(() => adaptNeonMigrations([{ ...target, source: target.source + "\nselect 1;" }]), /revis/);
  const adapted = adaptNeonMigrations(original);
  const history = adapted.slice(0, 15).map(({id,source}) => ({id,checksum:migrationChecksum(source)}));
  assert.throws(() => pendingMigrations(original, history), /checksum/);
  assert.deepEqual(pendingMigrations(adapted, history).map(item => item.id), adapted.slice(15).map(item => item.id));
});

it("records the unavailable Timescale Community scheduler explicitly in the Neon demo profile", async () => {
  const original = (await loadInfrastructureMigrations()).find(item => item.id === "057-automation-schedules")!;
  const adapted = adaptNeonMigrations([original])[0]!;
  assert.notEqual(migrationChecksum(adapted.source), migrationChecksum(original.source));
  let executed = "";
  await adapted.execute!({ unsafe: async (sql: string) => { executed = sql; } } as never);
  assert.match(executed, /CREATE OR REPLACE FUNCTION app_automation_run_schedules/);
  assert.ok(!executed.includes("PERFORM add_job("));
  assert.match(executed, /COMMENT ON PROCEDURE app_automation_schedule_job/);
  assert.match(executed, /Neon demo: scheduler unavailable/);
});
