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

async function accessFixture(request: APIRequestContext) {
  const base = await isolatedTenant(request),
    delegate = await base.person("AcessoDelegado");
  const roles: string[] = [];
  const gateway = await base.managerApi.create<{ id: string }>("/gateways", {
    buildingId: base.building.id,
    name: "Gateway dos portões",
    serialNumber: `E2E-ACCESS-${randomUUID()}`,
  });
  async function gate(name: string) {
    const device = await base.managerApi.create<{ id: string }>("/devices", {
      buildingId: base.building.id,
      gatewayId: gateway.id,
      name: `Controlador ${name}`,
      type: "GATE_CONTROLLER",
    });
    const gate = await base.managerApi.create<{ id: string }>("/access", {
      buildingId: base.building.id,
      gatewayId: gateway.id,
      deviceId: device.id,
      name,
      kind: "GARAGE",
      enabled: true,
      allowResidents: true,
    });
    await withFixtureDatabase(async (sql) => {
      await sql`update gateways set enabled=true,status='ONLINE',last_seen_at=clock_timestamp() where id=${gateway.id}`;
      await sql`update devices set enabled=true,status='ONLINE',last_seen_at=clock_timestamp() where id=${device.id}`;
    });
    return { ...gate, deviceId: device.id };
  }
  const main = await gate("Portão autorizado"),
    hidden = await gate("Portão reservado");
  async function grant(capabilities: string[]) {
    const role = `E2E_ACCESS_${randomUUID()}`;
    roles.push(role);
    await withFixtureDatabase((sql) =>
      sql.begin(async (tx) => {
        await tx`insert into roles(key,scope,label) values(${role},'BUILDING','Physical access E2E')`;
        for (const capability of new Set(["buildings:read", ...capabilities]))
          await tx`insert into role_permissions(role_key,permission_key) values(${role},${capability})`;
        await tx`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${delegate.id},${base.building.id},${role},'gate',${main.id})`;
      }),
    );
    return role;
  }
  const cleanup = () =>
    withFixtureDatabase((sql) =>
      sql.begin(async (tx) => {
        await tx`delete from gate_commands where building_id=${base.building.id}`;
        await tx`delete from audit_logs where building_id=${base.building.id}`;
        await tx`delete from buildings where id=${base.building.id}`;
        await tx`delete from users where id in ${tx([base.manager.id, base.resident.id, delegate.id])}`;
        if (roles.length) await tx`delete from roles where key in ${tx(roles)}`;
      }),
    );
  const commands = () =>
    withFixtureDatabase(
      (sql) =>
        sql`select id,request_id,status from gate_commands where building_id=${base.building.id}`,
    );
  return { ...base, delegate, gateway, main, hidden, grant, cleanup, commands };
}
async function enter(page: Page, email: string) {
  await signIn(page, BUILDING_URL, email);
  await page.goto(`${BUILDING_URL}/acessos`);
  await expect(
    page.getByRole("heading", { name: "Portão autorizado", exact: true }),
  ).toBeVisible();
}
const mainCard = (page: Page) =>
  page
    .getByRole("heading", { name: "Portão autorizado", exact: true })
    .locator("xpath=ancestor::section[1]");
async function explicitOpen(page: Page) {
  await mainCard(page)
    .getByRole("button", { name: /Abrir garagem|Reenviar mesma solicitação/ })
    .click();
  // This compatibility branch lets the RED fixture reach the lost-response bug
  // in the old one-click UI. A separate test requires the new confirmation.
  if (await page.getByRole("dialog").count())
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Confirmar (abertura|reenvio)$/ })
      .click();
}

test("acesso: concessão exata configura o gate sem inventário e revogação fecha o editor", async ({
  page,
  request,
}) => {
  const f = await accessFixture(request);
  try {
    const role = await f.grant(["gates:read", "gates:manage"]);
    const inventory: string[] = [];
    page.on("request", (r) => {
      if (["/devices", "/gateways"].includes(new URL(r.url()).pathname))
        inventory.push(r.url());
    });
    await enter(page, f.delegate.email);
    await expect(
      page.getByText("Portão reservado", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Cadastrar acesso", exact: true }),
    ).toHaveCount(0);
    await mainCard(page)
      .getByRole("button", { name: "Configurar", exact: true })
      .click();
    await page.getByLabel("Nome", { exact: true }).fill("Portão revisado");
    const saved = page.waitForResponse(
      (r) =>
        r.url() === `${API_URL}/access/${f.main.id}` &&
        r.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Salvar acesso", exact: true })
      .click();
    expect((await saved).status()).toBe(200);
    const stored = await f.managerApi.get(
      `/access?buildingId=${f.building.id}`,
    );
    expect(
      (await stored.json()).items.find((gate: any) => gate.id === f.main.id)
        .name,
    ).toBe("Portão revisado");
    await page
      .getByRole("heading", { name: "Portão revisado", exact: true })
      .locator("xpath=ancestor::section[1]")
      .getByRole("button", { name: "Configurar", exact: true })
      .click();
    await withFixtureDatabase(
      (sql) =>
        sql`delete from role_permissions where role_key=${role} and permission_key='gates:manage'`,
    );
    await expect(
      page.getByRole("button", { name: "Salvar acesso", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Configurar", exact: true }),
    ).toHaveCount(0);
    expect(inventory).toEqual([]);
    expect(await f.commands()).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});

test("acesso: leitura não abre e request exige confirmação explícita antes de uma única intenção", async ({
  page,
  request,
}) => {
  const f = await accessFixture(request);
  try {
    const role = await f.grant(["gates:read"]);
    await enter(page, f.delegate.email);
    await expect(
      mainCard(page).getByRole("button", {
        name: "Abrir garagem",
        exact: true,
      }),
    ).toBeDisabled();
    await withFixtureDatabase(
      (sql) =>
        sql`insert into role_permissions(role_key,permission_key) values(${role},'commands:request')`,
    );
    await expect(
      mainCard(page).getByRole("button", {
        name: "Abrir garagem",
        exact: true,
      }),
    ).toBeEnabled();
    await mainCard(page)
      .getByRole("button", { name: "Abrir garagem", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Solicitar abertura de Portão autorizado?",
    });
    await expect(dialog).toBeVisible();
    expect(await f.commands()).toHaveLength(0);
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    expect(await f.commands()).toHaveLength(0);
    await mainCard(page)
      .getByRole("button", { name: "Abrir garagem", exact: true })
      .click();
    const accepted = page.waitForResponse(
      (r) =>
        r.url() === `${API_URL}/access/${f.main.id}/open` &&
        r.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "Confirmar abertura", exact: true })
      .click();
    expect((await accepted).status()).toBe(202);
    expect(await f.commands()).toHaveLength(1);
    await expect(
      page.getByText("Aguardando envio", { exact: true }),
    ).toBeVisible();
  } finally {
    await f.cleanup();
  }
});

test("acesso: resposta perdida conserva a identificação após navegação e não reenvia automaticamente", async ({
  page,
  request,
}) => {
  const f = await accessFixture(request);
  try {
    await f.grant(["gates:read", "commands:request"]);
    await enter(page, f.delegate.email);
    const requestIds: string[] = [];
    let received!: () => void;
    const firstReceived = new Promise<void>((r) => {
      received = r;
    });
    await page.route(`${API_URL}/access/${f.main.id}/open`, async (route) => {
      requestIds.push(route.request().postDataJSON().requestId);
      if (requestIds.length === 1) {
        const response = await route.fetch();
        expect(response.status()).toBe(202);
        await route.abort("failed");
        received();
      } else await route.continue();
    });
    await explicitOpen(page);
    await firstReceived;
    await page.getByRole("link", { name: "Início", exact: true }).click();
    await page
      .getByRole("link", { name: "Portões e acessos", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Portão autorizado", exact: true }),
    ).toBeVisible();
    expect(requestIds).toHaveLength(1);
    expect(await f.commands()).toHaveLength(1);
    const repeated = page.waitForResponse(
      (r) =>
        r.url() === `${API_URL}/access/${f.main.id}/open` &&
        r.request().method() === "POST",
    );
    await explicitOpen(page);
    const response = await repeated;
    expect(requestIds).toEqual([requestIds[0], requestIds[0]]);
    expect(
      response.status(),
      "repeat cannot bypass the independently absent history grant",
    ).toBe(403);
    expect(await f.commands()).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
});

test("acesso: abandonar a tela durante a nova leitura cancela o POST físico", async ({
  page,
  request,
}) => {
  const f = await accessFixture(request);
  let release!: () => void;
  try {
    await f.grant(["gates:read", "commands:request"]);
    await enter(page, f.delegate.email);
    const held = new Promise<void>((r) => {
      release = r;
    });
    let caught!: () => void;
    const pending = new Promise<void>((r) => {
      caught = r;
    });
    let armed = false;
    const posts: string[] = [];
    page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        r.url().endsWith(`/access/${f.main.id}/open`)
      )
        posts.push(r.url());
    });
    await page.route(
      `${API_URL}/access?buildingId=${f.building.id}`,
      async (route) => {
        if (armed) {
          armed = false;
          caught();
          await held;
        }
        await route.continue();
      },
    );
    await mainCard(page)
      .getByRole("button", { name: "Abrir garagem", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Solicitar abertura de Portão autorizado?",
    });
    await expect(dialog).toBeVisible();
    armed = true;
    await dialog
      .getByRole("button", { name: "Confirmar abertura", exact: true })
      .click();
    await pending;
    await page.getByRole("link", { name: "Início", exact: true }).click();
    release();
    await expect(
      page.getByRole("heading", { name: "Acessos", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("link", { name: "Portões e acessos", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Portão autorizado", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/A confirmação foi cancelada ao sair da tela/),
    ).toBeVisible();
    expect(posts).toEqual([]);
    expect(await f.commands()).toHaveLength(0);
  } finally {
    release?.();
    await f.cleanup();
  }
});

for (const transition of ["background", "logout"] as const) {
  test(`acesso: ${transition} invalida o preflight mesmo após retornar à sessão/tela`, async ({
    page,
    request,
  }) => {
    const f = await accessFixture(request);
    let release!: () => void;
    try {
      await f.grant(["gates:read", "commands:request"]);
      await enter(page, f.delegate.email);
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let caught!: () => void;
      const pending = new Promise<void>((resolve) => {
        caught = resolve;
      });
      let armed = false;
      const posts: string[] = [];
      page.on("request", (r) => {
        if (
          r.method() === "POST" &&
          r.url().endsWith(`/access/${f.main.id}/open`)
        )
          posts.push(r.url());
      });
      await page.route(
        `${API_URL}/access?buildingId=${f.building.id}`,
        async (route) => {
          if (!armed) {
            await route.continue();
            return;
          }
          // Hold an already-authorized response. Every concurrent poll is held
          // too, so a timer cannot consume the barrier intended for preflight.
          const response = await route.fetch();
          caught();
          await held;
          await route.fulfill({ response });
        },
      );
      await mainCard(page)
        .getByRole("button", { name: "Abrir garagem", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Solicitar abertura de Portão autorizado?",
      });
      await expect(dialog).toBeVisible();
      armed = true;
      await dialog
        .getByRole("button", { name: "Confirmar abertura", exact: true })
        .click();
      await pending;
      if (transition === "background") {
        // Explicit lifecycle simulation is deterministic across headless
        // engines; it verifies the browser event contract, not OS suspension.
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => "hidden",
          });
          document.dispatchEvent(new Event("visibilitychange"));
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => "visible",
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        armed = false;
        release();
        await expect(
          page.getByText(/A confirmação foi cancelada ao sair da tela/),
        ).toBeVisible();
      } else {
        const logout = page.waitForResponse(
          (r) => r.url() === `${API_URL}/auth/web/logout`,
        );
        await page
          .getByRole("button", { name: "Sair da conta", exact: true })
          .click();
        expect((await logout).status()).toBe(204);
        armed = false;
        release();
        await enter(page, f.delegate.email);
        await expect(
          mainCard(page).getByRole("button", {
            name: "Abrir garagem",
            exact: true,
          }),
        ).toBeEnabled();
        await expect(
          page.getByRole("button", {
            name: "Reenviar mesma solicitação",
            exact: true,
          }),
        ).toHaveCount(0);
      }
      expect(posts).toEqual([]);
      expect(await f.commands()).toHaveLength(0);
    } finally {
      release?.();
      await f.cleanup();
    }
  });
}

test("acesso: background cancela também a configuração ainda em preflight", async ({
  page,
  request,
}) => {
  const f = await accessFixture(request);
  let release!: () => void;
  try {
    await f.grant(["gates:read", "gates:manage"]);
    await enter(page, f.delegate.email);
    await mainCard(page)
      .getByRole("button", { name: "Configurar", exact: true })
      .click();
    await page.getByLabel("Nome", { exact: true }).fill("Não deve ser salvo");
    // Arm the network barrier only after the real form submission. Holding a
    // preceding poll would disable Save and prevent the scenario from starting.
    await page.getByRole("button", { name: "Salvar acesso", exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).form!.addEventListener("submit", () => {
        document.documentElement.dataset.accessSubmitObserved = "true";
      }, { once: true });
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let caught!: () => void;
    const pending = new Promise<void>((resolve) => {
      caught = resolve;
    });
    let armed = true;
    const writes: string[] = [];
    page.on("request", (r) => {
      if (
        r.method() === "PATCH" &&
        r.url() === `${API_URL}/access/${f.main.id}`
      )
        writes.push(r.url());
    });
    await page.route(
      `${API_URL}/access?buildingId=${f.building.id}`,
      async (route) => {
        if (!armed || !await page.evaluate(() => document.documentElement.dataset.accessSubmitObserved === "true")) {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        caught();
        await held;
        await route.fulfill({ response });
      },
    );
    await page
      .getByRole("button", { name: "Salvar acesso", exact: true })
      .click();
    await pending;
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    armed = false;
    release();
    await expect(
      page.getByText(/A configuração foi cancelada ao sair da tela/),
    ).toBeVisible();
    const response = await f.managerApi.get(
      `/access?buildingId=${f.building.id}`,
    );
    expect(
      (await response.json()).items.find((gate: any) => gate.id === f.main.id)
        .name,
    ).toBe("Portão autorizado");
    expect(writes).toEqual([]);
    expect(await f.commands()).toHaveLength(0);
  } finally {
    release?.();
    await f.cleanup();
  }
});
