import { useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarCheck2, CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, RefreshCw, Users } from "lucide-react";
import { api, Badge, Button, Card, cls, dayLabel, ErrorBanner, Field, formatDateTime, formatTime, Input, localDate, monthGrid, monthLabel, monthOf, ResourceFeedback, Select, shiftMonth, TextArea, useResource, WEEKDAYS } from "@predioon/ui";
import type { BuildingEvent, BuildingEventAnswer, CommonArea, ManagedReservation, Paged, Reservation, ReservationCalendarResponse } from "@predioon/ui";
import { AreaReservationCard } from "../components/AreaReservationCard.js";

type Props = { buildingId: string; canManage?: boolean; canConfigure?: boolean; canEvents?: boolean };
type DecisionStatus = "CONFIRMED" | "REJECTED";
type Decision = { id: string; status: DecisionStatus };
const errorText = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;
const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

/** "Limite: 1 por mês por unidade e 2 por mês por morador", or nothing when the area has no limit. */
export function areaRules(area: CommonArea): string {
  const limits = [
    ...(area.monthlyLimitPerUnit ? [`${area.monthlyLimitPerUnit} por mês por unidade`] : []),
    ...(area.monthlyLimitPerResident ? [`${area.monthlyLimitPerResident} por mês por morador`] : []),
  ];
  return [`${area.opensAt.slice(0, 5)}–${area.closesAt.slice(0, 5)}`, `até ${area.maxHoursPerBooking}h`,
    ...(area.capacity ? [`${area.capacity} pessoas`] : []), area.requiresApproval ? "requer aprovação" : "reserva automática",
    ...(limits.length ? [`limite de ${limits.join(" e ")}`] : [])].join(" · ");
}

export function Areas({ buildingId, canManage = false, canConfigure = false, canEvents = false }: Props) {
  const areas = useResource<Paged<CommonArea>>(`/common-areas?buildingId=${buildingId}`);
  const reservations = useResource<Paged<Reservation>>(`/reservations?buildingId=${buildingId}`);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [settled, setSettled] = useState<Record<string, DecisionStatus>>({});
  const completed = useRef(new Set<string>());
  const deciding = useRef(false);
  const tabId = useId();
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useSearchParams();
  const tabs = [
    ...(canManage ? [{ key: "calendario", label: "Calendário do mês" }] : []),
    { key: "proximas", label: "Próximas reservas" },
    ...(canEvents ? [{ key: "eventos", label: "Eventos" }] : []),
    { key: "regras", label: "Regras das áreas" },
  ];
  const tab = tabs.find(item => item.key === search.get("aba"))?.key ?? tabs[0]!.key;
  const areaList = areas.data?.items ?? [];
  const changed = () => { reservations.reload(); setRevision(value => value + 1); };

  async function decide(id: string, status: DecisionStatus, areaId = reservations.data?.items.find(item => item.id === id)?.areaId) {
    if (!canManage || deciding.current || completed.current.has(id)) return;
    if (!areaId || !areaList.some(area => area.id === areaId)) return;
    deciding.current = true;
    setDecision({ id, status }); setError(null); setMessage(null);
    try {
      await api.post(`/reservations/${id}/decision`, { status });
      completed.current.add(id);
      setSettled(previous => ({ ...previous, [id]: status }));
      setMessage(status === "CONFIRMED" ? "Reserva aprovada." : "Reserva recusada.");
      changed();
    } catch (cause) {
      setError(errorText(cause, "Falha ao decidir reserva"));
    } finally {
      deciding.current = false; setDecision(null);
    }
  }

  // A successful decision is authoritative while either list is refreshing.
  // Never override a later terminal state (for example a cancellation).
  const rows = (reservations.data?.items ?? []).map(item => item.status === "PENDING" && settled[item.id] ? { ...item, status: settled[item.id]! } : item);
  const pending = rows.filter(item => item.status === "PENDING");
  const confirmed = rows.filter(item => item.status === "CONFIRMED");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Comunidade · Reservas</p><h1 className="text-[28px] font-bold tracking-tight text-[#17334b] sm:text-[32px]">Áreas comuns</h1><p className="mt-1.5 text-sm leading-6 text-slate-600">Organize os espaços do condomínio e acompanhe cada reserva.</p></div><Button variant="secondary" disabled={areas.loading || reservations.loading} onClick={() => { areas.reload(); changed(); }}><RefreshCw size={16} aria-hidden="true" />Atualizar agenda</Button></div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}
      {areas.error && <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"><p role="alert" className="text-sm leading-6 text-amber-900">Não foi possível carregar os espaços. Atualize para ver os nomes e o calendário. As reservas ainda não identificadas ficam protegidas contra aprovação.</p><Button variant="secondary" onClick={areas.reload}>Atualizar espaços</Button></div>}

      <div className="grid gap-3 sm:grid-cols-3">{[
        { label: "Espaços disponíveis", value: areas.data ? areaList.length : "—", detail: "Áreas cadastradas no condomínio", icon: MapPin, tone: "bg-sky-50 text-sky-700" },
        { label: "Aguardando aprovação", value: reservations.data ? pending.length : "—", detail: "Solicitações para analisar", icon: Clock3, tone: "bg-amber-50 text-amber-800" },
        { label: "Próximas reservas", value: reservations.data ? confirmed.length : "—", detail: "Reservas já confirmadas", icon: CalendarCheck2, tone: "bg-emerald-50 text-emerald-700" },
      ].map(({ label, value, detail, icon: Icon, tone }) => <section key={label} aria-label={label} className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-5"><span aria-hidden="true" className={cls("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", tone)}><Icon size={21} /></span><div><p className="text-xs font-medium text-slate-600">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums text-[#17334b]">{value}</p><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p></div></section>)}</div>

      <Card title="Reservas aguardando aprovação" subtitle="Confira o espaço, a data e a unidade antes de decidir." action={<Badge tone="warning">{pending.length} pendentes</Badge>} className="rounded-2xl">
        {pending.length ? (
          <ul className="space-y-3">
            {pending.map(reservation => <AreaReservationCard key={reservation.id} reservation={reservation} area={areaList.find(area => area.id === reservation.areaId)} loadingArea={areas.loading} canManage={canManage} decision={decision} onDecide={(id, status) => void decide(id, status)} />)}
          </ul>
        ) : (
          <ResourceFeedback resource={reservations} emptyText="Nenhuma reserva aguardando aprovação." />
        )}
      </Card>

      <div role="tablist" aria-label="Áreas comuns" className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5">
        {tabs.map((item, index) => <button key={item.key} id={`${tabId}-${item.key}`} aria-controls={`${tabId}-panel`} tabIndex={tab === item.key ? 0 : -1} type="button" role="tab" aria-selected={tab === item.key}
          onKeyDown={event => { const target = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null; if (target === null) return; event.preventDefault(); const next = tabs[target]!; setSearch(next.key === tabs[0]!.key ? {} : { aba: next.key }); document.getElementById(`${tabId}-${next.key}`)?.focus(); }}
          onClick={() => setSearch(item.key === tabs[0]!.key ? {} : { aba: item.key })}
          className={cls("shrink-0 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold transition", tab === item.key ? "bg-[#17334b] text-white" : "text-slate-600 hover:bg-slate-50")}>{item.label}</button>)}
      </div>

      <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${tab}`} tabIndex={0} className="focus-visible:outline-emerald-600">
      {tab === "calendario" && !areas.error && <MonthCalendar buildingId={buildingId} areas={areas} revision={revision} onChanged={changed} onError={setError} decision={decision} settled={settled} onDecide={(item, status) => void decide(item.id, status, item.areaId)} />}

      {tab === "proximas" && <Card title="Próximas reservas confirmadas">
        {confirmed.length ? (
          <ul className="space-y-2">
            {confirmed.map(reservation => <AreaReservationCard key={reservation.id} reservation={reservation} area={areaList.find(area => area.id === reservation.areaId)} loadingArea={areas.loading} />)}
          </ul>
        ) : (
          <ResourceFeedback resource={reservations} emptyText="Sem reservas confirmadas." />
        )}
      </Card>}

      {tab === "eventos" && <EventsPanel buildingId={buildingId} areas={areaList} onChanged={changed} />}

      {tab === "regras" && !areas.error && <AreaRules buildingId={buildingId} areas={areas} canConfigure={canConfigure} />}
      </div>
    </div>
  );
}

const STATUS_CHIP: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800", CONFIRMED: "bg-emerald-100 text-emerald-800", EVENT: "bg-violet-100 text-violet-800",
};

function MonthCalendar({ buildingId, areas, revision, onChanged, onError, decision, settled, onDecide }: {
  buildingId: string; areas: ReturnType<typeof useResource<Paged<CommonArea>>>; revision: number; onChanged: () => void; onError: (message: string) => void;
  decision: Decision | null; settled: Record<string, DecisionStatus>; onDecide: (item: ManagedReservation, status: DecisionStatus) => void;
}) {
  const list = areas.data?.items ?? [];
  const [areaId, setAreaId] = useState("");
  const area = list.find(item => item.id === areaId) ?? list[0];
  const [month, setMonth] = useState(monthOf);
  const [day, setDay] = useState(() => localDate(new Date()));
  const [busy, setBusy] = useState(false);
  const grid = monthGrid(month)!;
  const calendar = useResource<ReservationCalendarResponse>(area
    ? `/reservations/calendar?${new URLSearchParams({ buildingId, areaId: area.id, from: grid.from, to: grid.to })}` : null, [revision]);
  if (!area) return <Card><ResourceFeedback resource={areas} emptyText="Nenhuma área cadastrada. Cadastre em Regras das áreas." /></Card>;

  const reservations = (calendar.data?.reservations ?? []).map(item => item.status === "PENDING" && settled[item.id] ? { ...item, status: settled[item.id]! } : item);
  const events = calendar.data?.events ?? [];
  const active = reservations.filter(item => item.status === "PENDING" || item.status === "CONFIRMED");
  const scheduled = events.filter(item => item.status === "SCHEDULED");
  const inMonth = (value: string) => localDate(value).slice(0, 7) === month;
  const onDay = (date: string) => ({
    reservations: reservations.filter(item => localDate(item.startsAt) === date),
    events: events.filter(item => localDate(item.startsAt) <= date && localDate(new Date(Date.parse(item.endsAt) - 1)) >= date),
  });
  const selected = onDay(day);
  async function act(run: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try { await run(); onChanged(); }
    catch (cause) { onError(errorText(cause, "Não foi possível alterar a reserva.")); }
    finally { setBusy(false); }
  }
  const who = (item: ManagedReservation) => [item.requesterName ?? "Morador", item.unit ? `unidade ${item.unit}` : null].filter(Boolean).join(" · ");

  return <Card>
    <div className="space-y-4">
      <div role="group" aria-label="Área do calendário" className="flex flex-wrap gap-2">{list.map(item => <button key={item.id} type="button" aria-pressed={item.id === area.id} onClick={() => setAreaId(item.id)}
        className={cls("rounded-xl border px-3 py-2 text-sm font-medium", item.id === area.id ? "border-[#173d5a] bg-[#173d5a] text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300")}>{item.name}</button>)}</div>
      <p className="text-xs text-slate-500">{areaRules(area)}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"><ChevronLeft size={18} /></button>
          <h2 className="min-w-44 text-center text-base font-bold text-[#142f50]">{monthLabel(month)}</h2>
          <button type="button" aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"><ChevronRight size={18} /></button>
          <Button variant="ghost" onClick={() => { setMonth(monthOf()); setDay(localDate(new Date())); }}>Hoje</Button>
        </div>
        <p role="status" className="text-xs text-slate-600">
          {count(active.filter(item => inMonth(item.startsAt)).length, "reserva", "reservas")} no mês · {count(active.filter(item => item.status === "PENDING" && inMonth(item.startsAt)).length, "aguardando", "aguardando")} aprovação · {count(scheduled.filter(item => inMonth(item.startsAt)).length, "evento", "eventos")}
        </p>
      </div>
      {calendar.error && <ErrorBanner message={calendar.error} />}
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-7 gap-1">
          {WEEKDAYS.map(name => <p key={name} className="px-1 text-center text-[11px] font-semibold uppercase text-slate-600">{name}</p>)}
          {grid.days.map(date => {
            const items = onDay(date);
            const shown = [
              ...items.events.filter(item => item.status === "SCHEDULED").map(item => ({ key: item.id, tone: "EVENT", text: item.title })),
              ...items.reservations.filter(item => item.status === "PENDING" || item.status === "CONFIRMED")
                .map(item => ({ key: item.id, tone: item.status, text: `${formatTime(item.startsAt)} ${item.unit ? `· ${item.unit}` : item.requesterName ?? ""}` })),
            ];
            const outside = date.slice(0, 7) !== month;
            return <button key={date} type="button" aria-pressed={date === day} onClick={() => setDay(date)}
              className={cls("relative flex min-h-[92px] flex-col gap-1 rounded-lg border p-1.5 text-left align-top transition", outside ? "border-slate-100 bg-slate-50/60 text-slate-500" : "border-slate-200 bg-white text-slate-800 hover:border-emerald-300", date === day && "ring-2 ring-emerald-500", date === localDate(new Date()) && "border-emerald-400")}>
              <span className="sr-only">{dayLabel(date)}: {count(items.reservations.filter(item => item.status === "PENDING" || item.status === "CONFIRMED").length, "reserva", "reservas")}, {count(items.events.filter(item => item.status === "SCHEDULED").length, "evento", "eventos")}. </span>
              <span aria-hidden="true" className="text-xs font-semibold">{Number(date.slice(8))}</span>
              {shown.slice(0, 3).map(item => <span key={item.key} className={cls("truncate rounded px-1 py-0.5 text-[10px] font-medium", STATUS_CHIP[item.tone])}>{item.text}</span>)}
              {shown.length > 3 && <span className="text-[10px] text-slate-500">+{shown.length - 3}</span>}
            </button>;
          })}
        </div>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-200" />Confirmada</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-200" />Aguardando aprovação</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-violet-200" />Evento do condomínio</span>
      </p>
      <section aria-label="Reservas do dia" className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-bold text-[#142f50]">{new Date(`${day}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })} · {area.name}</h3>
        {calendar.loading && !calendar.data ? <ResourceFeedback resource={calendar} emptyText="" />
          : !selected.reservations.length && !selected.events.length ? <p className="mt-2 text-sm text-slate-500">Nenhuma reserva ou evento neste dia.</p>
          : <ul className="mt-3 space-y-2">
            {selected.events.map(item => <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-violet-200 bg-white p-3 text-sm">
              <div><p className="font-medium text-slate-800">{item.title}</p><p className="text-xs text-slate-500">Evento · {formatDateTime(item.startsAt)} → {formatDateTime(item.endsAt)}</p></div>
              <Badge>{item.status}</Badge>
            </li>)}
            {selected.reservations.map(item => <li key={item.id} className={cls("flex flex-col gap-2 rounded-lg border bg-white p-3 text-sm md:flex-row md:items-center md:justify-between", item.status === "PENDING" ? "border-amber-200" : "border-slate-200", (item.status === "CANCELLED" || item.status === "REJECTED") && "opacity-60")}>
              <div>
                <p className="font-medium text-slate-800">{formatTime(item.startsAt)} às {formatTime(item.endsAt)} · {who(item)}</p>
                {item.notes && <p className="mt-0.5 text-xs text-slate-500">{item.notes}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{item.status}</Badge>
                {item.status === "PENDING" && <><Button variant="secondary" disabled={busy || Boolean(decision)} onClick={() => onDecide(item, "REJECTED")}>Recusar</Button>
                  <Button disabled={busy || Boolean(decision)} onClick={() => onDecide(item, "CONFIRMED")}>Aprovar</Button></>}
                {item.status === "CONFIRMED" && <Button variant="ghost" disabled={busy || Boolean(decision)} onClick={() => void act(() => api.delete(`/reservations/${item.id}`))}>Cancelar reserva</Button>}
              </div>
            </li>)}
          </ul>}
      </section>
    </div>
  </Card>;
}

const pad = (value: number) => String(value).padStart(2, "0");
/** An instant as the value of a datetime-local field, in the browser's time zone. */
const toLocalInput = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return `${localDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const fromLocalInput = (value: string) => new Date(value).toISOString();
const emptyEvent = () => ({ title: "", description: "", startsAt: "", endsAt: "", areaId: "", location: "", rsvpUntil: "", maxGuests: "0", capacity: "" });

function EventsPanel({ buildingId, areas, onChanged }: { buildingId: string; areas: CommonArea[]; onChanged: () => void }) {
  const events = useResource<Paged<BuildingEvent>>(`/v1/building-events?buildingId=${encodeURIComponent(buildingId)}`);
  const [form, setForm] = useState(emptyEvent);
  const [editing, setEditing] = useState<BuildingEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [answersFor, setAnswersFor] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const answers = useResource<Paged<BuildingEventAnswer>>(answersFor ? `/v1/building-events/${answersFor}/responses` : null);
  useEffect(() => { setEditing(null); setForm(emptyEvent()); }, [buildingId]);

  function edit(event: BuildingEvent) {
    setEditing(event); setError(null); setMessage(null);
    setForm({ title: event.title, description: event.description, startsAt: toLocalInput(event.startsAt), endsAt: toLocalInput(event.endsAt),
      areaId: event.areaId ?? "", location: event.location, rsvpUntil: toLocalInput(event.rsvpUntil), maxGuests: String(event.maxGuests), capacity: event.capacity ? String(event.capacity) : "" });
  }
  async function save() {
    setBusy(true); setError(null); setMessage(null);
    try {
      if (!form.startsAt || !form.endsAt) throw new Error("Informe o início e o término do evento.");
      const body = { title: form.title.trim(), description: form.description.trim(), location: form.location.trim(), areaId: form.areaId || null,
        startsAt: fromLocalInput(form.startsAt), endsAt: fromLocalInput(form.endsAt), rsvpUntil: form.rsvpUntil ? fromLocalInput(form.rsvpUntil) : null,
        maxGuests: Number(form.maxGuests || 0), capacity: form.capacity ? Number(form.capacity) : null };
      if (editing) await api.patch(`/v1/building-events/${editing.id}`, { version: editing.version, ...body });
      else await api.post("/v1/building-events", { buildingId, ...body });
      setMessage(editing ? "Evento atualizado." : "Evento criado. Os moradores já podem confirmar presença.");
      setEditing(null); setForm(emptyEvent()); events.reload(); onChanged();
    } catch (cause) { setError(errorText(cause, "Não foi possível salvar o evento.")); }
    finally { setBusy(false); }
  }
  async function cancel(event: BuildingEvent) {
    setBusy(true); setError(null); setMessage(null);
    try { await api.post(`/v1/building-events/${event.id}/cancel`, { version: event.version }); setMessage("Evento cancelado."); setCancelling(null); events.reload(); onChanged(); }
    catch (cause) { setError(errorText(cause, "Não foi possível cancelar o evento.")); }
    finally { setBusy(false); }
  }

  const list = answers.data?.items ?? [];
  return <>
    {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
    <div className="grid items-start gap-5 xl:grid-cols-3">
      <Card title={editing ? "Editar evento" : "Novo evento"}>
        <form className="space-y-3" onSubmit={submit => { submit.preventDefault(); void save(); }}>
          <Field label="Título"><Input required value={form.title} onChange={title => setForm({ ...form, title })} placeholder="Festa junina" /></Field>
          <Field label="Descrição"><TextArea value={form.description} onChange={description => setForm({ ...form, description })} rows={3} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Início"><Input type="datetime-local" required value={form.startsAt} onChange={startsAt => setForm({ ...form, startsAt })} /></Field>
            <Field label="Término"><Input type="datetime-local" required value={form.endsAt} onChange={endsAt => setForm({ ...form, endsAt })} /></Field>
          </div>
          <Field label="Área comum" hint="Escolhida, a área fica ocupada para reservas durante o evento."><Select value={form.areaId} onChange={areaId => setForm({ ...form, areaId })}
            options={[{ value: "", label: "Nenhuma (outro local)" }, ...areas.map(area => ({ value: area.id, label: area.name }))]} /></Field>
          <Field label="Local" hint="Opcional. Ex.: hall de entrada, piscina."><Input value={form.location} onChange={location => setForm({ ...form, location })} /></Field>
          <Field label="Confirmar presença até" hint="Opcional. Sem prazo, vale até o início do evento."><Input type="datetime-local" value={form.rsvpUntil} onChange={rsvpUntil => setForm({ ...form, rsvpUntil })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Acompanhantes por morador"><Input type="number" min={0} max={20} value={form.maxGuests} onChange={maxGuests => setForm({ ...form, maxGuests })} /></Field>
            <Field label="Limite de pessoas" hint="Opcional."><Input type="number" min={1} max={10000} value={form.capacity} onChange={capacity => setForm({ ...form, capacity })} /></Field>
          </div>
          <Button type="submit" full disabled={busy || form.title.trim().length < 2}>{busy ? "Salvando…" : editing ? "Salvar alterações" : "Criar evento"}</Button>
          {editing && <Button full variant="ghost" disabled={busy} onClick={() => { setEditing(null); setForm(emptyEvent()); }}>Cancelar edição</Button>}
        </form>
      </Card>
      <Card title="Próximos eventos" className="xl:col-span-2" action={<Button variant="ghost" onClick={events.reload}>Atualizar</Button>}>
        {events.data?.items.length ? <ul className="space-y-3">{events.data.items.map(event => <li key={event.id} className="rounded-xl border border-slate-100 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex gap-3">
              <span className="h-fit rounded-lg bg-violet-50 p-2 text-violet-600"><CalendarDays size={20} /></span>
              <div>
                <p className="font-medium text-slate-800">{event.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{formatDateTime(event.startsAt)} → {formatDateTime(event.endsAt)}</p>
                {(event.areaName || event.location) && <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><MapPin size={12} />{[event.areaName, event.location].filter(Boolean).join(" · ")}</p>}
              </div>
            </div>
            <Badge>{event.status}</Badge>
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1"><Users size={13} />{count(event.attendingResponses, "confirmação", "confirmações")} · {count(event.attendingPeople, "pessoa", "pessoas")}</span>
            <span>{count(event.declinedResponses, "não vai", "não vão")}</span>
            {event.capacity && <span>limite de {event.capacity} pessoas</span>}
            {event.rsvpUntil && <span>confirmação até {formatDateTime(event.rsvpUntil)}</span>}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setAnswersFor(answersFor === event.id ? null : event.id)}>{answersFor === event.id ? "Ocultar confirmações" : "Ver confirmações"}</Button>
            {event.status === "SCHEDULED" && <Button variant="ghost" disabled={busy} onClick={() => edit(event)}>Editar</Button>}
            {event.status === "SCHEDULED" && (cancelling === event.id
              ? <><Button variant="danger" disabled={busy} onClick={() => void cancel(event)}>Confirmar cancelamento</Button><Button variant="ghost" disabled={busy} onClick={() => setCancelling(null)}>Manter evento</Button></>
              : <Button variant="ghost" disabled={busy} onClick={() => setCancelling(event.id)}>Cancelar evento</Button>)}
          </div>
          {answersFor === event.id && <section aria-label={`Confirmações de ${event.title}`} className="mt-3 rounded-lg bg-slate-50 p-3">
            {list.length ? <ul className="divide-y divide-slate-200 text-sm">{list.map(answer => <li key={answer.userId} className="flex items-center justify-between gap-3 py-2">
              <div><p className="font-medium text-slate-800">{answer.name ?? "Morador"}</p><p className="text-xs text-slate-500">{answer.unit ? `unidade ${answer.unit}` : "sem unidade vinculada"}</p></div>
              <div className="text-right">{answer.attending ? <Badge tone="success">Vai</Badge> : <Badge tone="neutral">Não vai</Badge>}
                {answer.attending && answer.guests > 0 && <p className="mt-1 text-xs text-slate-500">+{count(answer.guests, "acompanhante", "acompanhantes")}</p>}</div>
            </li>)}</ul> : <ResourceFeedback resource={answers} emptyText="Ninguém respondeu ainda." />}
          </section>}
        </li>)}</ul> : <ResourceFeedback resource={events} emptyText="Nenhum evento marcado." />}
      </Card>
    </div>
  </>;
}

type AreaDraft = { name: string; opensAt: string; closesAt: string; maxHoursPerBooking: string; requiresApproval: boolean; capacity: string; monthlyLimitPerResident: string; monthlyLimitPerUnit: string };
const draftOf = (area?: CommonArea): AreaDraft => ({
  name: area?.name ?? "", opensAt: area?.opensAt.slice(0, 5) ?? "08:00", closesAt: area?.closesAt.slice(0, 5) ?? "22:00",
  maxHoursPerBooking: String(area?.maxHoursPerBooking ?? 6), requiresApproval: area?.requiresApproval ?? true, capacity: area?.capacity ? String(area.capacity) : "",
  monthlyLimitPerResident: area?.monthlyLimitPerResident ? String(area.monthlyLimitPerResident) : "", monthlyLimitPerUnit: area?.monthlyLimitPerUnit ? String(area.monthlyLimitPerUnit) : "",
});
const optionalNumber = (value: string) => value.trim() ? Number(value) : null;

function AreaRules({ buildingId, areas, canConfigure }: { buildingId: string; areas: ReturnType<typeof useResource<Paged<CommonArea>>>; canConfigure: boolean }) {
  const list = areas.data?.items ?? [];
  return <div className="grid items-start gap-5 xl:grid-cols-2">
    {list.map(area => canConfigure
      ? <AreaForm key={area.id} buildingId={buildingId} area={area} onSaved={areas.reload} />
      : <Card key={area.id} title={area.name}><p className="text-sm text-slate-600">{areaRules(area)}</p></Card>)}
    {!list.length && <Card><ResourceFeedback resource={areas} emptyText="Nenhuma área cadastrada." /></Card>}
    {canConfigure && <AreaForm key={`new:${list.length}`} buildingId={buildingId} onSaved={areas.reload} />}
  </div>;
}

function AreaForm({ buildingId, area, onSaved }: { buildingId: string; area?: CommonArea; onSaved: () => void }) {
  const [draft, setDraft] = useState(() => draftOf(area));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const body = { name: draft.name.trim(), opensAt: draft.opensAt, closesAt: draft.closesAt, maxHoursPerBooking: Number(draft.maxHoursPerBooking),
        requiresApproval: draft.requiresApproval, monthlyLimitPerResident: optionalNumber(draft.monthlyLimitPerResident), monthlyLimitPerUnit: optionalNumber(draft.monthlyLimitPerUnit),
        ...(draft.capacity.trim() ? { capacity: Number(draft.capacity) } : {}) };
      if (area) await api.patch(`/common-areas/${area.id}`, body);
      else await api.post("/common-areas", { buildingId, ...body });
      setMessage(area ? "Regras salvas." : "Área cadastrada.");
      if (!area) setDraft(draftOf());
      onSaved();
    } catch (cause) { setError(errorText(cause, "Não foi possível salvar a área.")); }
    finally { setBusy(false); }
  }
  return <Card title={area ? area.name : "Cadastrar área"}>
    <form className="space-y-3" onSubmit={submit => { submit.preventDefault(); void save(); }}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {message && <p role="status" className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{message}</p>}
      <Field label="Nome da área"><Input required value={draft.name} onChange={name => setDraft({ ...draft, name })} placeholder="Salão de festas" /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Abre às"><Input type="time" required value={draft.opensAt} onChange={opensAt => setDraft({ ...draft, opensAt })} /></Field>
        <Field label="Fecha às"><Input type="time" required value={draft.closesAt} onChange={closesAt => setDraft({ ...draft, closesAt })} /></Field>
        <Field label="Máx. horas"><Input type="number" min={1} max={24} required value={draft.maxHoursPerBooking} onChange={maxHoursPerBooking => setDraft({ ...draft, maxHoursPerBooking })} /></Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Limite por unidade" hint="Reservas por mês. Vazio = sem limite."><Input type="number" min={1} max={31} value={draft.monthlyLimitPerUnit} onChange={monthlyLimitPerUnit => setDraft({ ...draft, monthlyLimitPerUnit })} /></Field>
        <Field label="Limite por morador" hint="Reservas por mês. Vazio = sem limite."><Input type="number" min={1} max={31} value={draft.monthlyLimitPerResident} onChange={monthlyLimitPerResident => setDraft({ ...draft, monthlyLimitPerResident })} /></Field>
        <Field label="Capacidade" hint="Pessoas. Opcional."><Input type="number" min={1} value={draft.capacity} onChange={capacity => setDraft({ ...draft, capacity })} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={draft.requiresApproval} onChange={change => setDraft({ ...draft, requiresApproval: change.target.checked })} />Reservas precisam de aprovação da administração</label>
      <Button type="submit" disabled={busy || draft.name.trim().length < 2}>{busy ? "Salvando…" : area ? "Salvar regras" : "Cadastrar área"}</Button>
    </form>
  </Card>;
}
