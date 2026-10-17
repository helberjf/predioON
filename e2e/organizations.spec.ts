import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "./fixtures";
import { ADMIN_URL, API_URL } from "./environment";
import { authenticatedApi, enterCredentials, signIn, signOut } from "./helpers";
import { withFixtureDatabase } from "./database";

type Account = { id: string; email: string };
type CatalogGrant = { role_key: string; permission_key: string; created_at: string };
type Fixture = {
  prefix: string; organization: string; inactive: string; building: string;
  name: string; inactiveName: string; buildingName: string;
  pure: Account; flag: Account; outsider: Account;
  capabilities: (account: Account, expected: string[]) => Promise<void>;
  setCapability: (key: "organizations:read" | "organizations:manage", enabled: boolean) => Promise<void>;
  revokeBinding: () => Promise<void>;
};

/** This suite owns the disposable cluster while changing the two platform grants.
 * All UI requests use normal login/API/RLS; owner SQL only prepares/cleans fixtures. */
async function withOrganizations(request: APIRequestContext, run: (fixture: Fixture) => Promise<void>) {
  const prefix = `e2e-org-${randomUUID()}`;
  const organization = `${prefix}-a`, inactive = `${prefix}-b`, building = `${prefix}-building`;
  const account = (kind: string): Account => ({ id: `${prefix}-${kind}`, email: `${prefix}-${kind}@organizations.test` });
  const pure = account("pure"), flag = account("flag"), outsider = account("outsider");
  const users = [pure.id, flag.id, outsider.id], binding = randomUUID();
  const name = `Cliente próprio ${prefix}`, inactiveName = `Cliente inativo ${prefix}`, buildingName = `Imóvel próprio ${prefix}`;
  let grants: CatalogGrant[] | undefined;
  try {
    await withFixtureDatabase(async sql => {
      const catalog = await sql<{ row: CatalogGrant }[]>`select to_jsonb(rp) row from role_permissions rp where role_key='PLATFORM_ADMIN'
        and permission_key in ('organizations:read','organizations:manage') order by permission_key`;
      grants = catalog.map(({ row }) => row); // JSON retains PostgreSQL microseconds exactly.
      expect(grants).toHaveLength(2);
      await sql.begin(async tx => {
        await tx`insert into organizations(id,name,slug,active,metadata) values
          (${organization},${name},${organization},true,'{"preserve":"commercial metadata"}'),
          (${inactive},${inactiveName},${inactive},false,'{}')`;
        await tx`insert into buildings(id,organization_id,name,code) values(${building},${organization},${buildingName},${prefix.slice(-20)})`;
        for (const current of [pure, flag, outsider]) {
          const inserted = await tx`insert into users(id,email,name,password_hash,active,is_platform_admin)
            select ${current.id},${current.email},${current.id},password_hash,true,${current.id === flag.id}
            from users where email='admin@predioon.local' returning id`;
          expect(inserted).toHaveLength(1);
        }
        await tx`insert into role_bindings(id,user_id,role_key) values(${binding},${pure.id},'PLATFORM_ADMIN')`;
      });
    });
    const clients = new Map<string, Awaited<ReturnType<typeof authenticatedApi>>>();
    await run({
      prefix, organization, inactive, building, name, inactiveName, buildingName, pure, flag, outsider,
      async capabilities(current, expected) {
        let api = clients.get(current.id);
        if (!api) { api = await authenticatedApi(request, current.email); clients.set(current.id, api); }
        const response = await api.get("/v1/authorization/platform");
        expect(response.status(), "A premissa usa a projeção real autenticada").toBe(200);
        expect(response.headers()["cache-control"]).toBe("no-store");
        expect(await response.json()).toEqual({ capabilities: [...expected].sort() });
      },
      async setCapability(key, enabled) {
        await withFixtureDatabase(async sql => {
          await sql`delete from role_permissions where role_key='PLATFORM_ADMIN' and permission_key=${key}`;
          if (enabled) await sql`insert into role_permissions select * from jsonb_populate_recordset(null::role_permissions,${sql.json(grants!)}::jsonb) where permission_key=${key}`;
        });
      },
      async revokeBinding() { await withFixtureDatabase(sql => sql`update role_bindings set active=false where id=${binding}`); },
    });
  } finally {
    await withFixtureDatabase(async sql => sql.begin(async tx => {
      if (grants) {
        await tx`delete from role_permissions where role_key='PLATFORM_ADMIN' and permission_key in ('organizations:read','organizations:manage')`;
        await tx`insert into role_permissions select * from jsonb_populate_recordset(null::role_permissions,${tx.json(grants)}::jsonb)`;
      }
      await tx`delete from audit_logs where user_id in ${tx(users)} or resource_id in (${organization},${inactive},${building})`;
      await tx`delete from buildings where organization_id in (${organization},${inactive})`;
      // Only this scenario's unguessable slug namespace, including uncertain POST responses.
      await tx`delete from organizations where slug like ${prefix + '%'} or id in (${organization},${inactive})`;
      await tx`delete from users where id in ${tx(users)}`;
    }));
  }
}

test("organizações: RBAC puro entra em Clientes sem elevar o papel legado", async ({ page, request }) => withOrganizations(request, async f => {
  await f.capabilities(f.pure, ["organizations:read", "organizations:manage"]);
  const login = page.waitForResponse(response => response.url() === `${API_URL}/auth/web/login`);
  await signIn(page, ADMIN_URL, f.pure.email);
  expect((await (await login).json()).user.role).toBe("RESIDENT");
  await expect(page).toHaveURL(`${ADMIN_URL}/clientes`);
  await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
  await expect(page.getByText(f.name, { exact: true })).toBeVisible();
  await withFixtureDatabase(async sql => {
    const [row] = await sql`select is_platform_admin from users where id=${f.pure.id}`;
    expect(row!.is_platform_admin).toBe(false);
  });
}));

async function openClients(page: Page, account: Account) {
  await signIn(page, ADMIN_URL, account.email);
  await page.goto(`${ADMIN_URL}/clientes`);
  await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
}
const clientRow = (page: Page, name: string) => page.getByRole("article", { name: `Cliente ${name}`, exact: true });
async function fillClient(page: Page, name: string, slug: string) {
  await page.getByLabel("Nome do cliente", { exact: true }).fill(name);
  await page.getByLabel("Slug do cliente", { exact: true }).fill(slug);
}
async function focusAuthorization(page: Page) {
  const response = page.waitForResponse(r => r.url() === `${API_URL}/v1/authorization/platform`);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect((await response).status()).toBe(200);
}

/** Delay a real response, and prove its body reached the same browser document.
 * The client may rightly refuse to consume an old identity's original stream. */
async function holdFirstResponse(page: Page, path: string) {
  let release!: () => void, reached!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { reached = resolve; });
  const marker = randomUUID();
  await page.evaluate(({ path, marker, origin }) => {
    const host = window as typeof window & { organizationDeliveries?: Record<string, unknown> };
    host.organizationDeliveries ??= {};
    const original = window.fetch.bind(window);
    let captured = false;
    window.fetch = async (...args) => {
      const input = args[0];
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      const selected = !captured && url.origin === origin && url.pathname === path;
      if (selected) captured = true;
      const response = await original(...args);
      if (selected) host.organizationDeliveries![marker] = await response.clone().json();
      return response;
    };
  }, { path, marker, origin: API_URL });
  let once = false;
  await page.route(`${API_URL}${path}`, async route => {
    if (once || route.request().method() !== "GET") return route.continue();
    once = true;
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    reached();
    await barrier;
    await route.fulfill({ response: actual });
  });
  return {
    held, release,
    async delivered() {
      await expect.poll(() => page.evaluate(marker => (window as typeof window & { organizationDeliveries?: Record<string, unknown> }).organizationDeliveries?.[marker] !== undefined, marker)).toBe(true);
      return page.evaluate(marker => (window as typeof window & { organizationDeliveries: Record<string, unknown> }).organizationDeliveries[marker], marker);
    },
  };
}

test("organizações: conta comercial não monta módulos legados nem oferece seus atalhos", async ({ page, request }, info) => withOrganizations(request, async f => {
  await openClients(page, f.pure);
  await expect(clientRow(page, f.name)).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver alertas", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Buscar no sistema", exact: true }).fill("Alertas");
  await expect(page.getByText("Nenhuma página encontrada.", { exact: true })).toBeVisible();
  const requests: string[] = [];
  page.on("request", current => { if (new URL(current.url()).origin === API_URL) requests.push(new URL(current.url()).pathname); });
  for (const route of ["predios", "gateways", "dispositivos", "alertas", "usuarios", "unidades-equipes", "funcionalidades", "auditoria", "operacao", "suporte-remoto", "acesso-suporte", "predios/?check=1"]) {
    await page.goto(`${ADMIN_URL}/${route}`);
    await expect(page.getByText("Este painel é exclusivo da administração da plataforma.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ir para Clientes", exact: true })).toBeVisible();
  }
  expect(requests.every(path => path.startsWith("/auth/") || path === "/v1/authorization/platform")).toBe(true);
  await page.getByRole("link", { name: "Ir para Clientes", exact: true }).click();
  await expect(clientRow(page, f.name)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Menu principal", exact: true });
  await expect(menu.getByRole("link")).toHaveCount(2);
  await expect(menu.getByRole("button", { name: "Fechar menu", exact: true })).toBeFocused();
  await menu.getByRole("link", { name: "Minhas sessões", exact: true }).click();
  await expect(page.getByRole("article", { name: "Sessão deste navegador", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (info.project.name === "chromium") await page.screenshot({ path: info.outputPath("commercial-own-sessions-mobile.png"), fullPage: true });
}));

test("organizações: gestor cria uma vez, edita parcialmente e confirma desativação e reativação", async ({ page, request }, info) => withOrganizations(request, async f => {
  await openClients(page, f.pure);
  await expect(clientRow(page, f.name)).toBeVisible();
  const createdName = `Novo ${f.prefix}`, slug = `${f.prefix}-novo`;
  await fillClient(page, createdName, slug);
  let posts = 0;
  page.on("request", current => { if (current.url() === `${API_URL}/organizations` && current.method() === "POST") posts++; });
  const created = page.waitForResponse(r => r.url() === `${API_URL}/organizations` && r.request().method() === "POST");
  // Two submit events exercise the synchronous guard independently of a disabled button.
  await page.getByRole("form", { name: "Cadastrar cliente", exact: true }).evaluate(form => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit(); });
  expect((await created).status()).toBe(201);
  await expect(clientRow(page, createdName)).toBeVisible();
  expect(posts).toBe(1);
  await clientRow(page, f.name).getByRole("button", { name: "Editar cliente", exact: true }).click();
  const changedName = `Atualizado ${f.prefix}`;
  await fillClient(page, changedName, `${f.prefix}-editado`);
  const edited = page.waitForResponse(r => r.url() === `${API_URL}/organizations/${f.organization}` && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "Salvar cliente", exact: true }).click();
  const update = await edited;
  expect(update.status()).toBe(200);
  expect(Object.keys(update.request().postDataJSON()).sort()).toEqual(["name", "slug"]);
  expect((await update.json()).metadata).toEqual({ preserve: "commercial metadata" });
  await expect(clientRow(page, changedName)).toBeVisible();
  let patches = 0;
  page.on("request", current => { if (current.url() === `${API_URL}/organizations/${f.organization}` && current.method() === "PATCH") patches++; });
  await clientRow(page, changedName).getByRole("button", { name: "Desativar cliente", exact: true }).click();
  await page.getByRole("button", { name: "Manter estado atual", exact: true }).click();
  expect(patches).toBe(0);
  for (const active of [false, true]) {
    await clientRow(page, changedName).getByRole("button", { name: active ? "Reativar cliente" : "Desativar cliente", exact: true }).click();
    const response = page.waitForResponse(r => r.url() === `${API_URL}/organizations/${f.organization}` && r.request().method() === "PATCH");
    await page.getByRole("button", { name: active ? "Confirmar reativação" : "Confirmar desativação", exact: true }).click();
    const result = await response;
    expect(result.status()).toBe(200); expect(result.request().postDataJSON()).toEqual({ active });
    await expect(clientRow(page, changedName).getByText(active ? "Ativo" : "Inativo", { exact: true })).toBeVisible();
  }
  expect(patches).toBe(2);
  await page.reload();
  await expect(clientRow(page, changedName)).toBeVisible();
  await expect(clientRow(page, createdName)).toBeVisible();
  await withFixtureDatabase(async sql => {
    const rows = await sql`select action from audit_logs where user_id=${f.pure.id}`;
    expect(rows.filter(row => row.action === "ORGANIZATION_CREATED")).toHaveLength(1);
    expect(rows.filter(row => row.action === "ORGANIZATION_UPDATED")).toHaveLength(3);
  });
  if (info.project.name === "chromium") await page.screenshot({ path: info.outputPath("commercial-clients-managed.png"), fullPage: true });
}));

test("organizações: conflito real conserva rascunho e não repete a escrita ao revalidar", async ({ page, request }) => withOrganizations(request, async f => {
  await openClients(page, f.pure);
  const draft = `Rascunho ${f.prefix}`;
  await fillClient(page, draft, f.organization);
  let posts = 0;
  page.on("request", current => { if (current.url() === `${API_URL}/organizations` && current.method() === "POST") posts++; });
  const response = page.waitForResponse(r => r.url() === `${API_URL}/organizations` && r.request().method() === "POST");
  await page.getByRole("button", { name: "Cadastrar cliente", exact: true }).click();
  expect((await response).status()).toBe(409);
  await expect(page.getByRole("alert")).toContainText("Já existe uma organização com este slug");
  await expect(page.getByLabel("Nome do cliente", { exact: true })).toHaveValue(draft);
  await expect(page.getByLabel("Slug do cliente", { exact: true })).toHaveValue(f.organization);
  await focusAuthorization(page);
  expect(posts).toBe(1);
}));

test("organizações: revoga gestão e leitura legadas sem restaurar o rascunho depois", async ({ page, request }) => withOrganizations(request, async f => {
  await openClients(page, f.flag);
  await clientRow(page, f.name).getByRole("button", { name: "Editar cliente", exact: true }).click();
  await page.getByLabel("Nome do cliente", { exact: true }).fill("Rascunho que deve ser descartado");
  await f.setCapability("organizations:manage", false);
  await f.capabilities(f.flag, ["organizations:read"]);
  await focusAuthorization(page);
  await expect(page.getByLabel("Nome do cliente", { exact: true })).toHaveCount(0);
  await expect(clientRow(page, f.name)).toBeVisible();
  await f.setCapability("organizations:manage", true);
  await focusAuthorization(page);
  await expect(page.getByLabel("Nome do cliente", { exact: true })).toHaveValue("");
  await f.setCapability("organizations:read", false);
  await focusAuthorization(page);
  await expect(page.getByText("Você não tem permissão para consultar clientes.", { exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByLabel("Nome do cliente", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Condomínios", exact: true })).toBeVisible();
}));

test("organizações: binding puro revogado retira clientes e conserva sessões próprias", async ({ page, request }) => withOrganizations(request, async f => {
  await openClients(page, f.pure);
  await expect(clientRow(page, f.name)).toBeVisible();
  await f.revokeBinding();
  await f.capabilities(f.pure, []);
  await focusAuthorization(page);
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Clientes", exact: true })).toHaveCount(0);
  const sessions = page.waitForResponse(r => new URL(r.url()).pathname === "/auth/sessions");
  await page.getByRole("link", { name: "Minhas sessões", exact: true }).click();
  const data = await (await sessions).json();
  expect(data.items.length).toBeGreaterThan(0);
  expect(data.items.every((row: { userId: string }) => row.userId === f.pure.id)).toBe(true);
  await signOut(page);
}));

test("organizações: GET antigo não recoloca dados depois de revogar leitura e atualizar em pendência", async ({ page, request }) => withOrganizations(request, async f => {
  await openClients(page, f.pure);
  await expect(clientRow(page, f.name)).toBeVisible();
  const delayed = await holdFirstResponse(page, "/organizations");
  try {
    await page.getByRole("button", { name: "Atualizar clientes", exact: true }).click();
    await delayed.held;
    await page.getByRole("button", { name: "Atualizar clientes", exact: true }).click();
    await f.setCapability("organizations:read", false);
    await focusAuthorization(page);
    await expect(page.getByRole("article")).toHaveCount(0);
    delayed.release();
    const actual = await delayed.delivered() as { items: { id: string }[] };
    expect(actual.items.some(row => row.id === f.organization)).toBe(true);
    await expect(page.getByText(f.name, { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Nome do cliente", { exact: true })).toHaveCount(0);
  } finally { delayed.release(); }
}));

for (const destination of ["sessions", "same-account", "other-account"] as const) {
  test(`organizações: preflight antigo não escreve após ${destination}`, async ({ page, request }) => withOrganizations(request, async f => {
    await openClients(page, f.pure);
    await fillClient(page, "Intenção antiga", `${f.prefix}-pending`);
    const delayed = await holdFirstResponse(page, "/v1/authorization/platform");
    let posts = 0;
    page.on("request", current => { if (current.url() === `${API_URL}/organizations` && current.method() === "POST") posts++; });
    try {
      await page.getByRole("button", { name: "Cadastrar cliente", exact: true }).click();
      await delayed.held;
      if (destination === "sessions") {
        await page.getByRole("link", { name: "Minhas sessões", exact: true }).click();
        await expect(page.getByRole("article", { name: "Sessão deste navegador", exact: true })).toBeVisible();
      } else {
        await signOut(page);
        await enterCredentials(page, destination === "same-account" ? f.pure.email : f.outsider.email);
        if (destination === "same-account") await expect(page.getByLabel("Nome do cliente", { exact: true })).toHaveValue("");
        else await expect(page.getByText("Você não tem permissão para consultar clientes.", { exact: true })).toBeVisible();
      }
      delayed.release();
      expect(await delayed.delivered()).toEqual({ capabilities: ["organizations:manage", "organizations:read"] });
      expect(posts).toBe(0);
      await withFixtureDatabase(async sql => { expect(await sql`select id from organizations where slug=${f.prefix + '-pending'}`).toHaveLength(0); });
    } finally { delayed.release(); }
  }));
}

test("organizações: revogação posterior ao preflight recebe403 e fecha o escopo sem replay", async ({ page, request }) => withOrganizations(request, async f => {
  await openClients(page, f.pure);
  await fillClient(page, "Intenção revogada", `${f.prefix}-revoked`);
  const delayed = await holdFirstResponse(page, "/v1/authorization/platform");
  let posts = 0;
  page.on("request", current => { if (current.url() === `${API_URL}/organizations` && current.method() === "POST") posts++; });
  try {
    await page.getByRole("button", { name: "Cadastrar cliente", exact: true }).click();
    await delayed.held;
    await f.revokeBinding();
    const denied = page.waitForResponse(r => r.url() === `${API_URL}/organizations` && r.request().method() === "POST");
    delayed.release();
    expect((await denied).status()).toBe(403);
    await expect(page.getByText("Você não tem permissão para consultar clientes.", { exact: true })).toBeVisible();
    expect(posts).toBe(1);
    await expect(page.getByRole("article")).toHaveCount(0);
    await withFixtureDatabase(async sql => { expect(await sql`select action from audit_logs where user_id=${f.pure.id}`).toHaveLength(0); });
  } finally { delayed.release(); }
}));

test("organizações: falhas de projeção e listagem têm retry real sem parecer lista vazia", async ({ page, request }) => withOrganizations(request, async f => {
  let projectionFailure = true, listFailure = true;
  await page.route(`${API_URL}/v1/authorization/platform`, route => {
    if (!projectionFailure) return route.continue();
    projectionFailure = false;
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Autorização temporariamente indisponível" }) });
  });
  await page.route(`${API_URL}/organizations`, route => {
    if (!listFailure) return route.continue();
    listFailure = false;
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Lista temporariamente indisponível" }) });
  });
  await signIn(page, `${ADMIN_URL}/clientes`, f.pure.email);
  await expect(page.getByRole("alert")).toContainText("Autorização temporariamente indisponível");
  await expect(page.getByText("Nenhum cliente cadastrado.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Lista temporariamente indisponível");
  await expect(page.getByText("Nenhum cliente cadastrado.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(clientRow(page, f.name)).toBeVisible();
}));

test("organizações: Imóveis revalida seleção antes de enviar e não exige gestão comercial", async ({ page, request }) => withOrganizations(request, async f => {
  await signIn(page, ADMIN_URL, f.flag.email);
  await page.goto(`${ADMIN_URL}/predios`);
  await page.getByLabel("Cliente", { exact: true }).selectOption(f.organization);
  await page.getByLabel("Nome", { exact: true }).fill("Imóvel de teste");
  await page.getByLabel("Código", { exact: true }).fill("PRE039");
  let posts = 0;
  page.on("request", current => { if (current.url() === `${API_URL}/buildings` && current.method() === "POST") posts++; });
  await f.setCapability("organizations:read", false);
  await page.getByRole("button", { name: "Cadastrar", exact: true }).click();
  await expect(page.getByText("Você não tem permissão para consultar clientes.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Cliente", { exact: true })).toHaveCount(0);
  await expect(page.getByText(f.buildingName, { exact: true })).toBeVisible();
  expect(posts).toBe(0);
  await f.setCapability("organizations:read", true);
  await f.setCapability("organizations:manage", false);
  await focusAuthorization(page);
  await expect(page.getByLabel("Cliente", { exact: true })).toHaveValue("");
  await page.getByLabel("Cliente", { exact: true }).selectOption(f.organization);
  const created = page.waitForResponse(r => r.url() === `${API_URL}/buildings` && r.request().method() === "POST");
  await page.getByRole("button", { name: "Cadastrar", exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByText("Imóvel de teste", { exact: true })).toBeVisible();
  expect(posts).toBe(1);
}));

test("organizações: leitor legado consulta ativos e inativos sem formulário ou ações", async ({ page, request }) => withOrganizations(request, async f => {
  await f.setCapability("organizations:manage", false);
  await f.capabilities(f.flag, ["organizations:read"]);
  await signIn(page, ADMIN_URL, f.flag.email);
  await page.goto(`${ADMIN_URL}/clientes`);
  await expect(page.getByText(f.name, { exact: true })).toBeVisible();
  await expect(page.getByText(f.inactiveName, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cadastrar|Editar|Desativar|Reativar/ })).toHaveCount(0);
  await expect(page.getByLabel("Slug", { exact: true })).toHaveCount(0);
}));

for (const lostResponse of ["network", "invalid-json"] as const) {
  test(`organizações: escrita concluída com resposta ${lostResponse} orienta reconciliação sem replay`, async ({ page, request }) => withOrganizations(request, async f => {
    await openClients(page, f.pure);
    const draft = `Resultado incerto ${f.prefix}`, slug = `${f.prefix}-uncertain`;
    await fillClient(page, draft, slug);
    let posts = 0;
    await page.route(`${API_URL}/organizations`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      posts++;
      const actual = await route.fetch();
      expect(actual.status()).toBe(201); // The server really committed before losing its response.
      if (lostResponse === "network") return route.abort("failed");
      return route.fulfill({ response: actual, body: "{invalid-json" });
    });
    await page.getByRole("button", { name: "Cadastrar cliente", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Não foi possível confirmar se a alteração foi concluída. Atualize a lista antes de tentar novamente.");
    await expect(page.getByLabel("Nome do cliente", { exact: true })).toHaveValue(draft);
    await expect(page.getByLabel("Slug do cliente", { exact: true })).toHaveValue(slug);
    await page.getByRole("button", { name: "Atualizar clientes", exact: true }).click();
    await expect(clientRow(page, draft)).toBeVisible();
    await focusAuthorization(page);
    expect(posts).toBe(1);
    await withFixtureDatabase(async sql => {
      expect(await sql`select id from organizations where slug=${slug}`).toHaveLength(1);
      expect(await sql`select id from audit_logs where user_id=${f.pure.id} and action='ORGANIZATION_CREATED'`).toHaveLength(1);
    });
  }));
}

test("organizações: cancelar edição com preflight pendente invalida a intenção antiga", async ({ page, request }) => withOrganizations(request, async f => {
  await openClients(page, f.pure);
  await clientRow(page, f.name).getByRole("button", { name: "Editar cliente", exact: true }).click();
  await page.getByLabel("Nome do cliente", { exact: true }).fill("Não deve persistir");
  const delayed = await holdFirstResponse(page, "/v1/authorization/platform");
  let patches = 0;
  page.on("request", current => { if (new URL(current.url()).pathname.startsWith("/organizations/") && current.method() === "PATCH") patches++; });
  try {
    await page.getByRole("button", { name: "Salvar cliente", exact: true }).click();
    await delayed.held;
    await page.getByRole("button", { name: "Cancelar edição", exact: true }).click();
    delayed.release();
    expect(await delayed.delivered()).toEqual({ capabilities: ["organizations:manage", "organizations:read"] });
    await expect(page.getByRole("button", { name: "Cadastrar cliente", exact: true })).toBeVisible();
    expect(patches).toBe(0);
    await withFixtureDatabase(async sql => { expect((await sql`select name from organizations where id=${f.organization}`)[0]!.name).toBe(f.name); });
  } finally { delayed.release(); }
}));

test("organizações: Imóveis preserva sua lista sem consultar seletor comercial não autorizado", async ({ page, request }) => withOrganizations(request, async f => {
  await f.setCapability("organizations:read", false);
  await f.capabilities(f.flag, ["organizations:manage"]);
  await signIn(page, ADMIN_URL, f.flag.email);
  let organizationReads = 0;
  page.on("request", current => { if (new URL(current.url()).pathname === "/organizations" && current.method() === "GET") organizationReads++; });
  await page.goto(`${ADMIN_URL}/predios`);
  await expect(page.getByText(f.buildingName, { exact: true })).toBeVisible();
  expect(organizationReads, "Sem read comercial não há consulta de opções").toBe(0);
  await expect(page.getByRole("button", { name: "Cadastrar", exact: true })).toBeDisabled();
  await expect(page.getByText("Você não tem permissão para consultar clientes.", { exact: true })).toBeVisible();
}));

test("organizações: erro transitório no preflight conserva rascunho sem enviar escrita", async ({ page, request }) => withOrganizations(request, async f => {
  await openClients(page, f.pure);
  await fillClient(page, "Rascunho preservado", `${f.prefix}-draft`);
  let failOnce = true, posts = 0;
  await page.route(`${API_URL}/v1/authorization/platform`, route => {
    if (!failOnce) return route.continue();
    failOnce = false;
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Preflight indisponível" }) });
  });
  page.on("request", current => { if (current.url() === `${API_URL}/organizations` && current.method() === "POST") posts++; });
  await page.getByRole("button", { name: "Cadastrar cliente", exact: true }).click();
  await expect(page.getByText(/Acesso a clientes indisponível: Preflight indisponível/)).toBeVisible();
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.getByLabel("Nome do cliente", { exact: true })).toHaveValue("Rascunho preservado");
  await expect(page.getByLabel("Slug do cliente", { exact: true })).toHaveValue(`${f.prefix}-draft`);
  expect(posts).toBe(0);
}));

test("organizações: evento de background invalida preflight mesmo depois de retornar", async ({ page, request }) => withOrganizations(request, async f => {
  await openClients(page, f.pure);
  await fillClient(page, "Intenção antes do background", `${f.prefix}-background`);
  const delayed = await holdFirstResponse(page, "/v1/authorization/platform");
  let posts = 0;
  page.on("request", current => { if (current.url() === `${API_URL}/organizations` && current.method() === "POST") posts++; });
  try {
    await page.getByRole("button", { name: "Cadastrar cliente", exact: true }).click();
    await delayed.held;
    // Deterministic lifecycle event, not a claim of real OS/tab suspension.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    delayed.release();
    expect(await delayed.delivered()).toEqual({ capabilities: ["organizations:manage", "organizations:read"] });
    await expect(page.getByRole("button", { name: "Cadastrar cliente", exact: true })).toBeEnabled();
    expect(posts).toBe(0);
    await withFixtureDatabase(async sql => { expect(await sql`select id from organizations where slug=${f.prefix + '-background'}`).toHaveLength(0); });
  } finally { delayed.release(); }
}));

test("organizações: seletor de Imóveis aguarda dados novos depois de perder e recuperar leitura", async ({ page, request }) => withOrganizations(request, async f => {
  await signIn(page, ADMIN_URL, f.flag.email);
  await page.goto(`${ADMIN_URL}/predios`);
  await page.getByLabel("Cliente", { exact: true }).selectOption(f.organization);
  await f.setCapability("organizations:read", false);
  await focusAuthorization(page);
  await expect(page.getByLabel("Cliente", { exact: true })).toHaveCount(0);
  const delayed = await holdFirstResponse(page, "/organizations");
  try {
    await f.setCapability("organizations:read", true);
    await focusAuthorization(page);
    await delayed.held;
    await expect(page.getByLabel("Cliente", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Cliente", { exact: true })).toHaveValue("");
    await expect(page.getByRole("option", { name: f.name, exact: true })).toHaveCount(0);
    await expect(page.getByText(f.buildingName, { exact: true })).toBeVisible();
    delayed.release();
    const delivered = await delayed.delivered() as { items: { id: string }[] };
    expect(delivered.items.some(row => row.id === f.organization)).toBe(true);
    await expect(page.getByLabel("Cliente", { exact: true })).toBeEnabled();
    await expect(page.getByRole("option", { name: f.name, exact: true })).toHaveCount(1);
    await expect(page.getByLabel("Cliente", { exact: true })).toHaveValue("");
  } finally { delayed.release(); }
}));

test("organizações: revogação publicada no mesmo turno da resposta de escrita impede confirmação antiga", async ({ page, request }) => withOrganizations(request, async f => {
  await openClients(page, f.pure);
  await fillClient(page, "Escrita anterior à revogação", `${f.prefix}-committed`);
  await page.evaluate(origin => {
    type PendingBody = { resolve(value: unknown): void; body: unknown };
    const state = {
      write: null as PendingBody | null, authorization: null as PendingBody | null,
      armAuthorization: false, messages: [] as string[],
      release() {
        if (!this.authorization || !this.write) throw new Error("Os dois corpos reais ainda não estão disponíveis");
        // Resolve the real JSON reads in the same turn: authorization first,
        // then the committed write, before React's next scheduled render/effect.
        this.authorization.resolve(this.authorization.body);
        this.write.resolve(this.write.body);
        return { authorization: this.authorization.body, write: this.write.body };
      },
    };
    (window as typeof window & { organizationCompletionRace: typeof state }).organizationCompletionRace = state;
    new MutationObserver(records => {
      for (const record of records) for (const node of Array.from(record.addedNodes)) {
        if (node.textContent?.includes("Cliente cadastrado.")) state.messages.push(node.textContent);
      }
    }).observe(document.body, { subtree: true, childList: true });
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const input = args[0];
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      const method = args[1]?.method ?? (input instanceof Request ? input.method : "GET");
      const response = await original(...args);
      if (url.origin !== origin || !response.ok) return response;
      const key = url.pathname === "/organizations" && method === "POST" ? "write"
        : url.pathname === "/v1/authorization/platform" && state.armAuthorization ? "authorization" : null;
      if (key) {
        const body: unknown = await response.clone().json();
        response.json = () => new Promise(resolve => { state[key] = { resolve, body }; });
      }
      return response;
    };
  }, API_URL);
  let posts = 0;
  page.on("request", current => { if (current.url() === `${API_URL}/organizations` && current.method() === "POST") posts++; });
  await page.getByRole("button", { name: "Cadastrar cliente", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).organizationCompletionRace.write))).toBe(true);
  await withFixtureDatabase(async sql => { expect(await sql`select id from organizations where slug=${f.prefix + '-committed'}`).toHaveLength(1); });
  await f.setCapability("organizations:manage", false);
  await page.evaluate(() => {
    (window as any).organizationCompletionRace.armAuthorization = true;
    window.dispatchEvent(new Event("focus"));
  });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).organizationCompletionRace.authorization))).toBe(true);
  const bodies = await page.evaluate(() => (window as any).organizationCompletionRace.release()) as { authorization: unknown; write: { slug: string } };
  expect(bodies.authorization).toEqual({ capabilities: ["organizations:read"] });
  expect(bodies.write.slug).toBe(`${f.prefix}-committed`);
  await expect(page.getByLabel("Nome do cliente", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).organizationCompletionRace.messages)).toEqual([]);
  await page.evaluate(() => { (window as any).organizationCompletionRace.armAuthorization = false; });
  await f.setCapability("organizations:manage", true);
  await focusAuthorization(page);
  await expect(page.getByLabel("Nome do cliente", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Atualizar clientes", exact: true }).click();
  await expect(clientRow(page, "Escrita anterior à revogação")).toBeVisible();
  expect(await page.evaluate(() => (window as any).organizationCompletionRace.messages)).toEqual([]);
  expect(posts).toBe(1);
}));

test("organizações: perder gestão comercial não invalida resposta de imóvel autorizado por leitura", async ({ page, request }) => withOrganizations(request, async f => {
  await signIn(page, ADMIN_URL, f.flag.email);
  await page.goto(`${ADMIN_URL}/predios`);
  await page.getByLabel("Cliente", { exact: true }).selectOption(f.organization);
  const name = `Imóvel sem gestão comercial ${f.prefix}`;
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByLabel("Código", { exact: true }).fill("READ039");
  let release!: () => void, reached!: () => void, posts = 0;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { reached = resolve; });
  await page.route(`${API_URL}/buildings`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const actual = await route.fetch();
    expect(actual.status()).toBe(201);
    expect((await actual.json()).name).toBe(name);
    reached();
    await barrier;
    await route.fulfill({ response: actual });
  });
  try {
    await page.getByRole("button", { name: "Cadastrar", exact: true }).click();
    await held;
    await f.setCapability("organizations:manage", false);
    await focusAuthorization(page);
    await f.capabilities(f.flag, ["organizations:read"]);
    release();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("");
    expect(posts).toBe(1);
    await withFixtureDatabase(async sql => { expect(await sql`select id from buildings where organization_id=${f.organization} and name=${name}`).toHaveLength(1); });
  } finally { release(); }
}));

test("organizações: primeira projeção lenta não desloca o destino durante o clique no menu", async ({ page, request }, info) => withOrganizations(request, async f => {
  let release!: () => void, reached!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { reached = resolve; });
  let once = false;
  await page.route(`${API_URL}/v1/authorization/platform`, async route => {
    if (once) return route.continue();
    once = true;
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    expect(await actual.json()).toEqual({ capabilities: ["organizations:manage", "organizations:read"] });
    reached();
    await barrier;
    await route.fulfill({ response: actual });
  });
  try {
    await signIn(page, `${ADMIN_URL}/clientes`, f.pure.email);
    await held;
    const navigation = page.getByRole("navigation", { name: "Menu principal", exact: true });
    await expect(navigation).toBeVisible();
    const sessions = navigation.getByRole("link", { name: "Minhas sessões", exact: true });
    if (await sessions.count()) {
      // A usable link must remain under the same pointer throughout its click.
      const before = await sessions.boundingBox();
      expect(before).not.toBeNull();
      await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
      await page.mouse.down();
      release();
      await expect(navigation.getByRole("link", { name: "Clientes", exact: true })).toBeVisible();
      const after = await sessions.boundingBox();
      await page.mouse.up();
      await info.attach("initial-projection-pointer.json", { contentType: "application/json", body: JSON.stringify({ before, after, pathname: new URL(page.url()).pathname }) });
      expect(after?.y, "A autorização não pode mover um destino já oferecido durante pointerdown/up").toBe(before!.y);
    } else {
      // Withholding the incomplete menu must provide a loading state and leave logout usable.
      await expect(navigation).toHaveAttribute("aria-busy", "true");
      await expect(navigation.getByRole("status")).toContainText("Carregando menu");
      await expect(page.getByRole("button", { name: "Sair da conta", exact: true })).toBeEnabled();
      release();
      await expect(navigation).toHaveAttribute("aria-busy", "false");
      await sessions.click();
    }
    await expect(page).toHaveURL(`${ADMIN_URL}/sessoes`);
    await expect(page.getByRole("article", { name: "Sessão deste navegador", exact: true })).toBeVisible();
  } finally { release(); }
}));
