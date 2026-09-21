import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeAppDb, sqlClient, withUserContext } from "@predioon/db";
import { sql } from "drizzle-orm";
import { call, json, login, startTestServer, unique, type Session, type TestServer } from "./helpers.js";

/**
 * Integration tests against the local stack. Run `pnpm infra:up && pnpm db:seed` first.
 * They exercise the real middleware, the real database and the real RLS policies —
 * a mocked version of these tests would prove nothing about tenant isolation.
 */
describe("segurança da plataforma", () => {
  let server: TestServer;
  let admin: Session;
  let sindico: Session;
  let morador: Session;
  let testOrganizationId: string | undefined;
  const testReservationIds: string[] = [];
  let testAreaId: string | undefined;

  before(async () => {
    server = await startTestServer();
    admin = await login(server.url, "admin@predioon.local");
    sindico = await login(server.url, "sindico@predioon.local");
    morador = await login(server.url, "morador@predioon.local");
  });

  after(async () => {
    await server.close();
    for (const id of testReservationIds) await sqlClient`delete from reservations where id = ${id}`;
    if (testAreaId) await sqlClient`delete from common_areas where id = ${testAreaId}`;
    if (testOrganizationId) {
      await sqlClient`delete from buildings where organization_id = ${testOrganizationId}`;
      await sqlClient`delete from organizations where id = ${testOrganizationId}`;
    }
    // Sem fechar os pools (dono e aplicação), o processo de teste nunca encerra.
    await closeAppDb();
    await sqlClient.end();
  });

  describe("autenticação", () => {
    it("recusa senha errada sem revelar se o e-mail existe", async () => {
      const wrongPassword = await call(server.url, "/auth/login", {
        method: "POST",
        body: { email: "sindico@predioon.local", password: "errada" },
      });
      const unknownEmail = await call(server.url, "/auth/login", {
        method: "POST",
        body: { email: "ninguem@predioon.local", password: "errada" },
      });

      assert.equal(wrongPassword.status, 401);
      assert.equal(unknownEmail.status, 401);
      assert.deepEqual(await json(wrongPassword), await json(unknownEmail));
    });

    it("exige token para rotas autenticadas", async () => {
      const response = await call(server.url, "/buildings");
      assert.equal(response.status, 401);
    });

    it("rotaciona o refresh token e invalida o anterior", async () => {
      const first = await login(server.url, "morador@predioon.local");

      const refreshed = await call(server.url, "/auth/refresh", {
        method: "POST",
        body: { refreshToken: first.refreshToken },
      });
      assert.equal(refreshed.status, 200);

      const replayed = await call(server.url, "/auth/refresh", {
        method: "POST",
        body: { refreshToken: first.refreshToken },
      });
      assert.equal(replayed.status, 401, "o refresh token usado precisa deixar de funcionar");
    });
  });

  describe("isolamento entre prédios", () => {
    let otherBuildingId: string;

    before(async () => {
      const orgResponse = await call(server.url, "/organizations", {
          method: "POST",
          token: admin.accessToken,
          body: { name: unique("Cliente Teste"), slug: unique("cliente-teste") },
        });
      assert.equal(orgResponse.status, 201, "administrador deve conseguir criar cliente com auditoria");
      const org = await json<{ id: string }>(orgResponse);
      testOrganizationId = org.id;

      const buildingResponse = await call(server.url, "/buildings", {
          method: "POST",
          token: admin.accessToken,
          body: { organizationId: org.id, name: unique("Prédio Teste"), code: unique("T").slice(0, 20) },
        });
      assert.equal(buildingResponse.status, 201, "prédio de teste deve existir para validar isolamento real");
      const building = await json<{ id: string }>(buildingResponse);
      assert.ok(building.id);

      otherBuildingId = building.id;
      await sqlClient`insert into devices (id, building_id, name, type) values (${otherBuildingId + "-sensor"}, ${otherBuildingId}, 'Sensor isolado', 'WATER_LEVEL_SENSOR')`;
      await sqlClient`insert into telemetry (event_id, building_id, device_id, metric, value, numeric_value, time) values (${unique("rls")}, ${otherBuildingId}, ${otherBuildingId + "-sensor"}, 'water_level_percent', '50'::jsonb, 50, now())`;
    });

    it("RLS filtra telemetria de terceiros mesmo sem filtro da API", async () => {
      const visible = await withUserContext({ userId: "building_admin", role: "BUILDING_ADMIN" },
        tx => tx.execute(sql`select distinct building_id from telemetry`));
      assert.ok(visible.some(row => row.building_id === "bld_001"));
      assert.ok(!visible.some(row => row.building_id === otherBuildingId));
      const adminVisible = await withUserContext({ userId: "platform_admin", role: "PLATFORM_ADMIN" },
        tx => tx.execute(sql`select building_id from telemetry where building_id = ${otherBuildingId}`));
      assert.equal(adminVisible.length, 1, "a amostra de outro prédio existe e é visível só ao administrador global");
    });

    it("não lista prédios de terceiros para o síndico", async () => {
      const response = await call(server.url, "/buildings", { token: sindico.accessToken });
      const body = await json<{ items: Array<{ id: string }> }>(response);
      assert.ok(!body.items.some((item) => item.id === otherBuildingId));
    });

    it("bloqueia leitura direta de outro prédio", async () => {
      const response = await call(server.url, `/buildings/${otherBuildingId}`, { token: sindico.accessToken });
      assert.equal(response.status, 403);
    });

    it("bloqueia telemetria de outro prédio mesmo passando o id na query", async () => {
      const response = await call(server.url, `/telemetry/latest?buildingId=${otherBuildingId}`, {
        token: sindico.accessToken,
      });
      assert.equal(response.status, 403);
    });

    it("impede que morador acesse rotas de administração da plataforma", async () => {
      const response = await call(server.url, "/organizations", { token: morador.accessToken });
      assert.equal(response.status, 403);
    });

    it("impede que morador publique avisos", async () => {
      const buildings = await json<{ items: Array<{ id: string }> }>(
        await call(server.url, "/buildings", { token: morador.accessToken }),
      );
      const buildingId = buildings.items[0]?.id;
      assert.ok(buildingId, "morador precisa estar vinculado a um prédio no seed");

      const response = await call(server.url, "/notices", {
        method: "POST",
        token: morador.accessToken,
        body: { buildingId, title: "Não deveria passar", body: "teste" },
      });
      assert.equal(response.status, 403);
    });
  });

  describe("reservas de áreas comuns", () => {
    it("recusa duas reservas sobrepostas na mesma área", async () => {
      const buildings = await json<{ items: Array<{ id: string }> }>(
        await call(server.url, "/buildings", { token: morador.accessToken }),
      );
      const buildingId = buildings.items[0]!.id;

      // A dedicated area makes this test independent of existing bookings and repeated runs.
      const areaResponse = await call(server.url, "/common-areas", {
        method: "POST", token: sindico.accessToken,
        body: { buildingId, name: unique("Área de teste"), maxHoursPerBooking: 6 },
      });
      assert.equal(areaResponse.status, 201);
      const areaId = (await json<{ id: string }>(areaResponse)).id;
      testAreaId = areaId;
      const startsAt = new Date(Date.now() + 24 * 3_600_000);
      const endsAt = new Date(startsAt.getTime() + 2 * 3_600_000);

      const first = await call(server.url, "/reservations", {
        method: "POST",
        token: morador.accessToken,
        body: { areaId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
      });
      assert.equal(first.status, 201);
      testReservationIds.push((await json<{ id: string }>(first)).id);

      const overlapping = await call(server.url, "/reservations", {
        method: "POST",
        token: sindico.accessToken,
        body: {
          areaId,
          startsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
          endsAt: new Date(endsAt.getTime() + 3_600_000).toISOString(),
        },
      });
      assert.equal(overlapping.status, 409, "a constraint de exclusão do banco precisa barrar a sobreposição");
    });
  });
});
