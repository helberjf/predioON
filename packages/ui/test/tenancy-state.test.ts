import assert from "node:assert/strict";
import { it } from "node:test";
import { loadTenancyCollection, membershipStatus, membershipValidity } from "../src/tenancy-state.ts";

it("carrega páginas sem perder o condomínio e elimina registros sobrepostos", async () => {
  const paths: string[] = [];
  const rows = await loadTenancyCollection<{ id: string }>("/units?buildingId=bld_2", async path => {
    paths.push(path);
    return paths.length === 1 ? { items: [{ id: "a" }], nextCursor: "a/b" } : { items: [{ id: "a" }, { id: "b" }], nextCursor: null };
  });
  assert.deepEqual(rows, [{ id: "a" }, { id: "b" }]);
  assert.equal(paths[1], "/units?buildingId=bld_2&limit=100&after=a%2Fb");
});
it("interrompe paginação após mudança de condomínio, descartando resposta antiga", async () => {
  let active = true;
  let calls = 0;
  const rows = await loadTenancyCollection("/teams?buildingId=old", async () => {
    calls++;
    active = false;
    return { items: [{ id: "foreign" }], nextCursor: "next" };
  }, () => active);
  assert.deepEqual(rows, []);
  assert.equal(calls, 1);
});
it("falha sem apresentar listagem parcial se cursor repete ou a API nega outra página", async () => {
  await assert.rejects(loadTenancyCollection("/units", async () => ({ items: [], nextCursor: "same" })), /paginação não avançou/);
  let calls = 0;
  await assert.rejects(loadTenancyCollection("/units", async () => {
    if (++calls === 2) throw new Error("Sem acesso");
    return { items: [{ id: "a" }], nextCursor: "a" };
  }), /Sem acesso/);
});
it("valida e converte vigência sem transformar datas inválidas em concessões abertas", () => {
  assert.deepEqual(membershipValidity("", ""), { startsAt: null, endsAt: null });
  assert.throws(() => membershipValidity("invalida", ""), /datas/);
  assert.throws(() => membershipValidity("2030-01-02T12:00", "2030-01-01T12:00"), /posterior/);
  const validity = membershipValidity("2030-01-01T12:00", "2030-01-02T12:00");
  assert.ok(validity.startsAt?.endsWith("Z"));
  assert.equal(membershipStatus(validity, Date.parse(validity.startsAt!) - 1), "Agendado");
  assert.equal(membershipStatus(validity, Date.parse(validity.startsAt!)), "Vigente");
  assert.equal(membershipStatus(validity, Date.parse(validity.endsAt!)), "Expirado");
});
