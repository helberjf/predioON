import { useEffect, useState } from "react";
import { noticeIsVisible, nextNoticeOccurrence, type ScheduledNotice } from "@predioon/shared";
import { Badge, Card, ErrorBanner, formatDateTime, ResourceFeedback, useResource, ParkingPanel } from "@predioon/ui";
import type { Notice, Paged } from "@predioon/ui";

const LABELS: Record<string, string> = { COMMUNICATION: "Comunicado", MAINTENANCE: "Manutenção / limpeza", EVENT: "Reunião / evento", WASTE_COLLECTION: "Coleta de lixo", GESTAO: "Transparência da gestão" };
type ResidentNotice = Notice & ScheduledNotice & { expiresAt: string | null };

export function Notices({ buildingId }: { buildingId: string }) {
  const notices = useResource<Paged<ResidentNotice>>(`/notices?buildingId=${encodeURIComponent(buildingId)}`);
  const [, setClockTick] = useState(0);
  const now = new Date();
  useEffect(() => {
    const timer = setInterval(() => { setClockTick(value => value + 1); notices.reload(); }, 30_000);
    return () => clearInterval(timer);
  }, [notices.reload]);
  const items = notices.data?.items.filter(notice => noticeIsVisible(notice, now)) ?? [];
  return <>
    <ParkingPanel buildingId={buildingId} />
    {!items.length && <Card title="Avisos"><ResourceFeedback resource={notices} emptyText="Nenhum aviso publicado." /></Card>}
    {notices.error && <ErrorBanner message={notices.error} />}
    {items.map(notice => {
      const occurrence = nextNoticeOccurrence(notice.schedule, now);
      const next = occurrence && (!notice.expiresAt || new Date(occurrence) < new Date(notice.expiresAt)) ? occurrence : null;
      const schedule = notice.schedule;
      return <Card key={notice.id}>
        <div className="flex flex-wrap items-center gap-2"><Badge tone="info">{LABELS[notice.category] ?? notice.category}</Badge>{notice.pinned && <Badge tone="warning">fixado</Badge>}</div>
        <h2 className="mt-2 font-semibold text-slate-900">{notice.title}</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{notice.body}</p>
        {schedule && <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50 p-3 text-sm text-sky-900"><p>{next ? "Próxima data: " : "Data do evento: "}{new Intl.DateTimeFormat("pt-BR", { timeZone: schedule.timeZone, dateStyle: "full", timeStyle: "short" }).format(new Date(next ?? schedule.startsAt))}</p><p className="mt-1 text-xs">{schedule.recurrence === "WEEKLY" ? "Toda semana" : "Evento único"} · {schedule.timeZone}</p></div>}
        <p className="mt-3 text-xs text-slate-400">Publicado em {formatDateTime(notice.publishedAt)}</p>
      </Card>;
    })}
  </>;
}
