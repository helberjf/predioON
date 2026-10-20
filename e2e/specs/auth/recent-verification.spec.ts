import { expect, test, demoAccountEmail } from "../../support/fixtures";
import { withFixtureDatabase } from "../../support/database";
import { ADMIN_URL, API_URL, DEMO_PASSWORD } from "../../support/environment";
import { isolatedTenant, signIn } from "../../support/helpers";

/** What the session looks like ten minutes after signing in (055). */
const ageSessions = (email: string) => withFixtureDatabase(sql =>
  sql`update sessions set verified_at=clock_timestamp()-interval '11 minutes' where user_id=(select id from users where email=${demoAccountEmail(email)})`);

test("ação privilegiada numa sessão antiga pede a senha e conclui o mesmo pedido", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const staff = await fixture.person("Suporte");
  await signIn(page, ADMIN_URL, "admin@predioon.local");
  await page.getByRole("link", { name: "Acesso de suporte", exact: true }).click();
  await ageSessions("admin@predioon.local");

  const dialog = page.getByRole("dialog", { name: "Confirme que é você" });
  const staffPosts: number[] = [];
  page.on("response", response => {
    if (response.url() === `${API_URL}/v1/support-access/staff` && response.request().method() === "POST") staffPosts.push(response.status());
  });
  await page.getByLabel("Pessoa", { exact: true }).selectOption(staff.id);
  await page.getByLabel("Motivo da inclusão", { exact: true }).fill("Atendimento técnico");

  // Cancelling keeps the refusal and changes nothing.
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Senha atual", { exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Confirme sua senha para concluir esta ação.")).toBeVisible();
  expect(staffPosts).toEqual([403]);

  // A wrong password is refused inside the dialog; the right one repeats the request once.
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Senha atual", { exact: true }).fill("senha-errada");
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("A senha atual está incorreta");
  await dialog.getByLabel("Senha atual", { exact: true }).fill(DEMO_PASSWORD);
  const verified = page.waitForResponse(response => response.url() === `${API_URL}/auth/verify` && response.status() === 204);
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await verified;
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/ainda não acessa nenhum condomínio/)).toBeVisible();
  expect(staffPosts).toEqual([403, 403, 201]);
});
