import { expect, test } from "../../support/fixtures";
import { ADMIN_URL, API_URL, BUILDING_URL } from "../../support/environment";
import { isolatedTenant, signIn } from "../../support/helpers";

type FeatureState = { key: string; enabled: boolean; localEnabled: boolean | null; version: number };

// Rules from apps/api/src/modules/features/routes.ts and apps/admin-web/src/pages/Features.tsx:
// only `features:manage` writes; the reason has 3–1000 characters; a stale version is refused
// with 409 instead of overwriting; a building change reaches that building's portals live
// (pg_notify -> SSE) and leaves every other building alone.
test("plataforma desativa Avisos só no condomínio escolhido e o síndico perde a tela ao vivo", { tag: ["@critical", "@permissions", "@validation"] }, async ({ page, request, browser }) => {
  const f = await isolatedTenant(request);
  const path = `/features/buildings/${encodeURIComponent(f.building.id)}`;
  const notices = async () => {
    const response = await f.api.get(path);
    expect(response.status()).toBe(200);
    return ((await response.json()).items as FeatureState[]).find(item => item.key === "NOTICES")!;
  };
  const initial = await notices();
  expect(initial).toMatchObject({ enabled: true, localEnabled: null });

  // Permission and validation straight at the API: the manager reads, never writes.
  const denied = await f.managerApi.put(`${path}/NOTICES`, { enabled: false, version: initial.version, reason: "Tentativa do síndico" });
  expect(denied.status()).toBe(403);
  const tooShort = await f.api.put(`${path}/NOTICES`, { enabled: false, version: initial.version, reason: "ok" });
  expect(tooShort.status()).toBe(400);
  expect(await notices()).toMatchObject({ enabled: true, version: initial.version });

  const managerContext = await browser.newContext();
  try {
    // The manager keeps the notices page open while the platform changes it.
    const manager = await managerContext.newPage();
    await signIn(manager, BUILDING_URL, f.manager.email);
    await manager.goto(`${BUILDING_URL}/avisos`);
    await expect(manager.getByRole("heading", { name: "Avisos e agenda", exact: true })).toBeVisible();

    await signIn(page, ADMIN_URL, "admin@predioon.local");
    await page.getByRole("navigation", { name: "Menu principal", exact: true }).getByRole("link", { name: "Funcionalidades", exact: true }).click();
    await page.getByLabel("Onde aplicar", { exact: true }).selectOption({ label: f.building.name });
    const setting = page.getByLabel("Configurar Avisos", { exact: true });
    await expect(setting).toHaveValue("inherit");

    await setting.selectOption("off");
    await expect(page.getByRole("heading", { name: "Confirmar alteração · Avisos", exact: true })).toBeVisible();
    await expect(page.getByText("Esta alteração vale para o condomínio selecionado.", { exact: false })).toBeVisible();
    const reason = page.getByLabel("Justificativa obrigatória", { exact: true });
    const confirm = page.getByRole("button", { name: "Confirmar alteração", exact: true });
    await expect(confirm, "sem justificativa não confirma").toBeDisabled();
    await reason.fill("ok");
    await expect(confirm, "justificativa com menos de 3 caracteres").toBeDisabled();

    // Cancel discards the intent without writing.
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Confirmar alteração · Avisos", exact: true })).toHaveCount(0);
    expect(await notices()).toMatchObject({ enabled: true, version: initial.version });

    await setting.selectOption("off");
    await reason.fill("Condomínio usa outro mural de avisos");
    const saved = page.waitForResponse(response => response.request().method() === "PUT" && response.url() === `${API_URL}${path}/NOTICES`);
    await confirm.click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByText("Configuração salva. Os portais estão atualizando a disponibilidade.", { exact: true })).toBeVisible();
    await expect(setting).toHaveValue("off");

    // The open building portal follows without a reload: no menu entry, no page.
    await expect(manager.getByText("Esta funcionalidade está desativada para este condomínio. Consulte a administração.", { exact: true })).toBeVisible();
    await expect(manager.getByRole("navigation", { name: "Menu principal", exact: true }).getByRole("link", { name: "Avisos", exact: true })).toHaveCount(0);
    // The seed building keeps its own (inherited) state.
    const seed = await f.api.get("/features/buildings/bld_001");
    expect(((await seed.json()).items as FeatureState[]).find(item => item.key === "NOTICES")?.enabled).toBe(true);

    // A concurrent write wins; the stale form is refused instead of overwriting it.
    await setting.selectOption("inherit");
    await reason.fill("Volta a acompanhar o global");
    const current = await notices();
    const parallel = await f.api.put(`${path}/NOTICES`, { enabled: true, version: current.version, reason: "Alteração paralela" });
    expect(parallel.status()).toBe(200);
    const stale = page.waitForResponse(response => response.request().method() === "PUT" && response.url() === `${API_URL}${path}/NOTICES`);
    await confirm.click();
    expect((await stale).status()).toBe(409);
    await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa alterou esta configuração. Sua mudança não foi aplicada." })).toBeVisible();
    await expect(setting).toHaveValue("on");

    await expect(manager.getByRole("heading", { name: "Avisos e agenda", exact: true })).toBeVisible();
  } finally {
    await managerContext.close();
    const last = await notices();
    if (last.localEnabled !== null) await f.api.put(`${path}/NOTICES`, { enabled: null, version: last.version, reason: "Limpeza do teste E2E" });
  }
});
