import { expect, test } from "@playwright/test";
import { API_URL, RESIDENT_URL } from "./environment";
import { isolatedTenant, signIn } from "./helpers";

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
