import { useState } from "react";
import { api, Badge, Button, Card, EmptyState, ErrorBanner, formatDateTime, Select, useResource } from "@predioon/ui";
import type { Occurrence, Paged } from "@predioon/ui";

const STATUSES = [
  { value: "OPEN" as const, label: "Aberto" },
  { value: "IN_ANALYSIS" as const, label: "Em análise" },
  { value: "IN_PROGRESS" as const, label: "Em execução" },
  { value: "DONE" as const, label: "Concluído" },
  { value: "CANCELLED" as const, label: "Cancelado" },
];

export function Occurrences({ buildingId }: { buildingId: string }) {
  const [onlyOpen, setOnlyOpen] = useState<"true" | "false">("true");
  const list = useResource<Paged<Occurrence>>(`/occurrences?buildingId=${buildingId}&onlyOpen=${onlyOpen}&limit=100`);
  const [error, setError] = useState<string | null>(null);

  async function changeStatus(id: string, status: string) {
    try {
      await api.patch(`/occurrences/${id}`, { status });
      list.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao atualizar chamado");
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Chamados</h1>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <Card
        title="Fila de manutenção"
        subtitle="Chamados abertos pelos moradores e pela administração"
        action={
          <div className="w-44">
            <Select
              value={onlyOpen}
              onChange={setOnlyOpen}
              options={[
                { value: "true", label: "Somente abertos" },
                { value: "false", label: "Todos" },
              ]}
            />
          </div>
        }
      >
        {list.data?.items.length ? (
          <ul className="space-y-3">
            {list.data.items.map((occurrence) => (
              <li key={occurrence.id} className="rounded-xl border border-slate-100 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">#{occurrence.protocol}</span>
                      <Badge>{occurrence.status}</Badge>
                      <Badge>{occurrence.priority}</Badge>
                      <span className="text-xs text-slate-400">{occurrence.category}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-slate-800">{occurrence.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{occurrence.description}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {occurrence.location ?? "sem local"} · unidade {occurrence.unit ?? "—"} ·{" "}
                      {formatDateTime(occurrence.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="w-40">
                      <Select
                        value={occurrence.status as (typeof STATUSES)[number]["value"]}
                        onChange={(status) => void changeStatus(occurrence.id, status)}
                        options={STATUSES}
                      />
                    </div>
                    {occurrence.status !== "DONE" && (
                      <Button onClick={() => void changeStatus(occurrence.id, "DONE")}>Concluir</Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState text="Nenhum chamado nesta visão." />
        )}
      </Card>
    </>
  );
}
