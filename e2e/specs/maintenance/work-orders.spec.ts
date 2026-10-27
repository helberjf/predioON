import { expect, test } from "../../support/fixtures";
import { API_URL, BUILDING_URL } from "../../support/environment";
import { authenticatedApi, isolatedTenant, signIn } from "../../support/helpers";

test("gestão distribui uma ordem de serviço para a equipe, que executa, anota e conclui", async ({ page, request, browser }) => {
  const fixture = await isolatedTenant(request);
  const buildingId = fixture.building.id;
  const worker = await fixture.person("Tecnico");
  const teamName = `Manutenção ${fixture.suffix}`, title = `Trocar lâmpadas ${fixture.suffix}`, spare = `Pintar portão ${fixture.suffix}`;
  const team = await fixture.managerApi.create<{ id: string }>("/v1/tenancy/teams", { buildingId, name: teamName });
  await fixture.managerApi.create("/v1/tenancy/team-members", { buildingId, teamId: team.id, userId: worker.id });
  await fixture.managerApi.create("/v1/tenancy/role-bindings", { buildingId, teamId: team.id, roleKey: "MAINTENANCE", reason: "Equipe contratada" });
  const item = (target: typeof page, text: string) => target.getByRole("listitem").filter({ hasText: text });
  const posted = (target: typeof page, suffix: string) => target.waitForResponse(response => response.request().method() === "POST" && response.url().startsWith(`${API_URL}/v1/work-orders`) && response.url().endsWith(suffix));

  await signIn(page, BUILDING_URL, fixture.manager.email);
  await page.getByRole("link", { name: "Ordens de serviço", exact: true }).click();
  await expect(page.getByText("Nenhuma ordem de serviço em aberto.", { exact: true })).toBeVisible();
  const form = page.getByRole("form", { name: "Nova ordem de serviço", exact: true });
  for (const [name, assignee] of [[title, `Equipe · ${teamName}`], [spare, "Sem responsável"]] as const) {
    await form.getByLabel("O que precisa ser feito", { exact: true }).fill(name);
    await form.getByLabel("Prioridade", { exact: true }).selectOption("HIGH");
    if (assignee === "Sem responsável") await form.getByRole("radio", { name: "Definir depois" }).check();
    else {
      await form.getByRole("radio", { name: "Selecionar cadastrado" }).check();
      await form.getByLabel("Responsável", { exact: true }).selectOption({ label: assignee });
    }
    const created = posted(page, "/v1/work-orders");
    await form.getByRole("button", { name: "Abrir ordem de serviço", exact: true }).click();
    expect((await created).status()).toBe(201);
    await expect(item(page, name)).toContainText("Aberta");
  }
  await expect(item(page, title)).toContainText(`Equipe ${teamName}`);
  await expect(item(page, title)).toContainText("Prioridade alta");

  // The technician signs in elsewhere and sees only the team's order.
  const workerContext = await browser.newContext();
  const bench = await workerContext.newPage();
  await signIn(bench, BUILDING_URL, worker.email);
  await bench.getByRole("link", { name: "Ordens de serviço", exact: true }).click();
  await expect(item(bench, title)).toBeVisible();
  await expect(item(bench, spare)).toHaveCount(0);
  await expect(bench.getByRole("form", { name: "Nova ordem de serviço", exact: true })).toHaveCount(0);
  await expect(item(bench, title).getByRole("button", { name: "Cancelar", exact: true })).toHaveCount(0);
  await expect(item(bench, title).getByRole("button", { name: "Alterar responsável", exact: true })).toHaveCount(0);
  let changed = posted(bench, "/status");
  await item(bench, title).getByRole("button", { name: "Iniciar", exact: true }).click();
  expect((await changed).status()).toBe(200);
  await expect(item(bench, title)).toContainText("Em execução");
  await item(bench, title).getByRole("button", { name: "Histórico", exact: true }).click();
  const noteForm = bench.getByRole("form", { name: "Anotar na ordem de serviço", exact: true });
  await noteForm.getByLabel("Anotação", { exact: true }).fill("Seis lâmpadas trocadas no setor B");
  const noted = posted(bench, "/notes");
  await noteForm.getByRole("button", { name: "Registrar anotação", exact: true }).click();
  expect((await noted).status()).toBe(201);
  await expect(item(bench, title).getByText("Seis lâmpadas trocadas no setor B", { exact: true })).toBeVisible();
  changed = posted(bench, "/status");
  await item(bench, title).getByRole("button", { name: "Concluir", exact: true }).click();
  expect((await changed).status()).toBe(200);
  await expect(bench.getByText("Nenhuma ordem de serviço em aberto.", { exact: true })).toBeVisible();
  await workerContext.close();

  // The manager acts on a stale list: the server refuses instead of overwriting.
  await expect(item(page, title)).toContainText("Aberta");
  const stale = posted(page, "/status");
  await item(page, title).getByRole("button", { name: "Iniciar", exact: true }).click();
  expect((await stale).status()).toBe(409);
  await expect(page.getByRole("alert")).toContainText("A ordem de serviço foi alterada");
  await expect(item(page, title)).toHaveCount(0);
  await page.getByLabel("Mostrar encerradas", { exact: true }).check();
  await expect(item(page, title)).toContainText("Concluída");
  await item(page, title).getByRole("button", { name: "Histórico", exact: true }).click();
  await expect(item(page, title).getByText("Seis lâmpadas trocadas no setor B", { exact: true })).toBeVisible();
  await expect(item(page, title).getByRole("button", { name: "Iniciar", exact: true })).toHaveCount(0);

  await item(page, spare).getByRole("button", { name: "Cancelar", exact: true }).click();
  const cancelled = posted(page, "/status");
  await page.getByRole("button", { name: "Confirmar cancelamento", exact: true }).click();
  expect((await cancelled).status()).toBe(200);
  await expect(item(page, spare)).toContainText("Cancelada");

  const residentApi = await authenticatedApi(request, fixture.resident.email);
  expect((await residentApi.get(`/v1/work-orders?buildingId=${buildingId}`)).status()).toBe(403);
});
