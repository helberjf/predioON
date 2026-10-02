import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ADMIN_URL, API_URL, BUILDING_URL, RESIDENT_URL } from "./environment";
import { createWithForm, enterCredentials, signIn, signOut } from "./helpers";

test("síndico abre dashboard e cadastra bloco, unidade e equipe persistidos", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const blockCode = `E2E-${suffix}`;
  const blockName = `Torre de teste ${suffix}`;
  const unitCode = `101-${suffix}`;
  const teamName = `Equipe de teste ${suffix}`;
  const overview = page.waitForResponse(response => new URL(response.url()).pathname === "/overview/building" && response.status() === 200);

  await signIn(page, BUILDING_URL, "sindico@predioon.local");
  await expect(page.getByRole("heading", { name: "Olá, Síndico!", exact: true })).toBeVisible();
  expect((await overview).ok()).toBeTruthy();
  await expect(page.getByText("Condomínio Piloto", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Unidades e equipes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Unidades e equipes", exact: true })).toBeVisible();
  await page.getByLabel("Código do bloco", { exact: true }).fill(blockCode);
  await page.getByLabel("Nome do bloco", { exact: true }).fill(blockName);
  await createWithForm(page, "blocks", "Cadastrar bloco");
  await expect(page.getByRole("listitem").filter({ hasText: blockName })).toBeVisible();

  await page.getByLabel("Bloco", { exact: true }).selectOption({ label: `${blockCode} · ${blockName}` });
  await page.getByLabel("Código da unidade", { exact: true }).fill(unitCode);
  await page.getByLabel("Andar (opcional)", { exact: true }).fill("1");
  await createWithForm(page, "units", "Cadastrar unidade");
  await expect(page.getByRole("listitem").filter({ hasText: `${blockCode} · ${unitCode}` })).toBeVisible();

  await page.getByRole("button", { name: "Equipes", exact: true }).click();
  await page.getByLabel("Nome da equipe", { exact: true }).fill(teamName);
  await createWithForm(page, "teams", "Cadastrar equipe");
  await expect(page.getByRole("listitem").filter({ hasText: teamName })).toBeVisible();

  // A reload proves the UI reads saved records instead of depending on optimistic state.
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: blockName })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: `${blockCode} · ${unitCode}` })).toBeVisible();
  await page.getByRole("button", { name: "Equipes", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: teamName })).toBeVisible();

  // Exercise the actual scoped people directory used by the new management UI.
  await page.getByLabel("Pessoa", { exact: true }).selectOption({ label: "Morador Demo · morador@predioon.local" });
  await page.getByLabel("Equipe", { exact: true }).selectOption({ label: teamName });
  await createWithForm(page, "team-members", "Adicionar integrante");
  const memberRow = page.getByRole("listitem").filter({ hasText: "Morador Demo" }).filter({ hasText: teamName });
  await expect(memberRow).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Equipes", exact: true }).click();
  await expect(memberRow).toBeVisible();
});

test("portal do morador apresenta avisos e não oferece ferramentas de gestão", async ({ page }) => {
  await signIn(page, RESIDENT_URL, "morador@predioon.local");
  await expect(page.getByRole("heading", { name: "Olá, Morador!", exact: true })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Navegação do morador" });
  await expect(navigation.getByRole("link", { name: "Unidades e equipes", exact: true })).toHaveCount(0);
  await navigation.getByRole("link", { name: "Avisos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Coleta de lixo", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Publicar para os moradores|Cadastrar bloco|Conceder permissão|Editar/ })).toHaveCount(0);
  await navigation.getByRole("link", { name: "Perfil", exact: true }).click();
  await signOut(page);
  await expect(page.getByRole("navigation", { name: "Navegação do morador" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
});

test("logout e entrada como morador removem formulários e capacidades do síndico", async ({ page }) => {
  await signIn(page, BUILDING_URL, "sindico@predioon.local");
  await page.getByRole("link", { name: "Unidades e equipes", exact: true }).click();
  await page.getByLabel("Código do bloco", { exact: true }).fill(`rascunho-${randomUUID().slice(0, 8)}`);
  await expect(page.getByRole("button", { name: "Cadastrar bloco", exact: true })).toBeVisible();
  const logout = page.waitForResponse(response => response.url() === `${API_URL}/auth/logout` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sair da conta", exact: true }).click();
  expect((await logout).status()).toBe(204);
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Código do bloco", { exact: true })).toHaveCount(0);

  await enterCredentials(page, "morador@predioon.local");
  await expect(page.getByText("Morador Demo", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unidades e equipes", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cadastrar bloco|Cadastrar unidade|Equipes|Permissões|Conceder permissão/ })).toHaveCount(0);
  await expect(page.getByLabel("Código do bloco", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Síndico Demo", { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("Morador Demo", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cadastrar bloco", exact: true })).toHaveCount(0);
});

test("painel da plataforma permite sair após entrada com o perfil incorreto", async ({ page }) => {
  await signIn(page, ADMIN_URL, "morador@predioon.local");
  await expect(page.getByText("Este painel é exclusivo da administração da plataforma.")).toBeVisible();
  await signOut(page, "Sair e usar outra conta");
  await enterCredentials(page, "admin@predioon.local");
  await expect(page.getByRole("heading", { name: "Visão geral dos condomínios", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Usuários", exact: true })).toBeVisible();
});
