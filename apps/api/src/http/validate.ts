import type { Request, RequestHandler } from "express";
import type { ZodType } from "zod";
import { badRequest } from "./errors.js";

/** Parses and REPLACES the input, so handlers downstream get the typed, coerced value. */
function parseOrThrow<T>(schema: ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest(`${label} inválido`, result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })));
  }
  return result.data;
}

export const validateBody = <T>(schema: ZodType<T>): RequestHandler =>
  (req, _res, next) => {
    req.body = parseOrThrow(schema, req.body, "Corpo da requisição");
    next();
  };

/** Express 5 exposes req.query as a getter, so the parsed value is stashed instead of assigned. */
export const validateQuery = <T>(schema: ZodType<T>): RequestHandler =>
  (req, _res, next) => {
    (req as Request & { validQuery?: unknown }).validQuery = parseOrThrow(schema, req.query, "Query string");
    next();
  };

export function query<T>(req: Request): T {
  return (req as Request & { validQuery: T }).validQuery;
}
