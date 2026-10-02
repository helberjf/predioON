import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { API_URL, DEMO_PASSWORD } from "./environment";

export async function signIn(page: Page, origin: string, email: string) {
  await page.goto(origin);
  await enterCredentials(page, email);
}

export async function enterCredentials(page: Page, email: string) {
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(DEMO_PASSWORD);
  const response = page.waitForResponse(response => response.url() === `${API_URL}/auth/login` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  expect((await response).status(), "O seed precisa fornecer contas de demonstração com a senha configurada").toBe(200);
  await expect(page.getByLabel("Senha", { exact: true })).toHaveCount(0);
}

export async function signOut(page: Page, button = "Sair da conta") {
  const response = page.waitForResponse(response => response.url() === `${API_URL}/auth/logout` && response.request().method() === "POST");
  await page.getByRole("button", { name: button, exact: true }).click();
  expect((await response).status()).toBe(204);
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
}

export async function createWithForm(page: Page, endpoint: string, button: string) {
  const response = page.waitForResponse(response => response.url() === `${API_URL}/v1/tenancy/${endpoint}` && response.request().method() === "POST");
  await page.getByRole("button", { name: button, exact: true }).click();
  expect((await response).status(), `O cadastro ${endpoint} deve persistir na API real`).toBe(201);
}

type Person = { id: string; name: string; email: string };
type Building = { id: string; name: string; organizationId: string };

/** All fixtures go through the same authenticated API and RLS used by the UI. */
export async function authenticatedApi(request: APIRequestContext, email: string) {
  const login = await request.post(`${API_URL}/auth/login`, { data: { email, password: DEMO_PASSWORD } });
  expect(login.status(), `Autenticação da fixture ${email}`).toBe(200);
  const { accessToken } = await login.json() as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };
  return {
    get: (path: string) => request.get(`${API_URL}${path}`, { headers }),
    post: (path: string, data: object) => request.post(`${API_URL}${path}`, { headers, data }),
    patch: (path: string, data: object) => request.patch(`${API_URL}${path}`, { headers, data }),
    async create<T>(path: string, data: object): Promise<T> {
      const response = await request.post(`${API_URL}${path}`, { headers, data });
      expect(response.status(), `Fixture POST ${path}`).toBe(201);
      return response.json() as Promise<T>;
    },
  };
}

export async function adminFixtures(request: APIRequestContext) {
  const api = await authenticatedApi(request, "admin@predioon.local");
  const buildings = await api.get("/buildings");
  expect(buildings.status()).toBe(200);
  const seedBuilding = ((await buildings.json()).items as Building[]).find(building => building.id === "bld_001");
  expect(seedBuilding, "O seed local precisa criar bld_001 para as fixtures isoladas").toBeDefined();
  const suffix = randomUUID().slice(0, 8);
  return {
    suffix,
    api,
    person: (label: string) => api.create<Person>("/users", {
      name: `E2E ${label} ${suffix}`, email: `${label.toLowerCase()}-${suffix}@predioon.local`, password: DEMO_PASSWORD,
    }),
    createBuilding: (label: string) => api.create<Building>("/buildings", {
      organizationId: seedBuilding!.organizationId, name: `E2E ${label} ${suffix}`, code: `E2E-${label}-${suffix}`,
    }),
    membership: (person: Person, building: Building, role: "BUILDING_ADMIN" | "RESIDENT") => api.create("/users/memberships", {
      userId: person.id, buildingId: building.id, role,
    }),
  };
}

export async function isolatedTenant(request: APIRequestContext) {
  const fixtures = await adminFixtures(request);
  const building = await fixtures.createBuilding("A");
  const manager = await fixtures.person("Gestor");
  const resident = await fixtures.person("Morador");
  await fixtures.membership(manager, building, "BUILDING_ADMIN");
  await fixtures.membership(resident, building, "RESIDENT");
  const managerApi = await authenticatedApi(request, manager.email);
  return { ...fixtures, building, manager, resident, managerApi };
}
