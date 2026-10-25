import express, { type Express } from "express";

/** A cold Vercel instance must verify its database identities before serving requests. */
export function createServerlessApp(domain: Express, initialize: () => Promise<void>): Express {
  const handler = express();
  let ready: Promise<void> | undefined;
  handler.use("/internal", (_req, res) => {
    res.status(404).json({ error: "Rota não encontrada" });
  });
  handler.use(async (_req, res, next) => {
    ready ??= Promise.resolve().then(initialize).catch(() => {
      ready = undefined;
      throw new Error("Runtime indisponível");
    });
    try { await ready; next(); }
    catch {
      res.setHeader("Cache-Control", "no-store");
      res.status(503).json({ error: "API temporariamente indisponível" });
    }
  });
  handler.use(domain);
  return handler;
}
