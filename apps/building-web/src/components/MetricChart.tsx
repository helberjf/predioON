import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useId } from "react";
import { EmptyState, formatDateTime, formatDayMonth, formatNumber, formatTime } from "@predioon/ui";
import type { SeriesPoint } from "@predioon/ui";

type Props = { points: SeriesPoint[]; unit?: string; color?: string; daily?: boolean };

export function MetricChart({ points, unit, color = "#059669", daily = false }: Props) {
  const gradient = useId().replace(/:/g, "");
  if (!points.length) return <EmptyState text="Ainda não há histórico para este período." />;
  const data = points.map((point) => ({
    label: daily ? formatDayMonth(point.bucket) : formatTime(point.bucket),
    timestamp: point.bucket,
    valor: point.avg_value === null ? null : Number(point.avg_value),
  }));

  return <div className="h-64 w-full" role="img" aria-label={`Histórico com ${points.length} intervalos, em ${unit ?? "unidades"}. Os valores estão na tabela abaixo.`}>
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 14, right: 12, bottom: 0, left: -18 }}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.16} /><stop offset="100%" stopColor={color} stopOpacity={0.01} /></linearGradient></defs>
        <CartesianGrid stroke="#e9eef3" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} minTickGap={38} dy={7} />
        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(value: number | string) => [`${formatNumber(value, 1)}${unit ? ` ${unit}` : ""}`, "Média"]} labelFormatter={(_, entries) => formatDateTime(entries[0]?.payload?.timestamp)} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
        <Area type="linear" dataKey="valor" stroke={color} strokeWidth={2.5} fill={`url(#${gradient})`} dot={data.length === 1} connectNulls={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
