import { after, before, describe, it } from "node:test";
import { verifyRestrictedDatabaseRole } from "../src/runtime-connection.js";
import {
  assertPermissionDenied, assertServiceCatalogue, createRuntimeServicesFixture,
  parseRuntimeServicesEnvironment, runtimeServicesSkipReason, safeDatabaseOperation,
  verifyOwnerPositiveControl, type RuntimeServicesFixture,
} from "./fixtures/runtime-services.js";

const configuration = parseRuntimeServicesEnvironment(process.env);

// Initial Task4a catalogue/negative slice. Dispatcher/ACK positives, actor/TTL races,
// trigger interference and complete ACL/atomicity proofs remain Task4 follow-up.
describe("physical access service real PostgreSQL contract", { concurrency: false,
  skip: configuration ? false : runtimeServicesSkipReason }, () => {
  let fixture: RuntimeServicesFixture | undefined;
  let authenticated = false;
  before(async () => { fixture = await createRuntimeServicesFixture(configuration!); });
  after(async () => { await fixture?.cleanup(); });

  it("owner positive control sees the canonical schema, exact ledger and isolated synthetic UUID", async () => {
    await verifyOwnerPositiveControl(fixture!);
  });

  it("052 provides the physical role and private helpers before real authentication", async () => {
    await assertServiceCatalogue(fixture!, "predioon_access_service");
    await fixture!.provisionRuntime();
    await safeDatabaseOperation("real physical-service login identity", () => verifyRestrictedDatabaseRole(fixture!.access, "predioon_access_service"));
    authenticated = true;
  });

  it("authenticated physical service has no private-table, observational or DDL shortcut", async context => {
    if (!authenticated) { context.skip("bounded negatives require the preceding 052 catalogue and real-login contract"); return; }
    await safeDatabaseOperation("physical-service identity before negatives", () => verifyRestrictedDatabaseRole(fixture!.access, "predioon_access_service"));
    for (const statement of [
      "select metadata from public.gateways",
      "select password_hash from public.users",
      "select * from public.schema_migrations",
      "select * from public.gate_commands",
      "insert into public.gate_commands default values",
      "update public.gate_commands set status='PENDING'",
      "delete from public.gate_commands where false",
      "select * from public.telemetry",
      "select * from public.outbox_events",
      "create table public.runtime_services_forbidden(id integer)",
      "create temporary table runtime_services_forbidden_temp(id integer)",
    ]) await assertPermissionDenied(fixture!.access, statement);
    await assertPermissionDenied(fixture!.access, "select password_hash from public.users", true);
  });
});
