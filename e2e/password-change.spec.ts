import { demoAccountEmail, expect, test, type Page } from "./fixtures";
import { ADMIN_URL, API_URL, BUILDING_URL, DEMO_PASSWORD, RESIDENT_URL } from "./environment";
import { signIn } from "./helpers";
import type { AuthUser, SessionView } from "../packages/contracts/src/auth";

// Each test gets separate users with real Argon2 seed hashes, normal admission
// and PostgreSQL families; the fixture never edits the shared seed credential.
const newPassword = "  senha🔐nova🔑literal🧩  ";
const endpoint = `${API_URL}/auth/web/password`;
const form = (page: Page) => page.getByRole("form", { name: "Alterar minha senha", exact: true });

async function openPasswordForm(page: Page, portal: "admin" | "building" | "resident") {
  await page.getByRole("link", { name: portal === "resident" ? "Perfil" : "Minhas sessões", exact: true }).click();
  await page.getByRole("button", { name: "Alterar senha", exact: true }).click();
  await expect(form(page)).toBeVisible();
}

async function fillPasswords(page: Page, current = DEMO_PASSWORD, next = newPassword, confirmation = next) {
  await form(page).getByLabel("Senha atual", { exact: true }).fill(current);
  await form(page).getByLabel("Nova senha", { exact: true }).fill(next);
  await form(page).getByLabel("Confirmar nova senha", { exact: true }).fill(confirmation);
}

async function loginWithNewPassword(page: Page, email: string) {
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(newPassword);
  const response = page.waitForResponse(res => res.url() === `${API_URL}/auth/web/login` && res.request().method() === "POST");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByLabel("Senha", { exact: true })).toHaveCount(0);
}

for (const portal of [
  { kind: "admin", origin: ADMIN_URL, seed: "admin@predioon.local" },
  { kind: "building", origin: BUILDING_URL, seed: "sindico@predioon.local" },
  { kind: "resident", origin: RESIDENT_URL, seed: "morador@predioon.local" },
] as const) {
  test(`senha: ${portal.kind} confirma a troca literal e revoga navegador, aba e dispositivo`, async ({ page, context, request }, testInfo) => {
    if (testInfo.project.name === "chromium" && portal.kind === "resident") await page.setViewportSize({ width: 390, height: 844 });
    const email = demoAccountEmail(portal.seed);
    const native = await request.post(`${API_URL}/auth/login`, {
      headers: { "User-Agent": "Senha dispositivo nativo E2E" }, data: { email, password: DEMO_PASSWORD },
    });
    expect(native.status()).toBe(200);
    const tokens = await native.json() as { accessToken: string; refreshToken: string };
    await signIn(page, portal.origin, portal.seed);
    const peer = await context.newPage();
    await peer.goto(portal.origin);
    await expect(peer.getByRole("navigation")).toBeVisible();
    await openPasswordForm(page, portal.kind);
    await expect(page.getByRole("article", { name: "Sessão deste navegador", exact: true }).getByText("Ativa", { exact: true })).toBeVisible();
    if (testInfo.project.name === "chromium") await page.screenshot({ path: testInfo.outputPath(`password-${portal.kind}.png`), fullPage: true });
    await fillPasswords(page);
    const changed = page.waitForResponse(res => res.url() === endpoint && res.request().method() === "POST");
    await form(page).getByRole("button", { name: "Confirmar troca e sair", exact: true }).click();
    const result = await changed;
    expect(result.status()).toBe(204);
    expect(result.request().postDataJSON()).toEqual({ currentPassword: DEMO_PASSWORD, newPassword });
    for (const tab of [page, peer]) {
      await expect(tab.getByLabel("E-mail", { exact: true })).toBeVisible();
      await expect(tab.getByRole("navigation")).toHaveCount(0);
      await expect(form(tab)).toHaveCount(0);
    }
    expect((await request.get(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } })).status()).toBe(401);
    expect((await request.post(`${API_URL}/auth/refresh`, { data: { refreshToken: tokens.refreshToken } })).status()).toBe(401);
    expect((await request.post(`${API_URL}/auth/login`, { data: { email, password: DEMO_PASSWORD } })).status()).toBe(401);
    await page.reload();
    await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
    await loginWithNewPassword(page, email);
    await expect(page.getByRole("navigation")).toBeVisible();
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`senha: morador usa ponteiro e teclado sem obstrução em ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page, RESIDENT_URL, "morador@predioon.local");
    await openPasswordForm(page, "resident");
    const navigation = page.getByRole("navigation", { name: "Navegação do morador", exact: true });
    const submissions: string[] = [];
    page.on("request", req => { if (req.url() === endpoint && req.method() === "POST") submissions.push(req.url()); });
    // Scroll with the pointer before clicking; .fill() alone bypasses hit testing.
    for (const label of ["Senha atual", "Nova senha", "Confirmar nova senha"]) {
      const input = form(page).getByLabel(label, { exact: true });
      const initial = await input.boundingBox();
      expect(initial).not.toBeNull();
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.wheel(0, initial!.y + initial!.height / 2 - viewport.height / 2);
      await expect.poll(async () => {
        const box = await input.boundingBox(), nav = await navigation.boundingBox();
        return Boolean(box && nav && box.y >= 0 && box.y + box.height < nav.y);
      }).toBe(true);
      await expect(input).toBeVisible();
      // The normal click performs an actual pointer hit-test; never force it.
      await input.click();
      await expect(input).toBeFocused();
      await page.keyboard.type("rascunho");
      await expect(input).toHaveValue("rascunho");
    }
    await page.keyboard.press("Shift+Tab");
    await expect(form(page).getByLabel("Nova senha", { exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(form(page).getByLabel("Senha atual", { exact: true })).toBeFocused();
    for (const label of ["Nova senha", "Confirmar nova senha"]) {
      await page.keyboard.press("Tab");
      await expect(form(page).getByLabel(label, { exact: true })).toBeFocused();
    }
    await page.keyboard.press("Tab");
    await expect(form(page).getByRole("button", { name: "Confirmar troca e sair", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(form(page).getByRole("button", { name: "Cancelar alteração", exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press("Enter");
    await expect(form(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Alterar senha", exact: true }).click();
    for (const label of ["Senha atual", "Nova senha", "Confirmar nova senha"]) await expect(form(page).getByLabel(label, { exact: true })).toHaveValue("");
    expect(submissions).toEqual([]);
  });
}

test("senha: dispensar erro não confirma uma alteração válida nem encerra a sessão", async ({ page, request }) => {
  await signIn(page, RESIDENT_URL, "morador@predioon.local");
  await openPasswordForm(page, "resident");
  await fillPasswords(page, "Senha atual incorreta");
  const rejected = page.waitForResponse(res => res.url() === endpoint && res.request().method() === "POST");
  await form(page).getByRole("button", { name: "Confirmar troca e sair", exact: true }).click();
  expect((await rejected).status()).toBe(400);
  await expect(form(page).getByRole("alert")).toBeVisible();
  await fillPasswords(page);
  const submissions: string[] = [];
  page.on("request", req => { if (req.url() === endpoint && req.method() === "POST") submissions.push(req.url()); });
  // A default submit button inside the form must not turn dismissal into confirmation.
  await form(page).getByRole("button", { name: "Fechar mensagem", exact: true }).click();
  await expect(form(page).getByRole("alert")).toHaveCount(0);
  await expect(form(page).getByLabel("Senha atual", { exact: true })).toHaveValue(DEMO_PASSWORD);
  await expect(form(page).getByLabel("Nova senha", { exact: true })).toHaveValue(newPassword);
  await expect(form(page).getByLabel("Confirmar nova senha", { exact: true })).toHaveValue(newPassword);
  await expect(page.getByRole("article", { name: "Sessão deste navegador", exact: true }).getByText("Ativa", { exact: true })).toBeVisible();
  expect(submissions).toEqual([]);
  // Real reauthentication with the original credential proves it was not changed.
  expect((await request.post(`${API_URL}/auth/login`, { data: { email: demoAccountEmail("morador@predioon.local"), password: DEMO_PASSWORD } })).status()).toBe(200);
});

test("senha: validação Unicode, confirmação e cancelar não enviam credenciais", async ({ page }) => {
  await signIn(page, BUILDING_URL, "sindico@predioon.local");
  await openPasswordForm(page, "building");
  const submissions: string[] = [];
  page.on("request", req => { if (req.url() === endpoint && req.method() === "POST") submissions.push(req.url()); });
  await fillPasswords(page, DEMO_PASSWORD, "🔐".repeat(14));
  await form(page).getByRole("button", { name: "Confirmar troca e sair", exact: true }).click();
  await expect(form(page).getByRole("alert")).toContainText("pelo menos 15 caracteres");
  await fillPasswords(page, DEMO_PASSWORD, newPassword, newPassword.trim());
  await form(page).getByRole("button", { name: "Confirmar troca e sair", exact: true }).click();
  await expect(form(page).getByRole("alert")).toContainText("confirmação");
  await form(page).getByRole("button", { name: "Cancelar alteração", exact: true }).click();
  await expect(form(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Alterar senha", exact: true }).click();
  for (const label of ["Senha atual", "Nova senha", "Confirmar nova senha"]) await expect(form(page).getByLabel(label, { exact: true })).toHaveValue("");
  expect(submissions).toEqual([]);
  expect(await page.evaluate(secret => Object.values(localStorage).concat(Object.values(sessionStorage)).some(value => value.includes(secret)), newPassword)).toBe(false);
  await page.getByRole("link", { name: "Início", exact: true }).click();
  await openPasswordForm(page, "building");
  await expect(form(page).getByLabel("Senha atual", { exact: true })).toHaveValue("");
});

test("senha: senha atual incorreta mantém a sessão e permite corrigir com a API real", async ({ page, request }) => {
  const email = demoAccountEmail("morador@predioon.local");
  const native = await request.post(`${API_URL}/auth/login`, { data: { email, password: DEMO_PASSWORD } });
  expect(native.status()).toBe(200);
  const { accessToken } = await native.json() as { accessToken: string };
  await signIn(page, RESIDENT_URL, "morador@predioon.local");
  await openPasswordForm(page, "resident");
  await fillPasswords(page, "Senha atual incorreta");
  const rejected = page.waitForResponse(res => res.url() === endpoint && res.request().method() === "POST");
  await form(page).getByRole("button", { name: "Confirmar troca e sair", exact: true }).click();
  expect((await rejected).status()).toBe(400);
  await expect(form(page).getByRole("alert")).toContainText("Confira a senha atual");
  await expect(page.getByRole("navigation")).toBeVisible();
  for (const label of ["Senha atual", "Nova senha", "Confirmar nova senha"]) await expect(form(page).getByLabel(label, { exact: true })).toHaveValue("");
  expect((await request.get(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${accessToken}` } })).status()).toBe(200);
  await fillPasswords(page);
  const changed = page.waitForResponse(res => res.url() === endpoint && res.request().method() === "POST");
  await form(page).getByRole("button", { name: "Confirmar troca e sair", exact: true }).click();
  expect((await changed).status()).toBe(204);
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
});

test("senha: rede e limite429 não encerram a conta nem expõem texto da resposta", async ({ page }) => {
  await signIn(page, BUILDING_URL, "sindico@predioon.local");
  await openPasswordForm(page, "building");
  let submissions = 0;
  await page.route(endpoint, async route => {
    submissions++;
    if (submissions === 1) await route.abort("failed");
    else await route.fulfill({ status: 429, contentType: "application/json", headers: { "Retry-After": "60" }, body: JSON.stringify({ error: newPassword }) });
  });
  try {
    await fillPasswords(page);
    await form(page).getByRole("button", { name: "Confirmar troca e sair", exact: true }).click();
    await expect(form(page).getByRole("alert")).toContainText("Não foi possível confirmar");
    await fillPasswords(page);
    await form(page).getByRole("button", { name: "Confirmar troca e sair", exact: true }).click();
    await expect(form(page).getByRole("alert")).toContainText("Aguarde");
    await expect(page.getByText(newPassword, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(form(page).getByRole("button", { name: "Confirmar troca e sair", exact: true })).toBeEnabled();
    expect(submissions).toBe(2);
  } finally { await page.unrouteAll({ behavior: "wait" }); }
});

test("senha: envio único termina a sessão depois de navegar enquanto a resposta está pendente", async ({ page }) => {
  await signIn(page, BUILDING_URL, "sindico@predioon.local");
  await openPasswordForm(page, "building");
  await fillPasswords(page);
  let release!: () => void, arrived!: () => void;
  let submissions = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  const intercepted = new Promise<void>(resolve => { arrived = resolve; });
  await page.route(endpoint, async route => { submissions++; arrived(); await held; await route.continue(); });
  try {
    await form(page).getByRole("button", { name: "Confirmar troca e sair", exact: true }).click();
    await intercepted;
    await expect(form(page).getByRole("button", { name: "Alterando senha...", exact: true })).toBeDisabled();
    await expect(form(page).getByLabel("Senha atual", { exact: true })).toHaveValue("");
    await expect(form(page).getByLabel("Nova senha", { exact: true })).toHaveValue("");
    await form(page).dispatchEvent("submit");
    await page.getByRole("link", { name: "Início", exact: true }).click();
    await expect(form(page)).toHaveCount(0);
    const changed = page.waitForResponse(res => res.url() === endpoint && res.request().method() === "POST");
    release();
    expect((await changed).status()).toBe(204);
    await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
    expect(submissions).toBe(1);
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
});

test("senha: resposta da conta anterior não encerra a nova autenticação", async ({ page }) => {
  const initialLogin = page.waitForResponse(res => res.url() === `${API_URL}/auth/web/login` && res.request().method() === "POST");
  await signIn(page, BUILDING_URL, "sindico@predioon.local");
  const initialUser = (await (await initialLogin).json() as { user: AuthUser }).user;
  await openPasswordForm(page, "building");
  await fillPasswords(page);
  let release!: () => void, arrived!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const intercepted = new Promise<void>(resolve => { arrived = resolve; });
  // Hold the real response while a replacement login starts. The browser cookie
  // lock serializes authentication requests, so release A before awaiting B.
  await page.route(endpoint, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(204);
    arrived();
    await held;
    await route.fulfill({ response });
  });
  try {
    await form(page).getByRole("button", { name: "Confirmar troca e sair", exact: true }).click();
    await intercepted;
    await page.getByRole("button", { name: "Sair da conta", exact: true }).click();
    await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
    const replacementEmail = demoAccountEmail("morador@predioon.local");
    await page.getByLabel("E-mail", { exact: true }).fill(replacementEmail);
    await page.getByLabel("Senha", { exact: true }).fill(DEMO_PASSWORD);
    const loggedIn = page.waitForResponse(res => res.url() === `${API_URL}/auth/web/login` && res.request().method() === "POST");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Entrando...", exact: true })).toBeDisabled();
    const delivered = page.waitForResponse(res => res.url() === endpoint && res.request().method() === "POST");
    release();
    expect((await delivered).status()).toBe(204);
    const replacementLogin = await loggedIn;
    expect(replacementLogin.status()).toBe(200);
    const replacementUser = (await replacementLogin.json() as { user: AuthUser }).user;
    expect(replacementUser.email).toBe(replacementEmail);
    expect(replacementUser.id).not.toBe(initialUser.id);
    // A successful login preserves /sessoes. The greeting belongs to /, so
    // assert the current identity and its real active session on this route.
    await expect(page).toHaveURL(new URL("/sessoes", BUILDING_URL).href);
    await expect(page.getByRole("banner").getByText(replacementUser.name, { exact: true })).toBeVisible();
    await expect(page.getByRole("banner").getByText(initialUser.name, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("article", { name: "Sessão deste navegador", exact: true }).getByText("Ativa", { exact: true })).toBeVisible();
    await expect(page.getByLabel("E-mail", { exact: true })).toHaveCount(0);
    const restored = page.waitForResponse(res => res.url() === `${API_URL}/auth/web/refresh` && res.request().method() === "POST");
    await page.reload();
    const restoredResponse = await restored;
    expect(restoredResponse.status()).toBe(200);
    expect((await restoredResponse.json() as { user: AuthUser }).user).toMatchObject({ id: replacementUser.id, email: replacementEmail });
    await expect(page).toHaveURL(new URL("/sessoes", BUILDING_URL).href);
    await expect(page.getByRole("banner").getByText(replacementUser.name, { exact: true })).toBeVisible();
    const sessionResponse = page.waitForResponse(async res => {
      if (res.url() !== `${API_URL}/auth/sessions` || res.request().method() !== "GET" || res.status() !== 200) return false;
      const body = await res.json() as { items: SessionView[] };
      return body.items.some(row => row.userId === replacementUser.id && row.current && !row.revokedAt);
    });
    await page.getByRole("button", { name: "Atualizar sessões", exact: true }).click();
    const currentSessions = await (await sessionResponse).json() as { items: SessionView[] };
    expect(currentSessions.items.every(row => row.userId === replacementUser.id)).toBe(true);
    expect(currentSessions.items.some(row => row.current && !row.revokedAt)).toBe(true);
    await expect(page.getByRole("article", { name: "Sessão deste navegador", exact: true }).getByText("Ativa", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Alterar senha", exact: true }).click();
    for (const label of ["Senha atual", "Nova senha", "Confirmar nova senha"]) await expect(form(page).getByLabel(label, { exact: true })).toHaveValue("");
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
});
