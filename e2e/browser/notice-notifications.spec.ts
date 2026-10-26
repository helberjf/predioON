import { expect, test, type Page } from "@playwright/test";

const notices = [
  { id: "one", title: "Manutenção amanhã", body: "Confira o horário.", category: "COMMUNICATION", pinned: false, publishedAt: "2026-01-01T12:00:00Z", expiresAt: null, schedule: null },
  { id: "two", title: "Reunião de moradores", body: "Participe da reunião.", category: "EVENT", pinned: true, publishedAt: "2026-01-02T12:00:00Z", expiresAt: null, schedule: null },
];

async function mockApi(page: Page) {
  const state = { userId: "user-a", enabled: true, fail: false, items: [...notices] };
  await page.route("**/*", async route => {
    if (!["fetch", "xhr"].includes(route.request().resourceType())) return route.continue();
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api(?=\/)/, "");
    const user = { id: state.userId, name: "Ana Moradora", email: "ana@example.test", role: "RESIDENT", memberships: [{ buildingId: "building-a", role: "RESIDENT" }, { buildingId: "building-b", role: "RESIDENT" }] };
    let json: unknown = { items: [] };
    if (path === "/auth/web/refresh") json = { accessToken: "test-access", user };
    else if (path === "/auth/me") json = user;
    else if (path === "/buildings") json = { items: [{ id: "building-a", name: "Condomínio A" }, { id: "building-b", name: "Condomínio B" }] };
    else if (path.startsWith("/buildings/")) json = { name: "Condomínio A" };
    else if (path.startsWith("/features/")) json = { items: [{ key: "NOTICES", enabled: state.enabled, version: 1, globalVersion: 1 }] };
    else if (path === "/v1/authorization") json = { capabilities: ["notices:read"] };
    else if (path === "/notices") {
      if (state.fail) return route.fulfill({ status: 503, json: { error: "Indisponível" } });
      json = { items: state.items };
    }
    return route.fulfill({ json });
  });
  return state;
}

for (const portal of [
  { name: "morador", url: "http://127.0.0.1:5675", start: "/" },
  { name: "síndico", url: "http://127.0.0.1:5674", start: "/sessoes" },
]) {
  test(`${portal.name}: fechar preserva contador; ler remove e persiste; novo aviso volta a alertar`, async ({ page }) => {
    const state = await mockApi(page);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${portal.url}${portal.start}`);
    await expect(page.getByRole("alert").filter({ hasText: "Você tem 2 avisos novos" })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("new-notices.png"), fullPage: true });
    await page.getByRole("button", { name: "Fechar alerta de novos avisos" }).click();
    await expect(page.getByText("Você tem 2 avisos novos", { exact: true })).toHaveCount(0);
    if (portal.name === "síndico" && page.viewportSize()!.width < 1024) await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
    await expect(page.getByLabel("2 avisos novos", { exact: true }).filter({ visible: true }).first()).toBeVisible();
    // Dismissing did not mark anything as read; reopening still alerts.
    await page.reload();
    await expect(page.getByText("Você tem 2 avisos novos", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Ver avisos", exact: true }).click();
    await expect(page.getByText("Manutenção amanhã", { exact: true })).toBeVisible();
    await expect(page.getByLabel("2 avisos novos", { exact: true })).toHaveCount(0);
    await page.goto(`${portal.url}${portal.start}`);
    await expect(page.getByRole("button", { name: "Ver avisos", exact: true })).toHaveCount(0);
    state.items.push({ ...notices[0]!, id: "three", title: "Novo comunicado" });
    await page.reload();
    await expect(page.getByText("Você tem 1 aviso novo", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Ver avisos", exact: true }).click();
    await expect(page.getByText("Novo comunicado", { exact: true })).toBeVisible();
    // Another condominium and another account each retain an independent history.
    await page.goto(`${portal.url}${portal.start}`);
    await page.getByLabel("Condomínio em uso", { exact: true }).selectOption("building-b");
    await expect(page.getByText("Você tem 3 avisos novos", { exact: true })).toBeVisible();
    await page.getByLabel("Condomínio em uso", { exact: true }).selectOption("building-a");
    await expect(page.getByRole("button", { name: "Ver avisos", exact: true })).toHaveCount(0);
    state.userId = "user-b";
    await page.reload();
    await expect(page.getByText("Você tem 3 avisos novos", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`${portal.name}: sem aviso novo, erro ou módulo desligado não abre alerta`, async ({ page }) => {
    const state = await mockApi(page);
    state.items = [];
    await page.goto(`${portal.url}${portal.start}`);
    await expect(page.getByLabel("Condomínio em uso", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver avisos", exact: true })).toHaveCount(0);
    state.items = [...notices];
    state.fail = true;
    await page.reload();
    await expect(page.getByLabel("Condomínio em uso", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver avisos", exact: true })).toHaveCount(0);
    state.fail = false;
    state.enabled = false;
    await page.reload();
    await expect(page.getByLabel("Condomínio em uso", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver avisos", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Avisos/ })).toHaveCount(0);
  });
}

test("morador: filtro não marca como visto um aviso novo de outra categoria", async ({ page }) => {
  const state = await mockApi(page);
  await page.clock.install();
  await page.goto("http://127.0.0.1:5675/");
  await page.getByRole("button", { name: "Ver avisos", exact: true }).click();
  await page.getByRole("button", { name: "Comunicados", exact: true }).click();
  state.items.push({ ...notices[1]!, id: "new-event", title: "Evento recém-publicado" });
  await page.clock.fastForward(30_000);
  await page.getByRole("button", { name: "Mais", exact: true }).click();
  await expect(page.getByLabel("1 aviso novo", { exact: true })).toBeVisible();
  await expect(page.getByText("Evento recém-publicado", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Fechar mais opções", exact: true }).click();
  await page.getByRole("button", { name: "Eventos", exact: true }).click();
  await expect(page.getByText("Evento recém-publicado", { exact: true })).toBeVisible();
  await expect(page.getByLabel("1 aviso novo", { exact: true })).toHaveCount(0);
});

test("síndico: aviso publicado com a lista aberta é marcado depois da atualização", async ({ page }) => {
  const state = await mockApi(page);
  await page.clock.install();
  await page.goto("http://127.0.0.1:5674/avisos");
  await expect(page.getByText("Manutenção amanhã", { exact: true })).toBeVisible();
  state.items.push({ ...notices[0]!, id: "new-publication", title: "Publicação durante a visita" });
  await page.clock.fastForward(30_000);
  await expect(page.getByText("Publicação durante a visita", { exact: true })).toBeVisible();
  await page.goto("http://127.0.0.1:5674/sessoes");
  await expect(page.getByLabel("Condomínio em uso", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver avisos", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("1 aviso novo", { exact: true })).toHaveCount(0);
});
