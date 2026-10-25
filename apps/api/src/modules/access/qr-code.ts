// The hourly totem QR. The database has no HMAC (no pgcrypto), so the key stays
// in the API: it derives one key per gate and generation from GATE_QR_SECRET and
// stores nothing secret. The database still decides permission, feature and
// hardware state; this module only proves that the reader saw the current QR.
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { formatGateQr, GATE_QR_GRACE_MS, GATE_QR_WINDOW_MS, type GateQr } from "@predioon/shared";
import { config } from "../../config.js";
import { HttpError } from "../../http/errors.js";

/** Full UTC hours, which are also full hours in Brasília. */
export const gateQrWindow = (nowMs: number): number => Math.floor(nowMs / GATE_QR_WINDOW_MS);

export function gateQrSecret(): string {
  if (!config.gateQrSecret) throw new HttpError(503, "A abertura por QR não está configurada neste ambiente.");
  return config.gateQrSecret;
}

/** Renewing a gate's QR bumps its generation, which changes this key at once. */
function gateQrMac(secret: string, gateId: string, generation: number, window: number): string {
  const key = Buffer.from(hkdfSync("sha256", secret, gateId, `predioon-gate-qr:v1:${generation}`, 32));
  return createHmac("sha256", key).update(`${gateId}.${window}`).digest().subarray(0, 16).toString("base64url");
}

export function gateQrContent(gateId: string, generation: number, window: number, secret = gateQrSecret()): string {
  return formatGateQr({ gateId, window, mac: gateQrMac(secret, gateId, generation, window) });
}

/** The current hour, or the previous one during the first minutes of a new hour. Never a later hour. */
export function verifyGateQr(qr: GateQr, generation: number, nowMs: number, secret = gateQrSecret()): boolean {
  const current = gateQrWindow(nowMs);
  const fresh = qr.window === current || (qr.window === current - 1 && nowMs - current * GATE_QR_WINDOW_MS < GATE_QR_GRACE_MS);
  if (!fresh) return false;
  const expected = Buffer.from(gateQrMac(secret, qr.gateId, generation, qr.window));
  const received = Buffer.from(qr.mac);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** What a totem shows now, and the next hour's QR so it can switch on time with a flaky network. */
export function totemCodes(gateId: string, generation: number, nowMs: number, secret = gateQrSecret()) {
  const window = gateQrWindow(nowMs), boundary = new Date((window + 1) * GATE_QR_WINDOW_MS).toISOString();
  return {
    current: { content: gateQrContent(gateId, generation, window, secret), validUntil: boundary },
    next: { content: gateQrContent(gateId, generation, window + 1, secret), validFrom: boundary },
  };
}
