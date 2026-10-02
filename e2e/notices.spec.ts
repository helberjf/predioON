import { expect, test } from "./fixtures";
import { API_URL, BUILDING_URL } from "./environment";
import { authenticatedApi, enterCredentials, isolatedTenant, signIn, signOut } from "./helpers";

test("aviso pode ser publicado, editado e removido; agendamento fica restrito à gestão", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const title = `Comunicado E2E ${fixture.suffix}`;
  const scheduledTitle = `Ainda privado E2E ${fixture.suffix}`;
  const body = "Comunicado publicado pelo formulário no navegador.";
  await signIn(page, BUILDING_URL, fixture.manager.email);
  await page.goto(`${BUILDING_URL}/avisos`);
  await expect(page.getByRole("heading", { name: "Avisos e agenda", exact: true })).toBeVisible();
  const publish = page.getByRole("button", { name: "Publicar para os moradores", exact: true });
  await expect(publish).toBeDisabled();
  await page.getByLabel("Título", { exact: true }).fill(title);
  await expect(publish).toBeDisabled();
  await page.getByLabel("Mensagem", { exact: true }).fill(body);
  const created = page.waitForResponse(response => response.url() === `${API_URL}/notices` && response.request().method() === "POST");
  await publish.click();
  expect((await created).status()).toBe(201);
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByLabel("Mensagem", { exact: true }).fill(`${body} Edição confirmada.`);
  const edited = page.waitForResponse(response => response.url().includes("/notices/") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  expect((await edited).status()).toBe(200);
  await expect(row).toContainText("Edição confirmada.");

  await page.getByLabel("Título", { exact: true }).fill(scheduledTitle);
  await page.getByLabel("Mensagem", { exact: true }).fill("Esta publicação futura só pode aparecer para a gestão.");
  // A day far in the future avoids timezone-boundary and clock-skew races.
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Publicar em", { exact: true }).fill(`${future}T12:00`);
  const scheduled = page.waitForResponse(response => response.url() === `${API_URL}/notices` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Salvar publicação", exact: true }).click();
  expect((await scheduled).status()).toBe(201);
  await expect(page.getByRole("listitem").filter({ hasText: scheduledTitle })).toContainText("Publicação agendada");
  await page.reload();
  await expect(row).toContainText("Edição confirmada.");
  await expect(page.getByRole("listitem").filter({ hasText: scheduledTitle })).toBeVisible();

  await signOut(page);
  await enterCredentials(page, fixture.resident.email);
  await expect(page.getByRole("heading", { name: "Avisos publicados", exact: true })).toBeVisible();
  await expect(row).toContainText("Edição confirmada.");
  await expect(page.getByText(scheduledTitle, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Título", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Editar|Remover|Publicar para os moradores|Salvar publicação)$/ })).toHaveCount(0);
  const residentApi = await authenticatedApi(request, fixture.resident.email);
  const privateList = await residentApi.get(`/notices?buildingId=${fixture.building.id}&includeUnpublished=true`);
  expect(privateList.status()).toBe(403);
  const forbiddenWrite = await residentApi.post("/notices", { buildingId: fixture.building.id, title: "Tentativa proibida", body: "Morador não pode publicar." });
  expect(forbiddenWrite.status()).toBe(403);

  await signOut(page);
  await enterCredentials(page, fixture.manager.email);
  await expect(row.getByRole("button", { name: "Remover", exact: true })).toBeVisible();
  const deleted = page.waitForResponse(response => response.url().includes("/notices/") && response.request().method() === "DELETE");
  await row.getByRole("button", { name: "Remover", exact: true }).click();
  expect((await deleted).status()).toBe(204);
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: scheduledTitle })).toBeVisible();
  await expect(row).toHaveCount(0);
});

for (const route of [
  { path: "/regras", heading: "Regras de alerta", management: /^(Criar regra|Ativar|Desativar)$/ },
  { path: "/areas", heading: "Áreas comuns", management: /^(Aprovar|Recusar)$/ },
  { path: "/alertas", heading: "Alertas", management: /^(Resolver|Reconhecer)$/ },
]) {
  test(`morador abrindo ${route.path} diretamente não recebe ações de gestão`, async ({ page }) => {
    await signIn(page, BUILDING_URL, "morador@predioon.local");
    const authorization = page.waitForResponse(response => new URL(response.url()).pathname === "/v1/authorization" && response.status() === 200);
    await page.goto(`${BUILDING_URL}${route.path}`);
    const grants = await (await authorization).json() as { capabilities: string[] };
    expect(grants.capabilities).not.toContain("buildings:manage");
    expect(grants.capabilities).not.toContain("devices:configure");
    expect(grants.capabilities).not.toContain("alerts:resolve");
    await expect(page.getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: route.management })).toHaveCount(0);
  });
}
