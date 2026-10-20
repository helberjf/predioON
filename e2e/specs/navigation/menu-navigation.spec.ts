import { expect, test, type Page } from "../../support/fixtures";
import { ADMIN_URL, BUILDING_URL } from "../../support/environment";
import { signIn } from "../../support/helpers";

const portals = [
  { name: "administração", url: ADMIN_URL, email: "admin@predioon.local", home: "Dashboard" },
  { name: "condomínio", url: BUILDING_URL, email: "sindico@predioon.local", home: "Início" },
];

const dialog = (page: Page) => page.getByRole("dialog", { name: "Menu principal", exact: true });
const opener = (page: Page) => page.getByRole("button", { name: "Abrir menu", exact: true });
const bodyOverflow = (page: Page) => page.evaluate(() => document.body.style.overflow);

async function openMenu(page: Page, home: string) {
  await opener(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("link", { name: home, exact: true })).toBeVisible();
}

async function expectClosed(page: Page, overflow: string) {
  await expect(page.getByRole("dialog", { name: "Menu principal", includeHidden: true })).toHaveCount(0);
  await expect(opener(page)).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => bodyOverflow(page)).toBe(overflow);
  await expect(opener(page)).toBeFocused();
}

for (const portal of portals) {
  test.describe(`Menu móvel — ${portal.name}`, () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("recebe o foco, confina Tab e Shift+Tab e impede foco no conteúdo de fundo", async ({ page }) => {
      await signIn(page, portal.url, portal.email);
      const backgroundAlert = page.getByRole("link", { name: "Ver alertas", exact: true });
      // Capture the real background element before a modal removes it from the accessibility tree.
      const backgroundHandle = await backgroundAlert.elementHandle();
      expect(backgroundHandle).not.toBeNull();
      await openMenu(page, portal.home);
      const close = dialog(page).getByRole("button", { name: "Fechar menu", exact: true });
      const logout = dialog(page).getByRole("button", { name: "Sair da conta", exact: true });
      await expect(close).toBeFocused();

      await backgroundHandle!.evaluate(element => (element as HTMLElement).focus());
      await expect(close).toBeFocused();
      await expect(page).toHaveURL(`${portal.url}/`);
      await page.keyboard.press("Shift+Tab");
      await expect(logout).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();

      const stops = await dialog(page).getByRole("link").count() + 2;
      for (const key of ["Tab", "Shift+Tab"]) {
        for (let index = 0; index < stops; index++) {
          await page.keyboard.press(key);
          await expect.poll(() => dialog(page).evaluate(element => element.contains(document.activeElement))).toBe(true);
        }
        await expect(close).toBeFocused();
      }
      await page.keyboard.press("Escape");
      await expect(opener(page)).toBeFocused();
    });

    test("devolve foco ao fechar por Escape, botão, fundo ou navegação inclusive para a página atual", async ({ page }) => {
      await signIn(page, portal.url, portal.email);
      const overflow = await bodyOverflow(page);
      for (const method of ["escape", "button", "backdrop"] as const) {
        await openMenu(page, portal.home);
        await expect.poll(() => bodyOverflow(page)).toBe("hidden");
        if (method === "escape") await page.keyboard.press("Escape");
        if (method === "button") await dialog(page).getByRole("button", { name: "Fechar menu", exact: true }).click();
        if (method === "backdrop") await page.mouse.click(371, 400);
        await expectClosed(page, overflow);
      }

      await openMenu(page, portal.home);
      await dialog(page).getByRole("link", { name: portal.home, exact: true }).click();
      await expect(page).toHaveURL(`${portal.url}/`);
      await expectClosed(page, overflow);
      await openMenu(page, portal.home);
      await dialog(page).getByRole("link", { name: "Minhas sessões", exact: true }).click();
      await expect(page).toHaveURL(`${portal.url}/sessoes`);
      await expectClosed(page, overflow);
      await expect(page.getByRole("main")).toBeVisible();
    });

    test("passa ao desktop sem modal oculto nem bloqueio de rolagem e pode reabrir no celular", async ({ page }) => {
      await signIn(page, portal.url, portal.email);
      const overflow = await bodyOverflow(page);
      await openMenu(page, portal.home);
      await expect.poll(() => bodyOverflow(page)).toBe("hidden");
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(page.getByRole("dialog", { name: "Menu principal", includeHidden: true })).toHaveCount(0);
      await expect.poll(() => bodyOverflow(page)).toBe(overflow);
      await expect(opener(page)).toBeHidden();
      await page.getByRole("navigation", { name: "Menu principal", exact: true })
        .getByRole("link", { name: "Minhas sessões", exact: true }).click();
      await expect(page).toHaveURL(`${portal.url}/sessoes`);

      await page.setViewportSize({ width: 375, height: 812 });
      await expect(opener(page)).toHaveAttribute("aria-expanded", "false");
      await openMenu(page, portal.home);
      await expect(dialog(page).getByRole("button", { name: "Fechar menu", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expectClosed(page, overflow);
    });
  });
}
