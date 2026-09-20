/** Errors that carry an HTTP status. Anything else becomes a 500. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = "Não autenticado") => new HttpError(401, message);
export const forbidden = (message = "Sem permissão para este recurso") => new HttpError(403, message);
export const notFound = (message = "Recurso não encontrado") => new HttpError(404, message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, details);

/**
 * Drizzle wraps driver errors, so the PostgreSQL SQLSTATE lives somewhere down the `cause` chain.
 * Walking it lets routes translate constraint violations into meaningful HTTP status codes.
 */
export function pgErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
