/** Local civil day -> explicit API instants, including 23/25 hour clock changes. */
export function reservationDayWindow(value: string): { from: string; to: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const from = new Date(year, month - 1, day);
  if (from.getFullYear() !== year || from.getMonth() + 1 !== month || from.getDate() !== day) return null;
  const to = new Date(year, month - 1, day + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}
