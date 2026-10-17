/** Pure argument rules of the telemetry retention CLI (telemetry-retention.ts). */
export const MINIMUM_RETENTION_MONTHS = 13;

export class UsageError extends Error {}

export type RetentionRequest = { kind: "status" } | { kind: "off" } | { kind: "set"; months: number };

export function parseRetentionArguments(args: readonly string[]): RetentionRequest {
  const known = new Set(["--months", "--confirm", "--off"]);
  for (let index = 0; index < args.length; index++) {
    if (!known.has(args[index]!)) throw new UsageError(`Opção desconhecida: ${args[index]}`);
    if (args[index] === "--months") index++;
  }
  const off = args.includes("--off"), at = args.indexOf("--months");
  if (off && at >= 0) throw new UsageError("Use --months ou --off, não os dois.");
  if (off) return { kind: "off" };
  if (at < 0) {
    if (args.includes("--confirm")) throw new UsageError("--confirm só acompanha --months.");
    return { kind: "status" };
  }
  const raw = args[at + 1] ?? "";
  if (!/^[0-9]{1,3}$/.test(raw)) throw new UsageError("--months precisa de um número inteiro de meses.");
  const months = Number(raw);
  // A full year plus a month keeps the same month of the previous year comparable.
  if (months < MINIMUM_RETENTION_MONTHS) throw new UsageError(`O mínimo é ${MINIMUM_RETENTION_MONTHS} meses.`);
  if (!args.includes("--confirm")) throw new UsageError(`Remover leituras com mais de ${months} meses é irreversível. Repita com --confirm.`);
  return { kind: "set", months };
}
