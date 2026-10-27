import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

/**
 * Migration 064: monthly limits per resident and per apartment, the apartment
 * taken from the resident's record, events that take a common area, and
 * attendance answers with companions and a capacity.
 */
describe("limites de reserva, unidade da reserva e eventos com confirmação", () => {
  let server: TestServer;
  const suffix = randomUUID();
  const org = `rle-org-${suffix}`, a = `rle-a-${suffix}`, b = `rle-b-${suffix}`;
  const kinds = ["manager", "first", "second", "double", "lonely", "outsider"] as const;
  const ids = Object.fromEntries(kinds.map(kind => [kind, `rle-${kind}-${suffix}`])) as Record<typeof kinds[number], string>;
  const names: Record<typeof kinds[number], string> = { manager: "Síndica Ana", first: "Bruno do 101", second: "Carla do 101", double: "Davi de dois", lonely: "Eva sem unidade", outsider: "Fora" };
  const unit = { u101: randomUUID(), u201: randomUUID(), u202: randomUUID(), foreign: randomUUID() };
  const area = { salon: randomUUID(), grill: randomUUID(), free: randomUUID(), events: randomUUID(), race: randomUUID() };
  const tokens = new Map<string, string>();
  const request = async (user: string, path: string, method = "GET", body?: unknown) => {
    if (!tokens.has(user)) tokens.set(user, (await login(server.url, `${user}@limits.test`)).accessToken);
    return call(server.url, path, { token: tokens.get(user), method, body });
  };
  async function json(response: Response, expected: number) {
    const body = response.status === 204 ? null : await response.json();
    assert.equal(response.status, expected, JSON.stringify(body));
    return body;
  }
  // São Paulo has no daylight saving time: local time is UTC-3 all year.
  const now = new Date();
  const local = (monthsAhead: number, day: number, hours: number, minutes = 0) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsAhead, day, hours + 3, minutes));
  const lastDay = (monthsAhead: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsAhead + 1, 0)).getUTCDate();
  const book = (user: string, areaId: string, startsAt: Date, extra: Record<string, unknown> = {}) =>
    request(user, "/reservations", "POST", { areaId, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(), ...extra });

  before(async () => {
    server = await startTestServer();
    const passwordHash = await hashPassword("predioon123");
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Reservation limits',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${org},'Limits A','LA'),(${b},${org},'Limits B','LB')`;
    for (const kind of kinds) await sqlClient`insert into users(id,name,email,password_hash) values(${ids[kind]},${names[kind]},${ids[kind] + "@limits.test"},${passwordHash})`;
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${ids.manager},${a},'BUILDING_ADMIN'),
      (${ids.first},${a},'RESIDENT'),(${ids.second},${a},'RESIDENT'),(${ids.double},${a},'RESIDENT'),(${ids.lonely},${a},'RESIDENT'),(${ids.outsider},${b},'RESIDENT')`;
    await sqlClient`insert into units(id,building_id,code) values(${unit.u101},${a},'101'),(${unit.u201},${a},'201'),(${unit.u202},${a},'202'),(${unit.foreign},${b},'101')`;
    await sqlClient`insert into unit_memberships(building_id,unit_id,user_id) values(${a},${unit.u101},${ids.first}),(${a},${unit.u101},${ids.second}),
      (${a},${unit.u201},${ids.double}),(${a},${unit.u202},${ids.double}),(${b},${unit.foreign},${ids.outsider})`;
    await sqlClient`insert into common_areas(id,building_id,name,requires_approval,max_hours_per_booking,monthly_limit_per_unit,monthly_limit_per_resident) values
      (${area.salon},${a},'Salão de festas',false,6,1,null),(${area.grill},${a},'Churrasqueira',false,6,null,1),
      (${area.free},${a},'Quadra',false,6,null,null),(${area.events},${a},'Espaço gourmet',false,6,null,null),(${area.race},${a},'Salão de jogos',false,6,1,null)`;
  });
  after(async () => {
    await sqlClient`delete from audit_logs where user_id in ${sqlClient(Object.values(ids))}`;
    await sqlClient`delete from buildings where organization_id=${org}`;
    await sqlClient`delete from organizations where id=${org}`;
    await sqlClient`delete from users where id in ${sqlClient(Object.values(ids))}`;
    await server?.close(); await closeAppDb(); await sqlClient.end();
  });

  it("a reserva fica na unidade real do morador, nunca no texto digitado", async () => {
    const single = await json(await book(ids.first, area.free, local(2, 3, 10), { unit: "999" }), 201);
    assert.equal(single.unit, "101");
    const chosen = await json(await book(ids.double, area.free, local(2, 3, 12), { unitId: unit.u202 }), 201);
    assert.equal(chosen.unit, "202");
    const typed = await json(await book(ids.double, area.free, local(2, 3, 14), { unit: "201" }), 201);
    assert.equal(typed.unit, "201");
    const [stored] = await sqlClient`select unit_id from reservations where id=${typed.id}`;
    assert.equal(stored!.unit_id, unit.u201);
    const refused = await json(await book(ids.double, area.free, local(2, 3, 16), { unitId: unit.u101 }), 400);
    assert.equal(refused.error ?? refused.message, "Escolha um apartamento vinculado ao seu cadastro.");
    const free = await json(await book(ids.lonely, area.free, local(2, 3, 18), { unit: "casa 7" }), 201);
    assert.equal(free.unit, "casa 7");
    assert.deepEqual((await json(await request(ids.double, `/reservations/units?buildingId=${a}`), 200)).items.map((item: { code: string }) => item.code), ["201", "202"]);
    assert.deepEqual((await json(await request(ids.lonely, `/reservations/units?buildingId=${a}`), 200)).items, []);
    await json(await request(ids.outsider, `/reservations/units?buildingId=${a}`), 403);
  });

  it("o limite por unidade vale para todos os moradores do apartamento e volta ao cancelar", async () => {
    const firstBooking = await json(await book(ids.first, area.salon, local(2, 10, 12)), 201);
    const blocked = await json(await book(ids.second, area.salon, local(2, 20, 12)), 409);
    assert.equal(blocked.error ?? blocked.message, "Seu apartamento já atingiu o limite de 1 reserva por mês nesta área.");
    await json(await book(ids.double, area.salon, local(2, 21, 12), { unitId: unit.u201 }), 201);
    // With two apartments and a limit per apartment, the resident has to say which one.
    await json(await book(ids.double, area.salon, local(2, 22, 12)), 400);
    await json(await book(ids.double, area.salon, local(2, 22, 12), { unitId: unit.u202 }), 201);
    await json(await request(ids.first, `/reservations/${firstBooking.id}`, "DELETE"), 204);
    await json(await book(ids.second, area.salon, local(2, 20, 12)), 201);
    await json(await book(ids.first, area.salon, local(3, 10, 12)), 201);
    const required = await json(await book(ids.lonely, area.salon, local(2, 25, 12)), 400);
    assert.match(required.error ?? required.message, /limite por apartamento/);
  });

  it("o limite por morador conta o mês no fuso do condomínio", async () => {
    const month = 4, last = lastDay(month);
    // 22:00 on the last day in São Paulo is already the next day in UTC.
    await json(await book(ids.first, area.grill, local(month, last, 22)), 201);
    await json(await book(ids.first, area.grill, local(month + 1, 1, 10)), 201);
    const blocked = await json(await book(ids.first, area.grill, local(month, 5, 10)), 409);
    assert.equal(blocked.error ?? blocked.message, "Você já atingiu o limite de 1 reserva por mês nesta área.");
    await json(await book(ids.second, area.grill, local(month, 5, 10)), 201);
  });

  it("pedidos simultâneos não furam o limite por unidade", async () => {
    const results = await Promise.all([book(ids.first, area.race, local(5, 8, 12)), book(ids.second, area.race, local(5, 18, 12))]);
    assert.deepEqual(results.map(response => response.status).sort(), [201, 409]);
    const [row] = await sqlClient`select count(*)::int as total from reservations where area_id=${area.race} and status in ('PENDING','CONFIRMED')`;
    assert.equal(row!.total, 1);
  });

  it("áreas novas têm uma reserva por apartamento; síndico cancela e altera para duas ou ilimitadas", async () => {
    const created = await json(await request(ids.manager, "/common-areas", "POST", { buildingId: a, name: "Brinquedoteca" }), 201);
    assert.equal(created.monthlyLimitPerUnit, 1);
    assert.equal(created.monthlyLimitPerResident, null);
    const [raw] = await sqlClient`insert into common_areas(building_id,name) values(${a},'Padrão SQL') returning monthly_limit_per_unit`;
    assert.equal(raw!.monthly_limit_per_unit, 1);
    const first = await json(await book(ids.first, created.id, local(6, 2, 10)), 201);
    await json(await book(ids.second, created.id, local(6, 3, 10)), 409);
    await json(await request(ids.outsider, `/reservations/${first.id}`, "DELETE"), 404);
    await json(await request(ids.second, `/reservations/${first.id}`, "DELETE"), 404);
    await json(await request(ids.manager, `/reservations/${first.id}`, "DELETE"), 204);
    const [cancelled] = await sqlClient`select status from reservations where id=${first.id}`;
    assert.equal(cancelled!.status, "CANCELLED");
    const [audit] = await sqlClient`select user_id from audit_logs where action='RESERVATION_CANCELLED' and resource_id=${first.id}`;
    assert.equal(audit!.user_id, ids.manager);
    const pending = await json(await book(ids.second, created.id, local(6, 3, 10)), 201);
    await json(await request(ids.manager, `/reservations/${pending.id}/decision`, "POST", { status: "CONFIRMED" }), 200);
    await json(await request(ids.manager, `/reservations/${pending.id}`, "DELETE"), 204);
    await json(await request(ids.manager, `/common-areas/${created.id}`, "PATCH", { monthlyLimitPerUnit: 2 }), 200);
    await json(await book(ids.first, created.id, local(6, 4, 10)), 201);
    await json(await book(ids.second, created.id, local(6, 5, 10)), 201);
    await json(await book(ids.first, created.id, local(6, 6, 10)), 409);
    await json(await request(ids.first, `/common-areas/${created.id}`, "PATCH", { monthlyLimitPerUnit: null }), 403);
    await json(await request(ids.manager, `/common-areas/${created.id}`, "PATCH", { monthlyLimitPerUnit: null }), 200);
    await json(await book(ids.first, created.id, local(6, 6, 10)), 201);
    const keptUnlimited = await json(await request(ids.manager, `/common-areas/${created.id}`, "PATCH", { name: "Brinquedoteca ampliada" }), 200);
    assert.equal(keptUnlimited.monthlyLimitPerUnit, null);
    const explicit = await json(await request(ids.manager, "/common-areas", "POST", { buildingId: a, name: "Biblioteca", monthlyLimitPerUnit: null }), 201);
    assert.equal(explicit.monthlyLimitPerUnit, null);
  });

  it("o evento ocupa a área: reservas e calendário respeitam o horário", async () => {
    await json(await book(ids.double, area.events, local(2, 12, 10), { unitId: unit.u201 }), 201);
    const overlapping = await json(await request(ids.manager, "/v1/building-events", "POST", {
      buildingId: a, title: "Reunião", areaId: area.events, startsAt: local(2, 12, 10, 30).toISOString(), endsAt: local(2, 12, 12).toISOString(),
    }), 409);
    assert.match(overlapping.error ?? overlapping.message, /Já há reservas nesta área/);
    const event = await json(await request(ids.manager, "/v1/building-events", "POST", {
      buildingId: a, title: "Festa junina", description: "Traga um prato", areaId: area.events,
      startsAt: local(2, 13, 18).toISOString(), endsAt: local(2, 13, 23).toISOString(), maxGuests: 2, capacity: 4,
    }), 201);
    assert.equal(event.areaName, "Espaço gourmet");
    assert.equal(event.status, "SCHEDULED");
    const taken = await json(await book(ids.first, area.events, local(2, 13, 20)), 409);
    assert.equal(taken.error ?? taken.message, "Há um evento do condomínio nesta área neste horário.");
    const busy = await json(await request(ids.first, `/reservations/availability?${new URLSearchParams({ buildingId: a, areaId: area.events, from: local(2, 13, 0).toISOString(), to: local(2, 14, 0).toISOString() })}`), 200);
    assert.deepEqual(busy.items.map((item: Record<string, string>) => Object.keys(item).sort()), [["endsAt", "startsAt"]]);
    assert.equal(Date.parse(busy.items[0].startsAt), local(2, 13, 18).getTime());
    await json(await request(ids.first, "/v1/building-events", "POST", { buildingId: a, title: "Minha festa", startsAt: local(2, 15, 18).toISOString(), endsAt: local(2, 15, 20).toISOString() }), 403);
    const [audit] = await sqlClient`select count(*)::int as total from audit_logs where action='EVENT_CREATED' and resource_id=${event.id}`;
    assert.equal(audit!.total, 1);

    const calendar = await json(await request(ids.manager, `/reservations/calendar?${new URLSearchParams({ buildingId: a, areaId: area.events, from: local(2, 1, 0).toISOString(), to: local(3, 1, 0).toISOString() })}`), 200);
    assert.deepEqual(calendar.reservations.map((item: { requesterName: string; unit: string }) => [item.requesterName, item.unit]), [[names.double, "201"]]);
    assert.deepEqual(calendar.events.map((item: { title: string }) => item.title), ["Festa junina"]);
    await json(await request(ids.first, `/reservations/calendar?${new URLSearchParams({ buildingId: a, areaId: area.events, from: local(2, 1, 0).toISOString(), to: local(3, 1, 0).toISOString() })}`), 403);
    await json(await request(ids.manager, `/reservations/calendar?${new URLSearchParams({ buildingId: a, areaId: area.events, from: local(2, 1, 0).toISOString(), to: local(4, 1, 0).toISOString() })}`), 400);
  });

  it("confirmação de presença respeita acompanhantes, vagas, prazo e cancelamento", async () => {
    const event = await json(await request(ids.manager, "/v1/building-events", "POST", {
      buildingId: a, title: "Churrasco de fim de ano", startsAt: local(2, 27, 12).toISOString(), endsAt: local(2, 27, 18).toISOString(), maxGuests: 2, capacity: 4,
    }), 201);
    const answer = (user: string, attending: boolean, guests = 0) => request(user, `/v1/building-events/${event.id}/response`, "PUT", { attending, guests });
    const mine = await json(await answer(ids.first, true, 2), 200);
    assert.deepEqual(mine.myResponse, { attending: true, guests: 2 });
    assert.equal(mine.attendingPeople, 3);
    const full = await json(await answer(ids.second, true, 1), 409);
    assert.equal(full.error ?? full.message, "Não há mais vagas para este evento.");
    await json(await answer(ids.second, true, 0), 200);
    const tooMany = await json(await answer(ids.double, true, 3), 400);
    assert.equal(tooMany.error ?? tooMany.message, "Este evento aceita até 2 acompanhantes por morador.");
    const declined = await json(await answer(ids.double, false, 2), 200);
    assert.deepEqual(declined.myResponse, { attending: false, guests: 0 });
    assert.deepEqual([declined.attendingResponses, declined.attendingPeople, declined.declinedResponses], [2, 4, 1]);
    await json(await answer(ids.outsider, true), 404);

    const listed = await json(await request(ids.second, `/v1/building-events?buildingId=${a}`), 200);
    const seen = listed.items.find((item: { id: string }) => item.id === event.id);
    assert.deepEqual(seen.myResponse, { attending: true, guests: 0 });
    for (const secret of [names.first, names.double, ids.first, ids.double]) assert.ok(!JSON.stringify(listed).includes(secret), "Respostas de vizinhos não saem para moradores");
    await json(await request(ids.second, `/v1/building-events/${event.id}/responses`), 403);
    const answers = await json(await request(ids.manager, `/v1/building-events/${event.id}/responses`), 200);
    assert.deepEqual(answers.items.map((item: { name: string; unit: string; attending: boolean; guests: number }) => [item.name, item.unit, item.attending, item.guests]),
      [[names.first, "101", true, 2], [names.second, "101", true, 0], [names.double, "201, 202", false, 0]]);

    await json(await answer(ids.first, false), 200);
    await sqlClient`update building_events set rsvp_until=now()-interval '1 minute', version=version+1 where id=${event.id}`;
    const closed = await json(await answer(ids.first, true), 409);
    assert.equal(closed.error ?? closed.message, "As confirmações deste evento já foram encerradas.");
    const [current] = await sqlClient`select version from building_events where id=${event.id}`;
    await json(await request(ids.manager, `/v1/building-events/${event.id}/cancel`, "POST", { version: current!.version }), 200);
    const cancelled = await json(await answer(ids.second, false), 409);
    assert.equal(cancelled.error ?? cancelled.message, "Este evento foi cancelado.");
    await json(await request(ids.manager, `/v1/building-events/${event.id}/cancel`, "POST", { version: current!.version + 1 }), 409);
  });

  it("edição usa a versão atual e reservas desligadas fecham os eventos", async () => {
    const event = await json(await request(ids.manager, "/v1/building-events", "POST", {
      buildingId: a, title: "Assembleia", location: "Hall", startsAt: local(2, 28, 19).toISOString(), endsAt: local(2, 28, 21).toISOString(),
    }), 201);
    const renamed = await json(await request(ids.manager, `/v1/building-events/${event.id}`, "PATCH", { version: event.version, title: "Assembleia geral" }), 200);
    assert.equal(renamed.title, "Assembleia geral");
    assert.equal(renamed.version, event.version + 1);
    await json(await request(ids.manager, `/v1/building-events/${event.id}`, "PATCH", { version: event.version, title: "Antiga" }), 409);
    await json(await request(ids.manager, `/v1/building-events/${event.id}`, "PATCH", { version: renamed.version, endsAt: local(2, 28, 18).toISOString() }), 400);
    await json(await request(ids.manager, "/v1/building-events", "POST", { buildingId: a, title: "Ontem", startsAt: new Date(Date.now() - 86_400_000).toISOString(), endsAt: new Date(Date.now() - 82_800_000).toISOString() }), 400);

    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${a},'RESERVATIONS',false)`;
    try {
      const off = await json(await request(ids.first, `/v1/building-events?buildingId=${a}`), 403);
      assert.equal(off.details?.code ?? off.code, "FEATURE_DISABLED");
    } finally {
      await sqlClient`delete from building_feature_settings where building_id=${a} and feature_key='RESERVATIONS'`;
    }
    await json(await request(ids.outsider, `/v1/building-events?buildingId=${a}`), 403);
  });
});
