import { expect, test } from "@playwright/test";
import { API_URL, BUILDING_URL } from "./environment";
import { authenticatedApi, isolatedTenant, signIn } from "./helpers";
import { withFixtureDatabase } from "./database";

test("chamado URGENT preserva gravidade ao salvar andamento e exige motivo para alteração explícita", async ({ page, request }) => {
  const fixture = await isolatedTenant(request);
  try {
    const resident = await authenticatedApi(request, fixture.resident.email);
    const ticket = await resident.create<{ id: string; title: string }>("/occurrences", {
      buildingId: fixture.building.id, title: `Chamado legado ${fixture.suffix}`,
      description: "Gravidade registrada por uma versão anterior", category: "GENERAL",
    });
    // The current creation contract no longer offers URGENT; reproduce only our legacy row.
    await withFixtureDatabase(async sql => {
      await sql`update occurrences set priority='URGENT' where id=${ticket.id} and building_id=${fixture.building.id}`;
    });
    await signIn(page, BUILDING_URL, fixture.manager.email);
    await page.goto(`${BUILDING_URL}/chamados`);
    const row = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: ticket.title, exact: true }) });
    await row.getByRole("button", { name: "Ver histórico e responder", exact: true }).click();
    const priority = page.getByLabel("Alterar gravidade", { exact: true });
    const reason = page.getByLabel("Motivo da classificação de gravidade", { exact: true });
    const save = page.getByRole("button", { name: "Salvar andamento", exact: true });
    await expect(priority).toHaveValue("HIGH");
    await expect(reason).toHaveCount(0);
    await page.getByLabel("Situação do chamado", { exact: true }).selectOption("IN_PROGRESS");
    await expect(save).toBeEnabled();
    const progressed = page.waitForResponse(response => response.url() === `${API_URL}/occurrences/${ticket.id}` && response.request().method() === "PATCH");
    await save.click();
    const statusResponse = await progressed;
    expect(statusResponse.status()).toBe(200);
    const statusBody = statusResponse.request().postDataJSON();
    expect(statusBody).toMatchObject({ status: "IN_PROGRESS" });
    expect(statusBody).not.toHaveProperty("priority");
    expect(statusBody).not.toHaveProperty("priorityReason");
    expect(await statusResponse.json()).toMatchObject({ status: "IN_PROGRESS", priority: "URGENT" });
    const detail = await (await fixture.managerApi.get(`/occurrences/${ticket.id}`)).json();
    expect(detail.timeline.filter((event: { kind: string }) => event.kind === "PRIORITY_CHANGED")).toEqual([]);

    await priority.selectOption("LOW");
    await expect(reason).toBeVisible();
    await expect(save).toBeDisabled();
    expect((await fixture.managerApi.patch(`/occurrences/${ticket.id}`, { priority: "LOW" })).status()).toBe(400);
    await reason.fill("Vistoria confirmou baixa gravidade");
    const reclassified = page.waitForResponse(response => response.url() === `${API_URL}/occurrences/${ticket.id}` && response.request().method() === "PATCH");
    await save.click();
    const priorityResponse = await reclassified;
    expect(priorityResponse.status()).toBe(200);
    expect(priorityResponse.request().postDataJSON()).toMatchObject({ priority: "LOW", priorityReason: "Vistoria confirmou baixa gravidade" });
    expect(await priorityResponse.json()).toMatchObject({ status: "IN_PROGRESS", priority: "LOW" });
    await page.reload();
    await row.getByRole("button", { name: "Ver histórico e responder", exact: true }).click();
    await expect(priority).toHaveValue("LOW");
    await expect(reason).toHaveCount(0);
    await expect(row.getByText("Vistoria confirmou baixa gravidade", { exact: true })).toBeVisible();
  } finally {
    await withFixtureDatabase(async sql => sql.begin(async tx => {
      await tx`delete from audit_logs where building_id=${fixture.building.id}`;
      await tx`delete from buildings where id=${fixture.building.id}`;
      await tx`delete from users where id in ${tx([fixture.manager.id, fixture.resident.id])}`;
    }));
  }
});
