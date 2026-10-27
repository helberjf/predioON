// Dependency-free on purpose: the resident app checks a scanned text with it
// through @predioon/contracts/gate-qr without loading every shared schema.

/** The totem QR changes at every full hour; the previous hour is still accepted for a few minutes. */
export const GATE_QR_WINDOW_MS = 3_600_000;
export const GATE_QR_GRACE_MS = 300_000;
const GATE_QR_PATTERN = /^predioon-portao:v1:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{1,12})\.([A-Za-z0-9_-]{22})$/;
export type GateQr = { gateId: string; window: number; mac: string };
/** Format only: whether a scanned text is a Prédio ON gate QR. Only the API can tell a valid one. */
export function parseGateQr(text: string): GateQr | null {
  const match = GATE_QR_PATTERN.exec(text.trim());
  if (!match) return null;
  const window = Number(match[2]);
  return Number.isSafeInteger(window) ? { gateId: match[1]!, window, mac: match[3]! } : null;
}
/** Not a URL on purpose: a phone's own camera shows text instead of opening any page. */
export function formatGateQr(qr: GateQr): string {
  return `predioon-portao:v1:${qr.gateId}.${qr.window}.${qr.mac}`;
}
