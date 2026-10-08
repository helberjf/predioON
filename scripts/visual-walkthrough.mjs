// Percurso visual dos três portais: clica em cada atalho, aba, item de menu e formulário principal,
// confere a tela resultante e salva uma captura por passo.
//
//   node scripts/visual-walkthrough.mjs <pasta-de-saida> [resident] [building] [admin]
//
// Precisa da API e dos três portais rodando localmente com as contas do seed. Cria e cancela uma
// reserva e abre uma ocorrência: use somente contra um banco descartável.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(process.cwd() + "/package.json");
const { chromium, expect } = require("@playwright/test");
const [out, ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const PASSWORD = process.env.SEED_PASSWORD ?? "predioon123";
const results = [];
let shot = 0;

async function session(browser, origin, email, viewport) {
  const page = await (await browser.newContext({ viewport, deviceScaleFactor: 1 })).newPage();
  const problems = [];
  page.on("pageerror", error => problems.push(`exceção: ${String(error).slice(0, 160)}`));
  page.on("response", response => { if (response.status() >= 500) problems.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByLabel("Senha", { exact: true }).waitFor({ state: "detached" });
  return { page, problems };
}
async function step(portal, name, ctx, run) {
  const before = ctx.problems.length;
  let status = "OK", detail = "";
  try { await run(); } catch (error) { status = "FALHA"; detail = String(error.message ?? error).split("\n")[0].slice(0, 220); }
  const fresh = ctx.problems.slice(before);
  if (fresh.length && status === "OK") { status = "ALERTA"; detail = [...new Set(fresh)].join("; ").slice(0, 220); }
  const file = `${String(++shot).padStart(2, "0")}-${portal}-${name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40)}.png`;
  await ctx.page.waitForTimeout(500);
  await ctx.page.screenshot({ path: `${out}/${file}` }).catch(() => {});
  results.push({ portal, name, status, detail, file });
  console.log(`${status.padEnd(6)} ${portal} · ${name}${detail ? " — " + detail : ""}`);
}
const settled = page => page.waitForTimeout(1500);
/** Fails when the screen shows an error banner or never leaves the loading state. */
async function healthy(page) {
  await settled(page);
  const alerts = await page.getByRole("alert").allTextContents();
  if (alerts.length) throw new Error(`mensagem de erro na tela: ${alerts.join(" | ").slice(0, 160)}`);
  if (await page.getByText("Carregando informações…").count()) { await page.waitForTimeout(4000); if (await page.getByText("Carregando informações…").count()) throw new Error("tela presa em Carregando"); }
}

const browser = await chromium.launch();
const want = name => !only.length || only.includes(name);

if (want("resident")) {
  const origin = "http://localhost:5175", portal = "morador";
  const ctx = await session(browser, origin, "morador@predioon.local", { width: 390, height: 844 });
  const { page } = ctx, nav = page.getByRole("navigation", { name: "Navegação do morador" });
  await step(portal, "início carrega", ctx, async () => { await expect(page.getByRole("heading", { name: /^Olá, / })).toBeVisible(); await healthy(page); });
  for (const [label, path] of [["Reservar áreas comuns", "/reservas"], ["Abrir portão", "/acessos"], ["Avisos", "/avisos"], ["Ocorrências", "/chamados"], ["Transparência e contas", "/transparencia"], ["Vagas de carros e motos", "/vagas"]]) {
    await step(portal, `atalho ${label}`, ctx, async () => {
      await page.goto(origin, { waitUntil: "domcontentloaded" }); await settled(page);
      await page.getByRole("main").getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(origin + path); await healthy(page);
      await page.getByRole("link", { name: "Voltar ao início", exact: true }).click();
      await expect(page).toHaveURL(origin + "/");
    });
  }
  for (const [label, path] of [["Reservas", "/reservas"], ["Acessos", "/acessos"], ["Ocorrências", "/chamados"], ["Início", "/"]]) {
    await step(portal, `aba ${label}`, ctx, async () => { await nav.getByRole("link", { name: label, exact: true }).click(); await expect(page).toHaveURL(origin + path); await healthy(page); });
  }
  await step(portal, "Mais abre e fecha por X, fundo e Esc", ctx, async () => {
    const more = nav.getByRole("button", { name: "Mais", exact: true }), panel = nav.getByRole("group", { name: "Mais opções" });
    await more.click(); await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Fechar mais opções" }).click(); await expect(panel).toHaveCount(0);
    await more.click(); await expect(panel).toBeVisible(); await page.mouse.click(195, 200); await expect(panel).toHaveCount(0);
    await more.click(); await expect(panel).toBeVisible(); await page.keyboard.press("Escape"); await expect(panel).toHaveCount(0);
    await more.click(); await expect(panel).toBeVisible();
  });
  for (const [label, path] of [["Avisos", "/avisos"], ["Vagas", "/vagas"], ["Transparência", "/transparencia"], ["Perfil", "/perfil"]]) {
    await step(portal, `Mais → ${label}`, ctx, async () => {
      const more = nav.getByRole("button", { name: "Mais", exact: true });
      if (await more.getAttribute("aria-expanded") !== "true") await more.click();
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(origin + path); await expect(more).toHaveAttribute("aria-expanded", "false"); await healthy(page);
    });
  }
  await step(portal, "Consumo não é oferecido a quem não tem medidor liberado", ctx, async () => {
    const more = nav.getByRole("button", { name: "Mais", exact: true });
    await more.click();
    await expect(nav.getByRole("link", { name: "Perfil", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Consumo", exact: true })).toHaveCount(0);
    await more.click();
  });
  await step(portal, "avisos filtros", ctx, async () => {
    await page.goto(origin + "/avisos", { waitUntil: "domcontentloaded" }); await settled(page);
    const filters = page.getByRole("group", { name: "Filtrar avisos" });
    const total = await page.getByRole("heading", { level: 2 }).count();
    for (const name of await filters.getByRole("button").allTextContents()) {
      await filters.getByRole("button", { name, exact: true }).click();
      const shown = await page.getByRole("heading", { level: 2 }).count();
      if (name !== "Todos" && !(shown >= 1 && shown <= total)) throw new Error(`filtro ${name} mostrou ${shown} de ${total}`);
    }
    await filters.getByRole("button", { name: "Todos", exact: true }).click();
    if (await page.getByRole("heading", { level: 2 }).count() !== total) throw new Error("Todos não restaurou a lista");
  });
  const title = `Teste visual ${Date.now().toString(36)}`;
  await step(portal, "ocorrência abre formulário e envia", ctx, async () => {
    await page.goto(origin + "/chamados", { waitUntil: "domcontentloaded" }); await settled(page);
    await page.getByRole("button", { name: "Abrir novo chamado", exact: true }).click();
    await page.getByLabel("Resumo", { exact: true }).fill(title);
    await page.getByLabel("Local", { exact: true }).fill("Hall de entrada");
    await page.getByLabel("Descrição", { exact: true }).fill("Registro criado pelo teste visual dos botões.");
    await page.getByRole("button", { name: "Enviar chamado", exact: true }).click();
    await expect(page.getByText(title).first()).toBeVisible();
  });
  await step(portal, "ocorrência aparece no início", ctx, async () => {
    await nav.getByRole("link", { name: "Início", exact: true }).click(); await settled(page);
    await expect(page.getByText(title).first()).toBeVisible();
  });
  await step(portal, "reserva escolhe área, confirma e cancela", ctx, async () => {
    await page.goto(origin + "/reservas", { waitUntil: "domcontentloaded" }); await settled(page);
    await page.getByRole("button", { name: /Churrasqueira/ }).click();
    const date = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("Data", { exact: true }).fill(date);
    await settled(page);
    await page.getByRole("button", { name: "Confirmar reserva", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /Reserva/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Minhas reservas", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: `${out}/reserva-confirmada.png` });
    await page.getByRole("button", { name: "Cancelar reserva", exact: true }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "Reserva cancelada." })).toBeVisible();
  });
  await step(portal, "acessos mostra estado dos portões", ctx, async () => {
    await page.goto(origin + "/acessos", { waitUntil: "domcontentloaded" }); await settled(page);
    await expect(page.getByRole("heading", { name: "Acessos", exact: true })).toBeVisible();
    for (const name of ["Abrir garagem", "Abrir entrada"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  });
  await step(portal, "perfil abre e cancela troca de senha", ctx, async () => {
    await page.getByRole("link", { name: "Perfil", exact: true }).first().click(); await settled(page);
    await page.getByRole("button", { name: "Alterar senha", exact: true }).click();
    await expect(page.getByLabel("Senha atual", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Cancelar/ }).first().click();
    await expect(page.getByLabel("Senha atual", { exact: true })).toHaveCount(0);
  });
  await step(portal, "320 px sem rolagem lateral", ctx, async () => {
    await page.setViewportSize({ width: 320, height: 568 });
    for (const path of ["/", "/reservas", "/avisos", "/chamados", "/acessos", "/perfil"]) {
      await page.goto(origin + path, { waitUntil: "domcontentloaded" }); await settled(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 1) throw new Error(`${path} estoura ${overflow}px na largura`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await step(portal, "sair da conta", ctx, async () => {
    await page.goto(origin + "/perfil", { waitUntil: "domcontentloaded" }); await settled(page);
    await page.getByRole("button", { name: "Sair da conta", exact: true }).click();
    await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  });
  await step(portal, "entrada: esqueci minha senha e convite", ctx, async () => {
    await page.getByRole("link", { name: "Esqueci minha senha", exact: true }).click();
    await expect(page.getByRole("form", { name: "Recuperar senha" })).toBeVisible();
    await page.getByRole("link", { name: "Voltar para a entrada", exact: true }).click();
    await page.getByRole("link", { name: "Tenho um convite", exact: true }).click();
    await expect(page.getByRole("form", { name: "Aceitar convite" })).toBeVisible();
  });
  await page.context().close();
}

for (const [key, portal, origin, email] of [["building", "operação", "http://localhost:5174", "sindico@predioon.local"], ["admin", "administração", "http://localhost:5173", "admin@predioon.local"]]) {
  if (!want(key)) continue;
  const ctx = await session(browser, origin, email, { width: 1440, height: 900 });
  const { page } = ctx, menu = page.getByRole("navigation", { name: "Menu principal" });
  await step(portal, "painel inicial", ctx, async () => healthy(page));
  const links = await menu.getByRole("link").allTextContents();
  for (const label of links) {
    await step(portal, `menu ${label}`, ctx, async () => {
      const link = menu.getByRole("link", { name: label, exact: true });
      await link.click(); await healthy(page);
      const active = await link.evaluate(element => element.className.includes("font-semibold"));
      if (!active) throw new Error("item não ficou marcado como atual");
    });
  }
  await step(portal, "busca encontra página", ctx, async () => {
    const term = links[links.length - 1];
    await page.getByRole("textbox", { name: "Buscar no sistema" }).fill(term.slice(0, 6));
    await page.getByRole("search").getByRole("link", { name: term, exact: true }).click();
    await healthy(page);
  });
  await step(portal, "sino leva aos alertas", ctx, async () => { await page.getByRole("link", { name: "Ver alertas", exact: true }).click(); await expect(page).toHaveURL(origin + "/alertas"); await healthy(page); });
  await step(portal, "menu no celular abre, rola e navega", ctx, async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Menu principal" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("link", { name: "Minhas sessões", exact: true }).click();
    await expect(page).toHaveURL(origin + "/sessoes"); await expect(dialog).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 1) throw new Error(`página estoura ${overflow}px na largura`);
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  await step(portal, "sair da conta", ctx, async () => {
    await page.getByRole("button", { name: "Sair da conta", exact: true }).click();
    await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  });
  await page.context().close();
}
await browser.close();
const bad = results.filter(result => result.status !== "OK");
console.log(`\nTOTAL ${results.length} · OK ${results.length - bad.length} · com problema ${bad.length}`);
