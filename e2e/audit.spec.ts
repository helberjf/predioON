import { randomUUID } from "node:crypto";
import type { AuditPage } from "../packages/contracts/src/audit";
import { expect, test, type APIRequestContext, type Page } from "./fixtures";
import { ADMIN_URL, API_URL, BUILDING_URL } from "./environment";
import { adminFixtures, enterCredentials, signIn, signOut } from "./helpers";
import { withFixtureDatabase } from "./database";

async function withAuditFixture(request: APIRequestContext, run: (f: {
  a: { id: string; name: string }; b: { id: string; name: string };
  manager: { id: string; email: string }; other: { id: string; email: string };
  delegate: { id: string; email: string }; role: string;
  local: string; foreign: string; global: string; unknown: string;
}) => Promise<void>) {
  const f = await adminFixtures(request);
  const a = await f.createBuilding("AuditA"), b = await f.createBuilding("AuditB");
  const manager = await f.person("AuditorLocal"), other = await f.person("AuditorOutro"), delegate = await f.person("AuditorExato");
  const users = [manager.id, other.id, delegate.id], role = `E2E_AUDIT_${f.suffix}`;
  const local = `AUDIT_LOCAL_${f.suffix}`, foreign = `AUDIT_FOREIGN_${f.suffix}`, global = `audit-global-${f.suffix}`, unknown = `audit-unknown-${f.suffix}`;
  try {
    await f.membership(manager, a, "BUILDING_ADMIN");
    await f.membership(other, b, "BUILDING_ADMIN");
    await withFixtureDatabase(async sql => sql.begin(async tx => {
      await tx`insert into roles(key,scope,label) values(${role},'BUILDING','E2E exact audit reader')`;
      await tx`insert into role_permissions(role_key,permission_key) values(${role},'audit:read'),(${role},'buildings:read')`;
      await tx`insert into devices(id,building_id,name,type) values(${local},${a.id},'E2E audit target','WATER_LEVEL_SENSOR'),(${foreign},${b.id},'E2E foreign audit target','WATER_LEVEL_SENSOR')`;
      await tx`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${delegate.id},${a.id},${role},'device',${local})`;
      await tx`insert into audit_logs(building_id,action,resource_type,resource_id,metadata,ip_address,user_agent,created_at)
        values(${a.id},${local},'device',${local},'{"secret":"private payload"}','192.0.2.9','Confidential fixture',clock_timestamp()+interval '5 minutes'),
              (${b.id},${foreign},'device',${foreign},'{}',null,null,clock_timestamp()+interval '5 minutes'),
              (null,'USER_CREATED','user',${global},'{}',null,null,clock_timestamp()+interval '5 minutes'),
              (null,'DEVICE_UPDATED','device',${unknown},'{}',null,null,clock_timestamp()+interval '5 minutes')`;
    }));
    await run({ a, b, manager, other, delegate, role, local, foreign, global, unknown });
  } finally {
    await withFixtureDatabase(async sql => sql.begin(async tx => {
      await tx`delete from audit_logs where scope_building_id in (${a.id},${b.id}) or resource_id in (${global},${unknown}) or user_id in ${tx(users)} or (resource_type='user' and resource_id in ${tx(users)})`;
      await tx`delete from buildings where id in (${a.id},${b.id})`;
      await tx`delete from users where id in ${tx(users)}`;
      await tx`delete from roles where key=${role}`;
    }));
  }
}

async function openAudit(page: Page, origin: string, buildingId?: string) {
  const response = page.waitForResponse(r => {
    const url = new URL(r.url());
    return url.origin === API_URL && url.pathname === "/audit" && (!buildingId || url.searchParams.get("buildingId") === buildingId);
  });
  await page.goto(`${origin}/auditoria`);
  return response;
}
const renderedAction = (value: string) => value.replaceAll("_", " ");

async function observeAuditDelivery(page: Page, buildingId: string) {
  await page.evaluate(({ origin, buildingId }) => {
    const state = window as typeof window & { auditDelivery?: string[] };
    const original = window.fetch.bind(window);
    // After an identity change the client correctly rejects at the headers,
    // before reading JSON. Consume a clone in the harness so the test proves
    // delivery of the real old body without waiting for an unused stream.
    window.fetch = async (...args) => {
      const response = await original(...args);
      const url = new URL(response.url);
      if (url.origin === origin && url.pathname === "/audit" && url.searchParams.get("buildingId") === buildingId) {
        const body = await response.clone().json() as { items: { resourceId: string | null }[] };
        state.auditDelivery = body.items.flatMap(row => row.resourceId ? [row.resourceId] : []);
      }
      return response;
    };
  }, { origin: API_URL, buildingId });
  return async (resourceId: string) => {
    await expect.poll(() => page.evaluate(() => (window as typeof window & { auditDelivery?: string[] }).auditDelivery)).toContain(resourceId);
  };
}

test("auditoria global não inclui histórico local, desconhecido ou campos privados", async ({ page, request }, info) => withAuditFixture(request, async f => {
  await signIn(page, ADMIN_URL, "admin@predioon.local");
  const response = await openAudit(page, ADMIN_URL);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const data = await response.json() as AuditPage;
  expect(data.items.some(row => row.resourceId === f.global)).toBe(true);
  for (const row of data.items) {
    expect(row.scopeKind).toBe("PLATFORM");
    expect(Object.keys(row).sort()).toEqual(["id", "buildingId", "scopeKind", "userId", "actorType", "action", "resourceType", "resourceId", "createdAt"].sort());
  }
  for (const secret of [f.local, f.foreign, f.unknown, "private payload", "192.0.2.9", "Confidential fixture"]) {
    expect(JSON.stringify(data)).not.toContain(secret);
    await expect(page.locator("body")).not.toContainText(secret);
  }
  await expect(page.getByText(f.global, { exact: false })).toBeVisible();
  if (info.project.name === "chromium") await page.screenshot({ path: info.outputPath("audit-global.png"), fullPage: true });
}));

test("auditoria local pagina timestamps iguais sem repetir registros e atualiza a primeira página", async ({ page, request }, info) => withAuditFixture(request, async f => {
  const rows = Array.from({ length: 28 }, (_, i) => ({ id: randomUUID(), action: `AUDIT_PAGE_${f.a.id}_${i}` }));
  await withFixtureDatabase(async sql => {
    await sql`delete from audit_logs where scope_building_id=${f.a.id}`;
    const timestamp = new Date(Date.now() + 300_000).toISOString();
    for (const row of rows) await sql`insert into audit_logs(id,building_id,action,resource_type,resource_id,created_at) values(${row.id},${f.a.id},${row.action},'device',${f.local},${timestamp})`;
  });
  const expected = [...rows].sort((a, b) => b.id.localeCompare(a.id));
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, BUILDING_URL, f.manager.email);
  const first = await openAudit(page, BUILDING_URL, f.a.id);
  expect(first.status()).toBe(200);
  expect((await first.json() as AuditPage).items.map(row => row.id)).toEqual(expected.slice(0, 25).map(row => row.id));
  await expect(page.getByRole("article", { name: "Registro de auditoria" })).toHaveCount(25);
  const next = page.waitForResponse(r => new URL(r.url()).pathname === "/audit" && new URL(r.url()).searchParams.get("offset") === "25");
  await page.getByRole("button", { name: "Próxima página", exact: true }).click();
  const second = await next;
  expect(second.status()).toBe(200);
  expect((await second.json() as AuditPage).items.map(row => row.id)).toEqual(expected.slice(25).map(row => row.id));
  await expect(page.getByRole("article", { name: "Registro de auditoria" })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Próxima página", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Atualizar histórico", exact: true }).click();
  await expect(page.getByText("Página 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Registro de auditoria" })).toHaveCount(25);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (info.project.name === "chromium") await page.screenshot({ path: info.outputPath("audit-local.png"), fullPage: true });
}));

test("auditoria exata não lê o vizinho, remove dados após revogação e distingue vazio autorizado", async ({ page, request }) => withAuditFixture(request, async f => {
  await signIn(page, BUILDING_URL, f.delegate.email);
  const loaded = await openAudit(page, BUILDING_URL, f.a.id);
  expect(loaded.status()).toBe(200);
  expect((await loaded.json() as AuditPage).items.map(row => row.resourceId)).toEqual([f.local]);
  await expect(page.getByText(renderedAction(f.local), { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(f.foreign);
  await withFixtureDatabase(sql => sql`delete from role_permissions where role_key=${f.role} and permission_key='audit:read'`);
  const denied = page.waitForResponse(r => new URL(r.url()).pathname === "/audit");
  await page.getByRole("button", { name: "Atualizar histórico", exact: true }).click();
  expect((await denied).status()).toBe(403);
  await expect(page.getByRole("alert")).toContainText("Sem permissão");
  await expect(page.getByRole("article", { name: "Registro de auditoria" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(renderedAction(f.local));
  await withFixtureDatabase(async sql => sql.begin(async tx => {
    await tx`insert into role_permissions(role_key,permission_key) values(${f.role},'audit:read')`;
    await tx`delete from audit_logs where scope_building_id=${f.a.id}`;
  }));
  const retry = page.waitForResponse(r => new URL(r.url()).pathname === "/audit");
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  expect((await retry).status()).toBe(200);
  await expect(page.getByText("Nenhum registro disponível neste escopo.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
}));

test("auditoria recupera falha e descarta resposta atrasada ao trocar condomínio", async ({ page, request }) => withAuditFixture(request, async f => {
  await withFixtureDatabase(sql => sql`insert into memberships(user_id,building_id,role) values(${f.manager.id},${f.b.id},'BUILDING_ADMIN')`);
  await signIn(page, BUILDING_URL, f.manager.email);
  await page.getByLabel("Condomínio em uso", { exact: true }).selectOption(f.a.id);
  let fail = true, hold = false, release!: () => void, observed!: () => void;
  const held = new Promise<void>(resolve => { observed = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${API_URL}/audit?**`, async route => {
    if (new URL(route.request().url()).searchParams.get("buildingId") !== f.a.id) return route.continue();
    if (fail) { fail = false; return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Histórico temporariamente indisponível" } }) }); }
    if (!hold) return route.continue();
    hold = false;
    const actual = await route.fetch();
    observed();
    await barrier;
    await route.fulfill({ response: actual });
  });
  try {
    expect((await openAudit(page, BUILDING_URL, f.a.id)).status()).toBe(503);
    await expect(page.getByRole("button", { name: "Tentar novamente", exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Nenhum registro disponível");
    await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
    await expect(page.getByText(renderedAction(f.local), { exact: true })).toBeVisible();
    const delivered = await observeAuditDelivery(page, f.a.id);
    hold = true;
    await page.getByRole("button", { name: "Atualizar histórico", exact: true }).click();
    await held;
    await page.getByLabel("Condomínio em uso", { exact: true }).selectOption(f.b.id);
    await expect(page.getByText(renderedAction(f.foreign), { exact: true })).toBeVisible();
    release();
    await delivered(f.local);
    await expect(page.getByText(renderedAction(f.local), { exact: true })).toHaveCount(0);
    await expect(page.getByText(renderedAction(f.foreign), { exact: true })).toBeVisible();
  } finally { release(); }
}));

test("auditoria atrasada da conta anterior não aparece após sair e entrar com outra conta", async ({ page, request }) => withAuditFixture(request, async f => {
  await signIn(page, BUILDING_URL, f.manager.email);
  expect((await openAudit(page, BUILDING_URL, f.a.id)).status()).toBe(200);
  await expect(page.getByText(renderedAction(f.local), { exact: true })).toBeVisible();
  let release!: () => void, observed!: () => void, heldOnce = false;
  const held = new Promise<void>(resolve => { observed = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${API_URL}/audit?**`, async route => {
    if (heldOnce || new URL(route.request().url()).searchParams.get("buildingId") !== f.a.id) return route.continue();
    heldOnce = true;
    const actual = await route.fetch();
    observed();
    await barrier;
    await route.fulfill({ response: actual });
  });
  try {
    const delivered = await observeAuditDelivery(page, f.a.id);
    await page.getByRole("button", { name: "Atualizar histórico", exact: true }).click();
    await held;
    await signOut(page);
    // Stay in the same document: a full page.goto aborts the old response and
    // would never exercise an in-flight account change in the React provider.
    const nextAccount = page.waitForResponse(r => new URL(r.url()).pathname === "/audit" && new URL(r.url()).searchParams.get("buildingId") === f.b.id);
    await enterCredentials(page, f.other.email);
    expect((await nextAccount).status()).toBe(200);
    await expect(page.getByText(renderedAction(f.foreign), { exact: true })).toBeVisible();
    release();
    await delivered(f.local);
    await expect(page.getByText(renderedAction(f.local), { exact: true })).toHaveCount(0);
    await expect(page.getByText(renderedAction(f.foreign), { exact: true })).toBeVisible();
  } finally { release(); }
}));
