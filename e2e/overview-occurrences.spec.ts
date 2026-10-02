import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { BUILDING_URL } from "./environment";
import { authenticatedApi, isolatedTenant, signIn, signOut } from "./helpers";
import { withFixtureDatabase } from "./database";

type Overview = {
  counts: { open_occurrences: number | null };
  coverage: { occurrences: "none" | "partial" | "whole" };
  occurrenceVisibility: "none" | "own" | "scoped" | "all";
};

async function openOverview(page: Page, buildingId: string) {
  const response = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/overview/building" && url.searchParams.get("buildingId") === buildingId;
  });
  await page.goto(BUILDING_URL);
  const loaded = await response;
  expect(loaded.status()).toBe(200);
  expect(loaded.headers()["cache-control"]).toBe("no-store");
  return loaded.json() as Promise<Overview>;
}

test("dashboard conta chamados próprios e da gestão sem conteúdo privado, distingue zero de pausa", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const neighbor = await fixture.person("VizinhoContador");
  await fixture.membership(neighbor, fixture.building, "RESIDENT");
  const residentApi = await authenticatedApi(request, fixture.resident.email);
  const neighborApi = await authenticatedApi(request, neighbor.email);
  const ownTitle = `Privado próprio ${fixture.suffix}`;
  const neighborTitle = `Privado vizinho ${fixture.suffix}`;
  const description = `Descrição confidencial ${fixture.suffix}`;
  const own = await residentApi.create<{ id: string }>("/occurrences", {
    buildingId: fixture.building.id, title: ownTitle, description, category: "GENERAL",
  });
  const other = await neighborApi.create<{ id: string }>("/occurrences", {
    buildingId: fixture.building.id, title: neighborTitle, description, category: "GENERAL",
  });
  const closed = await residentApi.create<{ id: string }>("/occurrences", {
    buildingId: fixture.building.id, title: `Encerrado ${fixture.suffix}`, description, category: "GENERAL",
  });
  expect((await fixture.managerApi.patch(`/occurrences/${closed.id}`, { status: "DONE" })).status()).toBe(200);
  const privateValues = [ownTitle, neighborTitle, description, own.id, other.id, closed.id, neighbor.id];

  await signIn(page, BUILDING_URL, fixture.resident.email);
  const ownOverview = await openOverview(page, fixture.building.id);
  expect(ownOverview.counts.open_occurrences).toBe(1);
  expect(ownOverview.coverage.occurrences).toBe("partial");
  expect(ownOverview.occurrenceVisibility).toBe("own");
  const ownLink = page.getByRole("link", { name: "Seus chamados abertos 1", exact: true });
  await expect(ownLink).toBeVisible();
  await expect(ownLink).toHaveAttribute("href", "/chamados");
  for (const value of privateValues) {
    expect(JSON.stringify(ownOverview)).not.toContain(value);
    await expect(page.locator("body")).not.toContainText(value);
  }
  await ownLink.click();
  await expect(page.getByRole("heading", { name: ownTitle, exact: true })).toBeVisible();
  await expect(page.getByText(neighborTitle, { exact: true })).toHaveCount(0);
  await signOut(page);

  await signIn(page, BUILDING_URL, fixture.manager.email);
  const management = await openOverview(page, fixture.building.id);
  expect(management.counts.open_occurrences).toBe(2);
  expect(management.coverage.occurrences).toBe("whole");
  expect(management.occurrenceVisibility).toBe("all");
  await expect(page.getByRole("link", { name: "Chamados abertos 2", exact: true })).toBeVisible();
  for (const value of privateValues) {
    expect(JSON.stringify(management)).not.toContain(value);
    await expect(page.locator("body")).not.toContainText(value);
  }

  const featurePath = `/features/buildings/${fixture.building.id}/TICKETS`;
  expect((await fixture.api.put(featurePath, { enabled: false, version: 0, reason: "Pausa isolada do cenário de contador E2E" })).status()).toBe(200);
  const paused = await openOverview(page, fixture.building.id);
  expect(paused.counts.open_occurrences).toBeNull();
  expect(paused.coverage.occurrences).toBe("none");
  expect(paused.occurrenceVisibility).toBe("none");
  await expect(page.getByRole("link", { name: "Acompanhar ocorrências", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Chamados abertos/ })).toHaveCount(0);

  expect((await fixture.api.put(featurePath, { enabled: true, version: 1, reason: "Retomar o condomínio isolado E2E" })).status()).toBe(200);
  const resumed = await openOverview(page, fixture.building.id);
  expect(resumed.counts.open_occurrences).toBe(2);
  await expect(page.getByRole("link", { name: "Chamados abertos 2", exact: true })).toBeVisible();
  for (const occurrence of [own, other]) {
    expect((await fixture.managerApi.patch(`/occurrences/${occurrence.id}`, { status: "DONE" })).status()).toBe(200);
  }
  const empty = await openOverview(page, fixture.building.id);
  expect(empty.counts.open_occurrences).toBe(0);
  expect(empty.occurrenceVisibility).toBe("all");
  await expect(page.getByRole("link", { name: "Chamados abertos 0", exact: true })).toBeVisible();
});

test("dashboard limita o contador ao recurso autorizado e não inventa zero para leitura básica", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const delegate = await fixture.person("EscopoExato");
  const reader = await fixture.person("LeituraBasica");
  const residentApi = await authenticatedApi(request, fixture.resident.email);
  const privateTitle = `Relato privado por recurso ${fixture.suffix}`;
  const visible = await residentApi.create<{ id: string }>("/occurrences", {
    buildingId: fixture.building.id, title: privateTitle, description: "Detalhe que não pertence ao resumo.", category: "GENERAL",
  });
  const hidden = await residentApi.create<{ id: string }>("/occurrences", {
    buildingId: fixture.building.id, title: `Outro relato ${fixture.suffix}`, description: "Outro relato privado.", category: "GENERAL",
  });
  const scopedRole = `E2E_SCOPE_${randomUUID()}`;
  const basicRole = `E2E_BASIC_${randomUUID()}`;
  const scopedBinding = randomUUID();
  const basicBinding = randomUUID();
  await withFixtureDatabase(async sql => { try {
    await sql.begin(async tx => {
      await tx`insert into roles(key,scope,label) values (${scopedRole},'BUILDING','E2E scoped count'),(${basicRole},'BUILDING','E2E basic count')`;
      // Discovery reads only the parent of this same exact occurrence binding;
      // no building-wide capability is granted to the delegated person.
      await tx`insert into role_permissions(role_key,permission_key) values (${scopedRole},'occurrences:manage'),(${scopedRole},'buildings:read'),(${basicRole},'buildings:read')`;
      await tx`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values (${scopedBinding},${delegate.id},${fixture.building.id},${scopedRole},'occurrence',${visible.id})`;
      await tx`insert into role_bindings(id,user_id,building_id,role_key) values (${basicBinding},${reader.id},${fixture.building.id},${basicRole})`;
    });
    await signIn(page, BUILDING_URL, delegate.email);
    const scoped = await openOverview(page, fixture.building.id);
    expect(scoped.counts.open_occurrences).toBe(1);
    expect(scoped.coverage.occurrences).toBe("partial");
    expect(scoped.occurrenceVisibility).toBe("scoped");
    const scopedLink = page.getByRole("link", { name: "Chamados abertos no seu escopo 1", exact: true });
    await expect(scopedLink).toBeVisible();
    for (const value of [privateTitle, visible.id, hidden.id, fixture.resident.id]) {
      expect(JSON.stringify(scoped)).not.toContain(value);
      await expect(page.locator("body")).not.toContainText(value);
    }
    await signOut(page);
    await signIn(page, BUILDING_URL, reader.email);
    const unavailable = await openOverview(page, fixture.building.id);
    expect(unavailable.counts.open_occurrences).toBeNull();
    expect(unavailable.coverage.occurrences).toBe("none");
    expect(unavailable.occurrenceVisibility).toBe("none");
    const unavailableLink = page.getByRole("link", { name: "Acompanhar ocorrências", exact: true });
    await expect(unavailableLink).toBeVisible();
    await expect(unavailableLink).toHaveText("Acompanhar ocorrências");
    await expect(page.getByRole("link", { name: /^(Seus chamados abertos|Chamados abertos)/ })).toHaveCount(0);
    for (const value of [privateTitle, visible.id, hidden.id, fixture.resident.id]) {
      expect(JSON.stringify(unavailable)).not.toContain(value);
      await expect(page.locator("body")).not.toContainText(value);
    }
  } finally {
    await sql.begin(async tx => {
      await tx`delete from role_bindings where id in (${scopedBinding},${basicBinding})`;
      await tx`delete from roles where key in (${scopedRole},${basicRole})`;
    });
  } });
});
