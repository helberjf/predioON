import { useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, MapPin, Minus, Plus, Users } from "lucide-react";
import { api, Badge, Button, Card, cls, ErrorBanner, formatDateTime, formatTime, ResourceFeedback, useResource } from "@predioon/ui";
import type { BuildingEvent, Paged } from "@predioon/ui";

/** "sábado, 14 de novembro · 19:00 às 23:00", or both dates when it spans days. */
export function eventWhen(event: Pick<BuildingEvent, "startsAt" | "endsAt">): string {
  const starts = new Date(event.startsAt), ends = new Date(event.endsAt);
  const day = starts.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const text = starts.toDateString() === ends.toDateString()
    ? `${day} · ${formatTime(starts)} às ${formatTime(ends)}`
    : `${formatDateTime(starts)} até ${formatDateTime(ends)}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
export function eventPlace(event: Pick<BuildingEvent, "areaName" | "location">): string | null {
  return [event.areaName, event.location].filter(Boolean).join(" · ") || null;
}

export function Events({ buildingId }: { buildingId: string }) {
  const events = useResource<Paged<BuildingEvent>>(`/v1/building-events?buildingId=${encodeURIComponent(buildingId)}`);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [guests, setGuests] = useState<Record<string, number>>({});

  async function answer(event: BuildingEvent, attending: boolean) {
    if (pending) return;
    setPending(event.id); setError(null); setSuccess("");
    try {
      const companions = attending ? guests[event.id] ?? event.myResponse?.guests ?? 0 : 0;
      await api.put(`/v1/building-events/${event.id}/response`, { attending, guests: companions });
      setSuccess(attending ? `Presença confirmada em "${event.title}".` : `Você avisou que não vai a "${event.title}".`);
      events.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar sua resposta."); }
    finally { setPending(null); }
  }

  const items = events.data?.items ?? [];
  return <>
    {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    {success && <p role="status" className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />{success}</p>}
    {!items.length && <Card title="Eventos do condomínio"><ResourceFeedback resource={events} emptyText="Nenhum evento marcado." /></Card>}
    {items.map(event => {
      const place = eventPlace(event);
      const mine = event.myResponse;
      const companions = guests[event.id] ?? mine?.guests ?? 0;
      // Spots still open for everyone; your own answer can always be kept or changed within your share.
      const remaining = event.capacity === null ? null : Math.max(0, event.capacity - event.attendingPeople);
      const left = event.capacity === null ? null : remaining! + (mine?.attending ? 1 + mine.guests : 0);
      return <Card key={event.id}>
        <article aria-label={event.title} className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600"><CalendarDays size={22} /></span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold leading-5 text-[#152d4b]">{event.title}</h2>
                <p className="mt-1 text-xs leading-5 text-slate-600">{eventWhen(event)}</p>
                {place && <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><MapPin size={13} />{place}</p>}
              </div>
            </div>
            {event.status === "CANCELLED" ? <Badge tone="danger">Cancelado</Badge> : mine ? <Badge tone={mine.attending ? "success" : "neutral"}>{mine.attending ? "Você vai" : "Você não vai"}</Badge> : null}
          </div>
          {event.description && <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{event.description}</p>}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1"><Users size={13} />{event.attendingPeople === 1 ? "1 pessoa confirmada" : `${event.attendingPeople} pessoas confirmadas`}</span>
            {remaining !== null && <span>{remaining === 0 ? "Sem vagas" : remaining === 1 ? "1 vaga" : `${remaining} vagas`}</span>}
            {event.rsvpUntil && <span className="inline-flex items-center gap-1"><Clock3 size={13} />Confirme até {formatDateTime(event.rsvpUntil)}</span>}
          </p>
          {event.status === "SCHEDULED" && (event.answersOpen ? <div className="space-y-3 border-t border-slate-100 pt-3">
            {event.maxGuests > 0 && <div className="flex items-center justify-between gap-3">
              <p id={`guests-${event.id}`} className="text-sm text-slate-700">Acompanhantes <span className="text-xs text-slate-500">(até {event.maxGuests})</span></p>
              <div role="group" aria-labelledby={`guests-${event.id}`} className="flex items-center gap-2">
                <button type="button" aria-label="Menos um acompanhante" disabled={companions <= 0 || pending !== null} onClick={() => setGuests({ ...guests, [event.id]: companions - 1 })} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 disabled:opacity-40"><Minus size={16} /></button>
                <output aria-live="polite" className="w-6 text-center text-sm font-semibold text-[#152d4b]">{companions}</output>
                <button type="button" aria-label="Mais um acompanhante" disabled={companions >= event.maxGuests || pending !== null} onClick={() => setGuests({ ...guests, [event.id]: companions + 1 })} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 disabled:opacity-40"><Plus size={16} /></button>
              </div>
            </div>}
            <div className="grid grid-cols-2 gap-2">
              <Button variant={mine && !mine.attending ? "primary" : "secondary"} disabled={pending !== null} onClick={() => void answer(event, false)}>Não vou</Button>
              <Button variant={mine?.attending && companions === mine.guests ? "primary" : "secondary"} disabled={pending !== null || (left === 0 && !mine?.attending)} onClick={() => void answer(event, true)}>{mine?.attending && companions !== mine.guests ? "Atualizar presença" : "Vou"}</Button>
            </div>
          </div> : <p className={cls("rounded-lg p-3 text-xs", "bg-slate-50 text-slate-600")}>As confirmações deste evento já foram encerradas.</p>)}
        </article>
      </Card>;
    })}
  </>;
}
