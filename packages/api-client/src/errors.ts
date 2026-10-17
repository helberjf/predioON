export type ApiErrorCode = "HTTP_ERROR" | "NETWORK_ERROR" | "SESSION_CHANGED" | "INVALID_RESPONSE" | "BROWSER_UNSUPPORTED";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  /** Machine-readable cause sent by the API in `details.reason`, e.g. VERIFICATION_REQUIRED. */
  readonly reason?: string;

  constructor(status: number, message: string, code: ApiErrorCode = "HTTP_ERROR", reason?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (reason) this.reason = reason;
  }
}
