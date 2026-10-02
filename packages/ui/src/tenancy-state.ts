type CursorPage<T> = { items: T[]; nextCursor: string | null };

/** Fetch every page for the selectors; never silently omit records after page one. */
export async function loadTenancyCollection<T extends { id: string }>(
  path: string,
  get: (path: string) => Promise<CursorPage<T>>,
  active: () => boolean = () => true,
): Promise<T[]> {
  const rows = new Map<string, T>();
  const visited = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    if (!active()) return [];
    const result: CursorPage<T> = await get(`${path}${path.includes("?") ? "&" : "?"}limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`);
    if (!active()) return [];
    for (const row of result.items) rows.set(row.id, row);
    if (!result.nextCursor) return [...rows.values()];
    if (visited.has(result.nextCursor)) throw new Error("A paginação não avançou. Atualize os cadastros para tentar novamente.");
    visited.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error("O cadastro excede o limite de consulta. Solicite apoio à administração.");
}

export function membershipValidity(startsAt: string, endsAt: string): { startsAt: string | null; endsAt: string | null } {
  const start = startsAt ? new Date(startsAt) : null;
  const end = endsAt ? new Date(endsAt) : null;
  if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime()))) throw new Error("Informe datas de vigência válidas.");
  if (start && end && end <= start) throw new Error("O fim da vigência precisa ser posterior ao início.");
  return { startsAt: start?.toISOString() ?? null, endsAt: end?.toISOString() ?? null };
}

export function membershipStatus(value: { startsAt?: string | null; endsAt?: string | null }, now = Date.now()): string {
  if (value.endsAt && Date.parse(value.endsAt) <= now) return "Expirado";
  if (value.startsAt && Date.parse(value.startsAt) > now) return "Agendado";
  return "Vigente";
}
