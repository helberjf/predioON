import { expect, test } from "@playwright/test";
import { ADMIN_URL, API_URL, BUILDING_URL, DEMO_PASSWORD, RESIDENT_URL } from "./environment";
import { adminFixtures, isolatedTenant, signIn } from "./helpers";
import { withFixtureDatabase } from "./database";

async function withSessionFixture(request: import("@playwright/test").APIRequestContext, run: (fixture: Awaited<ReturnType<typeof isolatedTenant>>) => Promise<void>) {
  const fixture = await isolatedTenant(request);
  try { await run(fixture); }
  finally {
    await withFixtureDatabase(async sql => sql.begin(async tx => {
      await tx`delete from audit_logs where building_id=${fixture.building.id}`;
      await tx`delete from buildings where id=${fixture.building.id}`;
      await tx`delete from users where id in ${tx([fixture.manager.id, fixture.resident.id])}`;
    }));
  }
}

async function nativeSession(request: import("@playwright/test").APIRequestContext, email: string, label: string) {
  const response = await request.post(`${API_URL}/auth/login`, {
    headers: { "User-Agent": label }, data: { email, password: DEMO_PASSWORD },
  });
  expect(response.status()).toBe(200);
  return await response.json() as { accessToken: string; refreshToken: string };
}

test("sessões: revogar outro dispositivo exige confirmação, preserva a atual e não lista o vizinho", async ({ page, request }) => {
  await withSessionFixture(request, async fixture => {
  const second = await nativeSession(request, fixture.manager.email, "Dispositivo secundário E2E");
  const neighbor = await nativeSession(request, fixture.resident.email, "Dispositivo privado vizinho E2E");
  await signIn(page, BUILDING_URL, fixture.manager.email);
  await page.getByRole("link", { name: "Minhas sessões", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Minhas sessões", exact: true })).toBeVisible();
  const secondary = page.getByRole("article").filter({ hasText: "Dispositivo secundário E2E" });
  await expect(secondary).toBeVisible();
  await expect(page.getByText("Dispositivo privado vizinho E2E", { exact: true })).toHaveCount(0);
  const deleted: string[] = [];
  page.on("request", req => { if (req.method() === "DELETE" && new URL(req.url()).pathname.startsWith("/auth/sessions/")) deleted.push(req.url()); });
  await secondary.getByRole("button", { name: "Encerrar sessão", exact: true }).click();
  await secondary.getByRole("button", { name: "Manter sessão", exact: true }).click();
  expect(deleted).toEqual([]);
  expect((await request.get(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${second.accessToken}` } })).status()).toBe(200);
  await secondary.getByRole("button", { name: "Encerrar sessão", exact: true }).click();
  const revoked = page.waitForResponse(res => res.request().method() === "DELETE" && new URL(res.url()).pathname.startsWith("/auth/sessions/"));
  await secondary.getByRole("button", { name: "Confirmar encerramento", exact: true }).click();
  expect((await revoked).status()).toBe(204);
  await expect(secondary).toHaveCount(0);
  await expect(page.getByText("Este navegador", { exact: true })).toBeVisible();
  expect(deleted.length).toBe(1);
  expect((await request.get(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${second.accessToken}` } })).status()).toBe(401);
  expect((await request.get(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${neighbor.accessToken}` } })).status()).toBe(200);
  await page.getByRole("checkbox", { name: "Mostrar sessões encerradas ou expiradas" }).check();
  await expect(secondary.getByText("Encerrada", { exact: true })).toBeVisible();
  await expect(secondary.getByRole("button", { name: "Encerrar sessão", exact: true })).toHaveCount(0);
  });
});

test("sessões: encerrar todas remove as abas atuais e invalida os outros dispositivos", async ({ page, context, request }) => {
  await withSessionFixture(request, async fixture => {
  const second = await nativeSession(request, fixture.manager.email, "Outra sessão para encerrar");
  await signIn(page, BUILDING_URL, fixture.manager.email);
  const peer = await context.newPage();
  await peer.goto(BUILDING_URL);
  await expect(peer.getByRole("navigation", { name: "Menu principal" })).toBeVisible();
  await page.getByRole("link", { name: "Minhas sessões", exact: true }).click();
  await page.getByRole("button", { name: "Encerrar todas as sessões", exact: true }).click();
  const result = page.waitForResponse(res => new URL(res.url()).pathname === "/auth/sessions/revoke-all");
  await page.getByRole("button", { name: "Confirmar e sair de todos os dispositivos", exact: true }).click();
  expect((await result).status()).toBe(204);
  for (const tab of [page, peer]) await expect(tab.getByLabel("E-mail", { exact: true })).toBeVisible();
  expect((await request.post(`${API_URL}/auth/refresh`, { data: { refreshToken: second.refreshToken } })).status()).toBe(401);
  await page.reload();
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  });
});

test("sessões: morador encerra a sessão atual pelo perfil sem restaurá-la no reload", async ({ page, request }) => {
  await withSessionFixture(request, async fixture => {
  await signIn(page, RESIDENT_URL, fixture.resident.email);
  await page.getByRole("link", { name: "Perfil", exact: true }).click();
  const current = page.getByRole("article").filter({ hasText: "Este navegador" });
  await current.getByRole("button", { name: "Encerrar esta sessão", exact: true }).click();
  const result = page.waitForResponse(res => res.request().method() === "DELETE" && new URL(res.url()).pathname.startsWith("/auth/sessions/"));
  await current.getByRole("button", { name: "Confirmar encerramento", exact: true }).click();
  expect((await result).status()).toBe(204);
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  });
});

test("sessões: revogação pendente conclui a saída depois de navegar para outra página", async ({ page, request }) => {
  await withSessionFixture(request, async fixture => {
    await signIn(page, BUILDING_URL, fixture.manager.email);
    await page.getByRole("link", { name: "Minhas sessões", exact: true }).click();
    await page.getByRole("button", { name: "Encerrar todas as sessões", exact: true }).click();

    let release!: () => void;
    let arrived!: () => void;
    let submissions = 0;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const intercepted = new Promise<void>(resolve => { arrived = resolve; });
    const endpoint = `${API_URL}/auth/sessions/revoke-all`;
    await page.route(endpoint, async route => {
      submissions += 1;
      arrived();
      await pending;
      await route.continue();
    });
    try {
      await page.getByRole("button", { name: "Confirmar e sair de todos os dispositivos", exact: true }).click();
      await intercepted;
      await page.getByRole("link", { name: "Início", exact: true }).click();
      await expect(page).toHaveURL(new URL("/", BUILDING_URL).href);
      await expect(page.getByRole("heading", { name: "Minhas sessões", exact: true })).toHaveCount(0);

      const revoked = page.waitForResponse(response => response.url() === endpoint && response.request().method() === "POST");
      release();
      expect((await revoked).status()).toBe(204);
      await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
      expect(submissions).toBe(1);
      await page.reload();
      await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
});

test("sessões: administração consulta a própria conexão e distingue falha de lista vazia", async ({ page, request }) => {
  const fixtures = await adminFixtures(request);
  const admin = await fixtures.api.create<{ id: string; email: string }>("/users", {
    name: `Administrador de sessões ${fixtures.suffix}`,
    email: `sessions-admin-${fixtures.suffix}@predioon.local`,
    password: DEMO_PASSWORD,
    isPlatformAdmin: true,
  });
  try {
    await signIn(page, ADMIN_URL, admin.email);
    await page.getByRole("link", { name: "Minhas sessões", exact: true }).click();
    await expect(page.getByRole("article", { name: "Sessão deste navegador", exact: true })).toBeVisible();
    await expect(page.getByText("Este navegador", { exact: true })).toBeVisible();

    await page.route(`${API_URL}/auth/sessions`, route => route.fulfill({
      status: 503, contentType: "application/json", body: JSON.stringify({ error: "Consulta temporariamente indisponível" }),
    }));
    await page.getByRole("button", { name: "Atualizar sessões", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Consulta temporariamente indisponível");
    await expect(page.getByText("Nenhuma sessão nesta visão.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Encerrar todas as sessões", exact: true })).toHaveCount(0);
    await page.unrouteAll({ behavior: "wait" });
    await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
    await expect(page.getByRole("article", { name: "Sessão deste navegador", exact: true })).toBeVisible();
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await withFixtureDatabase(async sql => sql.begin(async tx => {
      await tx`delete from audit_logs where user_id=${admin.id} or (resource_type='user' and resource_id=${admin.id})`;
      await tx`delete from users where id=${admin.id}`;
    }));
  }
});
