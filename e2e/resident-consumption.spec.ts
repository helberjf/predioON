import { expect, test } from "./fixtures";
import { API_URL, BUILDING_URL, RESIDENT_URL } from "./environment";
import { withFixtureDatabase } from "./database";
import { isolatedTenant, signIn } from "./helpers";

test("morador só vê o consumo depois que o síndico libera, e deixa de ver quando a liberação é retirada", async ({ page, request, browser }) => {
  const fixture = await isolatedTenant(request);
  const buildingId = fixture.building.id, device = `e2e-energy-${fixture.suffix}`, secret = `Medidor reservado ${fixture.suffix}`;
  await withFixtureDatabase(async sql => {
    await sql`insert into devices(id,building_id,name,type) values(${device},${buildingId},${secret},'ENERGY_METER')`;
    const [profile] = await sql`insert into monitoring_profiles(building_id,device_id,kind,tariff,daily_limit) values(${buildingId},${device},'ENERGY',7.77,555) returning id`;
    await sql`insert into daily_usage(profile_id,building_id,day,quantity,estimated_cost,covered_seconds,first_at,last_at)
      select ${profile!.id},${buildingId},to_char(now() at time zone b.timezone,'YYYY-MM-DD'),150,4321,60,now(),now() from buildings b where b.id=${buildingId}`;
  });

  const residentContext = await browser.newContext();
  const resident = await residentContext.newPage();
  const navigation = resident.getByRole("navigation", { name: "Navegação do morador" });
  const openMore = async () => {
    const more = navigation.getByRole("button", { name: "Mais", exact: true });
    if (await more.getAttribute("aria-expanded") !== "true") await more.click();
    await expect(navigation.getByRole("link", { name: "Perfil", exact: true })).toBeVisible();
  };
  await signIn(resident, RESIDENT_URL, fixture.resident.email);
  await openMore();
  await expect(navigation.getByRole("link", { name: "Consumo", exact: true })).toHaveCount(0);
  await resident.goto(`${RESIDENT_URL}/consumo`);
  await expect(resident.getByRole("status").filter({ hasText: "O consumo não está disponível para moradores neste condomínio." })).toBeVisible();

  await signIn(page, BUILDING_URL, fixture.manager.email);
  await page.getByRole("link", { name: "Consumo e análise", exact: true }).click();
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Consumo para moradores", exact: true }) });
  await expect(card.getByText("Não liberado", { exact: true })).toBeVisible();
  const change = (released: boolean) => page.waitForResponse(response => response.url() === `${API_URL}/monitoring/resident-access`
    && response.request().method() === "PUT" && response.request().postDataJSON().released === released);
  let saved = change(true);
  await card.getByRole("button", { name: "Liberar para moradores", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(card.getByText("Liberado", { exact: true })).toBeVisible();

  await resident.goto(RESIDENT_URL);
  await openMore();
  await navigation.getByRole("link", { name: "Consumo", exact: true }).click();
  await expect(resident.getByRole("heading", { name: "Consumo do condomínio", exact: true })).toBeVisible();
  await expect(resident.getByText("Energia das áreas comuns", { exact: true })).toBeVisible();
  await expect(resident.getByText("150,0 kWh").first()).toBeVisible();
  // Quantities only: no cost, tariff, limit or equipment name reaches the resident.
  const shown = await resident.locator("body").innerText();
  for (const hidden of ["R$", "4321", "7,77", "555", secret, "Tarifa", "Limite"]) expect(shown).not.toContain(hidden);

  saved = change(false);
  await card.getByRole("button", { name: "Deixar de mostrar aos moradores", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(card.getByText("Não liberado", { exact: true })).toBeVisible();
  await resident.reload();
  await expect(resident.getByRole("status").filter({ hasText: "O consumo não está disponível para moradores neste condomínio." })).toBeVisible();
  await expect(resident.getByText("150,0 kWh")).toHaveCount(0);
  await residentContext.close();

  const audit = await withFixtureDatabase(sql => sql`select metadata from audit_logs where building_id=${buildingId} and action='RESIDENT_CONSUMPTION_CHANGED' order by created_at`);
  expect(audit.map(row => row.metadata)).toEqual([{ before: false, after: true }, { before: true, after: false }]);
});
