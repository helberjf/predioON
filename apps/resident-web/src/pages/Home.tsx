import { useEffect } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Car, ChartNoAxesCombined, ChevronRight, CheckCircle2, Droplets, KeyRound, Leaf, Megaphone, ScrollText, Wrench } from "lucide-react";
import { noticeIsVisible } from "@predioon/shared";
import { Feature, useFeatures, Badge, Card, cls, ResourceFeedback, formatNumber, formatRelative, numericReading, readingStatus, useResource } from "@predioon/ui";
import type { LatestReading, Occurrence, Paged } from "@predioon/ui";
import { noticeLook, whenLabel, type ResidentNotice } from "../notices.js";

/** The six most used destinations the condominium has enabled; the rest live under "Mais". */
const SHORTCUTS = [
  { to: "/reservas", label: "Reservar áreas comuns", icon: CalendarDays, tone: "bg-emerald-50 text-emerald-600" },
  { to: "/acessos", label: "Abrir portão", icon: KeyRound, tone: "bg-blue-50 text-blue-600" },
  { to: "/avisos", label: "Avisos", icon: Megaphone, tone: "bg-rose-50 text-rose-500" },
  { to: "/chamados", label: "Ocorrências", icon: Wrench, tone: "bg-orange-50 text-orange-600" },
  { to: "/transparencia", label: "Transparência e contas", icon: ScrollText, tone: "bg-violet-50 text-violet-600" },
  { to: "/vagas", label: "Vagas de carros e motos", icon: Car, tone: "bg-sky-50 text-sky-600" },
  { to: "/consumo", label: "Consumo do imóvel", icon: ChartNoAxesCombined, tone: "bg-amber-50 text-amber-600" },
];
const SEE_ALL = "rounded-md text-xs font-semibold text-sky-700 hover:underline";

export function Home({ buildingId }: { buildingId: string }) {
  const flags = useFeatures();
  const notices = useResource<Paged<ResidentNotice>>(flags.enabled("NOTICES") ? `/notices?buildingId=${buildingId}` : null);
  const readings = useResource<Paged<LatestReading>>(flags.enabled("WATER_TANK") ? `/telemetry/latest?buildingId=${buildingId}` : null);
  const mine = useResource<Paged<Occurrence>>(flags.enabled("TICKETS") ? `/occurrences?buildingId=${buildingId}&limit=5` : null);
  useEffect(() => { const timer = setInterval(readings.reload, 10000); return () => clearInterval(timer); }, [readings.reload]);
  const level = readings.data?.items.find(reading => reading.metric === "water_level_percent");
  const percent = numericReading(level);
  const now = new Date();
  const current = notices.data?.items.filter(notice => noticeIsVisible(notice, now)).slice(0, 3) ?? [];
  return <>
    <div className="grid grid-cols-3 gap-2.5">{SHORTCUTS.filter(link => flags.routeAllowed(link.to)).slice(0, 6).map(({ to, label, icon: Icon, tone }) => <Link key={to} to={to} className="flex min-h-[108px] flex-col items-center justify-center gap-2.5 rounded-2xl border border-white bg-white px-2 py-3 text-center shadow-[0_1px_2px_rgba(16,40,70,0.04),0_6px_18px_-12px_rgba(16,40,70,0.12)] transition hover:border-emerald-200 active:scale-[0.98]">
      <span className={cls("flex h-12 w-12 items-center justify-center rounded-2xl", tone)}><Icon size={26} strokeWidth={2.2} /></span>
      <span className="max-w-[6.5rem] text-[11.5px] font-semibold leading-4 text-[#152d4b]">{label}</span>
    </Link>)}</div>

    <Feature name="NOTICES"><Card title="Avisos do condomínio" action={<Link to="/avisos" className={SEE_ALL}>Ver todos</Link>}>
      {current.length ? <ul className="-my-1 divide-y divide-slate-100">{current.map(notice => {
        const look = noticeLook(notice.category), Icon = look.icon;
        return <li key={notice.id}><Link to="/avisos" className="flex items-center gap-3 py-3">
          <span className={cls("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", look.tone)}><Icon size={21} /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-5 text-[#152d4b]">{notice.title}</p>
            <p className="truncate text-xs leading-5 text-slate-500">{whenLabel(notice, now) ?? notice.body}</p>
          </div>
          <ChevronRight size={17} className="shrink-0 text-slate-400" />
        </Link></li>;
      })}</ul> : <ResourceFeedback resource={notices} emptyText="Nenhum aviso publicado." />}
    </Card></Feature>

    <Feature name="WATER_TANK"><div id="monitoramento" className="scroll-mt-20"><Card title="Nível da caixa d’água" action={<Droplets size={21} className="text-sky-500" />}>{percent !== null ? <>
      <div className="flex items-end justify-between"><p className="text-[32px] font-bold leading-none text-[#173451]">{formatNumber(percent, 0)}%</p><span className="text-[11px] text-slate-500">{level?.device_name}</span></div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#21a6e5]" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div>
      <p className="mt-3 text-[11px] text-slate-500">{readingStatus(level)} · {formatRelative(level?.time)}</p>
    </> : <ResourceFeedback resource={readings} emptyText="Sem leitura validada no momento." />}</Card></div></Feature>

    <Feature name="TICKETS"><Card title="Minhas ocorrências" action={<Link to="/chamados" className={SEE_ALL}>Ver todas</Link>}>
      {mine.data?.items.length ? <ul className="-my-1 divide-y divide-slate-100">{mine.data.items.map(occurrence => <li key={occurrence.id} className="flex items-center gap-3 py-3">
        <span className={cls("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", occurrence.status === "DONE" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500")}>{occurrence.status === "DONE" ? <CheckCircle2 size={21} /> : <Wrench size={20} />}</span>
        <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-[#152d4b]">{occurrence.title}</p><p className="mt-0.5 text-[11px] text-slate-500">#{occurrence.protocol}</p></div>
        <Badge>{occurrence.status}</Badge>
      </li>)}</ul> : <ResourceFeedback resource={mine} emptyText="Você ainda não abriu ocorrências." />}
    </Card></Feature>

    <div className="flex items-center gap-3 rounded-2xl bg-[#ddf7e9] px-5 py-5">
      <div className="flex-1"><h2 className="text-base font-bold leading-5 text-[#15344f]">Vamos manter nosso<br />condomínio ainda melhor!</h2><p className="mt-2 text-xs leading-5 text-[#426353]">Respeite os horários e colabore com as áreas comuns.</p></div>
      <Leaf size={56} strokeWidth={1.5} className="shrink-0 -rotate-12 text-[#4ba872]" />
    </div>
  </>;
}
