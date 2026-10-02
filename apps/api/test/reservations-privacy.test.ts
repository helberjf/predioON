import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

type Reservation = {
  id: string; buildingId: string; areaId: string; userId: string; unit: string | null;
  startsAt: string; endsAt: string; status: string; notes: string | null;
};

/** HTTP containment until 029 replaces the broad legacy reservations SELECT policy.
 * These tests do not claim to prove direct SQL isolation or implement a calendar API.
 */
describe("privacidade do DTO de reservas", () => {
  let server: TestServer, passwordHash: string;
  before(async () => { passwordHash = await hashPassword("predioon123"); server = await startTestServer(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });

  async function create() {
    const suffix = randomUUID();
    const org = `reservation-privacy-${suffix}`, a = `rp-a-${suffix}`, b = `rp-b-${suffix}`;
    const manager = `rp-manager-${suffix}`, resident = `rp-resident-${suffix}`, neighbor = `rp-neighbor-${suffix}`;
    const ids = [manager, resident, neighbor], areaA = randomUUID(), areaB = randomUUID();
    const booking = { managerA: randomUUID(), residentA: randomUUID(), neighborA: randomUUID(), managerB: randomUUID(), neighborB: randomUUID() };
    const cleanup = async () => {
      await sqlClient`delete from buildings where organization_id=${org}`;
      await sqlClient`delete from organizations where id=${org}`;
      await sqlClient`delete from users where id in ${sqlClient(ids)}`;
    };
    try {
      await sqlClient`insert into organizations(id,name,slug) values(${org},'Reservation privacy test',${org})`;
      await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${org},'Privacy A','A'),(${b},${org},'Privacy B','B')`;
      for (const id of ids) await sqlClient`insert into users(id,name,email,password_hash) values(${id},${id},${id + '@privacy.test'},${passwordHash})`;
      await sqlClient`insert into memberships(user_id,building_id,role) values
        (${manager},${a},'BUILDING_ADMIN'),(${manager},${b},'RESIDENT'),
        (${resident},${a},'RESIDENT'),(${neighbor},${a},'RESIDENT'),(${neighbor},${b},'BUILDING_ADMIN')`;
      await sqlClient`insert into common_areas(id,building_id,name) values(${areaA},${a},'Private A'),(${areaB},${b},'Private B')`;
      let index = 0;
      for (const [key, user, building, area] of [
        ["managerA", manager, a, areaA], ["residentA", resident, a, areaA], ["neighborA", neighbor, a, areaA],
        ["managerB", manager, b, areaB], ["neighborB", neighbor, b, areaB],
      ] as const) {
        const starts = new Date(Date.now() + (++index + 1) * 86_400_000);
        const ends = new Date(starts.getTime() + 3_600_000);
        await sqlClient`insert into reservations(id,building_id,area_id,user_id,starts_at,ends_at,unit,notes)
          values(${booking[key]},${building},${area},${user},${starts.toISOString()}::timestamptz,${ends.toISOString()}::timestamptz,${`unit-${key}`},${`private-note-${key}`})`;
      }
      const tokens = new Map<string, string>();
      for (const id of ids) tokens.set(id, (await login(server.url, `${id}@privacy.test`)).accessToken);
      const request = (user: string, building = a, query = "") => call(server.url, `/reservations?buildingId=${building}${query}`, { token: tokens.get(user) });
      return { org, a, b, ids, manager, resident, neighbor, booking, request, cleanup };
    } catch (error) { await cleanup(); throw error; }
  }
  type Fixture = Awaited<ReturnType<typeof create>>;
  async function fixture(run: (f: Fixture) => Promise<void>) {
    const f = await create();
    try { await run(f); } finally { await f.cleanup(); }
  }
  async function list(f: Fixture, user: string, building = f.a, query = ""): Promise<Reservation[]> {
    const response = await f.request(user, building, query);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return (await response.json()).items;
  }

  for (const query of ["", "&mine=false", "&mine=true"]) {
    it(`morador recebe somente sua reserva com ${query || "mine ausente"}`, async () => fixture(async f => {
      const rows = await list(f, f.resident, f.a, query);
      assert.deepEqual(rows.map(row => row.id), [f.booking.residentA]);
      assert.equal(rows[0]!.userId, f.resident);
      assert.equal(rows[0]!.unit, "unit-residentA");
      assert.equal(rows[0]!.notes, "private-note-residentA");
      const serialized = JSON.stringify(rows);
      for (const secret of [f.manager, f.neighbor, f.booking.managerA, f.booking.neighborA, "unit-managerA", "unit-neighborA", "private-note-managerA", "private-note-neighborA"]) {
        assert.ok(!serialized.includes(secret), "Nenhum campo privado de terceiros deve sair do endpoint");
      }
      assert.deepEqual(Object.keys(rows[0]!).sort(), ["areaId", "buildingId", "endsAt", "id", "notes", "startsAt", "status", "unit", "userId"]);
    }));
  }

  it("gestor mantém fila completa com mine=false/ausente e pode filtrar próprias", async () => fixture(async f => {
    const expected = [f.booking.managerA, f.booking.residentA, f.booking.neighborA].sort();
    for (const query of ["", "&mine=false"]) assert.deepEqual((await list(f, f.manager, f.a, query)).map(row => row.id).sort(), expected);
    assert.deepEqual((await list(f, f.manager, f.a, "&mine=true")).map(row => row.id), [f.booking.managerA]);
  }));

  it("papel de síndico em outro condomínio não abre reservas dos vizinhos", async () => fixture(async f => {
    assert.deepEqual((await list(f, f.neighbor, f.a, "&mine=false")).map(row => row.id), [f.booking.neighborA]);
    assert.deepEqual((await list(f, f.manager, f.b)).map(row => row.id), [f.booking.managerB]);
    assert.deepEqual((await list(f, f.neighbor, f.b, "&mine=false")).map(row => row.id).sort(), [f.booking.managerB, f.booking.neighborB].sort());
    assert.equal((await f.request(f.resident, f.b)).status, 403);
  }));

  it("perda do papel de gestão limita a mesma sessão às reservas próprias", async () => fixture(async f => {
    await sqlClient`update memberships set role='RESIDENT' where user_id=${f.manager} and building_id=${f.a}`;
    assert.deepEqual((await list(f, f.manager)).map(row => row.id), [f.booking.managerA]);
    await sqlClient`update memberships set active=false where user_id=${f.manager} and building_id=${f.a}`;
    assert.equal((await f.request(f.manager)).status, 403);
  }));

  it("recusa boolean ambíguo em vez de converter texto arbitrário para true", async () => fixture(async f => {
    for (const value of ["0", "1", "FALSE", "qualquer", ""]) assert.equal((await f.request(f.manager, f.a, `&mine=${value}`)).status, 400, value);
  }));
});
