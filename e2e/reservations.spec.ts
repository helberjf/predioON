import { expect, test } from "@playwright/test";
import { API_URL, RESIDENT_URL } from "./environment";
import { authenticatedApi, isolatedTenant, signIn } from "./helpers";

test("reserva informa o estado real quando a gestão altera a aprovação com o formulário aberto", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const areaName = `Aprovação atual ${fixture.suffix}`;
  const area = await fixture.managerApi.create<{ id: string }>("/common-areas", {
    buildingId: fixture.building.id, name: areaName, requiresApproval: true, maxHoursPerBooking: 4,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, RESIDENT_URL, fixture.resident.email);
  await page.goto(`${RESIDENT_URL}/reservas`);

  for (const [index, requiresApproval] of [false, true].entries()) {
    if (index > 0) {
      // A navigation reloads the current area configuration before the next change.
      await page.goto(`${RESIDENT_URL}/reservas`);
    }
    await page.getByRole("button").filter({ has: page.getByRole("heading", { name: areaName, exact: true }) }).click();
    if (requiresApproval) {
      await expect(page.getByText("A reserva será enviada para aprovação da administração.", { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByText("A reserva será enviada para aprovação da administração.", { exact: true })).toBeVisible();
    }
    const configured = await fixture.managerApi.patch(`/common-areas/${area.id}`, { requiresApproval });
    expect(configured.status()).toBe(200);
    await page.getByLabel("Data", { exact: true }).fill(new Date(Date.now() + (20 + index) * 86_400_000).toISOString().slice(0, 10));
    await page.getByLabel("Início", { exact: true }).fill("12:00");
    await page.getByLabel("Duração (h)", { exact: true }).fill("2");
    await page.getByLabel("Unidade", { exact: true }).fill("101");
    const response = page.waitForResponse(response => response.url() === `${API_URL}/reservations` && response.request().method() === "POST");
    await page.getByRole("button", { name: "Confirmar reserva", exact: true }).click();
    const created = await response;
    expect(created.status()).toBe(201);
    expect((await created.json()).status).toBe(requiresApproval ? "PENDING" : "CONFIRMED");
    await expect(page.getByRole("status").filter({ hasText: /^Reserva / })).toHaveText(requiresApproval
      ? "Reserva enviada para aprovação da administração."
      : "Reserva confirmada com sucesso.");
    await expect(page.getByRole("listitem").filter({ hasText: areaName })).toHaveCount(index + 1);
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: areaName })).toHaveCount(index + 1);
  }
});

test("calendário mostra só ocupação, informa conflito real e atualiza após cancelamento", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  const areaName = `Ocupação ${fixture.suffix}`;
  const area = await fixture.managerApi.create<{ id: string }>("/common-areas", {
    buildingId: fixture.building.id, name: areaName, requiresApproval: false, maxHoursPerBooking: 4,
  });
  const neighbor = await fixture.person("Vizinho");
  await fixture.membership(neighbor, fixture.building, "RESIDENT");
  const neighborApi = await authenticatedApi(request, neighbor.email);
  const date = new Date(Date.now() + 25 * 86_400_000).toISOString().slice(0, 10);
  const secret = `Recado privado ${fixture.suffix}`;
  const booked = await neighborApi.create<{ id: string }>("/reservations", {
    areaId: area.id, startsAt: `${date}T13:00:00Z`, endsAt: `${date}T15:00:00Z`, unit: "VIZINHO-999", notes: secret,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, RESIDENT_URL, fixture.resident.email);
  await page.goto(`${RESIDENT_URL}/reservas`);
  await page.getByRole("button").filter({ has: page.getByRole("heading", { name: areaName, exact: true }) }).click();
  const calendarResponse = () => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/reservations/availability" && url.searchParams.get("areaId") === area.id;
  });
  const occupancy = calendarResponse();
  await page.getByLabel("Data", { exact: true }).fill(date);
  const loaded = await occupancy;
  expect(loaded.status()).toBe(200);
  const intervals = (await loaded.json()).items as Array<Record<string, unknown>>;
  expect(intervals).toHaveLength(1);
  expect(Object.keys(intervals[0]!).sort()).toEqual(["endsAt", "startsAt"]);
  const calendar = page.getByRole("region", { name: "Horários ocupados", exact: true });
  await expect(page.getByText("Horários no fuso America/Sao_Paulo.", { exact: true })).toBeVisible();
  await expect(calendar).toContainText("10:00");
  await expect(calendar).toContainText("12:00");
  for (const privateValue of [secret, "VIZINHO-999", neighbor.id, booked.id]) await expect(page.locator("body")).not.toContainText(privateValue);

  await page.getByLabel("Início", { exact: true }).fill("10:00");
  await page.getByLabel("Duração (h)", { exact: true }).fill("2");
  const conflict = page.waitForResponse(response => response.url() === `${API_URL}/reservations` && response.request().method() === "POST");
  const afterConflict = calendarResponse();
  await page.getByRole("button", { name: "Confirmar reserva", exact: true }).click();
  expect((await conflict).status()).toBe(409);
  await expect(page.getByRole("alert")).toContainText("Já existe uma reserva para esta área neste horário");
  expect((await afterConflict).status()).toBe(200);
  await expect(calendar.getByRole("button", { name: "Atualizar horários", exact: true })).toBeEnabled();

  expect((await neighborApi.delete(`/reservations/${booked.id}`)).status()).toBe(204);
  const refreshed = calendarResponse();
  await calendar.getByRole("button", { name: "Atualizar horários", exact: true }).click();
  expect((await refreshed).status()).toBe(200);
  await expect(calendar.getByText("Nenhum horário ocupado nesta data.", { exact: true })).toBeVisible();
  await expect(calendar.getByRole("listitem")).toHaveCount(0);
  const accepted = page.waitForResponse(response => response.url() === `${API_URL}/reservations` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Confirmar reserva", exact: true }).click();
  expect((await accepted).status()).toBe(201);
  await expect(page.getByRole("status").filter({ hasText: /^Reserva / })).toHaveText("Reserva confirmada com sucesso.");
  await expect(page.getByRole("listitem").filter({ hasText: areaName })).toContainText("Confirmada");
});
