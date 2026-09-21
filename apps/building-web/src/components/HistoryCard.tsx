import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, Card, formatDateTime, formatNumber, HISTORY_PERIODS, ResourceFeedback, Select, seriesPath, useResource } from "@predioon/ui";
import type { HistoryBucket, Paged, SeriesPoint } from "@predioon/ui";
import { MetricChart } from "./MetricChart.js";

export function HistoryCard({ deviceId, metric, title, unit, color, initialBucket = "1h" }: { deviceId: string; metric: string; title: string; unit: string; color?: string; initialBucket?: HistoryBucket }) {
  const [bucket, setBucket] = useState<HistoryBucket>(initialBucket);
  const [anchor, setAnchor] = useState(Date.now);
  const series = useResource<Paged<SeriesPoint>>(seriesPath(deviceId, metric, bucket, anchor));
  const points = series.data?.items ?? [];
  return <Card title={title} subtitle="Média das leituras por intervalo" action={<div className="flex flex-wrap items-center gap-2"><label className="w-44"><span className="sr-only">Período do histórico</span><Select value={bucket} onChange={(value) => { setBucket(value); setAnchor(Date.now()); }} options={HISTORY_PERIODS} /></label><Button variant="secondary" onClick={() => setAnchor(Date.now())} disabled={!deviceId || series.loading}><RefreshCw size={15} />Atualizar</Button></div>}>
    {!deviceId ? <ResourceFeedback resource={{ ...series, loading: false }} emptyText="Selecione um sensor para consultar seu histórico." /> : series.error || (!points.length && series.loading) ? <ResourceFeedback resource={series} emptyText="" /> : <MetricChart points={points} unit={unit} color={color} daily={bucket === "1d"} />}
    {points.length > 0 && <details className="mt-4 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-500">Ver leituras do gráfico ({points.length} intervalos)</summary><div className="mt-3 max-h-60 overflow-auto"><table className="w-full text-left text-xs"><caption className="sr-only">{title}</caption><thead className="text-slate-500"><tr><th className="py-2">Horário</th><th>Média ({unit})</th><th>Mínimo</th><th>Máximo</th><th>Amostras</th></tr></thead><tbody className="divide-y divide-slate-100">{points.map((point) => <tr key={point.bucket}><td className="py-2 pr-3">{formatDateTime(point.bucket)}</td><td>{formatNumber(point.avg_value, 1)}</td><td>{formatNumber(point.min_value, 1)}</td><td>{formatNumber(point.max_value, 1)}</td><td>{point.samples}</td></tr>)}</tbody></table></div></details>}
  </Card>;
}
