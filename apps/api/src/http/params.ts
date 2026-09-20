import type { Request } from "express";
import { badRequest } from "./errors.js";

/**
 * Express 5 types route params as `string | string[]` because of wildcard segments.
 * Every route here uses single-value params, so narrowing happens in one place.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest(`Parâmetro de rota "${name}" ausente ou inválido`);
  }
  return value;
}
