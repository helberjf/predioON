import { expect, test } from "../../support/fixtures";
import { API_URL, BUILDING_URL } from "../../support/environment";
import { withFixtureDatabase } from "../../support/database";
import { authenticatedApi, isolatedTenant, signIn } from "../../support/helpers";

test("gestão cria, publica e ativa uma automação; um alerta abre a ordem de serviço uma única vez", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const buildingId = fixture.building.id;
  const name = `Vazamento ${fixture.suffix}`, orderTitle = `Conter vazamento ${fixture.suffix}`;
  // The rule's own row: its details hold nested lists whose text also mentions the name.
  const item = (text: string) => page.getByRole("listitem").filter({ has: page.getByText(text, { exact: true }) });
  const sent = (path: string) => page.waitForResponse(response => response.request().method() === "POST" && response.url().startsWith(`${API_URL}/v1/automations`) && response.url().endsWith(path));
  /** Alerts are stored by ingestion, outside any user session. */
  const alert = (severity: string) => withFixtureDatabase(sql => sql`insert into alerts(building_id,severity,type,message)
    values(${buildingId},${severity},'WATER_LEAK','Vazamento detectado na casa de bombas')`);

  await signIn(page, BUILDING_URL, fixture.manager.email);
  await page.getByRole("link", { name: "Automações", exact: true }).click();
  await expect(page.getByText("Nenhuma automação cadastrada.", { exact: true })).toBeVisible();
  const form = page.getByRole("form", { name: "Nova automação", exact: true });
  await form.getByLabel("Nome da automação", { exact: true }).fill(name);
  await form.getByLabel("Tipos de alerta", { exact: true }).fill("WATER_LEAK");
  await form.getByLabel("Gravidade mínima", { exact: true }).selectOption("HIGH");
  await form.getByLabel("Título da ordem de serviço", { exact: true }).fill(orderTitle);
  await form.getByLabel("Prioridade da ordem", { exact: true }).selectOption("URGENT");
  let response = sent("/v1/automations");
  await form.getByRole("button", { name: "Criar automação", exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(item(name)).toContainText("Rascunho");
  await expect(item(name).getByRole("button", { name: "Ativar", exact: true })).toHaveCount(0);

  // A draft ignores alerts, and simulation shows what it would have done.
  await alert("CRITICAL");
  await item(name).getByRole("button", { name: "Detalhes", exact: true }).click();
  await item(name).getByRole("button", { name: "Simular", exact: true }).click();
  await expect(item(name).getByRole("status")).toContainText("1 alerta(s) dos últimos 30 dias atenderiam a regra. Nada foi criado.");
  await expect(item(name)).toContainText("Esta automação ainda não abriu nenhuma ordem.");

  response = sent("/publish");
  await item(name).getByRole("button", { name: "Publicar", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(item(name)).toContainText("Desativada");
  response = sent("/state");
  await item(name).getByRole("button", { name: "Ativar", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(item(name)).toContainText("Ativa");

  await alert("MEDIUM");
  await alert("HIGH");
  await alert("CRITICAL");
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(item(name)).toContainText("1 ordem(ns) aberta(s)");
  // The details stayed open and were reloaded with the rule.
  await expect(item(name).getByText("Ordem aberta", { exact: true })).toHaveCount(1);
  await expect(item(name).getByText("Em pausa", { exact: true })).toHaveCount(1);

  await page.getByRole("link", { name: "Ordens de serviço", exact: true }).click();
  await expect(item(orderTitle)).toHaveCount(1);
  await expect(item(orderTitle)).toContainText("Prioridade urgente");
  await expect(item(orderTitle)).toContainText("Vazamento detectado na casa de bombas");

  const residentApi = await authenticatedApi(request, fixture.resident.email);
  expect((await residentApi.get(`/v1/automations?buildingId=${buildingId}`)).status()).toBe(403);
});

test("manutenção preventiva: a automação programada mostra as próximas datas e abre a ordem quando a data chega", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const name = `Limpeza da caixa ${fixture.suffix}`, orderTitle = `Limpar caixa d'água ${fixture.suffix}`;
  const item = (text: string) => page.getByRole("listitem").filter({ has: page.getByText(text, { exact: true }) });
  const sent = (path: string) => page.waitForResponse(response => response.request().method() === "POST" && response.url().startsWith(`${API_URL}/v1/automations`) && response.url().endsWith(path));
  const tomorrow = new Date(Date.now() + 86_400_000);
  const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

  await signIn(page, BUILDING_URL, fixture.manager.email);
  await page.getByRole("link", { name: "Automações", exact: true }).click();
  const form = page.getByRole("form", { name: "Nova automação", exact: true });
  await form.getByLabel("Nome da automação", { exact: true }).fill(name);
  await form.getByLabel("Quando agir", { exact: true }).selectOption("SCHEDULE");
  await expect(form.getByLabel("Tipos de alerta", { exact: true })).toHaveCount(0);
  await form.getByLabel("Repetir a cada (dias)", { exact: true }).fill("180");
  await form.getByLabel("Primeira data", { exact: true }).fill(day);
  await form.getByLabel("Título da ordem de serviço", { exact: true }).fill(orderTitle);
  let response = sent("/v1/automations");
  await form.getByRole("button", { name: "Criar automação", exact: true }).click();
  expect((await response).status()).toBe(201);

  await item(name).getByRole("button", { name: "Detalhes", exact: true }).click();
  await expect(item(name)).toContainText("A cada 180 dia(s), a partir de");
  await item(name).getByRole("button", { name: "Simular", exact: true }).click();
  await expect(item(name).getByRole("status")).toContainText("Próximas datas da versão 1:");
  response = sent("/publish");
  await item(name).getByRole("button", { name: "Publicar", exact: true }).click();
  expect((await response).status()).toBe(200);
  response = sent("/state");
  await item(name).getByRole("button", { name: "Ativar", exact: true }).click();
  expect((await response).status()).toBe(200);

  // The database's scheduler runs every five minutes; here the executor is called for the day after the first date.
  const opened = await withFixtureDatabase(sql => sql`select app_automation_run_schedules(${new Date(`${day}T08:00`).toISOString()}::timestamptz + interval '1 day') as n`);
  expect(opened[0]!.n).toBe(1);
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(item(name)).toContainText("1 ordem(ns) aberta(s)");
  await expect(item(name)).toContainText("data programada");

  await page.getByRole("link", { name: "Ordens de serviço", exact: true }).click();
  await expect(item(orderTitle)).toContainText("Manutenção programada a cada 180 dia(s)");
});
