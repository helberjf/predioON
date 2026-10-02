import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { API_URL, BUILDING_URL, RESIDENT_URL } from "./environment";
import { isolatedTenant, signIn } from "./helpers";
import { withFixtureDatabase } from "./database";

async function parkingFixture(request: APIRequestContext) {
  const base = await isolatedTenant(request);
  const delegate = await base.person("VagasDelegadas");
  const roles: string[] = [];
  const device = await base.managerApi.create<{ id: string }>("/devices", {
    buildingId: base.building.id,
    name: "Contador de carros",
    type: "PARKING_SENSOR",
  });
  const car = await base.managerApi.create<{ id: string }>("/parking", {
    buildingId: base.building.id,
    vehicleType: "CAR",
    capacity: 20,
    sensorId: device.id,
  });
  const motorcycle = await base.managerApi.create<{ id: string }>("/parking", {
    buildingId: base.building.id,
    vehicleType: "MOTORCYCLE",
    capacity: 8,
  });
  const grant = async (
    permissions: string[],
    resource?: { type: string; id: string },
  ) => {
    const role = `E2E_PARKING_${randomUUID()}`;
    roles.push(role);
    await withFixtureDatabase(async (sql) =>
      sql.begin(async (tx) => {
        await tx`insert into roles(key,scope,label) values(${role},'BUILDING','Parking E2E')`;
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
  const cleanup = () =>
    withFixtureDatabase(async (sql) =>
      sql.begin(async (tx) => {
        await tx`delete from audit_logs where building_id=${base.building.id}`;
        await tx`delete from buildings where id=${base.building.id}`;
        await tx`delete from users where id in ${tx([base.manager.id, base.resident.id, delegate.id])}`;
        if (roles.length) await tx`delete from roles where key in ${tx(roles)}`;
      }),
    );
  return { ...base, delegate, device, car, motorcycle, grant, revoke, cleanup };
}
const card = (page: Page, label: "Carros" | "Motos") =>
  page
    .getByRole("heading", { name: label, exact: true })
    .locator("..")
    .locator("..");
async function openParking(page: Page, email: string, origin = BUILDING_URL) {
  await signIn(page, origin, email);
  const inventory: string[] = [];
  page.on("request", (request) => {
    if (["/devices", "/gateways"].includes(new URL(request.url()).pathname))
      inventory.push(request.url());
  });
  await page.goto(`${origin}/vagas`);
  await expect(
    page.getByRole("heading", { name: "Vagas disponíveis", exact: true }),
  ).toBeVisible();
  return inventory;
}

test("vagas: gestor do domínio cadastra e informa contagem sem acesso ao inventário", async ({
  page,
  request,
}) => {
  const f = await parkingFixture(request);
  try {
    await f.grant(["parking:read", "parking:manage"]);
    await withFixtureDatabase(async (sql) => {
      await sql`delete from parking_lots where id=${f.car.id}`;
    });
    const inventory = await openParking(page, f.delegate.email);
    await card(page, "Carros")
      .getByRole("button", { name: "Cadastrar capacidade", exact: true })
      .click();
    await card(page, "Carros")
      .getByLabel("Capacidade total", { exact: true })
      .fill("30");
    const created = page.waitForResponse(
      (response) =>
        response.url() === `${API_URL}/parking` &&
        response.request().method() === "POST",
    );
    await card(page, "Carros")
      .getByRole("button", { name: "Salvar", exact: true })
      .click();
    const response = await created;
    expect(response.status()).toBe(201);
    const lot = await response.json();
    expect(lot.sensorId).toBeNull();
    expect(lot.available).toBeNull();
    await card(page, "Carros")
      .getByRole("button", { name: "Informar ocupação", exact: true })
      .click();
    await card(page, "Carros")
      .getByLabel("Vagas ocupadas", { exact: true })
      .fill("7");
    const changed = page.waitForResponse(
      (response) =>
        response.url() === `${API_URL}/parking/${lot.id}/occupancy` &&
        response.request().method() === "PATCH",
    );
    await card(page, "Carros")
      .getByRole("button", { name: "Salvar", exact: true })
      .click();
    expect((await changed).status()).toBe(200);
    await expect(card(page, "Carros")).toContainText("23");
    await expect(card(page, "Carros")).toContainText("Atualização manual");
    expect(inventory).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

test("vagas: concessão exata preserva sensor atual e remove editor após revogação", async ({
  page,
  request,
}) => {
  const f = await parkingFixture(request);
  try {
    const role = await f.grant(["parking:read", "parking:manage"], {
      type: "parking",
      id: f.car.id,
    });
    await f.grant(["parking:read"], { type: "parking", id: f.motorcycle.id });
    const inventory = await openParking(page, f.delegate.email);
    await expect(
      card(page, "Motos").getByRole("button", {
        name: /^(Configurar|Informar ocupação)$/,
      }),
    ).toHaveCount(0);
    await card(page, "Carros")
      .getByRole("button", { name: "Configurar", exact: true })
      .click();
    const sensor = card(page, "Carros").getByLabel("Contagem automática", {
      exact: true,
    });
    await expect(sensor).toHaveValue(f.device.id);
    await expect(sensor.locator('option[value=""]')).toHaveCount(0);
    await card(page, "Carros")
      .getByLabel("Capacidade total", { exact: true })
      .fill("25");
    const changed = page.waitForResponse(
      (response) =>
        response.url() === `${API_URL}/parking/${f.car.id}` &&
        response.request().method() === "PATCH",
    );
    await card(page, "Carros")
      .getByRole("button", { name: "Salvar", exact: true })
      .click();
    const response = await changed;
    expect(response.status()).toBe(200);
    expect((await response.json()).sensorId).toBe(f.device.id);
    await card(page, "Carros")
      .getByRole("button", { name: "Configurar", exact: true })
      .click();
    await card(page, "Carros")
      .getByLabel("Capacidade total", { exact: true })
      .fill("999");
    await f.revoke(role, "parking:manage");
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect(
      card(page, "Carros").getByLabel("Capacidade total", { exact: true }),
    ).toHaveCount(0);
    await expect(
      card(page, "Carros").getByRole("button", {
        name: "Informar ocupação",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(inventory).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

test("vagas: leitura exata e gestão no sensor permitem contagem sem expor o vizinho ou promover cadastro", async ({
  page,
  request,
}) => {
  const f = await parkingFixture(request);
  try {
    await f.grant(["parking:manage"], {
      type: "device",
      id: f.device.id,
    });
    const readRole = await f.grant(["parking:read"], {
      type: "parking",
      id: f.car.id,
    });
    const inventory = await openParking(page, f.delegate.email);
    await expect(card(page, "Motos")).not.toContainText("Capacidade: 8");
    await expect(
      card(page, "Motos").getByRole("button", {
        name: "Cadastrar capacidade",
        exact: true,
      }),
    ).toHaveCount(0);
    await card(page, "Carros")
      .getByRole("button", { name: "Informar ocupação", exact: true })
      .click();
    await card(page, "Carros")
      .getByLabel("Vagas ocupadas", { exact: true })
      .fill("4");
    const changed = page.waitForResponse(
      (response) =>
        response.url() === `${API_URL}/parking/${f.car.id}/occupancy` &&
        response.request().method() === "PATCH",
    );
    await card(page, "Carros")
      .getByRole("button", { name: "Salvar", exact: true })
      .click();
    expect((await changed).status()).toBe(200);
    await expect(card(page, "Carros")).toContainText("Capacidade: 20");
    await f.revoke(readRole, "parking:read");
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect(card(page, "Carros")).not.toContainText("Capacidade: 20");
    await expect(
      card(page, "Carros").getByRole("button", {
        name: "Informar ocupação",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(inventory).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

test("vagas: morador vê informação desconhecida ou vencida sem transformar ausência em zero", async ({
  page,
  request,
}) => {
  const f = await parkingFixture(request);
  try {
    await f.managerApi.patch(`/parking/${f.car.id}/occupancy`, {
      occupied: 3,
      version: 1,
    });
    await withFixtureDatabase(async (sql) => {
      await sql`update parking_lots set observed_at=clock_timestamp()-interval '1 hour' where id=${f.car.id}`;
    });
    const inventory = await openParking(page, f.resident.email, RESIDENT_URL);
    await expect(card(page, "Carros")).toContainText("Desatualizado");
    await expect(card(page, "Carros")).toContainText(
      "Último registro: 3 ocupadas",
    );
    await expect(card(page, "Motos")).toContainText("Sem informação");
    await expect(
      page.getByRole("button", {
        name: /^(Configurar|Informar ocupação|Cadastrar capacidade)$/,
      }),
    ).toHaveCount(0);
    expect(inventory).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

test("vagas: refresh preserva rascunho e conflito de versão não reenvia a alteração", async ({
  page,
  request,
}) => {
  const f = await parkingFixture(request);
  try {
    await f.grant(["parking:read", "parking:manage"]);
    const inventory = await openParking(page, f.delegate.email);
    await card(page, "Carros")
      .getByRole("button", { name: "Configurar", exact: true })
      .click();
    const capacity = card(page, "Carros").getByLabel("Capacidade total", {
      exact: true,
    });
    await capacity.fill("25");
    const refreshed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/parking" &&
        response.request().method() === "GET",
    );
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    expect((await refreshed).status()).toBe(200);
    await expect(capacity).toHaveValue("25");
    await withFixtureDatabase(async (sql) => {
      await sql`update parking_lots set capacity=22, version=version+1, updated_at=clock_timestamp() where id=${f.car.id}`;
    });
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        request.url() === `${API_URL}/parking/${f.car.id}` &&
        request.method() === "PATCH"
      )
        writes.push(request.postData() ?? "");
    });
    const changed = page.waitForResponse(
      (response) =>
        response.url() === `${API_URL}/parking/${f.car.id}` &&
        response.request().method() === "PATCH",
    );
    await card(page, "Carros")
      .getByRole("button", { name: "Salvar", exact: true })
      .click();
    expect((await changed).status()).toBe(409);
    await expect(capacity).toHaveCount(0);
    await expect(card(page, "Carros")).toContainText("Capacidade: 22");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!)).toMatchObject({ capacity: 25, version: 1 });
    expect(inventory).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

test("vagas: substituição do registro descarta rascunho da identidade anterior", async ({
  page,
  request,
}) => {
  const f = await parkingFixture(request);
  try {
    await f.grant(["parking:read", "parking:manage"]);
    const inventory = await openParking(page, f.delegate.email);
    await card(page, "Carros")
      .getByRole("button", { name: "Configurar", exact: true })
      .click();
    const capacity = card(page, "Carros").getByLabel("Capacidade total", {
      exact: true,
    });
    await capacity.fill("999");
    await withFixtureDatabase(async (sql) => {
      await sql`delete from parking_lots where id=${f.car.id}`;
    });
    const replacement = await f.managerApi.create<{
      id: string;
      version: number;
    }>("/parking", {
      buildingId: f.building.id,
      vehicleType: "CAR",
      capacity: 33,
      sensorId: f.device.id,
    });
    expect(replacement.id).not.toBe(f.car.id);
    expect(replacement.version).toBe(1);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname.startsWith("/parking/") &&
        request.method() === "PATCH"
      )
        writes.push(request.url());
    });
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect(card(page, "Carros")).toContainText("Capacidade: 33");
    await expect(capacity).toHaveCount(0);
    await card(page, "Carros")
      .getByRole("button", { name: "Configurar", exact: true })
      .click();
    await expect(capacity).toHaveValue("33");
    expect(writes).toEqual([]);
    expect(inventory).toEqual([]);
  } finally {
    await f.cleanup();
  }
});
