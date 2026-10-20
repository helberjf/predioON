import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "../../support/fixtures";
import { API_URL, BUILDING_URL, DEMO_PASSWORD } from "../../support/environment";
import { withFixtureDatabase } from "../../support/database";
import { isolatedTenant } from "../../support/helpers";

const PASSWORD = "Senha recuperada 2026";

test("gestor pede o link de recuperação, cria uma nova senha e entra somente com ela", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const { id, email } = fixture.manager;
  const pending = () => withFixtureDatabase(async sql => (await sql`select count(*)::int as total from password_resets where user_id=${id} and used_at is null`)[0]!.total as number);

  await page.goto(BUILDING_URL);
  await page.getByRole("link", { name: "Esqueci minha senha", exact: true }).click();
  await expect(page).toHaveURL(`${BUILDING_URL}/redefinir-senha`);
  const form = page.getByRole("form", { name: "Recuperar senha", exact: true });
  // An address without an account gets the very same answer.
  for (const address of [`ninguem-${fixture.suffix}@predioon.local`, email]) {
    await page.goto(`${BUILDING_URL}/redefinir-senha`);
    await form.getByLabel("E-mail da conta", { exact: true }).fill(address);
    const asked = page.waitForResponse(response => response.url() === `${API_URL}/auth/password/forgot`);
    await form.getByRole("button", { name: "Enviar link", exact: true }).click();
    expect((await asked).status()).toBe(204);
    await expect(form.getByRole("status")).toContainText("Se este e-mail tiver uma conta, enviamos um link");
  }
  // The link was issued for the real account; its secret exists only in the e-mail.
  await expect.poll(pending).toBe(1);

  await page.goto(`${BUILDING_URL}/redefinir-senha#codigo-invalido`);
  await form.getByLabel("Nova senha", { exact: true }).fill(PASSWORD);
  await form.getByLabel("Repita a nova senha", { exact: true }).fill(PASSWORD);
  await form.getByRole("button", { name: "Salvar nova senha", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("Link inválido, expirado ou já utilizado");

  // No mailbox exists here: stand in for the e-mail with a link whose hash the fixture stores.
  const secret = randomBytes(32), token = secret.toString("base64url");
  await withFixtureDatabase(async sql => {
    await sql`update password_resets set used_at=now() where user_id=${id} and used_at is null`;
    await sql`insert into password_resets(user_id,token_hash,expires_at) values(${id},${createHash("sha256").update(secret).digest()},now()+interval '30 minutes')`;
  });
  await page.goto(`${BUILDING_URL}/redefinir-senha#${token}`);
  await expect(page).toHaveURL(`${BUILDING_URL}/redefinir-senha`);
  await form.getByLabel("Nova senha", { exact: true }).fill(PASSWORD);
  await form.getByLabel("Repita a nova senha", { exact: true }).fill(`${PASSWORD} diferente`);
  await form.getByRole("button", { name: "Salvar nova senha", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("As senhas informadas são diferentes.");
  await form.getByLabel("Repita a nova senha", { exact: true }).fill(PASSWORD);
  const changed = page.waitForResponse(response => response.url() === `${API_URL}/auth/password/reset`);
  await form.getByRole("button", { name: "Salvar nova senha", exact: true }).click();
  expect((await changed).status()).toBe(204);
  await expect(form.getByRole("status")).toContainText("Senha alterada");
  expect(await page.content()).not.toContain(token);

  await page.getByRole("link", { name: "Ir para a entrada", exact: true }).click();
  const attempt = async (password: string) => {
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    const login = page.waitForResponse(response => response.url() === `${API_URL}/auth/web/login` && response.request().method() === "POST");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    return (await login).status();
  };
  expect(await attempt(DEMO_PASSWORD)).toBe(401);
  expect(await attempt(PASSWORD)).toBe(200);
  await expect(page.getByLabel("Senha", { exact: true })).toHaveCount(0);
  await expect(page.getByText(fixture.building.name).first()).toBeVisible();

  // The link is spent.
  const reused = await request.post(`${API_URL}/auth/password/reset`, { data: { token, newPassword: `${PASSWORD} de novo` } });
  expect(reused.status()).toBe(400);
});
