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
