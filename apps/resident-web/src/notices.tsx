import type { ComponentType } from "react";
import { Paintbrush, FileText, Megaphone, Trash2, Users } from "lucide-react";
import { nextNoticeOccurrence, type ScheduledNotice } from "@predioon/shared";
import type { Notice } from "@predioon/ui";

export type ResidentNotice = Notice & ScheduledNotice & { expiresAt: string | null };

type Look = { label: string; icon: ComponentType<{ size?: number }>; tone: string };
const FALLBACK: Look = { label: "Comunicado", icon: Megaphone, tone: "bg-sky-50 text-sky-600" };
/** One icon and colour per notice category, so a list can be scanned without reading. */
const CATEGORIES: Record<string, Look> = {
  COMMUNICATION: FALLBACK,
  MAINTENANCE: { label: "Manutenção / limpeza", icon: Paintbrush, tone: "bg-amber-50 text-amber-600" },
  EVENT: { label: "Reunião / evento", icon: Users, tone: "bg-violet-50 text-violet-600" },
  WASTE_COLLECTION: { label: "Coleta de lixo", icon: Trash2, tone: "bg-emerald-50 text-emerald-600" },
  GESTAO: { label: "Transparência da gestão", icon: FileText, tone: "bg-teal-50 text-teal-600" },
};
export const noticeLook = (category: string): Look => CATEGORIES[category] ?? { ...FALLBACK, label: category };

/** Next date of a scheduled notice that is still inside its validity, if any. */
export function nextDate(notice: ResidentNotice, now: Date): string | null {
  const occurrence = nextNoticeOccurrence(notice.schedule, now);
  return occurrence && (!notice.expiresAt || new Date(occurrence) < new Date(notice.expiresAt)) ? occurrence : null;
}

/** "Hoje, 19:00", "Amanhã, 09:00" or the date, in the notice's own time zone. */
export function whenLabel(notice: ResidentNotice, now: Date): string | null {
  if (!notice.schedule) return null;
  const at = new Date(nextDate(notice, now) ?? notice.schedule.startsAt), timeZone = notice.schedule.timeZone;
  const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(date);
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone, timeStyle: "short" }).format(at);
  if (day(at) === day(now)) return `Hoje, ${time}`;
  if (day(at) === day(new Date(now.getTime() + 86_400_000))) return `Amanhã, ${time}`;
  return `${new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit" }).format(at)}, ${time}`;
}
