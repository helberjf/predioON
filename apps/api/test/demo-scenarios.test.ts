import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { config } from "../src/config.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

// An ordinary installation runs without DEMO_SCENARIOS: the scenario routes do not exist.
describe("cenários da demonstração desligados por padrão", { skip: config.demoScenarios }, () => {
  let server: TestServer, admin: string;
  before(async () => {
    server = await startTestServer();
    admin = (await login(server.url, "admin@predioon.local")).accessToken;
  });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });

  it("informa que o modo está desligado e recusa ler ou trocar cenários", async () => {
    const status = await call(server.url, "/v1/demo", { token: admin });
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { enabled: false });
    assert.equal((await call(server.url, "/v1/demo/scenarios/bld_001", { token: admin })).status, 404);
    assert.equal((await call(server.url, "/v1/demo/scenarios/bld_001", { token: admin, method: "PUT", body: { scenario: "leak" } })).status, 404);
    assert.equal((await sqlClient`select count(*)::int as total from demo_scenarios where building_id='bld_001' and scenario='leak' and updated_at>now()-interval '1 minute'`)[0]!.total, 0);
  });

  it("só o administrador da plataforma pode gravar, mesmo direto no banco", async () => {
    const grants = await sqlClient`select has_table_privilege('predioon_app','demo_scenarios','INSERT') as insert_app,
      has_table_privilege('predioon_ingest','demo_scenarios','UPDATE') as update_ingest,
      has_function_privilege('predioon_ingest','app_demo_scenario_set(text,text)','EXECUTE') as ingest_set`;
    assert.deepEqual(grants[0], { insert_app: false, update_ingest: false, ingest_set: false });
  });
});
