import { CalendarDays, Clock3, MapPin, Users } from "lucide-react";
import { Badge, Button, cls, formatDateTime, formatTime, localDate, parseTimestamp } from "@predioon/ui";
import type { CommonArea, Reservation } from "@predioon/ui";

type Props = {
  reservation: Reservation;
  area?: CommonArea;
  loadingArea?: boolean;
  canManage?: boolean;
  decision?: { id: string; status: "CONFIRMED" | "REJECTED" | "CANCELLED" } | null;
  onDecide?: (id: string, status: "CONFIRMED" | "REJECTED") => void;
  onCancel?: (reservation: Reservation) => void;
};
const month = new Intl.DateTimeFormat("pt-BR", { month: "short" });
const date = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" });

export function AreaReservationCard({ reservation, area, loadingArea, canManage, decision, onDecide, onCancel }: Props) {
  const starts = parseTimestamp(reservation.startsAt);
  const sameDay = localDate(reservation.startsAt) === localDate(reservation.endsAt);
  const pending = reservation.status === "PENDING";
  const title = area?.name || (loadingArea ? "Identificando espaço…" : "Espaço não disponível");
  const unit = reservation.unit?.trim();
  const unitLabel = unit ? (/^unidade\b/i.test(unit) ? unit : `Unidade ${unit}`) : "Unidade não informada";
  const busy = decision?.id === reservation.id;

  return <li className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 sm:p-5 xl:flex-row xl:items-center xl:justify-between">
    <div className="flex min-w-0 items-start gap-4">
      <div aria-hidden="true" className={cls("flex h-[68px] w-[60px] shrink-0 flex-col items-center justify-center rounded-xl border", pending ? "border-amber-100 bg-amber-50 text-amber-800" : "border-emerald-100 bg-emerald-50 text-emerald-800")}>
        <span className="text-[11px] font-semibold uppercase tracking-wider">{starts ? month.format(starts).replace(".", "") : "Data"}</span>
        <span className="mt-0.5 text-2xl font-bold leading-none">{starts?.getDate() ?? "—"}</span>
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2.5"><h3 className="break-words text-base font-bold text-[#17334b]">{title}</h3><Badge tone={pending ? "warning" : "success"}>{pending ? "Aguardando aprovação" : "Confirmada"}</Badge></div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs leading-5 text-slate-600">
          <span className="inline-flex items-start gap-1.5"><CalendarDays size={14} aria-hidden="true" className="mt-0.5 shrink-0" />{sameDay && starts ? date.format(starts) : `${formatDateTime(reservation.startsAt)} a ${formatDateTime(reservation.endsAt)}`}</span>
          {sameDay && <span className="inline-flex items-center gap-1.5"><Clock3 size={14} aria-hidden="true" />{formatTime(reservation.startsAt)} às {formatTime(reservation.endsAt)}</span>}
          <span className="inline-flex items-center gap-1.5"><Users size={14} aria-hidden="true" />{unitLabel}</span>
        </div>
        {reservation.notes && <p className="break-words text-xs leading-5 text-slate-600">{reservation.notes}</p>}
        {!area && !loadingArea && <p className="flex items-start gap-1.5 text-xs leading-5 text-slate-600"><MapPin size={13} aria-hidden="true" className="mt-0.5 shrink-0" />Atualize os espaços para identificar esta reserva.</p>}
      </div>
    </div>
    {canManage && <div className="flex shrink-0 flex-wrap gap-2 border-t border-slate-100 pt-3 xl:border-0 xl:pt-0">
      {pending && <>
      <Button variant="secondary" disabled={!area || Boolean(decision)} onClick={() => onDecide?.(reservation.id, "REJECTED")}>{busy && decision.status === "REJECTED" ? "Recusando…" : "Recusar"}</Button>
      <Button disabled={!area || Boolean(decision)} onClick={() => onDecide?.(reservation.id, "CONFIRMED")}>{busy && decision.status === "CONFIRMED" ? "Aprovando…" : "Aprovar"}</Button>
      </>}
      <Button variant="ghost" disabled={!area || Boolean(decision)} onClick={() => onCancel?.(reservation)}>{busy && decision.status === "CANCELLED" ? "Cancelando…" : "Cancelar reserva"}</Button>
    </div>}
  </li>;
}
