import { expect, test } from "../../support/fixtures";
import { API_URL, BUILDING_URL, RESIDENT_URL } from "../../support/environment";
import { isolatedTenant, signIn } from "../../support/helpers";

const PASSWORD = "Senha do convidado 2026";

test("síndico convida um morador, que cria a própria senha e entra no portal apenas como morador", async ({ page, request, browser }) => {
  const fixture = await isolatedTenant(request);
  const buildingId = fixture.building.id;
  const email = `convidado-${fixture.suffix}@predioon.local`, name = `Convidada ${fixture.suffix}`;
  await fixture.managerApi.create("/v1/tenancy/units", { buildingId, code: "704" });

  await signIn(page, BUILDING_URL, fixture.manager.email);
  await page.getByRole("link", { name: "Unidades e equipes", exact: true }).click();
  await page.getByRole("button", { name: "Moradores e vínculos", exact: true }).click();
  const form = page.getByRole("form", { name: "Convidar morador", exact: true });
  await form.getByLabel("Nome da pessoa", { exact: true }).fill(name);
  await form.getByLabel("E-mail da pessoa", { exact: true }).fill(email);
  await form.getByLabel("Unidade (opcional)", { exact: true }).selectOption({ label: "704" });
  await form.getByLabel("Vínculo com a unidade", { exact: true }).selectOption("OWNER");
  const created = page.waitForResponse(response => response.url() === `${API_URL}/v1/tenancy/invitations` && response.request().method() === "POST");
  await form.getByRole("button", { name: "Gerar convite", exact: true }).click();
  expect((await created).status()).toBe(201);
  const code = await page.getByLabel("Código do convite", { exact: true }).inputValue();
  expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const row = page.getByRole("listitem").filter({ hasText: email });
  await expect(row).toContainText("Aguardando");
  // The list is rebuilt from the API and never carries the secret.
  await page.getByRole("button", { name: "Já entreguei, ocultar", exact: true }).click();
  await expect(page.getByText(code)).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Moradores e vínculos", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: email })).toContainText("Aguardando");
  expect(await page.content()).not.toContain(code);

  // The invited person uses another browser, with no session at all.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(RESIDENT_URL);
  await guest.getByRole("link", { name: "Tenho um convite", exact: true }).click();
  await guest.getByLabel("Código do convite", { exact: true }).fill("codigo-invalido");
  await guest.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(guest.getByRole("alert")).toContainText("Convite inválido, expirado ou já utilizado");

  await guest.goto(`${RESIDENT_URL}/convite#${code}`);
  await expect(guest).toHaveURL(`${RESIDENT_URL}/convite`);
  await guest.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(guest.getByText(email, { exact: true })).toBeVisible();
  await expect(guest.getByText(fixture.building.name, { exact: true }).first()).toBeVisible();
  await guest.getByLabel("Crie uma senha", { exact: true }).fill(PASSWORD);
  await guest.getByLabel("Repita a senha", { exact: true }).fill(`${PASSWORD} diferente`);
  await guest.getByRole("button", { name: "Aceitar convite", exact: true }).click();
  await expect(guest.getByRole("alert")).toContainText("As senhas informadas são diferentes.");
  await guest.getByLabel("Repita a senha", { exact: true }).fill(PASSWORD);
  const accepted = guest.waitForResponse(response => response.url() === `${API_URL}/auth/invitations/accept`);
  await guest.getByRole("button", { name: "Aceitar convite", exact: true }).click();
  expect((await accepted).status()).toBe(204);
  await expect(guest.getByRole("status")).toContainText("Convite aceito");

  await guest.getByRole("link", { name: "Ir para a entrada", exact: true }).click();
  await guest.getByLabel("E-mail", { exact: true }).fill(email);
  await guest.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  const login = guest.waitForResponse(response => response.url() === `${API_URL}/auth/web/login` && response.request().method() === "POST");
  await guest.getByRole("button", { name: "Entrar", exact: true }).click();
  expect((await login).status()).toBe(200);
  await expect(guest.getByLabel("Senha", { exact: true })).toHaveCount(0);
  await expect(guest.getByText("Sua conta não tem acesso a um condomínio ativo. Solicite o vínculo à administração.")).toHaveCount(0);
  await expect(guest.getByText(fixture.building.name).first()).toBeVisible();

  // The same secret is spent; the management portal refuses the new resident.
  const spent = await request.post(`${API_URL}/auth/invitations/preview`, { data: { token: code } });
  expect(spent.status()).toBe(404);
  const authorization = await guest.request.post(`${API_URL}/auth/login`, { data: { email, password: PASSWORD } });
  const { accessToken } = await authorization.json() as { accessToken: string };
  const forbidden = await request.get(`${API_URL}/v1/tenancy/invitations?buildingId=${buildingId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  expect(forbidden.status()).toBe(403);
  await guestContext.close();

  await page.reload();
  await page.getByRole("button", { name: "Moradores e vínculos", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: email }).filter({ hasText: "Aceito" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: name }).filter({ hasText: "Proprietário" })).toBeVisible();
});

test("convite revogado deixa de ser aceito", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const email = `revogado-${fixture.suffix}@predioon.local`;
  const { token } = await fixture.managerApi.create<{ token: string }>("/v1/tenancy/invitations", { buildingId: fixture.building.id, name: "Revogado", email });
  await signIn(page, BUILDING_URL, fixture.manager.email);
  await page.getByRole("link", { name: "Unidades e equipes", exact: true }).click();
  await page.getByRole("button", { name: "Moradores e vínculos", exact: true }).click();
  const row = page.getByRole("listitem").filter({ hasText: email });
  const revoked = page.waitForResponse(response => response.url().includes("/v1/tenancy/invitations/") && response.request().method() === "DELETE");
  await row.getByRole("button", { name: "Revogar convite", exact: true }).click();
  expect((await revoked).status()).toBe(204);
  await expect(row).toContainText("Revogado");
  await expect(row.getByRole("button", { name: "Revogar convite", exact: true })).toHaveCount(0);
  await page.goto(`${RESIDENT_URL}/convite#${token}`);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Convite inválido, expirado ou já utilizado");
});
