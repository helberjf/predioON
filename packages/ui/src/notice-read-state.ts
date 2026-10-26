export type ReadableNotice = { id: string; publishedAt: string; expiresAt?: string | null };

export const noticeReadKey = (userId: string, buildingId: string) => `predioon:notices:seen:${JSON.stringify([userId, buildingId])}`;
const version = (notice: ReadableNotice) => JSON.stringify([notice.id, notice.publishedAt]);
const visible = (notice: ReadableNotice, now: Date) => Date.parse(notice.publishedAt) <= now.getTime() && (!notice.expiresAt || Date.parse(notice.expiresAt) > now.getTime());

export function parseSeenNotices(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) && value.every(item => typeof item === "string") ? [...new Set(value)] : [];
  } catch { return []; }
}

export function unreadNotices<T extends ReadableNotice>(notices: readonly T[], seen: readonly string[], now = new Date()): T[] {
  const read = new Set(seen);
  return notices.filter(notice => visible(notice, now) && !read.has(version(notice)));
}

export function markNoticesSeen(seen: readonly string[], notices: readonly ReadableNotice[], now = new Date()): string[] {
  return [...new Set([...seen, ...notices.filter(notice => visible(notice, now)).map(version)])];
}
