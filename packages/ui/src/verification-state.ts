/**
 * Recent verification (API 055): a privileged request answered with
 * 403 VERIFICATION_REQUIRED asks the person for the password (and code), then
 * repeats that same request once. Concurrent requests share one prompt.
 */
export const VERIFICATION_REQUIRED = "VERIFICATION_REQUIRED";
export type VerificationPrompt = () => Promise<boolean>;

let prompt: VerificationPrompt | null = null;
let pending: Promise<boolean> | null = null;

/** The mounted dialog registers itself; null when no dialog is available. */
export function setVerificationPrompt(next: VerificationPrompt | null): void { prompt = next; }

export function needsRecentVerification(error: unknown): boolean {
  const value = error as { status?: unknown; reason?: unknown } | null;
  return value?.status === 403 && value?.reason === VERIFICATION_REQUIRED;
}

/** One prompt for every request waiting at the same time; false when nothing can ask. */
export function askForVerification(): Promise<boolean> {
  if (!prompt) return Promise.resolve(false);
  pending ??= prompt().catch(() => false).finally(() => { pending = null; });
  return pending;
}

/** Runs the call; on VERIFICATION_REQUIRED asks once and repeats it once. */
export async function withRecentVerification<T>(call: () => Promise<T>, ask: () => Promise<boolean> = askForVerification): Promise<T> {
  try { return await call(); }
  catch (error) {
    if (!needsRecentVerification(error) || !await ask()) throw error;
    return call();
  }
}
