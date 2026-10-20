import { randomUUID } from "node:crypto";
import { expect, test } from "../../support/fixtures";
import { API_URL, BUILDING_URL } from "../../support/environment";
import { withFixtureDatabase } from "../../support/database";
import { authenticatedApi, isolatedTenant, signIn } from "../../support/helpers";

// The ingest service is not part of the browser suite: readings are written by the owner role in
// the disposable database, exactly as the API tests do. Everything rendered still comes from
// /telemetry/latest under RLS. Rules: packages/ui/src/telemetry.ts (readingStatus, 15 minutes),
// packages/shared/src/sensors.ts (sensorReadingState) and the Water/Safety pages.
type Reading = { device: string; metric: string; value: number | boolean; minutesAgo?: number; quality?: "GOOD" | "UNCERTAIN" | "BAD" };

async function insertDevices(buildingId: string, devices: Array<{ id: string; name: string; type: string }>) {
  await withFixtureDatabase(sql => sql.begin(async tx => {
    for (const device of devices) await tx`insert into devices(id,building_id,name,type) values(${device.id},${buildingId},${device.name},${device.type})`;
  }));
}

// `::text::jsonb`: a parameter typed jsonb would be JSON-encoded again by postgres.js, turning
// `true` into the string "true", which the UI correctly treats as an unvalidated reading.
async function insertReadings(buildingId: string, readings: Reading[]) {
  await withFixtureDatabase(sql => sql.begin(async tx => {
    for (const reading of readings) {
      const numeric = typeof reading.value === "number" ? reading.value : null;
      await tx`insert into telemetry(time,event_id,building_id,device_id,metric,value,numeric_value,quality)
        values(now() - make_interval(mins => ${reading.minutesAgo ?? 0}), ${randomUUID()}, ${buildingId}, ${reading.device}, ${reading.metric},
          ${JSON.stringify(reading.value)}::text::jsonb, ${numeric}, ${reading.quality ?? "GOOD"})`;
    }
  }));
}

test("água: sem leitura não inventa nível; nível baixo só alerta com leitura recente", { tag: ["@critical", "@validation"] }, async ({ page, request }) => {
  const f = await isolatedTenant(request);
  const fresh = { id: `e2e-tank-a-${f.suffix}`, name: `A Caixa superior ${f.suffix}`, type: "WATER_LEVEL_SENSOR" };
  const stale = { id: `e2e-tank-b-${f.suffix}`, name: `B Caixa inferior ${f.suffix}`, type: "WATER_LEVEL_SENSOR" };
  await insertDevices(f.building.id, [fresh, stale]);

  await signIn(page, BUILDING_URL, f.manager.email);
  await page.getByRole("navigation", { name: "Menu principal", exact: true }).getByRole("link", { name: "Água e reservatórios", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Água e reservatórios", exact: true })).toBeVisible();
  const picker = page.getByLabel("Sensor de nível", { exact: true });
  await expect(picker).toHaveValue(fresh.id);
  // Registered but silent: the page says so instead of showing an empty or zero tank.
  await expect(page.getByText("Aguardando leitura do sensor", { exact: true })).toBeVisible();
  await expect(page.getByText("Nível abaixo de 20%", { exact: true })).toHaveCount(0);

  await insertReadings(f.building.id, [
    { device: fresh.id, metric: "water_level_percent", value: 15 },
    { device: stale.id, metric: "water_level_percent", value: 10, minutesAgo: 40 },
  ]);
  const reloaded = page.waitForResponse(response => response.url().startsWith(`${API_URL}/telemetry/latest`) && response.status() === 200);
  await page.getByRole("button", { name: "Atualizar leituras", exact: true }).click();
  await reloaded;
  await expect(page.getByText("Nível abaixo de 20%", { exact: true })).toBeVisible();
  await expect(page.getByText("Leitura recente", { exact: true }).first()).toBeVisible();

  // An older reading is lower still, but it no longer describes the tank: no low-level warning.
  await picker.selectOption({ label: stale.name });
  await expect(page.getByText("Leitura antiga", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Nível informado pelo sensor", { exact: true })).toBeVisible();
  await expect(page.getByText("Nível abaixo de 20%", { exact: true })).toHaveCount(0);
});

test("sensores: fumaça recente pede verificação, leitura não validada não vira alarme e o morador não lê telemetria", { tag: ["@critical", "@permissions"] }, async ({ page, request }) => {
  const f = await isolatedTenant(request);
  const panel = { id: `e2e-smoke-a-${f.suffix}`, name: `A Central térreo ${f.suffix}`, type: "SMOKE_PANEL_RELAY" };
  const doubtful = { id: `e2e-smoke-b-${f.suffix}`, name: `B Central cobertura ${f.suffix}`, type: "SMOKE_PANEL_RELAY" };
  await insertDevices(f.building.id, [panel, doubtful]);
  await insertReadings(f.building.id, [
    { device: panel.id, metric: "smoke_detected", value: true },
    { device: doubtful.id, metric: "smoke_detected", value: true, quality: "UNCERTAIN" },
  ]);

  await signIn(page, BUILDING_URL, f.manager.email);
  await page.getByRole("navigation", { name: "Menu principal", exact: true }).getByRole("link", { name: "Gás, fumaça e vazamentos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sensores e segurança", exact: true })).toBeVisible();
  const picker = page.getByLabel("Sensor · Central de incêndio", { exact: true });
  await expect(picker).toHaveValue(panel.id);
  await expect(page.getByText("Detecção ativa", { exact: true })).toBeVisible();
  await expect(page.getByText("Verifique o local e siga o procedimento do condomínio.", { exact: true })).toBeVisible();

  await picker.selectOption({ label: doubtful.name });
  await expect(page.getByText("Leitura não validada", { exact: true })).toBeVisible();
  await expect(page.getByText("Verifique o local e siga o procedimento do condomínio.", { exact: true })).toHaveCount(0);

  // Raw readings belong to the management: the resident of the same building is refused.
  const resident = await authenticatedApi(request, f.resident.email);
  const refused = await resident.get(`/telemetry/latest?buildingId=${encodeURIComponent(f.building.id)}`);
  expect(refused.status()).toBe(403);
});
