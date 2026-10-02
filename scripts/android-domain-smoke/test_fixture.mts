import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sqlClient } from "../../packages/db/src/index.ts";
import { closeAppDb } from "../../packages/db/src/runtime.ts";
import { startTestServer, call } from "../../apps/api/test/helpers.ts";
import { cleanup, createFixture, revoke, snapshot } from "./fixture.mts";

after(async () => {
  await closeAppDb();
  await sqlClient.end();
});
test("native domain fixtures exercise real published privacy, own writes, exact operations and revocation", async () => {
  const password = "AndroidDomainTestPassword123";
  const server = await startTestServer();
  let fixture: Awaited<ReturnType<typeof createFixture>> | undefined;
  try {
    fixture = await createFixture(password);
    const f = fixture,
      resident = f.accounts["resident-mobile"]!,
      operator = f.accounts["operations-mobile"]!;
    const tokens: Record<string, string> = {};
    for (const [app, account] of Object.entries(f.accounts)) {
      const response = await call(server.url, "/auth/login", {
        method: "POST",
        body: { email: account.email, password },
      });
      assert.equal(response.status, 200);
      tokens[app] = (await response.json()).accessToken;
    }
    const request = async (
      app: string,
      path: string,
      method = "GET",
      body?: unknown,
    ) => {
      const response = await call(server.url, path, {
        token: tokens[app],
        method,
        body,
      });
      return { status: response.status, body: await response.json() };
    };
    const own = (path: string, method = "GET", body?: unknown) =>
      request("resident-mobile", path, method, body);
    const ops = (path: string, method = "GET", body?: unknown) =>
      request("operations-mobile", path, method, body);
    for (const [app, account] of Object.entries(f.accounts)) {
      const discovery = await request(app, "/buildings");
      assert.equal(discovery.status, 200);
      assert.deepEqual(discovery.body.items.map((b: { id: string }) => b.id), [account.buildingId]);
      assert.equal((await request(app, `/features/buildings/${account.buildingId}`)).status, 200);
    }
    const finance = await own(`/finance?buildingId=${resident.buildingId}`);
    assert.equal(finance.status, 200);
    assert.deepEqual(
      finance.body.items.map((r: { title: string }) => r.title),
      [f.labels.report],
    );
    assert.equal(finance.body.items[0].entries[0].description, f.labels.entry);
    const notices = await own(`/notices?buildingId=${resident.buildingId}`);
    assert.equal(notices.status, 200);
    assert.deepEqual(
      notices.body.items.map((n: { title: string }) => n.title),
      [f.labels.notice],
    );
    const tickets = await own(`/occurrences?buildingId=${resident.buildingId}`);
    assert.equal(tickets.status, 200);
    assert.deepEqual(
      tickets.body.items.map((t: { id: string }) => t.id),
      [f.ids.residentTicket],
    );
    assert.equal(
      (await own(`/occurrences/${f.ids.neighborTicket}`)).status,
      404,
    );
    const created = await own("/occurrences", "POST", {
      buildingId: resident.buildingId,
      category: "Geral",
      title: f.labels.created,
      description: f.labels.description,
      priority: "NORMAL",
    });
    assert.equal(created.status, 201);
    assert.equal(
      (
        await own(`/occurrences/${created.body.id}/comments`, "POST", {
          message: f.labels.comment,
        })
      ).status,
      201,
    );
    assert.equal(
      (await ops(`/v1/authorization?buildingId=${operator.buildingId}`)).status,
      403,
    );
    const overview = await ops(
      `/overview/building?buildingId=${operator.buildingId}`,
    );
    assert.equal(overview.status, 200);
    assert.equal(overview.body.occurrenceVisibility, "scoped");
    assert.equal(overview.body.counts.open_occurrences, 1);
    assert.equal(overview.body.counts.open_alerts, 1);
    const readings = await ops(
      `/telemetry/latest?buildingId=${operator.buildingId}`,
    );
    assert.equal(readings.status, 200);
    assert.deepEqual(
      readings.body.items.map((r: { device_id: string }) => r.device_id),
      [f.ids.device],
    );
    assert.equal(
      (await ops(`/alerts/${f.ids.neighborAlert}/acknowledge`, "POST")).status,
      404,
    );
    assert.equal(
      (await ops(`/alerts/${f.ids.alert}/acknowledge`, "POST")).status,
      200,
    );
    assert.equal(
      (
        await ops(`/occurrences/${f.ids.operatorNeighborTicket}`, "PATCH", {
          status: "IN_PROGRESS",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await ops(`/occurrences/${f.ids.operatorTicket}`, "PATCH", {
          status: "IN_PROGRESS",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await ops(`/occurrences/${f.ids.operatorTicket}/comments`, "POST", {
          message: f.labels.operatorComment,
        })
      ).status,
      201,
    );
    for (const kind of ["device", "ticket", "finance"]) await revoke(f, kind);
    const revokedFeatures = await ops(`/features/buildings/${operator.buildingId}`);
    assert.equal(revokedFeatures.status, 403);
    assert.equal(revokedFeatures.body.error, "Prédio fora do seu escopo");
    assert.equal(
      (await own(`/finance?buildingId=${resident.buildingId}`)).status,
      403,
    );
    assert.equal(
      (await ops(`/telemetry/latest?buildingId=${operator.buildingId}`)).status,
      403,
    );
    assert.equal(
      (
        await ops(`/occurrences/${f.ids.operatorTicket}`, "PATCH", {
          status: "DONE",
        })
      ).status,
      404,
    );
    assert.equal(
      (await ops(`/overview/building?buildingId=${operator.buildingId}`))
        .status,
      403,
    );
    assert.deepEqual(await snapshot(f), {
      residentCreated: 1,
      residentComments: 1,
      operatorStatus: "IN_PROGRESS",
      operatorComments: 1,
      alertStatus: "ACKNOWLEDGED",
      neighborStatus: "OPEN",
      neighborAlertStatus: "OPEN",
      neighborEvents: 0,
      deviceGrantActive: false,
      ticketGrantActive: false,
      financeGrantActive: false,
    });
  } finally {
    await server.close();
    if (fixture) await cleanup(fixture);
  }
});
