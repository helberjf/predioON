import { expect, test } from "../../support/fixtures";
import { API_URL, BUILDING_URL } from "../../support/environment";
import { authenticatedApi, isolatedTenant, signIn } from "../../support/helpers";

test("gestão cadastra um ativo, abre uma ordem de serviço para ele e acompanha o histórico de manutenção", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const buildingId = fixture.building.id;
  const name = `Bomba de recalque ${fixture.suffix}`, renamed = `Bomba principal ${fixture.suffix}`, order = `Trocar selo mecânico ${fixture.suffix}`;
  const item = (text: string) => page.getByRole("listitem").filter({ hasText: text });
  const sent = (method: string, path: string) => page.waitForResponse(response => response.request().method() === method && response.url().startsWith(`${API_URL}${path}`));

  await signIn(page, BUILDING_URL, fixture.manager.email);
  await page.getByRole("link", { name: "Ativos", exact: true }).click();
  await expect(page.getByText("Nenhum ativo cadastrado.", { exact: true })).toBeVisible();
  const form = page.getByRole("form", { name: "Novo ativo", exact: true });
  await form.getByLabel("Nome do ativo", { exact: true }).fill(name);
  await form.getByLabel("Categoria", { exact: true }).selectOption("PUMP");
  await form.getByLabel("Localização", { exact: true }).fill("Casa de bombas");
  await form.getByLabel("Instalado em", { exact: true }).fill("2024-03-15");
  let response = sent("POST", "/v1/assets");
  await form.getByRole("button", { name: "Cadastrar ativo", exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(item(name)).toContainText("Bomba");
  await expect(item(name)).toContainText("Casa de bombas");
  await expect(form.getByLabel("Nome do ativo", { exact: true })).toHaveValue("");

  await item(name).getByRole("button", { name: "Editar", exact: true }).click();
  const edit = page.getByRole("form", { name: "Editar ativo", exact: true });
  await expect(edit.getByLabel("Instalado em", { exact: true })).toHaveValue("2024-03-15");
  await edit.getByLabel("Nome do ativo", { exact: true }).fill(renamed);
  response = sent("PATCH", "/v1/assets/");
  await edit.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(item(renamed)).toBeVisible();
  await expect(item(name)).toHaveCount(0);

  // A work order for this asset becomes its maintenance history.
  await page.getByRole("link", { name: "Ordens de serviço", exact: true }).click();
  const orderForm = page.getByRole("form", { name: "Nova ordem de serviço", exact: true });
  await orderForm.getByLabel("O que precisa ser feito", { exact: true }).fill(order);
  await orderForm.getByLabel("Ativo (opcional)", { exact: true }).selectOption({ label: renamed });
  response = sent("POST", "/v1/work-orders");
  await orderForm.getByRole("button", { name: "Abrir ordem de serviço", exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(item(order)).toContainText(renamed);

  await page.getByRole("link", { name: "Ativos", exact: true }).click();
  await item(renamed).getByRole("button", { name: "Detalhes", exact: true }).click();
  await expect(item(renamed).getByText(order, { exact: true })).toBeVisible();
  await expect(item(renamed)).toContainText("Nenhum equipamento vinculado.");

  response = sent("PATCH", "/v1/assets/");
  await item(renamed).getByRole("button", { name: "Desativar", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(item(renamed)).toHaveCount(0);
  await page.getByLabel("Mostrar inativos", { exact: true }).check();
  await expect(item(renamed)).toContainText("Inativo");
  await expect(item(renamed).getByRole("button", { name: "Editar", exact: true })).toHaveCount(0);
  // An inactive asset is no longer offered to new work orders.
  await page.getByRole("link", { name: "Ordens de serviço", exact: true }).click();
  await expect(page.getByRole("form", { name: "Nova ordem de serviço", exact: true })).toBeVisible();
  await expect(page.getByRole("form", { name: "Nova ordem de serviço", exact: true }).getByLabel("Ativo (opcional)", { exact: true })).toHaveCount(0);
  await expect(item(order)).toBeVisible();

  const residentApi = await authenticatedApi(request, fixture.resident.email);
  expect((await residentApi.get(`/v1/assets?buildingId=${buildingId}`)).status()).toBe(403);
});
