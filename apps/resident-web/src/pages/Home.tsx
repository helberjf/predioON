import { useEffect } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Car, ChartNoAxesCombined, ChevronRight, CheckCircle2, DoorOpen, Droplets, Leaf, Megaphone, UserRound, Wrench } from "lucide-react";
import { Feature, useFeatures, Badge, Card, ResourceFeedback, formatNumber, formatRelative, numericReading, readingStatus, useResource } from "@predioon/ui";
import type { LatestReading, Notice, Occurrence, Paged } from "@predioon/ui";
const shortcuts = [
  {to:"/transparencia",label:"Transparência e contas",icon:ChartNoAxesCombined,color:"text-teal-600",bg:"bg-teal-50"},
  {to:"/reservas",label:"Reservar áreas comuns",icon:CalendarDays,color:"text-emerald-600",bg:"bg-emerald-50"},
  {to:"/chamados",label:"Ocorrências",icon:Wrench,color:"text-orange-600",bg:"bg-orange-50"},
  {to:"/avisos",label:"Avisos",icon:Megaphone,color:"text-rose-500",bg:"bg-rose-50"},
  {to:"/reservas?tab=minhas",label:"Minhas reservas",icon:CalendarDays,color:"text-violet-600",bg:"bg-violet-50"},
  {to:"/#monitoramento",label:"Nível de água",icon:Droplets,color:"text-sky-500",bg:"bg-sky-50"},
  {to:"/perfil",label:"Meu perfil",icon:UserRound,color:"text-blue-600",bg:"bg-blue-50"},
  {to:"/acessos",label:"Abrir portões",icon:DoorOpen,color:"text-emerald-600",bg:"bg-emerald-50"},
  {to:"/vagas",label:"Vagas carro/moto",icon:Car,color:"text-sky-600",bg:"bg-sky-50"},
  {to:"/consumo",label:"Consumo do imóvel",icon:ChartNoAxesCombined,color:"text-amber-600",bg:"bg-amber-50"},
];
export function Home({ buildingId }: { buildingId: string }) {
  const flags = useFeatures();
  const notices = useResource<Paged<Notice>>(flags.enabled("NOTICES") ? `/notices?buildingId=${buildingId}` : null);
  const readings = useResource<Paged<LatestReading>>(flags.enabled("WATER_TANK") ? `/telemetry/latest?buildingId=${buildingId}` : null);
  const mine = useResource<Paged<Occurrence>>(flags.enabled("TICKETS") ? `/occurrences?buildingId=${buildingId}&limit=5` : null);
  useEffect(()=>{const timer=setInterval(readings.reload,10000);return ()=>clearInterval(timer);},[readings.reload]);
  const level = readings.data?.items.find(reading=>reading.metric==="water_level_percent");
  const percent = numericReading(level);
  return <>
    <div className="grid grid-cols-3 gap-2.5">{shortcuts.filter(link => flags.routeAllowed(link.to)).map(({to,label,icon:Icon,color,bg})=><Link key={to} to={to} onClick={to.includes("#") ? ()=>document.getElementById("monitoramento")?.scrollIntoView({behavior:"smooth"}) : undefined} className="flex min-h-[112px] flex-col items-center justify-center gap-2.5 rounded-2xl border border-white bg-white px-2 py-3 text-center shadow-sm shadow-slate-100 transition hover:border-emerald-200"><span className={`rounded-2xl p-2.5 ${bg} ${color}`}><Icon size={29} strokeWidth={2.3}/></span><span className="max-w-24 text-[11px] font-semibold leading-4 text-[#152d4b]">{label}</span></Link>)}</div>
    <Feature name="NOTICES"><Card title="Avisos do condomínio" action={<Link to="/avisos" className="text-xs text-sky-600">Ver todos</Link>}>
      {notices.data?.items.length ? <ul className="divide-y divide-slate-100">{notices.data.items.slice(0,3).map((notice,i)=><li key={notice.id}><Link to="/avisos" className="flex items-center gap-3 py-3 first:pt-1"><span className={`rounded-xl p-2.5 ${i%2 ? "bg-violet-50 text-violet-500" : "bg-sky-50 text-sky-500"}`}><Megaphone size={23}/></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold leading-5 text-[#152d4b]">{notice.title}</p><p className="line-clamp-2 text-[11px] leading-4 text-slate-500">{notice.body}</p></div><ChevronRight size={17} className="shrink-0 text-slate-400"/></Link></li>)}</ul> : <ResourceFeedback resource={notices} emptyText="Nenhum aviso publicado."/>}
    </Card></Feature>
    <div className="flex items-center gap-3 rounded-xl bg-[#ddf7e9] px-4 py-5"><div className="flex-1"><h2 className="text-base font-bold leading-5 text-[#15344f]">Vamos manter nosso<br/>condomínio ainda melhor!</h2><p className="mt-2 text-xs leading-5 text-[#426353]">Respeite os horários e colabore com as áreas comuns.</p></div><Leaf size={58} strokeWidth={1.5} className="shrink-0 -rotate-12 text-[#4ba872]"/></div>
    <Feature name="WATER_TANK"><div id="monitoramento" className="scroll-mt-4"><Card title="Nível da caixa d’água" action={<Droplets size={21} className="text-sky-500"/>}>{percent !== null ? <><div className="flex items-end justify-between"><p className="text-[32px] font-bold text-[#173451]">{formatNumber(percent,0)}%</p><span className="pb-2 text-[11px] text-slate-500">{level?.device_name}</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#21a6e5]" style={{width:`${Math.min(100,Math.max(0,percent))}%`}}/></div><p className="mt-3 text-[11px] text-slate-500">{readingStatus(level)} · {formatRelative(level?.time)}</p></> : <ResourceFeedback resource={readings} emptyText="Sem leitura validada no momento."/>}</Card></div></Feature>
    <Feature name="TICKETS"><Card title="Minhas ocorrências" action={<Link to="/chamados" className="text-xs text-sky-600">Ver todas</Link>}>
      {mine.data?.items.length ? <ul className="divide-y divide-slate-100">{mine.data.items.map(occurrence=><li key={occurrence.id} className="flex items-center gap-2 py-3 first:pt-0"><span className={`rounded-xl p-2 ${occurrence.status==="DONE" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"}`}>{occurrence.status==="DONE" ? <CheckCircle2 size={22}/> : <Wrench size={22}/>}</span><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-[#152d4b]">{occurrence.title}</p><p className="mt-1 text-[10px] text-slate-500">#{occurrence.protocol}</p></div><Badge>{occurrence.status}</Badge></li>)}</ul> : <ResourceFeedback resource={mine} emptyText="Você ainda não abriu ocorrências."/>}
    </Card></Feature>
  </>;
}
