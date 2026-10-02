import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "./fixtures";
import { API_URL, BUILDING_URL } from "./environment";
import { isolatedTenant, signIn } from "./helpers";
import { withFixtureDatabase } from "./database";

async function rulesFixture(
  request: APIRequestContext,
  run: (
    f: Awaited<ReturnType<typeof isolatedTenant>> & {
      delegate: { id: string; email: string };
      first: { id: string; name: string };
      second: { id: string; name: string };
      hidden: { id: string; name: string };
      device: { id: string };
      grant: (
        permissions: string[],
        resource?: { type: string; id: string },
      ) => Promise<string>;
      revoke: (role: string, capability: string) => Promise<void>;
    },
  ) => Promise<void>,
) {
  const base = await isolatedTenant(request),
    delegate = await base.person("RegrasDelegadas"),
    roles: string[] = [];
  try {
    const device = await base.managerApi.create<{ id: string }>("/devices", {
      buildingId: base.building.id,
      name: "Reservatório local",
      type: "WATER_LEVEL_SENSOR",
    });
    const create = (label: string, deviceId: string | null) =>
      base.managerApi.create<{ id: string; name: string }>("/alert-rules", {
        buildingId: base.building.id,
        deviceId,
        name: `${label} ${base.suffix}`,
        metric: "water_level_percent",
        operator: "LT",
        threshold: 20,
        severity: "CRITICAL",
        alertType: "WATER_LOW",
        messageTemplate: "Água baixa {value}",
        cooldownSeconds: 123,
      });
    const first = await create("Regra gerenciável", device.id),
      second = await create("Regra de consulta", device.id),
      hidden = await create("Regra geral privada", null);
    const grant = async (
      permissions: string[],
      resource?: { type: string; id: string },
    ) => {
      const role = `E2E_RULE_${randomUUID()}`;
      roles.push(role);
      await withFixtureDatabase(async (sql) =>
        sql.begin(async (tx) => {
          await tx`insert into roles(key,scope,label) values(${role},'BUILDING','Rules E2E')`;
          for (const permission of new Set(["buildings:read", ...permissions]))
            await tx`insert into role_permissions(role_key,permission_key) values(${role},${permission})`;
          await tx`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${delegate.id},${base.building.id},${role},${resource?.type ?? null},${resource?.id ?? null})`;
        }),
      );
      return role;
    };
    const revoke = (role: string, capability: string) =>
      withFixtureDatabase(async (sql) => {
        await sql`delete from role_permissions where role_key=${role} and permission_key=${capability}`;
      });
    await run({
      ...base,
      delegate,
      first,
      second,
      hidden,
      device,
      grant,
      revoke,
    });
  } finally {
    await withFixtureDatabase(async (sql) =>
      sql.begin(async (tx) => {
        await tx`delete from audit_logs where building_id=${base.building.id}`;
        await tx`delete from buildings where id=${base.building.id}`;
        await tx`delete from users where id in ${tx([base.manager.id, base.resident.id, delegate.id])}`;
        if (roles.length) await tx`delete from roles where key in ${tx(roles)}`;
      }),
    );
  }
}
const row = (page: Page, name: string) =>
  page
    .getByRole("listitem")
    .filter({ has: page.getByText(name, { exact: true }) });
async function openRules(page: Page, email: string) {
  await signIn(page, BUILDING_URL, email);
  const inventory: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/devices")
      inventory.push(request.url());
  });
  await page.goto(`${BUILDING_URL}/regras`);
  return inventory;
}

test("regras: gestor do domínio cria sem inventário nem devices:configure", async ({
  page,
  request,
}) =>
  rulesFixture(request, async (f) => {
    await f.grant(["alert-rules:read", "alert-rules:manage"]);
    const inventory = await openRules(page, f.delegate.email);
    await expect(
      page.getByRole("button", { name: "Criar regra", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Nome", { exact: true })
      .fill(`Nova regra sem inventário ${f.suffix}`);
    await page
      .getByLabel("Métrica", { exact: true })
      .fill("water_level_percent");
    await page
      .getByRole("button", { name: "Atualizar regras", exact: true })
      .click();
    await expect(page.getByLabel("Nome", { exact: true })).toHaveValue(
      `Nova regra sem inventário ${f.suffix}`,
    );
    const created = page.waitForResponse(
      (response) =>
        response.url() === `${API_URL}/alert-rules` &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Criar regra", exact: true })
      .click();
    const response = await created;
    expect(response.status()).toBe(201);
    expect((await response.json()).deviceId).toBeNull();
    await expect(
      page.getByText(`Nova regra sem inventário ${f.suffix}`, { exact: true }),
    ).toBeVisible();
    expect(inventory).toEqual([]);
  }));

test("regras: permissões exatas separam leitura de ação e desaparecem após revogação", async ({
  page,
  request,
}) =>
  rulesFixture(request, async (f) => {
    const manager = await f.grant(["alert-rules:read", "alert-rules:manage"], {
      type: "alert_rule",
      id: f.first.id,
    });
    await f.grant(["alert-rules:read"], {
      type: "alert_rule",
      id: f.second.id,
    });
    const inventory = await openRules(page, f.delegate.email);
    await row(page, f.first.name)
      .getByRole("button", { name: "Ver ações desta regra", exact: true })
      .click();
    await expect(
      row(page, f.first.name).getByRole("button", {
        name: "Desativar",
        exact: true,
      }),
    ).toBeVisible();
    await expect(row(page, f.second.name)).toBeVisible();
    await row(page, f.second.name)
      .getByRole("button", { name: "Ver ações desta regra", exact: true })
      .click();
    await expect(row(page, f.second.name)).toContainText(
      "Esta regra está disponível para consulta.",
    );
    await expect(
      row(page, f.second.name).getByRole("button", {
        name: /^(Ativar|Desativar)$/,
      }),
    ).toHaveCount(0);
    await expect(page.getByText(f.hidden.name, { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Criar regra", exact: true }),
    ).toHaveCount(0);
    await row(page, f.first.name)
      .getByRole("button", { name: "Ver ações desta regra", exact: true })
      .click();
    const changed = page.waitForResponse(
      (response) =>
        response.url() === `${API_URL}/alert-rules/${f.first.id}` &&
        response.request().method() === "PATCH",
    );
    await row(page, f.first.name)
      .getByRole("button", { name: "Desativar", exact: true })
      .click();
    const response = await changed;
    expect(response.status()).toBe(200);
    const rule = await response.json();
    expect(rule.enabled).toBe(false);
    expect(rule.severity).toBe("CRITICAL");
    expect(rule.cooldownSeconds).toBe(123);
    await f.revoke(manager, "alert-rules:manage");
    await page
      .getByRole("button", { name: "Atualizar regras", exact: true })
      .click();
    await expect(
      row(page, f.first.name).getByRole("button", {
        name: /^(Ativar|Desativar)$/,
      }),
    ).toHaveCount(0);
    await f.revoke(manager, "alert-rules:read");
    await page
      .getByRole("button", { name: "Atualizar regras", exact: true })
      .click();
    await expect(page.getByText(f.first.name, { exact: true })).toHaveCount(0);
    await expect(row(page, f.second.name)).toBeVisible();
    expect(inventory).toEqual([]);
  }));

test("regras: concessão do equipamento atua e cria apenas no próprio pai sem inventário", async ({
  page,
  request,
}) =>
  rulesFixture(request, async (f) => {
    const role = await f.grant(["alert-rules:read", "alert-rules:manage"], {
      type: "device",
      id: f.device.id,
    });
    const inventory = await openRules(page, f.delegate.email);
    await row(page, f.first.name)
      .getByRole("button", { name: "Ver ações desta regra", exact: true })
      .click();
    await expect(
      row(page, f.first.name).getByRole("button", {
        name: "Desativar",
        exact: true,
      }),
    ).toBeVisible();
    await expect(row(page, f.second.name)).toBeVisible();
    await expect(page.getByText(f.hidden.name, { exact: true })).toHaveCount(0);
    await row(page, f.first.name)
      .getByRole("button", {
        name: "Nova regra neste equipamento",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Nome", { exact: true })
      .fill(`Regra no equipamento ${f.suffix}`);
    await page
      .getByLabel("Métrica", { exact: true })
      .fill("water_level_percent");
    await expect(
      page.getByRole("option", { name: "Todos do prédio", exact: true }),
    ).toHaveCount(0);
    const created = page.waitForResponse(
      (response) =>
        response.url() === `${API_URL}/alert-rules` &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Criar regra", exact: true })
      .click();
    const response = await created;
    expect(response.status()).toBe(201);
    expect((await response.json()).deviceId).toBe(f.device.id);
    await f.revoke(role, "alert-rules:manage");
    await page
      .getByRole("button", { name: "Atualizar regras", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Criar regra", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Nova regra neste equipamento",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Nome", { exact: true })).toHaveCount(0);
    expect(inventory).toEqual([]);
  }));

test("regras: configuração de equipamento não concede gestão de regras", async ({
  page,
  request,
}) =>
  rulesFixture(request, async (f) => {
    await f.grant(["devices:read", "devices:configure"]);
    await openRules(page, f.delegate.email);
    await expect(
      page.getByRole("heading", { name: "Regras de alerta", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Criar regra", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(f.first.name, { exact: true })).toHaveCount(0);
  }));
