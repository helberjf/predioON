import { Link } from "react-router-dom";
import { Droplets, Megaphone, Wrench } from "lucide-react";
import { Badge, Card, EmptyState, formatNumber, formatRelative, useResource } from "@predioon/ui";
import type { LatestReading, Notice, Occurrence, Paged } from "@predioon/ui";

export function Home({ buildingId }: { buildingId: string }) {
  const notices = useResource<Paged<Notice>>(`/notices?buildingId=${buildingId}`);
  const readings = useResource<Paged<LatestReading>>(`/telemetry/latest?buildingId=${buildingId}`);
  const mine = useResource<Paged<Occurrence>>(`/occurrences?buildingId=${buildingId}&limit=5`);

  const level = readings.data?.items.find((reading) => reading.metric === "water_level_percent");
  const percent = Number(level?.numeric_value ?? 0);

  return (
    <>
      <Card title="Caixa d'água">
        {level ? (
          <>
            <div className="flex items-end justify-between">
              <p className="text-3xl font-bold text-slate-900">{formatNumber(percent, 0)}%</p>
              <Droplets className="text-sky-500" />
            </div>
            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${percent < 20 ? "bg-rose-500" : percent < 40 ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-400">Atualizado {formatRelative(level.time)}</p>
          </>
        ) : (
          <EmptyState text="Sem leitura no momento." />
        )}
      </Card>

      <Card
        title="Avisos do condomínio"
        action={
          <Link to="/avisos" className="text-xs font-semibold text-emerald-600">
            Ver todos
          </Link>
        }
      >
        {notices.data?.items.length ? (
          <ul className="space-y-3">
            {notices.data.items.slice(0, 3).map((notice) => (
              <li key={notice.id} className="flex gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                  <Megaphone size={17} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{notice.title}</p>
                  <p className="line-clamp-2 text-xs text-slate-500">{notice.body}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState text="Nenhum aviso publicado." />
        )}
      </Card>

      <Card
        title="Meus chamados"
        action={
          <Link to="/chamados" className="text-xs font-semibold text-emerald-600">
            Abrir chamado
          </Link>
        }
      >
        {mine.data?.items.length ? (
          <ul className="space-y-2">
            {mine.data.items.map((occurrence) => (
              <li key={occurrence.id} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    <Wrench size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{occurrence.title}</p>
                    <p className="text-xs text-slate-400">#{occurrence.protocol}</p>
                  </div>
                </div>
                <Badge>{occurrence.status}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState text="Você ainda não abriu chamados." />
        )}
      </Card>
    </>
  );
}
