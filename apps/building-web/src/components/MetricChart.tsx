import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, formatTime } from "@predioon/ui";
import type { SeriesPoint } from "@predioon/ui";

type Props = { points: SeriesPoint[]; unit?: string; color?: string };

export function MetricChart({ points, unit, color = "#059669" }: Props) {
  if (!points.length) return <EmptyState text="Ainda não há histórico para este período." />;

  const data = points.map((point) => ({
    label: formatTime(point.bucket),
    valor: point.avg_value === null ? null : Number(point.avg_value),
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1" />
          <YAxis tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1" />
          <Tooltip
            formatter={(value: number | string) => [`${value}${unit ? ` ${unit}` : ""}`, "Média"]}
            contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
          />
          <Line type="monotone" dataKey="valor" stroke={color} strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
