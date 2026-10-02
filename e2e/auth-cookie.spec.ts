import { expect, test, type Page } from "@playwright/test";
import { API_URL, BUILDING_URL, DEMO_PASSWORD, RESIDENT_URL } from "./environment";
import { authenticatedApi, enterCredentials, isolatedTenant, signIn, signOut } from "./helpers";

const loginFields = (page: Page) => page.getByLabel("E-mail", { exact: true });
const managerGreeting = (page: Page) => page.getByRole("heading", { name: "Olá, Síndico!", exact: true });

test("sessão web usa cookie HttpOnly, memória e SSE bearer sem credencial na URL, e restaura após reload", async ({ page, context }) => {
  const login = page.waitForResponse(response => response.url() === `${API_URL}/auth/web/login`);
  const stream = page.waitForRequest(request => new URL(request.url()).pathname === "/events/stream");
  await signIn(page, BUILDING_URL, "sindico@predioon.local");
  await expect(managerGreeting(page)).toBeVisible();
  const body = await (await login).json();
  expect(Object.keys(body).sort()).toEqual(["accessToken", "user"]);
  const streamRequest = await stream;
  expect(new URL(streamRequest.url()).search).toBe("");
  expect(Boolean((await streamRequest.allHeaders()).authorization?.startsWith("Bearer "))).toBe(true);
  const cookies = (await context.cookies(API_URL)).filter(cookie => cookie.name.includes("predioon_web_"));
  expect(cookies.length).toBe(1);
  expect(cookies[0]!.httpOnly).toBe(true); expect(cookies[0]!.sameSite).toBe("Strict");
  const privacy = await page.evaluate(() => ({
    visibleCookie: document.cookie.includes("predioon_web_"),
    legacy: localStorage.getItem("predioon.access") !== null || localStorage.getItem("predioon.refresh") !== null,
    persistedSecret: Object.values(localStorage).concat(Object.values(sessionStorage)).some(value => /accessToken|refreshToken|eyJ/.test(value)),
  }));
  expect(privacy).toEqual({ visibleCookie: false, legacy: false, persistedSecret: false });
  const restored = page.waitForResponse(response => response.url() === `${API_URL}/auth/web/refresh`);
  await page.reload(); expect((await restored).status()).toBe(200);
  await expect(managerGreeting(page)).toBeVisible();
  await signOut(page); await page.reload(); await expect(loginFields(page)).toBeVisible();
});

test("duas abas renovam o mesmo cookie sem replay e logout remove dados de ambas", async ({ page, context }) => {
  await signIn(page, BUILDING_URL, "sindico@predioon.local");
  const other = await context.newPage();
  const statuses: number[] = [];
  for (const tab of [page, other]) tab.on("response", response => { if (response.url() === `${API_URL}/auth/web/refresh`) statuses.push(response.status()); });
  await Promise.all([page.reload(), other.goto(BUILDING_URL)]);
  await expect(managerGreeting(page)).toBeVisible(); await expect(managerGreeting(other)).toBeVisible();
  expect(statuses).toEqual([200, 200]);
  await signOut(page);
  await expect(loginFields(other)).toBeVisible();
  await expect(other.getByRole("navigation", { name: "Menu principal" })).toHaveCount(0);
  await other.reload(); await expect(loginFields(other)).toBeVisible();
});

test("troca de conta em uma aba invalida a identidade anterior nas demais e portais mantêm sessões independentes", async ({ page, context }) => {
  await signIn(page, BUILDING_URL, "sindico@predioon.local");
  const peer = await context.newPage(); await peer.goto(BUILDING_URL); await expect(managerGreeting(peer)).toBeVisible();
  const resident = await context.newPage(); await signIn(resident, RESIDENT_URL, "morador@predioon.local");
  await expect(resident.getByRole("link", { name: "Perfil", exact: true })).toBeVisible();
  await signOut(page); await expect(loginFields(peer)).toBeVisible();
  await enterCredentials(page, "morador@predioon.local");
  await expect(peer.getByRole("heading", { name: "Olá, Morador!", exact: true })).toBeVisible();
  await expect(managerGreeting(peer)).toHaveCount(0);
  await resident.reload(); await expect(resident.getByRole("link", { name: "Perfil", exact: true })).toBeVisible();
  await signOut(page); await resident.reload();
  await expect(resident.getByRole("link", { name: "Perfil", exact: true })).toBeVisible();
});

test("logout sem rede permanece local após reload e novo login conclui a revogação pendente", async ({ page, context }) => {
  await signIn(page, BUILDING_URL, "sindico@predioon.local");
  await expect(managerGreeting(page)).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Sair da conta", exact: true }).click();
  await expect(loginFields(page)).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("revogação no servidor");
  await context.setOffline(false);
  let restores = 0;
  page.on("request", request => { if (request.url() === `${API_URL}/auth/web/refresh`) restores++; });
  await page.reload(); await expect(loginFields(page)).toBeVisible(); expect(restores).toBe(0);
  await enterCredentials(page, "morador@predioon.local");
  await expect(page.getByRole("heading", { name: "Olá, Morador!", exact: true })).toBeVisible();
});

test("revogar a família real encerra todas as abas do portal sem restaurar conteúdo privado", async ({ page, context, request }) => {
  const fixture = await isolatedTenant(request);
  const login = page.waitForResponse(response => response.url() === `${API_URL}/auth/web/login`);
  await signIn(page, BUILDING_URL, fixture.manager.email);
  const body = await (await login).json() as { accessToken: string };
  const claims = JSON.parse(Buffer.from(body.accessToken.split(".")[1]!, "base64url").toString()) as { sid: string };
  const peer = await context.newPage(); await peer.goto(BUILDING_URL);
  await expect(peer.getByRole("navigation", { name: "Menu principal" })).toBeVisible();
  const ownApi = await authenticatedApi(request, fixture.manager.email);
  expect((await ownApi.delete(`/auth/sessions/${claims.sid}`)).status()).toBe(204);
  await page.reload();
  await expect(loginFields(page)).toBeVisible(); await expect(loginFields(peer)).toBeVisible();
  await expect(peer.getByRole("navigation", { name: "Menu principal" })).toHaveCount(0);
});

test("cookie não autentica domínio e tentativas CSRF rejeitadas preservam a sessão válida", async ({ page, context }) => {
  await signIn(page, BUILDING_URL, "sindico@predioon.local");
  const statuses = await page.evaluate(async api => {
    const missingHeader = await fetch(`${api}/auth/web/logout`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
    const form = await fetch(`${api}/auth/web/refresh`, { method: "POST", credentials: "include", headers: { "X-Predioon-Web": "1", "Content-Type": "application/x-www-form-urlencoded" }, body: "" });
    const domain = await fetch(`${api}/auth/me`, { credentials: "include" });
    return [missingHeader.status, form.status, domain.status];
  }, API_URL);
  expect(statuses).toEqual([403, 415, 401]);
  const wrongOrigin = await context.request.post(`${API_URL}/auth/web/logout`, {
    headers: { Origin: "https://untrusted.example.test", "X-Predioon-Web": "1" }, data: {},
  });
  expect(wrongOrigin.status()).toBe(403);
  await page.reload(); await expect(managerGreeting(page)).toBeVisible();
});

test("login inválido revoga um cookie anterior sem reabrir a conta antiga no reload", async ({ page }) => {
  await page.goto(BUILDING_URL); await expect(loginFields(page)).toBeVisible();
  // Simulate a recoverable cookie arriving while this tab still displays the login form.
  const created = await page.evaluate(async ({ api, password }) => (await fetch(`${api}/auth/web/login`, {
    method: "POST", credentials: "include", headers: { "X-Predioon-Web": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "sindico@predioon.local", password }),
  })).status, { api: API_URL, password: DEMO_PASSWORD });
  expect(created).toBe(200);
  await loginFields(page).fill("morador@predioon.local"); await page.getByLabel("Senha", { exact: true }).fill("senha-invalida");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("E-mail ou senha inválidos");
  await page.reload(); await expect(loginFields(page)).toBeVisible(); await expect(managerGreeting(page)).toHaveCount(0);
});

test("navegador sem Web Locks informa a limitação, remove tokens antigos e não envia autenticação", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
    localStorage.setItem("predioon.access", "old-access"); localStorage.setItem("predioon.refresh", "old-refresh");
  });
  let authRequests = 0;
  page.on("request", request => { if (request.url().includes("/auth/web/")) authRequests++; });
  await page.goto(BUILDING_URL);
  await expect(page.getByRole("alert")).toContainText("bloqueios entre abas");
  expect(await page.evaluate(() => localStorage.getItem("predioon.access") === null && localStorage.getItem("predioon.refresh") === null)).toBe(true);
  expect(authRequests).toBe(0);
});
