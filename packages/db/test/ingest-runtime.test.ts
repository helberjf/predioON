import { after, before, describe, it } from "node:test";
import { verifyRestrictedDatabaseRole } from "../src/runtime-connection.js";
import {
  assertPermissionDenied, assertServiceCatalogue, createRuntimeServicesFixture,
  parseRuntimeServicesEnvironment, runtimeServicesSkipReason, safeDatabaseOperation,
  verifyOwnerPositiveControl, type RuntimeServicesFixture,
} from "./fixtures/runtime-services.js";

const configuration = parseRuntimeServicesEnvironment(process.env);

// Initial Task4a contract only. Operational writes, trigger interference, concurrent
// locks, full ACL/default/RLS contamination and 052 atomicity remain Task4 follow-up.
describe("observational ingest real PostgreSQL contract", { concurrency: false,
  skip: configuration ? false : runtimeServicesSkipReason }, () => {
  let fixture: RuntimeServicesFixture | undefined;
  let authenticated = false;
  before(async () => { fixture = await createRuntimeServicesFixture(configuration!); });
  after(async () => { await fixture?.cleanup(); });

  it("owner positive control sees the canonical schema, exact ledger and isolated synthetic UUID", async () => {
    await verifyOwnerPositiveControl(fixture!);
  });

  it("052 provides the observational role and private helpers before real authentication", async () => {
    await assertServiceCatalogue(fixture!, "predioon_ingest");
    await fixture!.provisionRuntime();
    await safeDatabaseOperation("real observational login identity", () => verifyRestrictedDatabaseRole(fixture!.ingest, "predioon_ingest"));
    authenticated = true;
  });

  it("authenticated ingest cannot read secrets, forge human access, write physical state or perform DDL", async context => {
    if (!authenticated) { context.skip("bounded negatives require the preceding 052 catalogue and real-login contract"); return; }
    // Positive identity is repeated before negatives, including current/session/usesysid.
    await safeDatabaseOperation("observational identity before negatives", () => verifyRestrictedDatabaseRole(fixture!.ingest, "predioon_ingest"));
    for (const statement of [
      "select metadata from public.gateways",
      "select password_hash from public.users",
      "select * from public.schema_migrations",
      "select * from public.gate_commands",
      "update public.gate_commands set status='PENDING'",
      "create table public.runtime_services_forbidden(id integer)",
      "create temporary table runtime_services_forbidden_temp(id integer)",
    ]) await assertPermissionDenied(fixture!.ingest, statement);
    await assertPermissionDenied(fixture!.ingest, "select password_hash from public.users", true);
  });
});
