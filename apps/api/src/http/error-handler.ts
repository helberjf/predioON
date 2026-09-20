import type { ErrorRequestHandler } from "express";
import { HttpError } from "./errors.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }

  console.error("Erro não tratado:", error);
  res.status(500).json({ error: "Erro interno" });
};

export const notFoundHandler = (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
  res.status(404).json({ error: "Rota não encontrada" });
};
