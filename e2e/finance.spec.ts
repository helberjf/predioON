import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { API_URL, BUILDING_URL, RESIDENT_URL } from "./environment";
import { authenticatedApi, isolatedTenant, signIn } from "./helpers";
import { withFixtureDatabase } from "./database";

test("prestação mantém rascunho privado, publica totais e preserva a edição publicada durante correção", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const title = `Contas publicadas ${fixture.suffix}`;
  await signIn(page, BUILDING_URL, fixture.manager.email);
  await page.goto(`${BUILDING_URL}/transparencia`);
  await page.getByRole("button", { name: "Nova prestação", exact: true }).click();
  await page.getByLabel("Título da prestação", { exact: true }).fill(title);
  await page.getByLabel("Resumo da prestação", { exact: true }).fill("Serviços e gastos conferidos pela administração.");
  await page.getByLabel("Saldo inicial (R$)", { exact: true }).fill("1000,00");
  await page.getByRole("button", { name: "Adicionar lançamento", exact: true }).click();
  await page.getByLabel("Valor (R$)", { exact: true }).fill("250,00");
  await page.getByLabel("Categoria financeira", { exact: true }).fill("Manutenção");
  await page.getByLabel("Descrição do lançamento", { exact: true }).fill("Reparo preventivo do portão.");
  const created = page.waitForResponse(response => response.url() === `${API_URL}/finance` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
  const draftResponse = await created;
  expect(draftResponse.status()).toBe(201);
  const draft = await draftResponse.json() as { id: string; month: string; version: number; totals: { closingBalanceCents: number } };
  expect(draft.totals.closingBalanceCents).toBe(75_000);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByText("Rascunho privado", { exact: true })).toBeVisible();

  const residentPage = await page.context().newPage();
  await signIn(residentPage, RESIDENT_URL, fixture.resident.email);
  await residentPage.goto(`${RESIDENT_URL}/transparencia`);
  await expect(residentPage.getByText("Nenhuma prestação publicada nesta seleção.", { exact: true })).toBeVisible();
  await expect(residentPage.getByRole("heading", { name: title, exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Editar rascunho", exact: true }).click();
  await page.getByLabel("Resumo da prestação", { exact: true }).fill("Conferência final da administração antes da publicação.");
  const edited = page.waitForResponse(response => response.url() === `${API_URL}/finance/${draft.id}` && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
  expect((await edited).status()).toBe(200);
  await expect(page.getByText("Conferência final da administração antes da publicação.", { exact: true })).toBeVisible();
  const published = page.waitForResponse(response => response.url() === `${API_URL}/finance/${draft.id}/publish` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Publicar para os moradores", exact: true }).click();
  expect((await published).status()).toBe(200);
  await expect(page.getByText("Publicado", { exact: true })).toBeVisible();
  await residentPage.reload();
  await expect(residentPage.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(residentPage.getByText("Conferência final da administração antes da publicação.", { exact: true })).toBeVisible();
  await expect(residentPage.getByText(/R\$\s*750,00/, { exact: true })).toBeVisible();
  await expect(residentPage.getByRole("button", { name: /^(Nova prestação|Editar rascunho|Publicar para os moradores|Criar correção deste mês)$/ })).toHaveCount(0);
  const residentApi = await authenticatedApi(request, fixture.resident.email);
  expect((await residentApi.post("/finance", { buildingId: fixture.building.id, month: draft.month, title: "Sem permissão", summary: "Tentativa negada", openingBalanceCents: 0, entries: [] })).status()).toBe(403);

  await page.getByRole("button", { name: "Criar correção deste mês", exact: true }).click();
  const correctionTitle = `Correção ainda privada ${fixture.suffix}`;
  await page.getByLabel("Título da prestação", { exact: true }).fill(correctionTitle);
  await page.getByLabel("Resumo e motivo da correção", { exact: true }).fill("Nova conferência; a publicação anterior deve permanecer visível.");
  const correction = page.waitForResponse(response => response.url() === `${API_URL}/finance` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
  const corrected = await correction;
  expect(corrected.status()).toBe(201);
  expect((await corrected.json()).revision).toBe(2);
  await expect(page.getByRole("heading", { name: correctionTitle, exact: true })).toBeVisible();
  await residentPage.reload();
  await expect(residentPage.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(residentPage.getByRole("heading", { name: correctionTitle, exact: true })).toHaveCount(0);
  await residentPage.close();
});

test("prestação escopada separa consulta de gestão, revoga o editor e não concede criação ou outro relatório", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const delegate = await fixture.person("FinanceiroEscopado");
  const legacyManager = await fixture.person("GestaoSemFinancas");
  const month = new Date().toISOString().slice(0, 7);
  const draft = (title: string) => fixture.managerApi.create<{ id: string }>("/finance", {
    buildingId: fixture.building.id, month, title, summary: "Conteúdo privado de prestação específica.", openingBalanceCents: 0, entries: [],
  });
  const managedTitle = `Gestão exata ${fixture.suffix}`;
  const readableTitle = `Consulta exata ${fixture.suffix}`;
  const hiddenTitle = `Relatório fora do escopo ${fixture.suffix}`;
  const managed = await draft(managedTitle), readable = await draft(readableTitle);
  await draft(hiddenTitle);
  const manageRole = `E2E_FINANCE_MANAGE_${randomUUID()}`;
  const readRole = `E2E_FINANCE_READ_${randomUUID()}`;
  const buildingRole = `E2E_BUILDING_ONLY_${randomUUID()}`;
  const bindingIds = [randomUUID(), randomUUID(), randomUUID()];
  await withFixtureDatabase(async sql => { try {
    await sql.begin(async tx => {
      await tx`insert into roles(key,scope,label) values (${manageRole},'BUILDING','Finance exact manage E2E'),(${readRole},'BUILDING','Finance exact read E2E'),(${buildingRole},'BUILDING','Building without finance E2E')`;
      await tx`insert into role_permissions(role_key,permission_key) values (${manageRole},'buildings:read'),(${manageRole},'finance:read'),(${manageRole},'finance:manage'),(${readRole},'buildings:read'),(${readRole},'finance:read'),(${buildingRole},'buildings:read'),(${buildingRole},'buildings:manage')`;
      await tx`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values (${bindingIds[0]!},${delegate.id},${fixture.building.id},${manageRole},'finance',${managed.id}),(${bindingIds[1]!},${delegate.id},${fixture.building.id},${readRole},'finance',${readable.id})`;
      await tx`insert into role_bindings(id,user_id,building_id,role_key) values (${bindingIds[2]!},${legacyManager.id},${fixture.building.id},${buildingRole})`;
    });
    await signIn(page, BUILDING_URL, delegate.email);
    const scopeRequests: string[] = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname === "/v1/authorization" && url.searchParams.get("resourceType") === "finance") scopeRequests.push(url.searchParams.get("resourceId")!);
    });
    await page.goto(`${BUILDING_URL}/transparencia`);
    await expect(page.getByRole("heading", { name: readableTitle, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: managedTitle, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: hiddenTitle, exact: true })).toHaveCount(0);
    await expect(page.getByText("Esta prestação está disponível para consulta.", { exact: true })).toBeVisible();
    expect(new Set(scopeRequests)).toEqual(new Set([readable.id]));
    await expect(page.getByRole("button", { name: /^(Nova prestação|Editar rascunho|Publicar para os moradores)$/ })).toHaveCount(0);
    await expect(page.getByText("Escrever atualização para os moradores", { exact: true })).toHaveCount(0);
    const managedCard = page.locator("section").filter({ has: page.getByRole("heading", { name: managedTitle, exact: true }) });
    const readableCard = page.locator("section").filter({ has: page.getByRole("heading", { name: readableTitle, exact: true }) });
    await managedCard.getByRole("button", { name: "Selecionar prestação", exact: true }).click();
    await expect(managedCard.getByRole("button", { name: "Editar rascunho", exact: true })).toBeVisible();
    await readableCard.getByRole("button", { name: "Selecionar prestação", exact: true }).click();
    await expect(readableCard).toContainText("Esta prestação está disponível para consulta.");
    await expect(page.getByRole("button", { name: /^(Editar rascunho|Publicar para os moradores)$/ })).toHaveCount(0);
    await managedCard.getByRole("button", { name: "Selecionar prestação", exact: true }).click();
    await managedCard.getByRole("button", { name: "Editar rascunho", exact: true }).click();
    await page.getByLabel("Resumo da prestação", { exact: true }).fill("Rascunho que deve sumir após revogação.");
    await sql`delete from role_permissions where role_key=${manageRole} and permission_key='finance:manage'`;
    await page.getByRole("button", { name: "Atualizar contas", exact: true }).click();
    await expect(page.getByLabel("Resumo da prestação", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Salvar rascunho|Editar rascunho|Publicar para os moradores)$/ })).toHaveCount(0);
    await expect(managedCard).toContainText("Esta prestação está disponível para consulta.");
    await sql`insert into role_permissions(role_key,permission_key) values (${manageRole},'finance:manage')`;
    await page.getByRole("button", { name: "Atualizar contas", exact: true }).click();
    await managedCard.getByRole("button", { name: "Editar rascunho", exact: true }).click();
    await expect(page.getByLabel("Resumo da prestação", { exact: true })).toHaveValue("Conteúdo privado de prestação específica.");
    await sql`delete from role_permissions where role_key=${manageRole} and permission_key='finance:read'`;
    await page.getByRole("button", { name: "Atualizar contas", exact: true }).click();
    await expect(page.getByLabel("Resumo da prestação", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: managedTitle, exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: readableTitle, exact: true })).toBeVisible();
    await sql`insert into role_permissions(role_key,permission_key) values (${manageRole},'finance:read')`;
    await page.getByRole("button", { name: "Atualizar contas", exact: true }).click();
    await managedCard.getByRole("button", { name: "Editar rascunho", exact: true }).click();
    await expect(page.getByLabel("Resumo da prestação", { exact: true })).toHaveValue("Conteúdo privado de prestação específica.");
    await page.getByLabel("Resumo da prestação", { exact: true }).fill("Edição permitida somente neste relatório.");
    const editResponse = page.waitForResponse(response => response.url() === `${API_URL}/finance/${managed.id}` && response.request().method() === "PUT");
    await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
    expect((await editResponse).status()).toBe(200);
    await expect(managedCard).toContainText("Edição permitida somente neste relatório.");
    const publishResponse = page.waitForResponse(response => response.url() === `${API_URL}/finance/${managed.id}/publish` && response.request().method() === "POST");
    await managedCard.getByRole("button", { name: "Publicar para os moradores", exact: true }).click();
    expect((await publishResponse).status()).toBe(200);
    await expect(managedCard.getByText("Publicado", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Nova prestação|Criar correção deste mês)$/ })).toHaveCount(0);
    const scopedApi = await authenticatedApi(request, delegate.email);
    expect((await scopedApi.post("/finance", { buildingId: fixture.building.id, month, title: "Sem concessão ampla", summary: "Tentativa negada", openingBalanceCents: 0, entries: [] })).status()).toBe(403);

    const otherContext = await page.context().browser()!.newContext();
    try {
      const otherPage = await otherContext.newPage();
      await signIn(otherPage, BUILDING_URL, legacyManager.email);
      await otherPage.goto(`${BUILDING_URL}/transparencia`);
      await expect(otherPage.getByText("Seu perfil não permite consultar as contas deste condomínio.", { exact: true })).toBeVisible();
      await expect(otherPage.getByRole("button", { name: /^(Nova prestação|Editar rascunho|Publicar para os moradores)$/ })).toHaveCount(0);
      await expect(otherPage.getByRole("heading", { name: managedTitle, exact: true })).toHaveCount(0);
      await expect(otherPage.getByText("Escrever atualização para os moradores", { exact: true })).toHaveCount(0);
    } finally { await otherContext.close(); }
  } finally {
    await sql.begin(async tx => {
      await tx`delete from role_bindings where id in ${tx(bindingIds)}`;
      await tx`delete from roles where key in (${manageRole},${readRole},${buildingRole})`;
    });
  } });
});
