/** Local civil day -> explicit API instants, including 23/25 hour clock changes. */
export function reservationDayWindow(value: string): { from: string; to: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const from = new Date(year, month - 1, day);
  if (from.getFullYear() !== year || from.getMonth() + 1 !== month || from.getDate() !== day) return null;
  const to = new Date(year, month - 1, day + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

const pad = (value: number) => String(value).padStart(2, "0");
/** Local civil date of an instant, as YYYY-MM-DD. */
export function localDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
/** The local month of an instant, as YYYY-MM. */
export function monthOf(value: Date = new Date()): string {
  return localDate(value).slice(0, 7);
}
function parseMonth(value: string): { year: number; month: number } | null {
  if (!/^\d{4}-\d{2}$/.test(value)) return null;
  const [year, month] = value.split("-").map(Number) as [number, number];
  return month >= 1 && month <= 12 ? { year, month } : null;
}
export function shiftMonth(value: string, delta: number): string {
  const parsed = parseMonth(value);
  if (!parsed) return value;
  return monthOf(new Date(parsed.year, parsed.month - 1 + delta, 1));
}
/** "Outubro de 2026". */
export function monthLabel(value: string): string {
  const parsed = parseMonth(value);
  if (!parsed) return value;
  const label = new Date(parsed.year, parsed.month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
/** "27 de setembro de 2026", for naming one day of a month grid. */
export function dayLabel(date: string): string {
  const day = reservationDayWindow(date);
  return day ? new Date(day.from).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" }) : date;
}

/**
 * Six weeks of local dates starting on the Sunday on or before the 1st, the
 * instants covering the whole grid (for the administration) and those covering
 * only the month itself (for residents, whose window is at most 31 days).
 */
export function monthGrid(value: string): { days: string[]; from: string; to: string; monthFrom: string; monthTo: string } | null {
  const parsed = parseMonth(value);
  if (!parsed) return null;
  const first = new Date(parsed.year, parsed.month - 1, 1);
  const start = new Date(parsed.year, parsed.month - 1, 1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => localDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42);
  return { days, from: start.toISOString(), to: end.toISOString(), monthFrom: first.toISOString(), monthTo: new Date(parsed.year, parsed.month, 1).toISOString() };
}

export type BusyInterval = { startsAt: string; endsAt: string };
export type FreeWindow = { start: string; end: string };
function at(date: string, time: string): Date | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(time);
  if (!reservationDayWindow(date) || !match) return null;
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day, Number(match[1]), Number(match[2]));
}
const clock = (value: Date, date: string) => localDate(value) === date ? `${pad(value.getHours())}:${pad(value.getMinutes())}` : "24:00";

/**
 * The free stretches of one local day inside the area's opening hours, once
 * the busy intervals and the time already gone are taken out. Stretches
 * shorter than the minimum are left out: nobody can book them.
 */
export function freeWindows(date: string, opensAt: string, closesAt: string, busy: readonly BusyInterval[], now = Date.now(), minimumMinutes = 30): FreeWindow[] {
  const opens = at(date, opensAt), day = reservationDayWindow(date);
  let closes = at(date, closesAt);
  if (!opens || !closes || !day) return [];
  if (closes <= opens) closes = new Date(day.to);
  let cursor = Math.max(opens.getTime(), now);
  const end = closes.getTime();
  const taken = busy.map(item => ({ start: Date.parse(item.startsAt), end: Date.parse(item.endsAt) }))
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > cursor && item.start < end)
    .sort((left, right) => left.start - right.start);
  const windows: FreeWindow[] = [];
  const push = (start: number, stop: number) => {
    if (stop - start >= minimumMinutes * 60_000) windows.push({ start: clock(new Date(start), date), end: clock(new Date(stop), date) });
  };
  for (const item of taken) {
    if (item.start > cursor) push(cursor, Math.min(item.start, end));
    cursor = Math.max(cursor, item.end);
    if (cursor >= end) break;
  }
  if (cursor < end) push(cursor, end);
  return windows;
}

export type DayAvailability = "free" | "partial" | "full" | "past";
/** How much of a day is still bookable, for the residents' month view. */
export function dayAvailability(date: string, opensAt: string, closesAt: string, busy: readonly BusyInterval[], now = Date.now()): DayAvailability {
  const day = reservationDayWindow(date);
  if (!day || Date.parse(day.to) <= now) return "past";
  const windows = freeWindows(date, opensAt, closesAt, busy, now);
  if (!windows.length) return "full";
  const whole = freeWindows(date, opensAt, closesAt, [], now);
  return windows.length === whole.length && windows.every((item, index) => item.start === whole[index]!.start && item.end === whole[index]!.end) ? "free" : "partial";
}
