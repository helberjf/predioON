export type WebhookPayload = {
  alertId: string;
  buildingId: string;
  deviceId: string;
  severity: string;
  type: string;
  message: string;
  triggeredAt: string;
};

export type TransportOutcome =
  | { kind: "http"; status: number; retryAfterSeconds?: number }
  | { kind: "network" | "timeout" | "no_destination" }
  | { kind: "aborted" };

/** Bounded hints only; the database owns the final retry time and attempt limit. */
export function retryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value || value.length > 128) return undefined;
  const header = value.trim();
  if (/^\d{1,9}$/.test(header)) return Math.min(300, Number(header));
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header)) return undefined;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.min(300, Math.ceil((date - now) / 1000))) : undefined;
}

/** One HTTP attempt. Redirects and mutating retries never happen in this transport. */
export async function postWebhook(
  destination: string | undefined,
  payload: WebhookPayload,
  idempotencyKey: string,
  cancellation: AbortSignal,
  request: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<TransportOutcome> {
  if (cancellation.aborted) return { kind: "aborted" };
  if (!destination) return { kind: "no_destination" };
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([cancellation, deadline]);
  try {
    const response = await request(destination, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload), signal,
    });
    // Provider bodies can contain private material and are never consumed or logged.
    void response.body?.cancel().catch(() => {});
    if (cancellation.aborted) return { kind: "aborted" };
    if (deadline.aborted) return { kind: "timeout" };
    const delay = response.status === 429 || response.status === 503
      ? retryAfterSeconds(response.headers.get("retry-after")) : undefined;
    return { kind: "http", status: response.status, ...(delay === undefined ? {} : { retryAfterSeconds: delay }) };
  } catch {
    // Driver/network errors often contain URLs or payloads. Export only a closed category.
    if (cancellation.aborted) return { kind: "aborted" };
    return { kind: deadline.aborted ? "timeout" : "network" };
  }
}
