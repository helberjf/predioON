// Scenario control for the demonstration field simulator (062). Only GET /
// exists everywhere (it says whether the mode is on); the rest needs DEMO_SCENARIOS=on.
import { Router } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { DEMO_SCENARIOS, DEMO_SCENARIO_LABELS, type DemoScenarioState } from "@predioon/shared";
import { assertGlobalCapability, inTenantContext } from "../../auth/middleware.js";
import { config } from "../../config.js";
import { badRequest, notFound, pgErrorCode } from "../../http/errors.js";
import { param } from "../../http/params.js";

export const demoRouter = Router();
demoRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
const ScenarioBody = z.object({ scenario: z.enum(DEMO_SCENARIOS) }).strict();
const BuildingId = z.string().min(1).max(128);

demoRouter.get("/", (_req, res) => { res.json({ enabled: config.demoScenarios }); });
demoRouter.use((_req, _res, next) => { next(config.demoScenarios ? undefined : notFound()); });

demoRouter.get("/scenarios/:buildingId", async (req, res) => {
  const buildingId = BuildingId.parse(param(req, "buildingId"));
  const state = await inTenantContext(req, async (tx) => {
    await assertGlobalCapability(tx, "features:manage");
    const [row] = await tx.execute(sql`select scenario, updated_at from demo_scenarios where building_id=${buildingId}`);
    return { buildingId, scenario: (row?.scenario as DemoScenarioState["scenario"]) ?? "normal",
      updatedAt: row ? new Date(row.updated_at as string).toISOString() : null } satisfies DemoScenarioState;
  });
  res.json({ ...state, scenarios: DEMO_SCENARIOS.map(key => ({ key, label: DEMO_SCENARIO_LABELS[key] })) });
});

demoRouter.put("/scenarios/:buildingId", async (req, res) => {
  const buildingId = BuildingId.parse(param(req, "buildingId"));
  const parsed = ScenarioBody.safeParse(req.body);
  if (!parsed.success) throw badRequest("Cenário inválido");
  try {
    const updatedAt = await inTenantContext(req, async (tx) => {
      const [row] = await tx.execute(sql`select app_demo_scenario_set(${buildingId},${parsed.data.scenario}) as updated_at`);
      return new Date(row!.updated_at as string).toISOString();
    });
    res.json({ buildingId, scenario: parsed.data.scenario, updatedAt } satisfies DemoScenarioState);
  } catch (error) {
    if (pgErrorCode(error) === "42501") throw notFound();
    if (pgErrorCode(error) === "P0002") throw notFound("Condomínio não encontrado");
    throw error;
  }
});
