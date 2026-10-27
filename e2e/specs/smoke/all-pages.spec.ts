import { expect, test } from "../../support/fixtures";
import { signIn } from "../../support/helpers";
import { trackPageHealth } from "../../support/page-health";
import { PORTALS } from "../../support/routes";

// Opens every route of the three portals with the seed account of each one and checks that the
// page really rendered: its title, no error banner, no endless loading, nothing disabled that the
// menu offers, and no exception or failed API call behind the scenes. A screenshot of each page
// goes into the HTML report. Seed with SEED_PHYSICAL_FEATURES=enabled (pnpm e2e:db does).
for (const portal of PORTALS) {
  test.describe(`Todas as páginas — ${portal.name}`, { tag: "@smoke" }, () => {
    test.use({ viewport: portal.viewport });

    for (const route of portal.routes) {
      test(`${route.path} abre sem erro`, async ({ page }, testInfo) => {
        const health = trackPageHealth(page);
        await signIn(page, portal.origin, portal.account);
        const mark = health.mark();
        await page.goto(`${portal.origin}${route.path}`);

        // A route the App does not know falls back to "/": the URL must stay where we asked.
        await expect(page).toHaveURL(`${portal.origin}${route.path}`);
        const main = page.getByRole("main");
        const ready = route.ready
          ? main.getByText(route.ready, { exact: true })
          : route.heading
            ? main.or(page.getByRole("banner")).getByRole("heading", { level: 1, name: route.heading, exact: typeof route.heading === "string" })
            : main.getByRole("heading");
        await expect(ready.first(), "título ou estado esperado da página").toBeVisible();
        await expect(main.getByText("Carregando informações…", { exact: true }), "a página não pode ficar carregando").toHaveCount(0);

        if (route.menu) {
          const link = page.getByRole("navigation", { name: portal.navigation, exact: true }).getByRole("link", { name: route.menu, exact: true });
          await expect.soft(link, "o menu oferece esta página").toBeVisible();
        }
        await expect.soft(main.getByText("Esta funcionalidade está desativada", { exact: false }), "funcionalidade ligada no seed").toHaveCount(0);
        // The "você tem N avisos novos" banner is information, not an error.
        await expect.soft(main.getByRole("alert").filter({ hasNotText: /avisos? novos?/ }), "nenhuma mensagem de erro na tela").toHaveCount(0);
        const expected = [...(portal.expected ?? []), ...(route.expected ?? [])];
        const unexpected = health.since(mark).filter(problem => !expected.some(item => item.problem.test(problem)));
        expect.soft(unexpected, "sem exceções nem chamadas de API com erro").toEqual([]);

        await testInfo.attach(`${portal.key}${route.path.replace(/\//g, "_")}.png`, {
          body: await page.screenshot({ fullPage: true }), contentType: "image/png",
        });
      });
    }
  });
}
