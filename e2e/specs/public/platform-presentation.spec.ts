import { test, expect } from "../../support/fixtures";
import { ADMIN_URL, BUILDING_URL, RESIDENT_URL } from "../../support/environment";
import { trackPageHealth } from "../../support/page-health";
import AxeBuilder from "@axe-core/playwright";

const portals = [
  { name: "administração", url: ADMIN_URL, subtitle: "Administração da plataforma" },
  { name: "síndico", url: BUILDING_URL, subtitle: "Operação do condomínio" },
  { name: "morador", url: RESIDENT_URL, subtitle: "Portal do morador" },
];

for (const portal of portals) {
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
      await expect(page.getByRole("heading", { name: "Seu imóvel acompanhado. Sua rotina organizada.", exact: true })).toBeVisible();
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
      await expect(page.getByRole("heading", { name: "Mais clareza na gestão. Mais tranquilidade para morar.", exact: true })).toBeVisible();
    });

    // Captured with the Playwright Codegen recorder on 2026-10-24, then made
    // portable with portal URLs, exact locators and assertions after each action.
    test("@critical fluxo gravado no Codegen explora recursos, abre login e volta ao início", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(portal.url);
      await page.getByRole("link", { name: "Conheça a plataforma", exact: true }).click();
      await expect(page).toHaveURL(`${portal.url}/conheca`);
      await page.getByRole("link", { name: "Explorar recursos", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Água sob controle", exact: true })).toBeInViewport();
      await page.getByRole("banner").getByRole("link", { name: "Login", exact: true }).click();
      await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Voltar ao início", exact: true }).click();
      await expect(page).toHaveURL(`${portal.url}/`);
      await expect(page.getByRole("heading", { name: "Seu imóvel acompanhado. Sua rotina organizada.", exact: true })).toBeVisible();
    });

    test("@critical apresentação pública explica os recursos e permite voltar ao login", async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 360, height: 800 });
      const health = trackPageHealth(page, { allowAnonymousRefresh: true });
      await page.goto(`${portal.url}/conheca`);
      await expect(page.getByRole("heading", { name: "Mais clareza na gestão. Mais tranquilidade para morar.", exact: true })).toBeVisible();
      for (const title of ["Água sob controle", "Energia sem surpresas", "Chamados com acompanhamento", "Avisos e reservas", "Gestão transparente", "Acessos e vagas"]) {
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      }
      await expect(page.getByText("Exemplo ilustrativo", { exact: true })).toBeVisible();
      await expect(page.getByText("+400%", { exact: true })).toBeVisible();
      const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      expect(layout.content).toBeLessThanOrEqual(layout.viewport + 1);
      await page.reload();
      await expect(page.getByRole("heading", { name: "O que muda na rotina do síndico", exact: true })).toBeVisible();
      await testInfo.attach(`apresentacao-mobile-${portal.name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await page.getByRole("banner").getByRole("link", { name: "Login", exact: true }).click();
      await expect(page).toHaveURL(`${portal.url}/login`);
      await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
      expect(health.since(0)).toEqual([]);
    });
  });
}
