import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, ResourceFeedback, formatDayMonth, formatNumber, formatTime, useResource } from "@predioon/ui";
import type { Paged, SeriesPoint } from "@predioon/ui";

export function DashboardChart({ deviceId, metric, title, unit, color, value, to }: { deviceId?: string; metric: string; title: string; unit: string; color: string; value: number | null; to: string }) {
  const [period, setPeriod] = useState("7d");
  const [anchor, setAnchor] = useState(Date.now);
  useEffect(() => {
    if (!deviceId) return;
    const timer = setInterval(() => setAnchor(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [deviceId]);
  const query = new URLSearchParams({ deviceId: deviceId ?? "", metric, bucket: period === "7d" ? "1d" : "1h", from: new Date(anchor - (period === "7d" ? 7 : 1) * 86400000).toISOString(), to: new Date(anchor).toISOString() });
  const series = useResource<Paged<SeriesPoint>>(deviceId ? `/telemetry/series?${query}` : null);
  const points = series.data?.items ?? [];
  const data = points.map(point => ({ label: period === "7d" ? formatDayMonth(point.bucket) : formatTime(point.bucket), value: point.avg_value === null ? null : Number(point.avg_value) }));
  return <Card title={title} subtitle="Média das leituras" action={<div className="text-right"><p className="text-lg font-bold" style={{color}}>{value === null ? "—" : `${formatNumber(value, 0)} ${unit}`}</p><p className="text-[10px] text-slate-400">Última leitura</p></div>}>
    <div className="mb-3 flex items-center justify-between gap-2"><label><span className="sr-only">Período: {title}</span><select value={period} onChange={event => { setPeriod(event.target.value); setAnchor(Date.now()); }} className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500"><option value="7d">Últimos 7 dias</option><option value="24h">Últimas 24 horas</option></select></label><Link to={to} className="text-[11px] text-sky-600 hover:underline">Ver histórico →</Link></div>
    <div className="h-[164px] min-w-0">
      {points.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{left:-24,right:0,top:6,bottom:0}} accessibilityLayer><CartesianGrid stroke="#edf2f5" vertical={false}/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fontSize:10,fill:"#7b889b"}} minTickGap={22}/><YAxis axisLine={false} tickLine={false} tick={{fontSize:10,fill:"#7b889b"}} domain={unit === "%" ? [0,100] : [0,"auto"]}/><Tooltip cursor={{fill:"#f3f7fa"}} formatter={(v: number) => [`${formatNumber(v,1)} ${unit}`,"Média"]} contentStyle={{fontSize:12,borderRadius:8,border:"1px solid #e2e8f0"}}/><Bar dataKey="value" fill={color} barSize={27} radius={[2,2,0,0]} isAnimationActive={false}/></BarChart></ResponsiveContainer> : <ResourceFeedback resource={series} emptyText="Ainda não há leituras neste período."/>}
    </div>
  </Card>;
}
