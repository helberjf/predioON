import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDeepStrictEqual } from "node:util";
import {
  codeIs, createRuntimeServicesFixture, parseRuntimeServicesEnvironment, runtimeServicesSkipReason,
  safeDatabaseOperation, verifyOwnerPositiveControl, type RuntimeServicesFixture,
} from "./fixtures/runtime-services.js";
import { boundedTransaction, seedRuntimeServiceData } from "./fixtures/runtime-service-data.js";

const configuration = parseRuntimeServicesEnvironment(process.env);
const matcher = "public.app_automation_matches(public.automation_versions,text,public.alert_severity,text)";

async function baselineCase(run: (fixture: RuntimeServicesFixture) => Promise<void>) {
  const fixture = await createRuntimeServicesFixture(configuration!, { baselineRelease: 51 });
  try {
    await verifyOwnerPositiveControl(fixture);
    assert.ok(fixture.candidate052, "canonical 052 is required after the successful 051 owner control");
    await run(fixture);
  } finally { await fixture.cleanup(); }
}

async function matcherSnapshot(fixture: RuntimeServicesFixture) {
  const [row] = await safeDatabaseOperation("private canonical matcher metadata", () => boundedTransaction(fixture.observer, tx => tx`
    select to_jsonb(p) as definition from pg_proc p where p.oid=to_regprocedure(${matcher})`));
  assert.ok(row?.definition, "the real canonical matcher exists");
  return row.definition;
}

describe("052 exact pure matcher exception and heartbeat association", {
  concurrency: false, skip: configuration ? false : runtimeServicesSkipReason,
}, () => {
  it("accepts the unchanged canonical matcher and rejects a foreign gateway while inactive/disabled-gateway heartbeat remains operational", async () => {
    await baselineCase(async fixture => {
      const data = await seedRuntimeServiceData(fixture);
      const before = await matcherSnapshot(fixture);
      assert.deepEqual(await fixture.applyCandidate052(), [fixture.candidate052!.id]);
      assert.ok(isDeepStrictEqual(await matcherSnapshot(fixture), before), "052 preserves the complete original matcher catalogue row and ACL");
      await fixture.provisionRuntime();
      await safeDatabaseOperation("inactive source with disabled but associated gateway", () => boundedTransaction(fixture.owner, async tx => {
        await tx`update public.buildings set active=false where id=${data.building}`;
        await tx`update public.gateways set enabled=false where id=${data.gateway}`;
      }));
      const positive = await safeDatabaseOperation("associated enabled source still records its heartbeat", () => boundedTransaction(fixture.ingest, tx => tx`
        update public.devices set status='OFFLINE',last_seen_at=clock_timestamp(),updated_at=clock_timestamp()
        where id=${data.meter} returning id`));
      assert.equal(positive.length, 1);
      await safeDatabaseOperation("owner establishes cross-building association negative control", () => boundedTransaction(fixture.owner, tx => tx`
        update public.devices set gateway_id=${data.otherGateway} where id=${data.meter}`));
      const [invalid] = await safeDatabaseOperation("independent observer confirms foreign gateway control", () => boundedTransaction(fixture.observer, tx => tx`
        select d.gateway_id,g.building_id<>d.building_id as foreign_parent from public.devices d
        join public.gateways g on g.id=d.gateway_id where d.id=${data.meter}`));
      assert.ok(invalid?.foreign_parent && invalid.gateway_id === data.otherGateway);
      await assert.rejects(safeDatabaseOperation("foreign gateway heartbeat rejected by WITH CHECK", () => boundedTransaction(fixture.ingest, tx => tx`
        update public.devices set status='ONLINE',last_seen_at=clock_timestamp() where id=${data.meter}`)), codeIs("42501"));
      const [unchanged] = await safeDatabaseOperation("denied heartbeat leaves operational state unchanged", () => boundedTransaction(fixture.observer, tx => tx`
        select status from public.devices where id=${data.meter}`));
      assert.equal(unchanged?.status, "OFFLINE");
      await safeDatabaseOperation("owner establishes optional-gateway positive control", () => boundedTransaction(fixture.owner, tx => tx`
        update public.devices set gateway_id=null where id=${data.meter}`));
      const standalone = await safeDatabaseOperation("source without gateway still records heartbeat", () => boundedTransaction(fixture.ingest, tx => tx`
        update public.devices set status='ONLINE',last_seen_at=clock_timestamp() where id=${data.meter} returning id`));
      assert.equal(standalone.length, 1);
    });
  });

  for (const [label, mutation] of [
    ["rewritten body", `CREATE OR REPLACE FUNCTION ${matcher.replace("(public.automation_versions,text,public.alert_severity,text)", "(target public.automation_versions, alert_type text, alert_level public.alert_severity, alert_device text)")}
      RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true'`],
    ["SECURITY DEFINER", `ALTER FUNCTION ${matcher} SECURITY DEFINER`],
    ["non-immutable definition", `ALTER FUNCTION ${matcher} STABLE`],
    ["changed effective ACL", `GRANT EXECUTE ON FUNCTION ${matcher} TO predioon_app`],
  ] as const) {
    it(`does not extend the matcher exception to a ${label}`, async () => {
      await baselineCase(async fixture => {
        await safeDatabaseOperation("controlled fixture-only matcher alteration", () => boundedTransaction(fixture.owner, tx => tx.unsafe(mutation)));
        const before = await matcherSnapshot(fixture);
        await assert.rejects(fixture.applyCandidate052(), codeIs("42501"));
        assert.ok(isDeepStrictEqual(await matcherSnapshot(fixture), before), "failed migration preserves the altered matcher rather than repairing it");
        const [ledger] = await safeDatabaseOperation("failed matcher guard leaves ledger at 051", () => boundedTransaction(fixture.observer, tx => tx`
          select count(*)::int as count from public.schema_migrations`));
        assert.equal(ledger?.count, 51);
      });
    });
  }
});
