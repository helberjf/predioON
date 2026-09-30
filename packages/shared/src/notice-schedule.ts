import { z } from "zod";

export function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}

export const NoticeScheduleSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  recurrence: z.enum(["NONE", "WEEKLY"]).default("NONE"),
  timeZone: z.string().min(1).max(100).refine(validTimeZone, "Fuso horário inválido"),
});
export type NoticeSchedule = { startsAt: string | Date; recurrence: "NONE" | "WEEKLY"; timeZone: string };
export type ScheduledNotice = { schedule: NoticeSchedule | null; nextOccurrenceAt: string | null };

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
function partsAt(date: Date, timeZone: string): Parts {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)])) as Parts;
}
function localEpoch(parts: Parts): number { return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second); }
function candidates(parts: Parts, timeZone: string): number[] {
  const local = localEpoch(parts);
  const offsets = new Set([-86_400_000, 0, 86_400_000].map(delta => {
    const sample = local + delta;
    return localEpoch(partsAt(new Date(sample), timeZone)) - sample;
  }));
  return [...offsets].map(offset => local - offset).filter(instant => localEpoch(partsAt(new Date(instant), timeZone)) === local).sort((a, b) => a - b);
}

/** Reject ambiguous/nonexistent local times so entering an event never silently changes its hour. */
export function localDateTimeToIso(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match || !validTimeZone(timeZone)) throw new Error("Data ou fuso horário inválido");
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: 0 };
  const check = new Date(localEpoch(parts));
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month || check.getUTCDate() !== parts.day || check.getUTCHours() !== parts.hour || check.getUTCMinutes() !== parts.minute) throw new Error("Data inválida");
  const matches = candidates(parts, timeZone);
  if (matches.length !== 1) throw new Error("Horário inexistente ou ambíguo neste fuso. Escolha outro horário.");
  return new Date(matches[0]!).toISOString();
}

export function instantToLocalDateTime(value: string | Date, timeZone: string): string {
  const p = partsAt(new Date(value), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Weekly recurrences use the event's wall clock, including DST. Missing hours skip that week; repeated hours use the earlier instant. */
export function nextNoticeOccurrence(schedule: NoticeSchedule | null, now = new Date()): string | null {
  if (!schedule) return null;
  const start = new Date(schedule.startsAt);
  if (!Number.isFinite(start.getTime()) || !validTimeZone(schedule.timeZone)) return null;
  if (start >= now) return start.toISOString();
  if (schedule.recurrence === "NONE") return null;
  const first = partsAt(start, schedule.timeZone);
  const current = partsAt(now, schedule.timeZone);
  const week = 7 * 86_400_000;
  const estimate = Math.max(1, Math.floor((localEpoch(current) - localEpoch(first)) / week));
  for (let i = estimate; i <= estimate + 3; i++) {
    const day = new Date(localEpoch(first) + i * week);
    const parts = { ...first, year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() };
    const occurrence = candidates(parts, schedule.timeZone)[0];
    if (occurrence !== undefined && occurrence >= now.getTime()) return new Date(occurrence).toISOString();
  }
  return null;
}

export function noticeIsVisible(notice: { publishedAt: string | Date; expiresAt?: string | Date | null }, now = new Date()): boolean {
  return new Date(notice.publishedAt) <= now && (!notice.expiresAt || new Date(notice.expiresAt) > now);
}
