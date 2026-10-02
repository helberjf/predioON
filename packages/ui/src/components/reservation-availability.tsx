import type { ReservationAvailabilityResponse } from "@predioon/contracts";
import { reservationAvailabilityPath } from "@predioon/api-client";
import { formatDateTime } from "../format.js";
import { reservationDayWindow } from "../reservation-state.js";
import { useResource } from "../use-resource.js";
import { Button, ErrorBanner, ResourceFeedback } from "./primitives.js";

export function ReservationAvailability({ buildingId, areaId, date, revision = 0 }: {
  buildingId: string; areaId: string; date: string; revision?: number;
}) {
  const period = reservationDayWindow(date);
  const occupancy = useResource<ReservationAvailabilityResponse>(period
    ? reservationAvailabilityPath({ buildingId, areaId, ...period }) : null, [revision]);
  if (!date) return <p className="text-xs text-slate-500">Escolha a data para consultar os horários ocupados.</p>;
  if (!period) return <ErrorBanner message="Informe uma data válida para consultar os horários." />;
  return <section aria-label="Horários ocupados" className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-800">Horários ocupados</h3>
      <Button type="button" variant="ghost" disabled={occupancy.loading} onClick={occupancy.reload}>Atualizar horários</Button>
    </div>
    {occupancy.loading || occupancy.error || !occupancy.data?.items.length
      ? <ResourceFeedback resource={occupancy} emptyText="Nenhum horário ocupado nesta data." />
      : <ul className="space-y-2 text-sm text-slate-700">{occupancy.data.items.map(interval =>
        <li key={`${interval.startsAt}/${interval.endsAt}`}>{formatDateTime(interval.startsAt)} → {formatDateTime(interval.endsAt)}</li>)}</ul>}
    <p className="text-xs text-slate-500">Os horários podem mudar. A disponibilidade é verificada ao enviar a reserva.</p>
  </section>;
}
