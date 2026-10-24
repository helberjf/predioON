import { expect, test, type Page } from "../../support/fixtures";
import { BUILDING_URL } from "../../support/environment";
import { signIn } from "../../support/helpers";

const menu = (page: Page) => page.getByRole("navigation", { name: "Menu principal", exact: true });
// Readings, equipment, maintenance and administration belong to whoever manages the building.
const MANAGEMENT = ["Alertas", "Água e reservatórios", "Energia e fases", "Consumo e análise", "Gás, fumaça e vazamentos", "Equipamentos",
  "Ordens de serviço", "Ativos", "Unidades e equipes", "Regras de alerta", "Automações", "Histórico de atividades", "Acesso de suporte"];
const COMMUNITY = ["Início", "Ocorrências", "Avisos", "Áreas comuns", "Transparência e contas", "Minhas sessões"];

test.describe("Portal do condomínio conforme as permissões", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("o morador vê só a comunidade e não abre as telas da administração", async ({ page }) => {
    await signIn(page, BUILDING_URL, "morador@predioon.local");
    for (const name of COMMUNITY) await expect(menu(page).getByRole("link", { name, exact: true })).toBeVisible();
    for (const name of MANAGEMENT) await expect(menu(page).getByRole("link", { name, exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Ver alertas", exact: true })).toHaveCount(0);
    await expect(page.getByText("Equipamentos monitorados", { exact: true })).toHaveCount(0);
    for (const path of ["/agua", "/dispositivos", "/unidades-equipes", "/auditoria"]) {
      await page.goto(`${BUILDING_URL}${path}`);
      await expect(page.getByText("Sua conta não tem acesso a esta área do condomínio.", { exact: true })).toBeVisible();
    }
  });

  test("o síndico continua vendo monitoramento, equipamentos e administração", async ({ page }) => {
    await signIn(page, BUILDING_URL, "sindico@predioon.local");
    for (const name of [...COMMUNITY, ...MANAGEMENT]) await expect(menu(page).getByRole("link", { name, exact: true })).toBeVisible();
    await expect(page.getByText("Equipamentos monitorados", { exact: true })).toBeVisible();
  });
});
