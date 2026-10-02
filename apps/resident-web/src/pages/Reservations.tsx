import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, CheckCircle2, ChevronRight, Flame, PartyPopper, Trees, Users } from "lucide-react";
import { api, Badge, Button, Card, cls, ErrorBanner, Field, formatDateTime, Input, ReservationAvailability, ResourceFeedback, useResource } from "@predioon/ui";
import type { CommonArea, Paged, Reservation } from "@predioon/ui";

export function Reservations({ buildingId }: { buildingId: string }) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const authorization = useResource<{ capabilities: string[] }>(`/v1/authorization?buildingId=${encodeURIComponent(buildingId)}`);
  useEffect(() => {
    window.addEventListener("focus", authorization.reload);
    const interval = setInterval(authorization.reload, 30_000);
    return () => { window.removeEventListener("focus", authorization.reload); clearInterval(interval); };
  }, [authorization.reload]);
  const can = (capability: string) => authorization.data?.capabilities.includes(capability) === true;
  const canAreas = can("common-areas:read");
  const canManage = can("reservations:manage") && canAreas;
  const canRead = can("reservations:read-own") || canManage;
  const canCreate = can("reservations:create-own") && can("reservations:read-own") && canAreas;
  const canCalendar = can("reservations:read-calendar") && canAreas;
  const canCancel = (can("reservations:cancel-own") && can("reservations:read-own")) || canManage;
  const canChooseArea = canCreate || canCalendar;
  const areas = useResource<Paged<CommonArea>>(canAreas ? `/common-areas?buildingId=${encodeURIComponent(buildingId)}` : null);
  const mine = useResource<Paged<Reservation>>(canRead ? `/reservations?buildingId=${encodeURIComponent(buildingId)}&mine=true` : null);
  const [search, setSearch] = useSearchParams();
  const tab = canRead && (search.get("tab") === "minhas" || !canChooseArea) ? "minhas" : "nova";
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState(false);
  const [calendarRevision, setCalendarRevision] = useState(0);
  const [form, setForm] = useState({ areaId: "", date: "", start: "19:00", hours: "4", unit: "" });
  const area = areas.data?.items.find(item => item.id === form.areaId);
  const areaName = (id: string) => areas.data?.items.find(item => item.id === id)?.name ?? "Área comum";
  async function book() {
    if (!canCreate || pending) return;
    setPending(true); setError(null); setSuccess("");
    try {
      const startsAt = new Date(`${form.date}T${form.start}:00`);
      const hours = Number(form.hours);
      if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(hours) || hours <= 0) throw new Error("Informe uma data, horário e duração válidos.");
      const created = await api.post<Reservation>("/reservations", { areaId: form.areaId, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + hours * 3600000).toISOString(), unit: form.unit || undefined });
      setSuccess(created.status === "CONFIRMED" ? "Reserva confirmada com sucesso." : created.status === "PENDING" ? "Reserva enviada para aprovação da administração." : "Reserva registrada. Confira a situação em Minhas reservas.");
      mine.reload(); setSearch({ tab: "minhas" }); setForm({ ...form, date: "" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao reservar"); }
    finally { setPending(false); setCalendarRevision(value => value + 1); }
  }
  async function cancel(id: string) {
    if (!canCancel || pending) return;
    setPending(true); setError(null); setSuccess("");
    try { await api.delete(`/reservations/${id}`); mine.reload(); setSuccess("Reserva cancelada."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível cancelar a reserva."); }
    finally { setPending(false); setCalendarRevision(value => value + 1); }
  }
  if (!authorization.data) return <Card><ResourceFeedback resource={authorization} emptyText="Não foi possível consultar suas permissões para reservas." /></Card>;
  if (!canRead && !canChooseArea) return <Card><p className="text-sm text-slate-600">Seu perfil não tem acesso às reservas deste condomínio. Consulte a administração.</p></Card>;
  const tabs = [
    ...(canChooseArea ? [{ key: "nova", label: canCreate ? "Nova reserva" : "Ocupação das áreas" }] : []),
    ...(canRead ? [{ key: "minhas", label: "Minhas reservas" }] : []),
  ];
  return <>
    <div className="flex rounded-lg bg-slate-200/60 p-1" aria-label="Opções de reserva">{tabs.map(item => <button key={item.key} aria-pressed={tab === item.key} onClick={() => { setSearch(item.key === "minhas" ? { tab: "minhas" } : {}); setError(null); setSuccess(""); }} className={cls("flex-1 rounded-md px-2 py-2.5 text-sm font-medium", tab === item.key ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600")}>{item.label}</button>)}</div>
    {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    {success && <p role="status" className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />{success}</p>}
    {tab === "nova" ? <>
      {areas.data?.items.length ? <div className="space-y-3">{areas.data.items.map(item => {
        const Icon = /churras/i.test(item.name) ? Flame : /salão|festa|gourmet/i.test(item.name) ? PartyPopper : Trees;
        const selected = area?.id === item.id;
        return <div key={item.id} className={cls("overflow-hidden rounded-xl border bg-white", selected ? "border-emerald-300" : "border-slate-100")}>
          <button aria-expanded={selected} onClick={() => { setForm({ ...form, areaId: selected ? "" : item.id, hours: String(Math.min(4, item.maxHoursPerBooking)) }); setError(null); }} className="flex w-full items-center gap-4 p-3 text-left">
            <span className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-[#d6ece4] to-[#ebf2f7] text-[#398878]"><span className="absolute -bottom-5 -right-5 h-20 w-20 rounded-full border-[12px] border-white/35" /><Icon size={39} strokeWidth={1.5} /></span>
            <div className="min-w-0 flex-1"><h2 className="text-sm font-bold text-[#152d4b]">{item.name}</h2><p className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-500"><Users size={13} />{item.capacity ? `Capacidade: ${item.capacity} pessoas` : "Uso por horário"}</p><span className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"><CalendarDays size={15} />{selected ? "Selecionado" : canCreate ? "Reservar" : "Consultar horários"}</span></div><ChevronRight size={17} className="shrink-0 text-slate-400" />
          </button>
          {selected && <form onSubmit={event => { event.preventDefault(); void book(); }} className="space-y-3 border-t border-emerald-100 p-4">
            <p className="text-xs text-slate-500">Funcionamento: {item.opensAt.slice(0, 5)} às {item.closesAt.slice(0, 5)}</p>
            <p className="text-xs text-slate-500">Horários no fuso {timeZone}.</p>
            <div className="grid grid-cols-2 gap-3"><Field label="Data"><Input type="date" required value={form.date} onChange={date => setForm({ ...form, date })} /></Field>{canCreate && <Field label="Início"><Input type="time" required value={form.start} onChange={start => setForm({ ...form, start })} /></Field>}</div>
            {canCalendar && <ReservationAvailability buildingId={buildingId} areaId={item.id} date={form.date} revision={calendarRevision} />}
            {canCreate && <>
              <div className="grid grid-cols-2 gap-3"><Field label="Duração (h)" hint={`máx. ${item.maxHoursPerBooking}h`}><Input type="number" required value={form.hours} onChange={hours => setForm({ ...form, hours })} /></Field><Field label="Unidade"><Input value={form.unit} onChange={unit => setForm({ ...form, unit })} placeholder="101" /></Field></div>
              {item.requiresApproval && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">A reserva será enviada para aprovação da administração.</p>}
              <Button type="submit" full disabled={pending || !form.date}>{pending ? "Enviando…" : "Confirmar reserva"}</Button>
            </>}
          </form>}
        </div>;
      })}</div> : <Card><ResourceFeedback resource={areas} emptyText="Nenhuma área comum disponível para reserva." /></Card>}
      <p className="px-1 text-xs leading-5 text-slate-500">Escolha o espaço e informe a data{canCreate ? " e o horário. Você pode acompanhar a situação em Minhas reservas." : " para consultar os horários ocupados."}</p>
    </> : <Card title="Próximas reservas">{mine.data?.items.length ? <ul className="divide-y divide-slate-100">{mine.data.items.map(reservation => <li key={reservation.id} className="py-4 first:pt-0"><div className="flex items-start justify-between gap-3"><div className="flex gap-3"><span className="h-fit rounded-lg bg-emerald-50 p-2 text-emerald-600"><CalendarDays size={22} /></span><div><p className="text-sm font-semibold text-[#152d4b]">{areaName(reservation.areaId)}</p><p className="mt-1 text-xs leading-5 text-slate-500">{formatDateTime(reservation.startsAt)}</p></div></div><Badge>{reservation.status}</Badge></div>{canCancel && ["PENDING", "CONFIRMED"].includes(reservation.status) && <div className="mt-2 text-right"><Button variant="ghost" disabled={pending} onClick={() => void cancel(reservation.id)}>Cancelar reserva</Button></div>}</li>)}</ul> : <ResourceFeedback resource={mine} emptyText="Você não tem reservas futuras." />}</Card>}
  </>;
}
