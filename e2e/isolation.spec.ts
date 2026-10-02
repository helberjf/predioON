import { expect, test } from "@playwright/test";
import { API_URL, BUILDING_URL, RESIDENT_URL } from "./environment";
import { adminFixtures, authenticatedApi, createWithForm, enterCredentials, isolatedTenant, signIn, signOut } from "./helpers";

test("login valida campos, informa senha incorreta e permite recuperar a entrada", async ({ page }) => {
  await page.goto(BUILDING_URL);
  const email = page.getByLabel("E-mail", { exact: true });
  const password = page.getByLabel("Senha", { exact: true });
  const loginRequests: string[] = [];
  page.on("request", request => { if (request.url() === `${API_URL}/auth/login`) loginRequests.push(request.method()); });
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  expect(await email.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  await email.fill("email-invalido");
  await password.fill("senha-incorreta");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  expect(await email.evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true);
  expect(loginRequests).toEqual([]);

  await email.fill("sindico@predioon.local");
  const rejected = page.waitForResponse(response => response.url() === `${API_URL}/auth/login`);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  expect((await rejected).status()).toBe(401);
  await expect(page.getByRole("alert")).toHaveText("E-mail ou senha inválidos");
  await expect(page.getByRole("navigation", { name: "Menu principal" })).toHaveCount(0);
  await enterCredentials(page, "sindico@predioon.local");
  await expect(page.getByRole("heading", { name: "Olá, Síndico!", exact: true })).toBeVisible();
});

for (const [product, origin] of [["operação", BUILDING_URL], ["morador", RESIDENT_URL]] as const) {
  test(`conta sem condomínio pode sair no portal de ${product}`, async ({ page, request }) => {
    const fixtures = await adminFixtures(request);
    const person = await fixtures.person("SemVinculo");
    await signIn(page, origin, person.email);
    await expect(page.getByText("Sua conta não tem acesso a um condomínio ativo. Solicite o vínculo à administração.")).toBeVisible();
    await expect(page.getByLabel("Condomínio em uso", { exact: true })).toHaveCount(0);
    await signOut(page);
    await page.reload();
    await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
  });
}

test("trocar condomínio descarta rascunhos, isola cadastros e preserva a escolha ao recarregar", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const second = await fixture.createBuilding("B");
  await fixture.membership(fixture.manager, second, "BUILDING_ADMIN");
  const nameA = `Bloco exclusivo A ${fixture.suffix}`;
  const nameB = `Bloco exclusivo B ${fixture.suffix}`;
  await fixture.managerApi.create("/v1/tenancy/blocks", { buildingId: fixture.building.id, code: "A", name: nameA });
  await fixture.managerApi.create("/v1/tenancy/blocks", { buildingId: second.id, code: "B", name: nameB });

  await signIn(page, BUILDING_URL, fixture.manager.email);
  await page.getByRole("link", { name: "Unidades e equipes", exact: true }).click();
  const selector = page.getByLabel("Condomínio em uso", { exact: true });
  await selector.selectOption(fixture.building.id);
  await expect(page.getByRole("listitem").filter({ hasText: nameA })).toBeVisible();
  await page.getByLabel("Código do bloco", { exact: true }).fill("RASCUNHO-A");
  await page.getByLabel("Nome do bloco", { exact: true }).fill("Não deve acompanhar a troca");

  await selector.selectOption(second.id);
  await expect(page.getByRole("listitem").filter({ hasText: nameB })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: nameA })).toHaveCount(0);
  await expect(page.getByLabel("Código do bloco", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Nome do bloco", { exact: true })).toHaveValue("");
  const savedName = `Novo no condomínio B ${fixture.suffix}`;
  await page.getByLabel("Código do bloco", { exact: true }).fill("NOVO-B");
  await page.getByLabel("Nome do bloco", { exact: true }).fill(savedName);
  await createWithForm(page, "blocks", "Cadastrar bloco");
  await expect(page.getByRole("listitem").filter({ hasText: savedName })).toBeVisible();
  await page.reload();
  await expect(selector).toHaveValue(second.id);
  await expect(page.getByRole("listitem").filter({ hasText: savedName })).toBeVisible();

  await selector.selectOption(fixture.building.id);
  await expect(page.getByRole("listitem").filter({ hasText: nameA })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: savedName })).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: nameB })).toHaveCount(0);
  const storedA = await fixture.managerApi.get(`/v1/tenancy/blocks?buildingId=${fixture.building.id}`);
  const storedB = await fixture.managerApi.get(`/v1/tenancy/blocks?buildingId=${second.id}`);
  expect(storedA.status()).toBe(200);
  expect(storedB.status()).toBe(200);
  expect((await storedA.json()).items.map((item: { name: string }) => item.name)).toEqual([nameA]);
  expect((await storedB.json()).items.map((item: { name: string }) => item.name)).toEqual(expect.arrayContaining([nameB, savedName]));
});

test("administrador concedido por RBAC usa cadastro e diretório de pessoas sem vínculo legado", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const delegate = await fixture.person("Delegado");
  await fixture.managerApi.create("/v1/tenancy/role-bindings", {
    buildingId: fixture.building.id, userId: delegate.id, roleKey: "BUILDING_ADMIN", reason: "Delegação E2E com RBAC, sem vínculo legado",
  });
  await signIn(page, BUILDING_URL, delegate.email);
  await page.getByRole("link", { name: "Unidades e equipes", exact: true }).click();
  await page.getByLabel("Código do bloco", { exact: true }).fill("RBAC");
  const blockName = `Bloco RBAC ${fixture.suffix}`;
  await page.getByLabel("Nome do bloco", { exact: true }).fill(blockName);
  await createWithForm(page, "blocks", "Cadastrar bloco");
  await expect(page.getByRole("listitem").filter({ hasText: blockName })).toBeVisible();
  await page.getByRole("button", { name: "Equipes", exact: true }).click();
  await expect(page.getByLabel("Pessoa", { exact: true })).toBeEnabled();
  await page.getByLabel("Pessoa", { exact: true }).selectOption(delegate.id);
  await expect(page.getByLabel("Pessoa", { exact: true })).toHaveValue(delegate.id);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: blockName })).toBeVisible();
});

test("concessão exige justificativa e revogação tem confirmação cancelável", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  await signIn(page, BUILDING_URL, fixture.manager.email);
  await page.getByRole("link", { name: "Unidades e equipes", exact: true }).click();
  await page.getByRole("button", { name: "Permissões", exact: true }).click();
  await page.getByLabel("Pessoa", { exact: true }).selectOption(fixture.resident.id);
  await page.getByLabel("Papel no condomínio", { exact: true }).selectOption("MAINTENANCE");
  await page.getByRole("button", { name: "Conceder permissão", exact: true }).click();
  expect(await page.getByLabel("Justificativa", { exact: true }).evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  const reason = `Manutenção temporária E2E ${fixture.suffix}`;
  await page.getByLabel("Justificativa", { exact: true }).fill(reason);
  await createWithForm(page, "role-bindings", "Conceder permissão");
  const grant = page.getByRole("listitem").filter({ hasText: reason });
  await expect(grant).toBeVisible();
  const residentApi = await authenticatedApi(request, fixture.resident.email);
  const granted = await residentApi.get(`/v1/authorization?buildingId=${fixture.building.id}`);
  expect(granted.status()).toBe(200);
  expect((await granted.json()).capabilities).toContain("alerts:acknowledge");
  await grant.getByRole("button", { name: "Revogar", exact: true }).click();
  await page.getByRole("button", { name: "Manter vínculo", exact: true }).click();
  await expect(grant).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar revogação", exact: true })).toHaveCount(0);
  await grant.getByRole("button", { name: "Revogar", exact: true }).click();
  const removed = page.waitForResponse(response => response.url().includes("/v1/tenancy/role-bindings/") && response.request().method() === "DELETE");
  await page.getByRole("button", { name: "Confirmar revogação", exact: true }).click();
  expect((await removed).status()).toBe(204);
  await expect(grant).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Permissões", exact: true }).click();
  await expect(page.getByText("Nenhuma concessão cadastrada.", { exact: true })).toBeVisible();
  const authorization = await residentApi.get(`/v1/authorization?buildingId=${fixture.building.id}`);
  expect(authorization.status()).toBe(200);
  expect((await authorization.json()).capabilities).not.toContain("alerts:acknowledge");
});

test("logout revoga a sessão no servidor e histórico do navegador não restaura gestão", async ({ page, request }) => {
  const authenticated = page.waitForResponse(response => response.url() === `${API_URL}/auth/login` && response.status() === 200);
  await signIn(page, BUILDING_URL, "sindico@predioon.local");
  const { accessToken } = await (await authenticated).json() as { accessToken: string };
  await page.getByRole("link", { name: "Unidades e equipes", exact: true }).click();
  await expect(page.getByLabel("Código do bloco", { exact: true })).toBeVisible();
  await signOut(page);
  const revoked = await request.get(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  expect(revoked.status()).toBe(401);
  await page.goBack();
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Código do bloco", { exact: true })).toHaveCount(0);
  await page.goto(`${BUILDING_URL}/unidades-equipes`);
  await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cadastrar bloco", exact: true })).toHaveCount(0);
});
