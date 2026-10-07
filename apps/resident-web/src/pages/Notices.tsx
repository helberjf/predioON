import { useEffect, useState } from "react";
import { noticeIsVisible } from "@predioon/shared";
import { Badge, Card, cls, ErrorBanner, formatDateTime, ResourceFeedback, useResource } from "@predioon/ui";
import type { Paged } from "@predioon/ui";
import { nextDate, noticeLook, type ResidentNotice } from "../notices.js";

const FILTERS = [
  { key: "", label: "Todos" },
  { key: "COMMUNICATION", label: "Comunicados" },
  { key: "MAINTENANCE", label: "Manutenções" },
  { key: "EVENT", label: "Eventos" },
  { key: "WASTE_COLLECTION", label: "Coleta" },
];

export function Notices({ buildingId }: { buildingId: string }) {
  const notices = useResource<Paged<ResidentNotice>>(`/notices?buildingId=${encodeURIComponent(buildingId)}`);
  const [, setClockTick] = useState(0);
  const [filter, setFilter] = useState("");
  const now = new Date();
  useEffect(() => {
    const timer = setInterval(() => { setClockTick(value => value + 1); notices.reload(); }, 30_000);
    return () => clearInterval(timer);
  }, [notices.reload]);
  const visible = notices.data?.items.filter(notice => noticeIsVisible(notice, now)) ?? [];
  // Only categories that have something to show become a filter.
  const filters = FILTERS.filter(item => !item.key || visible.some(notice => notice.category === item.key));
  const items = visible.filter(notice => !filter || notice.category === filter);
  return <>
    {filters.length > 2 && <div role="group" aria-label="Filtrar avisos" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {filters.map(item => <button key={item.key} type="button" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)} className={cls("shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition", filter === item.key ? "border-emerald-600 bg-emerald-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200")}>{item.label}</button>)}
    </div>}
    {!items.length && <Card title="Avisos"><ResourceFeedback resource={notices} emptyText="Nenhum aviso publicado." /></Card>}
    {notices.error && <ErrorBanner message={notices.error} />}
    {items.map(notice => {
      const next = nextDate(notice, now), schedule = notice.schedule, look = noticeLook(notice.category), Icon = look.icon;
      return <Card key={notice.id}>
        <div className="flex items-start gap-3">
          <span className={cls("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", look.tone)}><Icon size={22} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><Badge tone="info">{look.label}</Badge>{notice.pinned && <Badge tone="warning">fixado</Badge>}</div>
            <h2 className="mt-2 text-base font-bold leading-6 text-[#142f50]">{notice.title}</h2>
          </div>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{notice.body}</p>
        {schedule && <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm text-sky-900"><p>{next ? "Próxima data: " : "Data do evento: "}{new Intl.DateTimeFormat("pt-BR", { timeZone: schedule.timeZone, dateStyle: "full", timeStyle: "short" }).format(new Date(next ?? schedule.startsAt))}</p><p className="mt-1 text-xs">{schedule.recurrence === "WEEKLY" ? "Toda semana" : "Evento único"} · {schedule.timeZone}</p></div>}
        <p className="mt-3 text-xs text-slate-400">Publicado em {formatDateTime(notice.publishedAt)}</p>
      </Card>;
    })}
  </>;
}
