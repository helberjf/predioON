import { expect, test } from "./fixtures";
import { API_URL, BUILDING_URL } from "./environment";
import { isolatedTenant, signIn } from "./helpers";

type Row = { id: string; code?: string; name?: string; blockId?: string | null; floor?: number | null };

test("síndico corrige bloco, unidade e equipe; edição intacta não envia requisição e conflito preserva o rascunho", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const buildingId = fixture.building.id;
  const blockName = `Torre A ${fixture.suffix}`, teamName = `Manutenção ${fixture.suffix}`;
  const block = await fixture.managerApi.create<Row>("/v1/tenancy/blocks", { buildingId, code: "A", name: blockName });
  const unit = await fixture.managerApi.create<Row>("/v1/tenancy/units", { buildingId, blockId: block.id, code: "101", floor: 1 });
  await fixture.managerApi.create<Row>("/v1/tenancy/units", { buildingId, blockId: block.id, code: "102", floor: 1 });
  const team = await fixture.managerApi.create<Row>("/v1/tenancy/teams", { buildingId, name: teamName });
  const patches: string[] = [];
  page.on("request", sent => { if (sent.method() === "PATCH" && sent.url().startsWith(`${API_URL}/v1/tenancy/`)) patches.push(sent.url()); });
  const save = async (status: number) => {
    const response = page.waitForResponse(received => received.request().method() === "PATCH" && received.url().startsWith(`${API_URL}/v1/tenancy/`));
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    expect((await response).status()).toBe(status);
  };
  const item = (text: string) => page.getByRole("listitem").filter({ hasText: text });

  await signIn(page, BUILDING_URL, fixture.manager.email);
  await page.getByRole("link", { name: "Unidades e equipes", exact: true }).click();
  await expect(item(blockName)).toBeVisible();

  // An untouched form closes without calling the API.
  await item(blockName).getByRole("button", { name: "Editar", exact: true }).click();
  const blockForm = page.getByRole("form", { name: "Editar bloco", exact: true });
  await expect(blockForm.getByLabel("Nome", { exact: true })).toHaveValue(blockName);
  await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(page.getByText("Nenhuma alteração para salvar.", { exact: true })).toBeVisible();
  await expect(blockForm).toHaveCount(0);
  expect(patches).toEqual([]);

  // Cancelling discards the draft.
  await item(blockName).getByRole("button", { name: "Editar", exact: true }).click();
  await blockForm.getByLabel("Nome", { exact: true }).fill("Rascunho descartado");
  await page.getByRole("button", { name: "Cancelar edição", exact: true }).click();
  await expect(blockForm).toHaveCount(0);
  await expect(item(blockName)).toBeVisible();
  expect(patches).toEqual([]);

  const renamedBlock = `Torre Alfa ${fixture.suffix}`;
  await item(blockName).getByRole("button", { name: "Editar", exact: true }).click();
  await blockForm.getByLabel("Código", { exact: true }).fill("ALFA");
  await blockForm.getByLabel("Nome", { exact: true }).fill(renamedBlock);
  await save(200);
  await expect(page.getByText("Cadastro atualizado.", { exact: true })).toBeVisible();
  await expect(item(renamedBlock)).toBeVisible();
  await expect(item(blockName)).toHaveCount(0);

  // A duplicate code is refused and the draft stays available for correction.
  await item("ALFA · 101").getByRole("button", { name: "Editar", exact: true }).click();
  const unitForm = page.getByRole("form", { name: "Editar unidade", exact: true });
  await unitForm.getByLabel("Código", { exact: true }).fill("102");
  await save(409);
  await expect(page.getByRole("alert")).toContainText("Este cadastro já existe no condomínio");
  await expect(unitForm.getByLabel("Código", { exact: true })).toHaveValue("102");
  await unitForm.getByLabel("Código", { exact: true }).fill("101-B");
  await unitForm.getByLabel("Bloco", { exact: true }).selectOption("");
  await unitForm.getByLabel("Andar (opcional)", { exact: true }).fill("");
  await save(200);
  await expect(unitForm).toHaveCount(0);
  await expect(item("101-B")).toBeVisible();
  await expect(item("101-B")).not.toContainText("ALFA");
  await expect(item("101-B")).not.toContainText("Andar");

  const renamedTeam = `Manutenção predial ${fixture.suffix}`;
  await page.getByRole("button", { name: "Equipes", exact: true }).click();
  await item(teamName).getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByRole("form", { name: "Editar equipe", exact: true }).getByLabel("Nome", { exact: true }).fill(renamedTeam);
  await save(200);
  await expect(item(renamedTeam)).toBeVisible();
  expect(patches).toHaveLength(4);

  await page.reload();
  await expect(item(renamedBlock)).toBeVisible();
  const stored = async (name: string) => {
    const response = await fixture.managerApi.get(`/v1/tenancy/${name}?buildingId=${buildingId}`);
    expect(response.status()).toBe(200);
    return (await response.json()).items as Row[];
  };
  expect((await stored("blocks")).find(row => row.id === block.id)).toMatchObject({ code: "ALFA", name: renamedBlock });
  expect((await stored("units")).find(row => row.id === unit.id)).toMatchObject({ code: "101-B", blockId: null, floor: null });
  expect((await stored("teams")).find(row => row.id === team.id)).toMatchObject({ name: renamedTeam });
});

test("síndico desativa e reativa unidade e equipe com confirmação; inativos só aparecem a pedido", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const buildingId = fixture.building.id;
  const teamName = `Jardinagem ${fixture.suffix}`;
  const unit = await fixture.managerApi.create<Row>("/v1/tenancy/units", { buildingId, code: "305" });
  await fixture.managerApi.create<Row>("/v1/tenancy/units", { buildingId, code: "306" });
  const team = await fixture.managerApi.create<Row>("/v1/tenancy/teams", { buildingId, name: teamName });
  const item = (text: string) => page.getByRole("listitem").filter({ hasText: text });
  const changeStatus = async (action: () => Promise<void>) => {
    const response = page.waitForResponse(received => received.request().method() === "PATCH" && received.url().endsWith("/status"));
    await action();
    expect((await response).status()).toBe(200);
  };
  const stored = async (name: string, id: string, query = "") => {
    const response = await fixture.managerApi.get(`/v1/tenancy/${name}?buildingId=${buildingId}${query}`);
    expect(response.status()).toBe(200);
    return ((await response.json()).items as Array<Row & { active: boolean }>).find(row => row.id === id);
  };

  await signIn(page, BUILDING_URL, fixture.manager.email);
  await page.getByRole("link", { name: "Unidades e equipes", exact: true }).click();
  await expect(item("305")).toBeVisible();

  // Declining the confirmation changes nothing.
  await item("305").getByRole("button", { name: "Desativar", exact: true }).click();
  await expect(page.getByText("Confirme a desativação de unidade 305.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Manter ativo", exact: true }).click();
  expect((await stored("units", unit.id))?.active).toBe(true);

  await item("305").getByRole("button", { name: "Desativar", exact: true }).click();
  await changeStatus(() => page.getByRole("button", { name: "Confirmar desativação", exact: true }).click());
  await expect(page.getByText("Cadastro desativado.", { exact: true })).toBeVisible();
  await expect(item("305")).toHaveCount(0);
  await expect(item("306")).toBeVisible();
  expect(await stored("units", unit.id)).toBeUndefined();
  expect((await stored("units", unit.id, "&includeInactive=true"))?.active).toBe(false);

  await page.getByLabel("Mostrar inativos", { exact: true }).check();
  await expect(item("305")).toContainText("Inativo");
  await expect(item("305").getByRole("button", { name: "Editar", exact: true })).toHaveCount(0);
  await expect(item("306")).not.toContainText("Inativo");
  await changeStatus(() => item("305").getByRole("button", { name: "Reativar", exact: true }).click());
  await expect(page.getByText("Cadastro reativado.", { exact: true })).toBeVisible();
  await expect(item("305")).not.toContainText("Inativo");
  expect((await stored("units", unit.id))?.active).toBe(true);

  await page.getByRole("button", { name: "Equipes", exact: true }).click();
  await item(teamName).getByRole("button", { name: "Desativar", exact: true }).click();
  await changeStatus(() => page.getByRole("button", { name: "Confirmar desativação", exact: true }).click());
  await expect(item(teamName)).toContainText("Inativo");
  await page.getByLabel("Mostrar inativos", { exact: true }).uncheck();
  await expect(page.getByText("Nenhuma equipe cadastrada.", { exact: true })).toBeVisible();
  expect((await stored("teams", team.id, "&includeInactive=true"))?.active).toBe(false);
});
