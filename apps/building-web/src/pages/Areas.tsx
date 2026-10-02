import { useState } from "react";
import { api, Badge, Button, Card, ErrorBanner, ResourceFeedback, formatDateTime, useResource } from "@predioon/ui";
import type { CommonArea, Paged, Reservation } from "@predioon/ui";

export function Areas({ buildingId, canManage = false }: { buildingId: string; canManage?: boolean }) {
  const areas = useResource<Paged<CommonArea>>(`/common-areas?buildingId=${buildingId}`);
  const reservations = useResource<Paged<Reservation>>(`/reservations?buildingId=${buildingId}`);
  const [error, setError] = useState<string | null>(null);

  const areaName = (areaId: string) => areas.data?.items.find((area) => area.id === areaId)?.name ?? areaId;

  async function decide(id: string, status: "CONFIRMED" | "REJECTED") {
    try {
      await api.post(`/reservations/${id}/decision`, { status });
      reservations.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao decidir reserva");
    }
  }

  const pending = reservations.data?.items.filter((r) => r.status === "PENDING") ?? [];
  const confirmed = reservations.data?.items.filter((r) => r.status === "CONFIRMED") ?? [];

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Áreas comuns</h1>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <Card title="Reservas aguardando aprovação">
        {pending.length ? (
          <ul className="space-y-3">
            {pending.map((reservation) => (
              <li key={reservation.id} className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium text-slate-800">{areaName(reservation.areaId)}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatDateTime(reservation.startsAt)} → {formatDateTime(reservation.endsAt)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    unidade {reservation.unit ?? "—"}
                    {reservation.notes ? ` · ${reservation.notes}` : ""}
                  </p>
                </div>
                {canManage && <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => void decide(reservation.id, "REJECTED")}>
                    Recusar
                  </Button>
                  <Button onClick={() => void decide(reservation.id, "CONFIRMED")}>Aprovar</Button>
                </div>}
              </li>
            ))}
          </ul>
        ) : (
          <ResourceFeedback resource={reservations} emptyText="Nenhuma reserva aguardando aprovação." />
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Próximas reservas confirmadas">
          {confirmed.length ? (
            <ul className="space-y-2">
              {confirmed.map((reservation) => (
                <li key={reservation.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-800">{areaName(reservation.areaId)}</p>
                    <p className="text-xs text-slate-500">{formatDateTime(reservation.startsAt)}</p>
                  </div>
                  <Badge>{reservation.status}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <ResourceFeedback resource={reservations} emptyText="Sem reservas confirmadas." />
          )}
        </Card>

        <Card title="Áreas cadastradas">
          {areas.data?.items.length ? (
            <ul className="space-y-2">
              {areas.data.items.map((area) => (
                <li key={area.id} className="rounded-xl border border-slate-100 p-3 text-sm">
                  <p className="font-medium text-slate-800">{area.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {area.opensAt}–{area.closesAt} · até {area.maxHoursPerBooking}h
                    {area.capacity ? ` · ${area.capacity} pessoas` : ""}
                    {area.requiresApproval ? " · requer aprovação" : " · reserva automática"}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <ResourceFeedback resource={areas} emptyText="Nenhuma área cadastrada." />
          )}
        </Card>
      </div>
    </>
  );
}
