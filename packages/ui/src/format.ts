const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const timeOnly = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" });
const dayMonth = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

/**
 * PostgreSQL returns aggregate timestamps as "2026-09-20 04:49:00+00", which `new Date()`
 * rejects: the space is not the ISO separator and the offset needs minutes. Normalising here
 * keeps every caller from having to know that.
 */
export function parseTimestamp(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const withOffset = normalized.replace(/([+-]\d{2})$/, "$1:00");
  const parsed = new Date(withOffset);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Formatters never throw: a bad timestamp shows as "—" instead of blanking the page. */
function format(formatter: Intl.DateTimeFormat, value?: string | Date | null): string {
  const parsed = parseTimestamp(value);
  return parsed ? formatter.format(parsed) : "—";
}

export function formatDateTime(value?: string | Date | null): string {
  return format(dateTime, value);
}

export function formatTime(value?: string | Date | null): string {
  return format(timeOnly, value);
}

export function formatDayMonth(value?: string | Date | null): string {
  return format(dayMonth, value);
}

export function formatNumber(value: number | string | null | undefined, decimals = 0): string {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (parsed === null || parsed === undefined || Number.isNaN(parsed)) return "—";
  return parsed.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "há 2 min", "há 3 h" — the panel must make staleness obvious at a glance. */
export function formatRelative(value?: string | Date | null): string {
  const parsed = parseTimestamp(value);
  if (!parsed) return "nunca";

  const seconds = Math.floor((Date.now() - parsed.getTime()) / 1000);
  if (seconds < 60) return "agora";
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `há ${Math.floor(seconds / 3600)} h`;
  return `há ${Math.floor(seconds / 86400)} d`;
}

export function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
