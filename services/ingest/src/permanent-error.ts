/**
 * SQLSTATE class 22 ("data exception") means PostgreSQL refused the content
 * itself: a NUL character, a lone UTF-16 surrogate in JSON, a value out of
 * range. The same message fails the same way on every redelivery, so retrying
 * it only blocks the single ordered MQTT session for every condominium.
 *
 * Connection loss, deadlocks, serialization failures and permission errors
 * belong to other classes and stay retryable. Drizzle wraps driver errors in
 * `cause`, so the chain is walked.
 */
export function permanentDataErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^22[0-9A-Z]{3}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
