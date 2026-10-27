import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReservationAvailabilityResponse } from "@predioon/contracts";
import { reservationAvailabilityPath } from "@predioon/api-client";
import { cls } from "../format.js";
import { dayAvailability, dayLabel, freeWindows, localDate, monthGrid, monthLabel, monthOf, shiftMonth, type DayAvailability } from "../reservation-state.js";
import { useResource } from "../use-resource.js";
import { Button, ErrorBanner, ResourceFeedback } from "./primitives.js";

export const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DAY_TONE: Record<DayAvailability, string> = {
  free: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400",
  partial: "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-400",
  full: "border-slate-200 bg-slate-100 text-slate-400 line-through",
  past: "border-transparent text-slate-300",
};
const DAY_WORDS: Record<DayAvailability, string> = { free: "livre", partial: "com horários livres", full: "sem horário livre", past: "já passou" };

/**
 * A resident's view of one area: which days of the month still have free
 * time and, for the chosen day, the free stretches inside the opening hours.
 * It never shows who booked or for how long, only what is still free.
 */
export function ReservationMonth({ buildingId, areaId, opensAt, closesAt, date, onDate, revision = 0 }: {
  buildingId: string; areaId: string; opensAt: string; closesAt: string; date: string; onDate: (date: string) => void; revision?: number;
}) {
  const [month, setMonth] = useState(() => date ? date.slice(0, 7) : monthOf());
  useEffect(() => { if (date && date.slice(0, 7) !== month) setMonth(date.slice(0, 7)); }, [date]);
  const grid = monthGrid(month);
  const occupancy = useResource<ReservationAvailabilityResponse>(grid
    // The resident window is at most 31 days, also across a clock change.
    ? reservationAvailabilityPath({ buildingId, areaId, from: grid.monthFrom, to: new Date(Math.min(Date.parse(grid.monthTo), Date.parse(grid.monthFrom) + 31 * 86_400_000)).toISOString() }) : null, [revision]);
  const busy = occupancy.data?.items ?? [];
  const now = Date.now();
  const current = month === monthOf();
  const windows = date ? freeWindows(date, opensAt, closesAt, busy, now) : [];
  const selectedInMonth = date.slice(0, 7) === month;
  return <div className="space-y-3">
    <section aria-label="Dias livres no mês" className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" aria-label="Mês anterior" disabled={current} onClick={() => setMonth(shiftMonth(month, -1))} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={18} /></button>
        <p className="text-sm font-semibold text-[#152d4b]">{monthLabel(month)}</p>
        <button type="button" aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"><ChevronRight size={18} /></button>
      </div>
      {occupancy.error && <ErrorBanner message={occupancy.error} />}
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-slate-400">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">{grid?.days.map(day => {
        if (day.slice(0, 7) !== month) return <span key={day} aria-hidden="true" />;
        const state = occupancy.data ? dayAvailability(day, opensAt, closesAt, busy, now) : "past";
        const label = `${dayLabel(day)}: ${occupancy.data ? DAY_WORDS[state] : "carregando"}`;
        return <button key={day} type="button" aria-label={label} aria-pressed={day === date} disabled={state === "past" || state === "full"}
          onClick={() => onDate(day)}
          className={cls("aspect-square rounded-lg border text-xs font-semibold transition disabled:cursor-not-allowed", DAY_TONE[state], day === date && "ring-2 ring-emerald-500 ring-offset-1")}>
          {Number(day.slice(8))}
        </button>;
      })}</div>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-200" />Livre</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-200" />Com horários livres</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-200" />Sem horário livre</span>
      </p>
    </section>
    {date && <section aria-label="Horários livres" className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Horários livres em {new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}</h3>
        <Button type="button" variant="ghost" disabled={occupancy.loading} onClick={occupancy.reload}>Atualizar horários</Button>
      </div>
      {occupancy.loading || occupancy.error || !selectedInMonth
        ? <ResourceFeedback resource={occupancy} emptyText="Escolha um dia no calendário." />
        : windows.length
          ? <ul className="space-y-2 text-sm text-slate-700">{windows.map(window => <li key={window.start}>Livre das {window.start} às {window.end}</li>)}</ul>
          : <p role="status" className="text-sm text-slate-600">Nenhum horário livre nesta data.</p>}
      <p className="text-xs text-slate-500">Os horários podem mudar. A disponibilidade é verificada ao enviar a reserva.</p>
    </section>}
  </div>;
}

/** The day a reservation or event falls on, for grouping a month. */
export const dayOf = (value: string) => localDate(value);
