import { expect, test } from "../../support/fixtures";
import { BUILDING_URL } from "../../support/environment";
import { isolatedTenant, signIn } from "../../support/helpers";

test("equipes oferecem profissionais e recusam moradores, que continuam disponíveis nos vínculos de unidade", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const buildingId = fixture.building.id;
  const worker = await fixture.person("Tecnico");
  await fixture.managerApi.create("/v1/tenancy/role-bindings", { buildingId, userId: worker.id, roleKey: "MAINTENANCE", reason: "Equipe técnica do condomínio" });
  const team = await fixture.managerApi.create<{ id: string }>("/v1/tenancy/teams", { buildingId, name: `Manutenção ${fixture.suffix}` });

  await signIn(page, BUILDING_URL, fixture.manager.email);
  await page.getByRole("link", { name: "Unidades e equipes", exact: true }).click();
  await page.getByRole("button", { name: "Equipes", exact: true }).click();
  const person = page.getByLabel("Pessoa", { exact: true });
  await expect(person.locator("option", { hasText: worker.email })).toHaveCount(1);
  await expect(person.locator("option", { hasText: fixture.resident.email })).toHaveCount(0);
  await person.selectOption(worker.id);
  await page.getByLabel("Equipe", { exact: true }).selectOption(team.id);
  await page.getByRole("button", { name: "Adicionar integrante", exact: true }).click();
  await expect(page.getByText("Integrante incluído na equipe.", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: worker.name })).toBeVisible();
  expect((await fixture.managerApi.post("/v1/tenancy/team-members", { buildingId, teamId: team.id, userId: fixture.resident.id })).status()).toBe(400);

  await page.getByRole("button", { name: "Moradores e vínculos", exact: true }).click();
  await expect(page.getByLabel("Pessoa", { exact: true }).locator("option", { hasText: fixture.resident.email })).toHaveCount(1);
});
