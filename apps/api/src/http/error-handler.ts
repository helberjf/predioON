import type { ErrorRequestHandler } from "express";
import { HttpError } from "./errors.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  // body-parser errors carry the submitted body, which may contain credentials.
  // Report these client failures without logging or echoing their raw content.
  if (error?.type === "entity.parse.failed" && error.status === 400) {
    res.status(400).json({ error: "JSON inválido" });
    return;
  }
  if (error?.type === "entity.too.large" && error.status === 413) {
    res.status(413).json({ error: "Corpo da requisição excede o limite permitido" });
    return;
  }
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
