import { test, expect } from "../../support/fixtures";
import { ADMIN_URL, BUILDING_URL, RESIDENT_URL } from "../../support/environment";
import { trackPageHealth } from "../../support/page-health";
import AxeBuilder from "@axe-core/playwright";

const portals = [
  { name: "administração", url: ADMIN_URL, subtitle: "Administração da plataforma", resident: false },
  { name: "síndico", url: BUILDING_URL, subtitle: "Operação do condomínio", resident: false },
  { name: "morador", url: RESIDENT_URL, subtitle: "Portal do morador", resident: true },
];

for (const portal of portals) {
  const welcomeHeading = portal.resident ? "Seu condomínio. Sua rotina, mais simples." : "Seu imóvel acompanhado. Sua rotina organizada.";
  const presentationHeading = portal.resident ? "Seu condomínio mais perto de você." : "Mais clareza na gestão. Mais tranquilidade para morar.";
  const firstResource = portal.resident ? "Avisos que fazem parte do seu dia" : "Água sob controle";
  test.describe(`Entrada pública — ${portal.name}`, () => {
    test("@validation entrada, apresentação e login têm contraste e semântica acessíveis", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      for (const path of ["/", "/conheca", "/login"]) {
        await page.goto(`${portal.url}${path}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        const violations = result.violations.filter(item => item.impact === "serious" || item.impact === "critical")
          .map(item => ({ rule: item.id, elements: item.nodes.map(node => ({ target: node.target, reason: node.failureSummary })) }));
        expect(violations, `Acessibilidade ${portal.name}${path}`).toEqual([]);
      }
    });
    test("@smoke @critical mobile oferece Login e apresentação antes do formulário", async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const health = trackPageHealth(page, { allowAnonymousRefresh: true });
      await page.goto(portal.url);
      await expect(page.getByRole("heading", { name: welcomeHeading, exact: true })).toBeVisible();
      await expect(page.getByRole("main").getByText(portal.subtitle, { exact: true })).toBeVisible();
      await expect(page.getByLabel("E-mail", { exact: true })).toBeHidden();
      await expect(page.getByRole("link", { name: "Conheça a plataforma", exact: true })).toBeVisible();
      await testInfo.attach(`entrada-mobile-${portal.name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await page.getByRole("link", { name: "Login", exact: true }).click();
      await expect(page).toHaveURL(`${portal.url}/login`);
      await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
      expect(health.since(0)).toEqual([]);
    });

    test("@smoke desktop mantém login e oferece a apresentação", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(portal.url);
      await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Conheça a plataforma", exact: true }).click();
      await expect(page).toHaveURL(`${portal.url}/conheca`);
      await expect(page.getByRole("heading", { name: presentationHeading, exact: true })).toBeVisible();
    });

    // Captured with the Playwright Codegen recorder on 2026-10-24, then made
    // portable with portal URLs, exact locators and assertions after each action.
    // The resident journey was recorded again after splitting the presentation by audience.
    test("@critical fluxo gravado no Codegen explora recursos, abre login e volta ao início", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(portal.url);
      await page.getByRole("link", { name: "Conheça a plataforma", exact: true }).click();
      await expect(page).toHaveURL(`${portal.url}/conheca`);
      await page.getByRole("link", { name: "Explorar recursos", exact: true }).click();
      await expect(page.getByRole("heading", { name: firstResource, exact: true })).toBeInViewport();
      await page.getByRole("banner").getByRole("link", { name: "Login", exact: true }).click();
      await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Voltar ao início", exact: true }).click();
      await expect(page).toHaveURL(`${portal.url}/`);
      await expect(page.getByRole("heading", { name: welcomeHeading, exact: true })).toBeVisible();
    });

    test("@critical apresentação pública explica os recursos e permite voltar ao login", async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 360, height: 800 });
      const health = trackPageHealth(page, { allowAnonymousRefresh: true });
      await page.goto(`${portal.url}/conheca`);
      await expect(page.getByRole("heading", { name: presentationHeading, exact: true })).toBeVisible();
      const resources = portal.resident
        ? ["Avisos que fazem parte do seu dia", "Seu próximo encontro começa na reserva", "Seus chamados, com acompanhamento", "Contas do condomínio com clareza", "Acessos quando você tem permissão", "Consumo compartilhado com você"]
        : ["Água sob controle", "Energia sem surpresas", "Chamados com acompanhamento", "Avisos e reservas", "Gestão transparente", "Acessos e vagas"];
      for (const title of resources) {
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      }
      await expect(page.getByText("Exemplo ilustrativo", { exact: true })).toBeVisible();
      if (portal.resident) {
        await expect(page.getByRole("heading", { name: "O que muda na rotina do síndico", exact: true })).toHaveCount(0);
        await expect(page.getByText("+400%", { exact: true })).toHaveCount(0);
      } else {
        await expect(page.getByText("+400%", { exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Seu condomínio mais perto de você.", exact: true })).toHaveCount(0);
      }
      const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      expect(layout.content).toBeLessThanOrEqual(layout.viewport + 1);
      await page.reload();
      await expect(page.getByRole("heading", { name: portal.resident ? "Do primeiro acesso ao acompanhamento." : "O que muda na rotina do síndico", exact: true })).toBeVisible();
      await testInfo.attach(`apresentacao-mobile-${portal.name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await page.getByRole("banner").getByRole("link", { name: "Login", exact: true }).click();
      await expect(page).toHaveURL(`${portal.url}/login`);
      await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
      expect(health.since(0)).toEqual([]);
    });
  });
}

test("@critical apresentação do síndico não menciona a administração da plataforma", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BUILDING_URL}/conheca`);
  await expect(page.getByRole("heading", { name: "Síndico e equipe", exact: true })).toBeVisible();
  await expect(page.getByText(/administra/i)).toHaveCount(0);
  await page.goto(`${ADMIN_URL}/conheca`);
  await expect(page.getByRole("heading", { name: "Administração", exact: true })).toBeVisible();
});

test("@critical apresentação do morador oferece convite e não direciona para ferramentas de gestão", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${RESIDENT_URL}/conheca`);
  const invite = page.getByRole("link", { name: "Recebi um convite", exact: true });
  await expect(invite).toHaveAttribute("href", "/convite");
  await expect(page.getByRole("link", { name: /síndico|administrar|criar regra/i })).toHaveCount(0);
  await invite.click();
  await expect(page).toHaveURL(`${RESIDENT_URL}/convite`);
  await expect(page.getByLabel("Código do convite", { exact: true })).toBeVisible();
});
