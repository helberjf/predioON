import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertCircle, AlertTriangle, ArrowRight, Building2, CalendarDays, Cpu, Droplets, RadioTower, Thermometer, Users, Zap } from "lucide-react";
import { buildingImage, Card, ErrorBanner, PageHeading, ProgressRing, ResourceFeedback, useResource } from "@predioon/ui";
import type { PlatformOverview } from "@predioon/ui";

const TYPES = [
  {types:["WATER_LEVEL_SENSOR","WATER_METER"],label:"Água",icon:Droplets,color:"#259de9"},
  {types:["PHASE_MONITOR","ENERGY_METER"],label:"Energia",icon:Zap,color:"#f5b718"},
  {types:["PUMP_MONITOR"],label:"Bombas",icon:Activity,color:"#13ac7c"},
  {types:["LEAK_SENSOR","SEWAGE_LEAK_SENSOR"],label:"Vazamentos",icon:AlertCircle,color:"#8564ed"},
  {types:["TEMPERATURE_SENSOR"],label:"Temperatura",icon:Thermometer,color:"#fa6573"},
];
export function Overview() {
  const overview=useResource<PlatformOverview>("/overview/platform");
  const [selected,setSelected]=useState("");
  useEffect(()=>{const timer=setInterval(overview.reload,15000);return()=>clearInterval(timer);},[overview.reload]);
  const data=overview.error?null:overview.data;
  const directory=data?.directoryAvailability==='available';
  const selection=data?.buildings?.find(b=>b.id===selected);
  const buildings=(data?.buildings??[]).filter(b=>!selection||b.id===selection.id);
  const counts=data?.counts;
  const categories=selection?.categories??data?.categories??[];
  const groups=TYPES.map(group=>({...group,total:categories.filter(c=>group.types.includes(c.type)).reduce((n,c)=>n+c.devices,0),online:categories.filter(c=>group.types.includes(c.type)).reduce((n,c)=>n+c.devices_online,0)}));
  const others=categories.filter(c=>!TYPES.some(g=>g.types.includes(c.type))).reduce((n,c)=>n+c.devices,0);
  const distribution=[...groups.map(g=>({label:g.label,color:g.color,total:g.total})),{label:'Outros',color:'#94a3b8',total:others}].filter(g=>g.total>0);
  const equipment=categories.reduce((n,c)=>n+c.devices,0);
  let start=0;
  const gradient=distribution.map(g=>{const end=start+g.total/equipment*100,part=`${g.color} ${start}% ${end}%`;start=end;return part;}).join(',');
  const gateways=selection?.gateways??counts?.gateways,gatewaysOnline=selection?.gateways_online??counts?.gateways_online;
  const open=selection?.open_alerts??counts?.open_alerts,critical=selection?.critical_alerts??counts?.critical_alerts;
  const directoryText=data&&!directory?'Diretório de condomínios indisponível para sua conta.':'Nenhum condomínio ativo.';
  const tiles=[
    {label:'Condomínios ativos',value:counts?.buildings,icon:Building2,bg:'#e0f8ed',color:'#06a36f',to:'/predios'},
    {label:'Gateways online',value:counts?`${counts.gateways_online}/${counts.gateways}`:undefined,icon:RadioTower,bg:'#e2f1fe',color:'#148feb',to:'/gateways'},
    {label:'Alertas abertos',value:counts?.open_alerts,icon:AlertTriangle,bg:'#fff6dc',color:'#e7a20b',to:'/alertas'},
    {label:'Alertas de alta prioridade',value:counts?.critical_alerts,icon:AlertCircle,bg:'#feeaed',color:'#ef4656',to:'/alertas'},
    {label:'Usuários ativos',value:counts?.users,icon:Users,bg:'#eaf0f6',color:'#20436b',to:'/usuarios'},
    {label:'Sensores online',value:counts?`${counts.devices_online}/${counts.devices}`:undefined,icon:Cpu,bg:'#f0eaff',color:'#8354d9',to:'/dispositivos'},
  ];
  return <>
    <PageHeading title="Visão geral dos condomínios" description="Status agregado dos condomínios, equipamentos e alertas da plataforma." action={<div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2"><CalendarDays size={20}/><div><p className="text-[10px] text-slate-500">Hoje</p><p className="text-xs text-[#193551]">{new Date().toLocaleDateString('pt-BR')}</p></div></div>}/>
    {overview.error&&<ErrorBanner message={overview.error}/>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{tiles.map(({label,value,icon:Icon,bg,color,to})=><Link key={label} to={to} className="flex items-center gap-3 rounded-lg border border-white/60 px-3 py-5 transition hover:shadow-md" style={{background:bg}}><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white" style={{background:color}}><Icon size={24}/></span><div><p className="text-2xl font-bold text-[#173451]">{value??'—'}</p><p className="mt-2 text-[11px] text-[#4d6078]">{label}</p></div></Link>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">{selection?'Status agregado do condomínio selecionado':'Status agregado de toda a plataforma'}</p>{directory&&<label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"><Building2 size={16}/><span className="sr-only">Filtrar quadros por condomínio</span><select value={selection?.id??''} onChange={e=>setSelected(e.target.value)} className="max-w-[240px] bg-transparent text-xs"><option value="">Todos os condomínios</option>{data?.buildings?.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}</div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.35fr_1fr_1fr]">
      <Card title="Condomínios da carteira" action={directory&&<Link to="/predios" className="text-xs text-sky-600">Ver todos</Link>}>
        <div className="grid min-h-[278px] grid-cols-[0.9fr_1fr] gap-3"><div className="relative overflow-hidden rounded-lg bg-[#12344e]"><img src={buildingImage} alt="" className="absolute inset-0 h-full w-full object-cover"/><div className="absolute inset-0 bg-gradient-to-t from-[#0c2030] via-transparent to-transparent"/><div className="absolute bottom-4 left-3"><p className="text-lg font-bold text-white">Seu prédio<br/><span className="text-emerald-400">sempre ON.</span></p><p className="mt-2 text-[9px] text-slate-300">Imagem ilustrativa</p></div></div><div>{buildings.length?<ul className="divide-y divide-slate-100">{buildings.slice(0,5).map(b=><li key={b.id} className="py-3"><button onClick={()=>setSelected(b.id)} className="flex gap-2 text-left"><Building2 size={15} className={b.open_alerts>0?'text-amber-500':'text-slate-500'}/><div><p className="text-xs font-semibold text-[#193551]">{b.name}</p><p className="text-[10px] text-slate-500">{b.organization_name}</p><p className="mt-1 text-[10px] text-slate-500">{b.open_alerts} alertas · {b.devices} sensores</p></div></button></li>)}</ul>:<ResourceFeedback resource={overview} emptyText={directoryText}/>}</div></div>
      </Card>
      <Card title="Status agregado dos sistemas" subtitle="Inventário e status online por categoria">
        {data?<div className="space-y-5 pt-1">{groups.map(({label,icon:Icon,color,total,online})=><div key={label} className="flex items-center gap-3"><Icon size={23} style={{color}}/><div className="flex-1"><div className="mb-1.5 flex justify-between text-xs"><span>{label}</span><span className="text-slate-500">{total?`${online}/${total} online`:'Nenhum equipamento'}</span></div><div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#24b388]" style={{width:`${total?online/total*100:0}%`}}/></div></div></div>)}<p className="text-xs text-slate-500">Comunicação: {gatewaysOnline}/{gateways} gateways online</p></div>:<ResourceFeedback resource={overview} emptyText="Status indisponível."/>}
      </Card>
      <Card title="Alertas pendentes" subtitle="Contagens agregadas">
        {data?<div className="space-y-4"><p className="text-3xl font-bold text-[#193551]">{open}</p><p className="text-xs text-slate-600">alertas abertos · {critical} de alta prioridade</p><p className="text-xs text-slate-500">O conteúdo dos alertas exige acesso local ao condomínio.</p><Link to="/alertas" className="inline-flex items-center gap-1 text-xs text-sky-600">Ver alertas no seu escopo <ArrowRight size={13}/></Link></div>:<ResourceFeedback resource={overview} emptyText="Alertas agregados indisponíveis."/>}
      </Card>
    </div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.35fr_1fr_1fr]">
      <Card title="Equipamentos por condomínio" subtitle="Distribuição agregada dos sensores">
        {buildings.length?<div className="space-y-4 py-2">{buildings.slice(0,6).map(b=><div key={b.id}><div className="mb-2 flex justify-between text-xs"><span>{b.name}</span><strong>{b.devices}</strong></div><div className="h-3 rounded bg-sky-50"><div className="h-full rounded bg-[#38a5ed]" style={{width:`${b.devices/Math.max(1,...buildings.map(row=>row.devices))*100}%`}}/></div></div>)}</div>:<ResourceFeedback resource={overview} emptyText={directoryText}/>}
      </Card>
      <Card title="Tipos de equipamento" subtitle="Composição agregada do monitoramento">
        {data&&equipment>0?<div className="flex flex-wrap items-center justify-center gap-5 py-3"><div role="img" aria-label={distribution.map(g=>`${g.label}: ${g.total}`).join(', ')} className="flex h-36 w-36 items-center justify-center rounded-full" style={{background:`conic-gradient(${gradient})`}}><div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white"><strong className="text-3xl text-[#193551]">{equipment}</strong><span className="text-[10px] text-slate-500">equipamentos</span></div></div><ul className="space-y-2.5">{distribution.map(g=><li key={g.label} className="flex gap-2 text-[11px]"><span className="h-2 w-2 rounded-full" style={{background:g.color}}/>{g.label}<strong>{g.total}</strong></li>)}</ul></div>:<ResourceFeedback resource={overview} emptyText="Nenhum equipamento nos totais agregados."/>}
      </Card>
      <Card title="Comunicação dos condomínios" subtitle="Status agregado dos gateways"><div className="flex flex-wrap items-center justify-center gap-4 py-4"><ProgressRing label="Gateways online" value={gateways!=null&&gatewaysOnline!=null&&gateways>0?gatewaysOnline/gateways*100:null}/><div><p className="text-lg font-bold text-[#193551]">{gateways!=null?`${gatewaysOnline} de ${gateways}`:'—'}</p><p className="mt-1 text-xs text-slate-500">gateways online</p></div></div></Card>
    </div>
  </>;
}
