import { useEffect, useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, ArrowRight, CalendarDays, Check, CheckCircle2, Cpu, Droplets, House, Megaphone, RadioTower, ShieldCheck, SlidersHorizontal, Thermometer, Wrench, Zap } from "lucide-react";
import { Feature, useFeatures, readingFeature, Badge, Card, ErrorBanner, ResourceFeedback, formatNumber, formatRelative, numericReading, booleanReading, readingStatus, PageHeading, ProgressRing, useAuth, useRealtime, useResource, WaterTank } from "@predioon/ui";
import type { AlertRule, BuildingOverview, Device, LatestReading, Notice, Paged, Tone } from "@predioon/ui";
import { sensorReadingState } from "@predioon/shared";
import { DashboardChart } from "../components/DashboardChart.js";

const quick = [{to:"/chamados",label:"Nova ocorrência",icon:Wrench},{to:"/areas",label:"Áreas comuns",icon:CalendarDays},{to:"/dispositivos",label:"Equipamentos",icon:Cpu},{to:"/avisos",label:"Avisos",icon:Megaphone},{to:"/agua",label:"Histórico de água",icon:Droplets},{to:"/regras",label:"Regras de alerta",icon:SlidersHorizontal}];
function SensorTile({label,value,detail,icon:Icon,color,status,tone,to}:{label:string;value:string;detail:string;icon:ComponentType<{size?:number;className?:string}>;color:string;status:string;tone:Tone;to:string}) {
  return <Link to={to} className="rounded-[10px] border border-[#e6eef3] bg-white p-3.5 transition hover:shadow-md"><div className="flex items-start gap-2.5"><span style={{color}}><Icon size={27}/></span><div className="min-w-0"><p className="text-xs font-semibold text-[#193551]">{label}</p><p className="mt-2 text-[17px] font-bold leading-tight text-[#142f50]">{value}</p><p className="mt-1 min-h-8 text-[11px] leading-4 text-slate-500">{detail}</p></div></div><div className="mt-2"><Badge tone={tone}>{status}</Badge></div></Link>;
}
export function Dashboard({ buildingId }: { buildingId: string }) {
  const { user } = useAuth();
  const flags = useFeatures();
  const query = `buildingId=${encodeURIComponent(buildingId)}`;
  const overview = useResource<BuildingOverview>(`/overview/building?${query}`);
  const latest = useResource<Paged<LatestReading>>(`/telemetry/latest?${query}`);
  const notices = useResource<Paged<Notice>>(flags.enabled("NOTICES") ? `/notices?${query}` : null);
  const devices = useResource<Paged<Device>>(`/devices?${query}`);
  const rules = useResource<Paged<AlertRule>>(`/alert-rules?${query}`);
  const [frames, setFrames] = useState<Record<string, LatestReading>>({});
  useEffect(() => setFrames({}), [buildingId]);
  useEffect(() => { const timer = setInterval(() => { latest.reload(); overview.reload(); devices.reload(); }, 10000); return () => clearInterval(timer); }, [latest.reload, overview.reload, devices.reload]);
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
  const values = Object.values(readings).filter(reading => { const feature = readingFeature(reading.metric); return !feature || flags.enabled(feature); });
  const water = values.find(r => r.metric === "water_level_percent");
  const volume = values.find(r => r.device_id === water?.device_id && r.metric === "volume_liters");
  const pump = values.find(r => r.metric === "pump_running");
  const phase = values.find(r => r.metric === "voltage_l1");
  const leak = values.find(r => r.metric === "water_leak_detected") ?? values.find(r => r.metric === "leak_detected");
  const temperature = values.find(r => r.metric === "temperature_c");
  const voltages = ["voltage_l1","voltage_l2","voltage_l3"].map(metric => values.find(r => r.device_id === phase?.device_id && r.metric === metric));
  const hasPhases = voltages.every(r => numericReading(r) !== null && readingStatus(r) === "Leitura recente");
  const leakState = sensorReadingState(leak, Date.now(), devices.data?.items.find(device => device.id === leak?.device_id)?.enabled !== false);
  const running = booleanReading(pump), leaking = leakState.status === "detected" ? true : leakState.status === "clear" ? false : null, level = numericReading(water), temp = numericReading(temperature);
  const counts = overview.data?.counts;
  const open = Number(counts?.open_alerts ?? 0);
  const current = values.length > 0 && values.every(r => readingStatus(r) === "Leitura recente");
  const allOnline = counts && Number(counts.devices) > 0 && Number(counts.devices_online) === Number(counts.devices);
  const normal = !overview.error && !latest.error && current && allOnline && open === 0;
  const status = overview.loading && !counts ? "Carregando a situação do condomínio" : open > 0 ? `${open} alerta${open === 1 ? " precisa" : "s precisam"} de atenção` : normal ? "Tudo em dia no monitoramento!" : "Acompanhe a atualização dos sensores";
  const StatusIcon = normal ? Check : AlertTriangle;
  const freshness = (reading?:LatestReading): {status:string;tone:Tone} => readingStatus(reading) === "Leitura recente" ? {status:"Leitura atualizada",tone:"success"} : {status:readingStatus(reading),tone:"neutral"};
  return <>
    <PageHeading title={`Olá, ${user?.name.split(" ")[0] ?? "síndico"}!`} description="Aqui está a situação do seu condomínio hoje." action={<div className="pt-1 text-right"><p className="text-xs text-slate-500">{new Date().toLocaleDateString("pt-BR",{weekday:"long"})}</p><p className="mt-1 text-xs text-slate-500">{new Date().toLocaleDateString("pt-BR",{day:"numeric",month:"long",year:"numeric"})}</p><span className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-slate-500"><span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-400"}`} />{connected ? "Atualizações em tempo real" : "Atualização a cada 10 segundos"}</span></div>} />
    {overview.error && <ErrorBanner message={overview.error} />}{latest.error && <ErrorBanner message={latest.error} />}
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-5 py-4 ${normal ? "border-emerald-200 bg-[#d9f5e9]" : "border-amber-200 bg-amber-50"}`}><div className="flex items-center gap-4"><span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${normal ? "bg-emerald-600 text-white" : "bg-amber-400 text-white"}`}><StatusIcon size={29}/></span><div><h2 className="text-lg font-bold tracking-tight text-[#142f50]">{status}</h2><p className="mt-0.5 text-xs text-slate-600">{normal ? "Sensores atualizados e nenhum alerta aberto." : "Confira os alertas e a última comunicação dos equipamentos."}</p></div></div><Link className="flex items-center gap-3 rounded-md bg-[#173d5a] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#235172]" to="/alertas">Ver detalhes <ArrowRight size={15}/></Link></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 min-[1200px]:grid-cols-6">
      <Feature name="WATER_TANK"><SensorTile label="Água" value={level === null ? "—" : `${formatNumber(level,0)}%`} detail={numericReading(volume) === null ? "Nível do reservatório" : `${formatNumber(numericReading(volume),0)} L no reservatório`} icon={Droplets} color="#16a5eb" to="/agua" {...freshness(water)}/></Feature>
      <Feature name="ELECTRICAL"><SensorTile label="Energia" value={hasPhases ? `${voltages.filter(r => Number(r?.numeric_value) > 0).length}/3` : "—"} detail="Fases com tensão" icon={Zap} color="#f3b918" to="/energia" {...(hasPhases ? {status:"Leituras atualizadas",tone:"success" as Tone} : {status:"Aguardando fases",tone:"neutral" as Tone})}/></Feature>
      <Feature name="PUMP"><SensorTile label="Bomba" value={running === null ? "—" : running ? "Ligada" : "Desligada"} detail="Bomba monitorada" icon={Activity} color="#12aa8b" to="/dispositivos" {...freshness(pump)}/></Feature>
      <Feature name="WATER_LEAK"><SensorTile label="Vazamento" value={leaking === null ? "—" : leaking ? "Detectado" : "Ausente"} detail="Sensor de vazamento de água" icon={ShieldCheck} color="#169eeb" to="/sensores" status={leakState.label} tone={leaking ? "danger" : leaking === false ? "info" : "neutral"}/></Feature>
      <Feature name="TEMPERATURE"><SensorTile label="Temperatura" value={temp === null ? "—" : `${formatNumber(temp,1)} °C`} detail="Ambiente monitorado" icon={Thermometer} color="#f15369" to="/dispositivos" {...freshness(temperature)}/></Feature>
      <SensorTile label="Comunicação" value={counts ? `${counts.gateways_online}/${counts.gateways}` : "—"} detail="Gateways online" icon={RadioTower} color="#11a982" to="/dispositivos" status={counts && Number(counts.gateways_online) > 0 ? "Conectado" : "Sem conexão"} tone={counts && Number(counts.gateways_online) > 0 ? "success" : "neutral"}/>
    </div>
    <div className="grid gap-3 md:grid-cols-2 min-[1200px]:grid-cols-[1.25fr_1.25fr_1fr]">
      <Feature name="WATER_TANK"><DashboardChart deviceId={water?.device_id} metric="water_level_percent" title="Nível da caixa d’água" unit="%" color="#38adeb" value={level} to="/agua"/></Feature>
      <Feature name="ELECTRICAL"><DashboardChart deviceId={phase?.device_id} metric="voltage_l1" title="Tensão de energia · Fase 1" unit="V" color="#58bc82" value={numericReading(phase)} to="/energia"/></Feature>
      <Feature name="WATER_TANK"><Card title="Seu reservatório"><WaterTank level={level}/><div className="flex items-start justify-between gap-2 text-xs"><div><strong className="text-[#193551]">{numericReading(volume) === null ? "Volume não informado" : `${formatNumber(numericReading(volume),0)} litros`}</strong><p className="mt-1 text-[11px] text-slate-500">{water?.device_name ?? "Aguardando sensor"}</p></div><Link to="/agua" className="shrink-0 text-sky-600">Detalhes →</Link></div></Card></Feature>
    </div>
    <div className="grid gap-3 md:grid-cols-2 min-[1200px]:grid-cols-[1.25fr_1.25fr_1fr]">
      <Card title="Alertas recentes" action={<Link to="/alertas" className="text-xs text-sky-600">Ver todos</Link>}>
        {overview.data?.latestAlerts.length ? <ul className="divide-y divide-slate-100">{overview.data.latestAlerts.slice(0,4).map(a => <li key={a.id} className="flex items-start gap-2.5 py-3 first:pt-0"><span className="rounded-lg bg-amber-50 p-2 text-amber-500"><AlertTriangle size={19}/></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold leading-5 text-[#193551]">{a.message}</p><p className="text-[11px] text-slate-500">{formatRelative(a.triggered_at)}</p></div><Badge>{a.severity}</Badge></li>)}</ul> : <ResourceFeedback resource={overview} emptyText="Nenhum alerta aberto. Continue acompanhando seu condomínio."/>}
      </Card>
      <Feature name="NOTICES"><Card title="Avisos do condomínio" action={<Link to="/avisos" className="text-xs text-sky-600">Ver todos</Link>}>
        {notices.data?.items.length ? <ul className="divide-y divide-slate-100">{notices.data.items.slice(0,4).map((n,i) => <li key={n.id} className="flex gap-3 py-3 first:pt-0"><span className={`h-fit rounded-lg p-2 ${i%2 ? "bg-violet-50 text-violet-500" : "bg-sky-50 text-sky-500"}`}><Megaphone size={20}/></span><div><p className="text-xs font-semibold leading-5 text-[#193551]">{n.title}</p><p className="line-clamp-2 text-[11px] leading-4 text-slate-500">{n.body}</p></div></li>)}</ul> : <ResourceFeedback resource={notices} emptyText="Nenhum aviso publicado."/>}
      </Card></Feature>
      <Card title="Acesso rápido"><div className="grid grid-cols-2 gap-2">{quick.filter(link => flags.routeAllowed(link.to)).map(({to,label,icon:Icon}) => <Link key={to} to={to} className="flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-[#f2f6f9] p-2 text-center text-[11px] font-medium text-[#193551] transition hover:border-emerald-200 hover:bg-emerald-50"><Icon size={24}/>{label}</Link>)}</div></Card>
    </div>
    <div className="grid gap-3 md:grid-cols-2 min-[1200px]:grid-cols-[1.25fr_1.25fr_1fr]">
      <Card title="Equipamentos monitorados" action={<Link to="/dispositivos" className="text-xs text-sky-600">Ver todos</Link>}>
        {devices.data?.items.length ? <ul className="divide-y divide-slate-100">{devices.data.items.slice(0,4).map(device => <li key={device.id} className="flex items-center gap-2.5 py-2 first:pt-0"><span className="rounded-lg bg-sky-50 p-2 text-sky-600"><Cpu size={17}/></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#193551]">{device.name}</p><p className="text-[10px] text-slate-500">{formatRelative(device.lastSeenAt)}</p></div><Badge>{device.status}</Badge></li>)}</ul> : <ResourceFeedback resource={devices} emptyText="Nenhum equipamento cadastrado."/>}
      </Card>
      <Card title="Prevenção e acompanhamento" action={<Link to="/regras" className="text-xs text-sky-600">Ver regras</Link>}>
        {rules.data?.items.length ? <ul className="space-y-3">{rules.data.items.slice(0,3).map(rule => <li key={rule.id} className="flex items-center gap-3"><span className="rounded-lg bg-emerald-50 p-2 text-emerald-600"><ShieldCheck size={19}/></span><div className="flex-1"><p className="text-xs font-semibold text-[#193551]">{rule.name}</p><p className="mt-1 text-[11px] text-slate-500">{rule.enabled ? "Monitoramento automático ativo" : "Regra desativada"}</p></div></li>)}</ul> : <ResourceFeedback resource={rules} emptyText="Configure regras para acompanhar os sensores."/>}
        <Feature name="TICKETS"><Link to="/chamados" className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-600"><span className="flex items-center gap-2"><Wrench size={16}/>{counts ? `${counts.open_occurrences} ${Number(counts.open_occurrences) === 1 ? "ocorrência aberta" : "ocorrências abertas"}` : "Acompanhar ocorrências"}</span><ArrowRight size={14}/></Link></Feature>
      </Card>
      <Card title="Conectividade dos sensores"><div className="flex items-center justify-center gap-3 py-2"><ProgressRing label="Sensores online" value={counts && Number(counts.devices) > 0 ? Number(counts.devices_online)/Number(counts.devices)*100 : null}/><div><p className="text-base font-bold text-[#193551]">{counts ? `${counts.devices_online} de ${counts.devices}` : "—"}</p><p className="mt-1 text-xs text-slate-500">equipamentos online</p></div></div><Link to="/dispositivos" className="mt-3 block text-right text-xs text-sky-600">Ver equipamentos →</Link></Card>
    </div>
    {user?.email.endsWith("@predioon.local") && <p className="text-[10px] text-slate-500">Ambiente de demonstração · Leituras do simulador quando ele estiver ativo.</p>}
  </>;
}
