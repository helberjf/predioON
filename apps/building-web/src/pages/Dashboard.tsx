import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, Cpu, Droplets, Megaphone, RadioTower, Wrench, Zap } from "lucide-react";
import { Badge, Card, ErrorBanner, ResourceFeedback, formatNumber, formatRelative, numericReading, booleanReading, readingStatus, PageHeading, StatTile, useAuth, useRealtime, useResource, WaterTank } from "@predioon/ui";
import type { BuildingOverview, LatestReading, Notice, Paged } from "@predioon/ui";
import { HistoryCard } from "../components/HistoryCard.js";

const quick = [{to:"/chamados",label:"Nova ocorrência",icon:Wrench},{to:"/areas",label:"Áreas comuns",icon:CalendarDays},{to:"/avisos",label:"Publicar aviso",icon:Megaphone},{to:"/regras",label:"Regras de alerta",icon:Activity}];
export function Dashboard({ buildingId }: { buildingId: string }) {
  const { user } = useAuth();
  const overview = useResource<BuildingOverview>(`/overview/building?buildingId=${encodeURIComponent(buildingId)}`);
  const latest = useResource<Paged<LatestReading>>(`/telemetry/latest?buildingId=${encodeURIComponent(buildingId)}`);
  const notices = useResource<Paged<Notice>>(`/notices?buildingId=${encodeURIComponent(buildingId)}`);
  const [frames, setFrames] = useState<Record<string, LatestReading>>({});
  useEffect(() => setFrames({}), [buildingId]);
  useEffect(() => { const timer = setInterval(() => { latest.reload(); overview.reload(); }, 10000); return () => clearInterval(timer); }, [latest.reload, overview.reload]);
  const connected = useRealtime(event => {
    if (event.buildingId !== buildingId) return;
    if (event.kind === "telemetry") setFrames(current => ({ ...current, [`${event.deviceId}:${event.metric}`]: {
      device_id:event.deviceId,device_name:event.deviceId,metric:event.metric,value:event.value,
      numeric_value:typeof event.value === "number" ? event.value : null,unit:event.unit ?? null,quality:event.quality ?? "GOOD",time:event.time,
    }}));
    else overview.reload();
  });
  const readings = Object.fromEntries((latest.data?.items ?? []).map(r => [`${r.device_id}:${r.metric}`,r]));
  for (const [key, frame] of Object.entries(frames)) {
    if (!readings[key] || new Date(frame.time).getTime() >= new Date(readings[key].time).getTime()) readings[key] = {...frame,device_name:readings[key]?.device_name ?? frame.device_name};
  }
  const values = Object.values(readings);
  const water = values.find(r => r.metric === "water_level_percent");
  const volume = values.find(r => r.device_id === water?.device_id && r.metric === "volume_liters");
  const pump = values.find(r => r.metric === "pump_running");
  const phase = values.find(r => r.metric === "voltage_l1");
  const voltages = ["voltage_l1","voltage_l2","voltage_l3"].map(metric => values.find(r => r.device_id === phase?.device_id && r.metric === metric));
  const hasPhases = voltages.every(r => numericReading(r) !== null && readingStatus(r) === "Leitura recente");
  const running = booleanReading(pump);
  const level = numericReading(water);
  const counts = overview.data?.counts;
  const open = Number(counts?.open_alerts ?? 0);
  const current = values.length > 0 && values.every(r => readingStatus(r) === "Leitura recente");
  const allOnline = counts && Number(counts.devices) > 0 && Number(counts.devices_online) === Number(counts.devices);
  const normal = !overview.error && !latest.error && current && allOnline && open === 0;
  const status = overview.loading && !counts ? "Carregando a situação do condomínio" : open > 0 ? `${open} alerta${open === 1 ? " precisa" : "s precisam"} de atenção` : normal ? "Sistemas monitorados sem alertas abertos" : "Acompanhe a atualização dos sensores";
  const StatusIcon = normal ? CheckCircle2 : AlertTriangle;
  return <>
    <PageHeading title={`Olá, ${user?.name.split(" ")[0] ?? "síndico"}!`} description="Aqui está a situação do seu condomínio hoje." action={<div className="text-right"><p className="text-sm font-medium text-slate-600">{new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}</p><span className="mt-2 inline-flex items-center gap-2 text-xs text-slate-500"><span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-400"}`} />{connected ? "Atualizações em tempo real" : "Atualização a cada 10 segundos"}</span></div>} />
    {user?.email.endsWith("@predioon.local") && <p className="text-xs font-medium text-slate-500">Conta de demonstração · Leituras do simulador quando ele estiver ativo.</p>}
    {overview.error && <ErrorBanner message={overview.error} />}{latest.error && <ErrorBanner message={latest.error} />}
    <div className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 ${normal ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><div className="flex items-center gap-4"><StatusIcon className={normal ? "text-emerald-600" : "text-amber-600"} size={30}/><div><h2 className="font-semibold text-slate-900">{status}</h2><p className="mt-1 text-sm text-slate-600">{normal ? "Continue acompanhando as leituras e manutenções." : "Consulte os alertas e a última comunicação de cada equipamento."}</p></div></div><Link className="flex items-center gap-2 text-sm font-semibold text-slate-700" to="/alertas">Ver detalhes <ArrowRight size={16}/></Link></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <StatTile label="Água" value={level === null ? "—" : `${formatNumber(level,0)}%`} detail={readingStatus(water)} icon={Droplets} tone="info" />
      <StatTile label="Energia" value={hasPhases ? `${voltages.filter(r => Number(r?.numeric_value) > 0).length}/3` : "—"} detail={hasPhases ? "Fases com tensão" : "Aguardando leituras das fases"} icon={Zap} tone="warning" />
      <StatTile label="Bomba" value={running === null ? "—" : running ? "Ligada" : "Desligada"} detail={readingStatus(pump)} icon={Activity} tone="success" />
      <StatTile label="Dispositivos" value={counts ? `${counts.devices_online}/${counts.devices}` : "—"} detail="Equipamentos online" icon={Cpu} />
      <StatTile label="Alertas abertos" value={counts ? String(open) : "—"} detail="Verifique a prioridade" icon={AlertTriangle} tone={open ? "warning" : "neutral"} />
    </div>
    <div className="grid items-start gap-5 xl:grid-cols-[1.7fr_1fr]">
      <HistoryCard deviceId={water?.device_id ?? ""} metric="water_level_percent" title="Histórico da caixa d’água" unit="%" color="#0ea5e9" />
      <Card title="Nível do reservatório" action={<Link to="/agua" className="text-xs font-semibold text-sky-600">Ver detalhes →</Link>}><WaterTank level={level}/><div className="flex justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500"><span>{water?.device_name ?? "Aguardando sensor"}</span><strong className="text-slate-700">{numericReading(volume) === null ? "Volume não informado" : `${formatNumber(numericReading(volume),0)} L`}</strong></div></Card>
    </div>
    <div className="grid items-start gap-5 xl:grid-cols-3">
      <Card title="Alertas recentes" action={<Link to="/alertas" className="text-xs font-semibold text-sky-600">Ver todos</Link>}>
        {overview.data?.latestAlerts.length ? <ul className="divide-y divide-slate-100">{overview.data.latestAlerts.slice(0,4).map(a => <li key={a.id} className="py-3 first:pt-0"><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-slate-700">{a.message}</p><Badge>{a.severity}</Badge></div><p className="mt-1 text-xs text-slate-400">{formatRelative(a.triggered_at)}</p></li>)}</ul> : <ResourceFeedback resource={overview} emptyText="Nenhum alerta aberto."/>}
      </Card>
      <Card title="Avisos do condomínio" action={<Link to="/avisos" className="text-xs font-semibold text-sky-600">Ver todos</Link>}>
        {notices.data?.items.length ? <ul className="divide-y divide-slate-100">{notices.data.items.slice(0,4).map(n => <li key={n.id} className="flex gap-3 py-3 first:pt-0"><Megaphone size={18} className="mt-1 shrink-0 text-emerald-500"/><div><p className="text-sm font-medium text-slate-700">{n.title}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{n.body}</p></div></li>)}</ul> : <ResourceFeedback resource={notices} emptyText="Nenhum aviso publicado."/>}
      </Card>
      <Card title="Acesso rápido"><div className="grid grid-cols-2 gap-3">{quick.map(({to,label,icon:Icon}) => <Link key={to} to={to} className="flex min-h-24 flex-col items-center justify-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-center text-xs font-medium text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50"><Icon size={23}/>{label}</Link>)}</div><div className="mt-5 flex items-center gap-2 text-xs text-slate-500"><RadioTower size={15}/>{counts ? `${counts.gateways_online}/${counts.gateways} gateways online` : "Consultando comunicação"}</div></Card>
    </div>
  </>;
}
