import { postWebhook, type TransportOutcome, type WebhookPayload } from "./transport.js";

export type Claim = { deliveryId: string; eventId: string; token: string };
export type Delivery = { payload: WebhookPayload; idempotencyKey: string };
export type Completion = "delivered" | "retry" | "failed" | "cancelled" | "no_destination" | "stale";
export type AttemptResult = Completion | "empty" | "aborted" | "database_error";

/** The implementation owns one physical backend and closes it after every attempt. */
export interface NotificationAttempt {
  readonly signal: AbortSignal;
  isValid(): boolean;
  claim(): Promise<Claim | undefined>;
  revalidate(claim: Claim): Promise<Delivery | undefined>;
  complete(claim: Claim, outcome: Exclude<TransportOutcome, { kind: "aborted" }>): Promise<Completion>;
  close(): Promise<void>;
}

export type AttemptFactory = (shutdown: AbortSignal) => Promise<NotificationAttempt>;

/** All SQL methods are individual autocommits, including the session barrier helpers. */
export async function runNotificationAttempt(
  open: AttemptFactory,
  shutdown: AbortSignal,
  destination: string | undefined,
  request: typeof fetch = fetch,
): Promise<AttemptResult> {
  if (shutdown.aborted) return "aborted";
  let attempt: NotificationAttempt | undefined;
  let result: AttemptResult = "database_error";
  const active = () => !!attempt && attempt.isValid() && !attempt.signal.aborted && !shutdown.aborted;
  try {
    attempt = await open(shutdown);
    if (!active()) result = "aborted";
    else {
      const claim = await attempt.claim();
      if (!active()) result = "aborted";
      else if (!claim) result = "empty";
      else {
        const delivery = await attempt.revalidate(claim);
        if (!active()) result = "aborted";
        else if (!delivery) result = "stale";
        else {
          const cancellation = AbortSignal.any([attempt.signal, shutdown]);
          const outcome = await postWebhook(destination, delivery.payload, delivery.idempotencyKey, cancellation, request);
          if (!active() || outcome.kind === "aborted") result = "aborted";
          else {
            const completed = await attempt.complete(claim, outcome);
            result = active() ? completed : "aborted";
          }
        }
      }
    }
  } catch {
    result = shutdown.aborted ? "aborted" : "database_error";
  } finally {
    // Failed/unconfirmed unlocks must destroy the client, never return it to a pool.
    try { await attempt?.close(); }
    catch { result = "database_error"; }
  }
  return result;
}
