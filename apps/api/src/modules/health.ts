import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@predioon/db";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({ ok: true, service: "predioon-api", timestamp: new Date().toISOString() });
});

/** Readiness: only healthy when the database actually answers. */
healthRouter.get("/ready", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ ok: true, database: "up" });
  } catch (error) {
    res.status(503).json({ ok: false, database: "down", error: String(error) });
  }
});
