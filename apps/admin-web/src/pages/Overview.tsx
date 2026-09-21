import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertCircle, AlertTriangle, ArrowRight, Building2, CalendarDays, CheckCircle2, Cpu, Droplets, RadioTower, Thermometer, Users, Zap } from "lucide-react";
import { Badge, buildingImage, Card, ErrorBanner, formatRelative, PageHeading, ProgressRing, ResourceFeedback, useResource } from "@predioon/ui";
import type { Alert, Device, Paged } from "@predioon/ui";

type Building = { id:string; name:string; code:string; organization_name:string; gateways:string; gateways_online:string; devices:string; open_alerts:string };
type PlatformOverview = { counts:Record<string,string>; buildings:Building[] };
const TYPES = [
  {type:"WATER_LEVEL_SENSOR",label:"Água",icon:Droplets,color:"#259de9"},
  {type:"PHASE_MONITOR",label:"Energia",icon:Zap,color:"#f5b718"},
  {type:"PUMP_MONITOR",label:"Bombas",icon:Activity,color:"#13ac7c"},
  {type:"LEAK_SENSOR",label:"Vazamentos",icon:AlertCircle,color:"#8564ed"},
  {type:"TEMPERATURE_SENSOR",label:"Temperatura",icon:Thermometer,color:"#fa6573"},
];
export function Overview() {
  const overview = useResource<PlatformOverview>("/overview/platform");
  const devices = useResource<Paged<Device>>("/devices");
  const [selected,setSelected] = useState("");
  const alerts = useResource<Paged<Alert>>(`/alerts?status=OPEN&limit=5${selected ? `&buildingId=${encodeURIComponent(selected)}` : ""}`);
  useEffect(() => { const timer = setInterval(() => { overview.reload(); devices.reload(); alerts.reload(); },15000); return () => clearInterval(timer); },[overview.reload,devices.reload,alerts.reload]);
  const counts = overview.data?.counts;
  const buildings = (overview.data?.buildings ?? []).filter(building => !selected || building.id === selected);
  const equipment = devices.data?.items.filter(device => !selected || device.buildingId === selected) ?? [];
  const groups = TYPES.map(group => ({...group,items:equipment.filter(device => device.type === group.type)}));
  const others = equipment.filter(device => !TYPES.some(group => group.type === device.type));
  const distribution = [...groups.map(group => ({label:group.label,color:group.color,total:group.items.length})),{label:"Outros",color:"#94a3b8",total:others.length}].filter(group => group.total > 0);
  let start = 0;
  const gradient = distribution.map(group => { const end = start + group.total / equipment.length * 100; const part = `${group.color} ${start}% ${end}%`; start=end; return part; }).join(",");
  const gateways = buildings.reduce((sum,building) => sum+Number(building.gateways),0);
  const gatewaysOnline = buildings.reduce((sum,building) => sum+Number(building.gateways_online),0);
  const tiles = [
    {label:"Condomínios ativos",value:counts?.buildings,icon:Building2,bg:"#e0f8ed",color:"#06a36f",to:"/predios"},
    {label:"Gateways online",value:counts ? `${counts.gateways_online}/${counts.gateways}` : undefined,icon:CheckCircle2,bg:"#e2f1fe",color:"#148feb",to:"/gateways"},
    {label:"Alertas abertos",value:counts?.open_alerts,icon:AlertTriangle,bg:"#fff6dc",color:"#e7a20b",to:"/alertas"},
    {label:"Alertas de alta prioridade",value:counts?.critical_alerts,icon:AlertCircle,bg:"#feeaed",color:"#ef4656",to:"/alertas"},
    {label:"Usuários ativos",value:counts?.users,icon:Users,bg:"#eaf0f6",color:"#20436b",to:"/usuarios"},
    {label:"Sensores online",value:counts ? `${counts.devices_online}/${counts.devices}` : undefined,icon:Cpu,bg:"#f0eaff",color:"#8354d9",to:"/dispositivos"},
  ];
  return <>
    <PageHeading title="Visão geral dos condomínios" description="Acompanhe os condomínios, equipamentos e alertas da sua carteira." action={<div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2"><CalendarDays size={20} className="text-[#2e4a6b]"/><div><p className="text-[10px] text-slate-500">Hoje</p><p className="text-xs text-[#193551]">{new Date().toLocaleDateString("pt-BR")}</p></div></div>}/>
    {overview.error && <ErrorBanner message={overview.error}/>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{tiles.map(({label,value,icon:Icon,bg,color,to}) => <Link key={label} to={to} className="flex items-center gap-3 rounded-lg border border-white/60 px-3 py-5 transition hover:shadow-md" style={{background:bg}}><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white" style={{background:color}}><Icon size={24}/></span><div className="min-w-0"><p className="text-2xl font-bold leading-none tracking-tight text-[#173451]">{value ?? "—"}</p><p className="mt-2 text-[11px] leading-4 text-[#4d6078]">{label}</p></div></Link>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1"><p className="text-xs font-medium text-slate-500">{selected ? "Detalhes do condomínio selecionado" : "Monitoramento de toda a carteira"}</p><label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"><Building2 size={16} className="text-[#1b3e60]"/><span className="sr-only">Filtrar quadros por condomínio</span><select className="max-w-[240px] bg-transparent text-xs text-[#193551] outline-none" value={selected} onChange={event => setSelected(event.target.value)}><option value="">Todos os condomínios</option>{overview.data?.buildings.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}</select></label></div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.35fr_1fr_1fr]">
      <Card title="Condomínios da carteira" action={<Link to="/predios" className="text-xs text-sky-600">Ver todos</Link>}>
        <div className="grid min-h-[278px] grid-cols-[0.9fr_1fr] gap-3">
          <div className="relative overflow-hidden rounded-lg bg-[#12344e]"><img src={buildingImage} alt="" className="absolute inset-0 h-full w-full object-cover"/><div className="absolute inset-0 bg-gradient-to-t from-[#0c2030] via-transparent to-transparent"/><div className="absolute bottom-4 left-3 right-3"><p className="text-lg font-bold text-white">Seu prédio<br/><span className="text-emerald-400">sempre ON.</span></p><p className="mt-2 text-[9px] text-slate-300">Imagem ilustrativa</p></div></div>
          <div>{buildings.length ? <ul className="divide-y divide-slate-100">{buildings.slice(0,5).map(building => <li key={building.id} className="py-3 first:pt-1"><button onClick={() => setSelected(building.id)} className="flex w-full items-start gap-2 text-left"><span className={`mt-0.5 ${Number(building.open_alerts) > 0 ? "text-amber-500" : "text-emerald-600"}`}>{Number(building.open_alerts) > 0 ? <AlertCircle size={15}/> : <CheckCircle2 size={15}/>}</span><div><p className="text-xs font-semibold leading-5 text-[#193551]">{building.name}</p><p className="text-[10px] leading-4 text-slate-500">{building.organization_name}</p><p className="mt-1 text-[10px] text-slate-500">{building.open_alerts} alertas · {building.devices} sensores</p></div></button></li>)}</ul> : <ResourceFeedback resource={overview} emptyText="Nenhum condomínio cadastrado."/>}<Link to="/predios" className="mt-4 inline-flex items-center gap-1 text-[11px] text-sky-600">Gerenciar <ArrowRight size={13}/></Link></div>
        </div>
      </Card>
      <Card title="Status dos sistemas" subtitle="Equipamentos online por categoria">
        {devices.error ? <ResourceFeedback resource={devices} emptyText=""/> : <div className="space-y-5 pt-1">{groups.map(({label,icon:Icon,color,items}) => { const online = items.filter(device => device.status === "ONLINE").length; return <div key={label} className="flex items-center gap-3"><span style={{color}}><Icon size={23}/></span><div className="min-w-0 flex-1"><div className="mb-1.5 flex items-center justify-between gap-2"><span className="text-xs font-medium text-[#193551]">{label}</span><span className="text-[10px] text-slate-500">{devices.loading && !devices.data ? "…" : items.length ? `${online}/${items.length} online` : "Não cadastrado"}</span></div><div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#24b388]" style={{width:`${items.length ? online/items.length*100 : 0}%`}}/></div></div></div>;})}<div className="flex items-center gap-3"><RadioTower size={23} className="text-emerald-500"/><div className="flex-1"><div className="mb-1.5 flex justify-between"><span className="text-xs text-[#193551]">Comunicação</span><span className="text-[10px] text-slate-500">{gatewaysOnline}/{gateways} online</span></div><div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{width:`${gateways ? gatewaysOnline/gateways*100 : 0}%`}}/></div></div></div></div>}
      </Card>
      <Card title="Alertas pendentes" action={<Link to="/alertas" className="text-xs text-sky-600">Ver todos</Link>}>
        {alerts.data?.items.length ? <ul className="max-h-[290px] divide-y divide-slate-100 overflow-y-auto pr-1">{alerts.data.items.map(alert => <li key={alert.id} className="flex items-start gap-2 py-3 first:pt-0"><AlertTriangle size={19} className="mt-1 shrink-0 text-amber-500"/><div className="min-w-0 flex-1"><p className="text-xs font-semibold leading-5 text-[#193551]">{alert.message}</p><p className="text-[10px] text-slate-500">{overview.data?.buildings.find(building => building.id === alert.buildingId)?.name ?? alert.buildingId}</p><p className="mt-1 text-[10px] text-slate-400">{formatRelative(alert.triggeredAt)}</p></div><Badge>{alert.severity}</Badge></li>)}</ul> : <ResourceFeedback resource={alerts} emptyText="Nenhum alerta pendente neste momento."/>}
      </Card>
    </div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.35fr_1fr_1fr]">
      <Card title="Equipamentos por condomínio" subtitle="Distribuição dos sensores cadastrados">
        {buildings.length ? <div className="space-y-4 py-2">{buildings.slice(0,6).map(building => <div key={building.id}><div className="mb-2 flex items-center justify-between gap-3 text-xs"><span className="text-[#193551]">{building.name}</span><strong className="text-sky-600">{building.devices}</strong></div><div className="h-3 rounded bg-sky-50"><div className="h-full rounded bg-[#38a5ed]" style={{width:`${Number(building.devices)/Math.max(1,...buildings.map(b=>Number(b.devices)))*100}%`}}/></div></div>)}</div> : <ResourceFeedback resource={overview} emptyText="Cadastre seu primeiro condomínio."/>}
        <Link to="/dispositivos" className="mt-5 block text-right text-xs text-sky-600">Ver equipamentos →</Link>
      </Card>
      <Card title="Tipos de equipamento" subtitle="Composição do monitoramento">
        {equipment.length ? <div className="flex flex-wrap items-center justify-center gap-5 py-3"><div role="img" aria-label={distribution.map(group=>`${group.label}: ${group.total}`).join(", ")} className="flex h-36 w-36 shrink-0 items-center justify-center rounded-full" style={{background:`conic-gradient(${gradient})`}}><div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white"><strong className="text-3xl text-[#193551]">{equipment.length}</strong><span className="mt-1 text-[10px] text-slate-500">equipamentos</span></div></div><ul className="space-y-2.5">{distribution.map(group=><li key={group.label} className="flex items-center gap-2 text-[11px] text-slate-600"><span className="h-2 w-2 rounded-full" style={{background:group.color}}/>{group.label}<strong className="ml-auto pl-3 text-[#193551]">{group.total}</strong></li>)}</ul></div> : <ResourceFeedback resource={devices} emptyText="Nenhum equipamento cadastrado."/>}
      </Card>
      <Card title="Comunicação dos condomínios" subtitle="Conexão entre os sensores e a plataforma"><div className="flex flex-wrap items-center justify-center gap-4 py-4"><ProgressRing label="Gateways online" value={overview.data && gateways ? gatewaysOnline/gateways*100 : null}/><div><p className="text-lg font-bold text-[#193551]">{overview.data ? `${gatewaysOnline} de ${gateways}` : "—"}</p><p className="mt-1 text-xs text-slate-500">gateways online</p></div></div><Link to="/gateways" className="block text-right text-xs text-sky-600">Ver comunicação →</Link></Card>
    </div>
  </>;
}
