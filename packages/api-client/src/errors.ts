export type ApiErrorCode = "HTTP_ERROR" | "NETWORK_ERROR" | "SESSION_CHANGED" | "INVALID_RESPONSE" | "BROWSER_UNSUPPORTED";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, message: string, code: ApiErrorCode = "HTTP_ERROR") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
