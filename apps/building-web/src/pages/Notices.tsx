import { useEffect, useState } from "react";
import { instantToLocalDateTime, localDateTimeToIso, type ScheduledNotice } from "@predioon/shared";
import { api, Badge, Button, Card, ErrorBanner, Field, Input, Select, TextArea, useResource, ResourceFeedback, ParkingPanel, useFeatures } from "@predioon/ui";
import type { Notice, Paged } from "@predioon/ui";

const CATEGORIES = [
  { value: "COMMUNICATION", label: "Comunicado" }, { value: "MAINTENANCE", label: "Manutenção / limpeza" },
  { value: "EVENT", label: "Reunião / evento" }, { value: "WASTE_COLLECTION", label: "Coleta de lixo" },
  { value: "GESTAO", label: "Transparência da gestão" },
];
const ZONES = ["America/Sao_Paulo", "America/Manaus", "America/Recife", "America/Belem", "America/Fortaleza", "America/Cuiaba", "America/Rio_Branco", "America/Noronha"];
type ManagedNotice = Notice & ScheduledNotice & { expiresAt: string | null; updatedAt: string };
const emptyForm = () => ({ title: "", body: "", category: "COMMUNICATION", pinned: false, eventAt: "", recurrence: "NONE" as "NONE" | "WEEKLY", timeZone: "America/Sao_Paulo", publishAt: "", expiresAt: "" });
const dateInZone = (value: string | Date, timeZone: string) => new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(value));

export function Notices({ buildingId, canManage = false }: { buildingId: string; canManage?: boolean }) {
  const flags = useFeatures();
  const notices = useResource<Paged<ManagedNotice>>(`/notices?buildingId=${encodeURIComponent(buildingId)}${canManage ? "&includeUnpublished=true&includeExpired=true" : ""}`);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<ManagedNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { setEditing(null); setForm(emptyForm()); setError(null); setMessage(null); }, [buildingId]);

  function edit(notice: ManagedNotice) {
    const zone = notice.schedule?.timeZone ?? "America/Sao_Paulo";
    setEditing(notice); setError(null); setMessage(null);
    setForm({ title: notice.title, body: notice.body, category: notice.category, pinned: notice.pinned,
      eventAt: notice.schedule ? instantToLocalDateTime(notice.schedule.startsAt, zone) : "", recurrence: notice.schedule?.recurrence ?? "NONE", timeZone: zone,
      publishAt: instantToLocalDateTime(notice.publishedAt, zone), expiresAt: notice.expiresAt ? instantToLocalDateTime(notice.expiresAt, zone) : "" });
  }
  async function save() {
    setError(null); setMessage(null); setBusy(true);
    try {
      if (form.recurrence === "WEEKLY" && !form.eventAt) throw new Error("Informe a data e hora do primeiro evento para repetir semanalmente");
      const body = { title: form.title, body: form.body, category: form.category, pinned: form.pinned,
        publishedAt: form.publishAt ? localDateTimeToIso(form.publishAt, form.timeZone) : new Date().toISOString(),
        expiresAt: form.expiresAt ? localDateTimeToIso(form.expiresAt, form.timeZone) : null,
        schedule: form.eventAt ? { startsAt: localDateTimeToIso(form.eventAt, form.timeZone), recurrence: form.recurrence, timeZone: form.timeZone } : null };
      if (editing) await api.patch(`/notices/${editing.id}`, { ...body, expectedUpdatedAt: editing.updatedAt });
      else await api.post("/notices", { buildingId, ...body });
      setMessage(editing ? "Aviso atualizado." : new Date(body.publishedAt) > new Date() ? "Publicação agendada." : "Aviso publicado.");
      setEditing(null); setForm(emptyForm()); notices.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar aviso"); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setError(null); setBusy(true);
    try { await api.delete(`/notices/${id}`); if (editing?.id === id) { setEditing(null); setForm(emptyForm()); } notices.reload(); setMessage("Aviso removido."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao remover aviso"); }
    finally { setBusy(false); }
  }
  function template(kind: "trash" | "meeting" | "hall") {
    const templates = {
      trash: { category: "WASTE_COLLECTION", title: "Dia de colocar o lixo", body: "Coloque o lixo no local de coleta antes do horário informado.", recurrence: "WEEKLY" as const },
      meeting: { category: "EVENT", title: "Reunião de condomínio", body: "Reunião no salão de festas. Confira a data e participe.", recurrence: "NONE" as const },
      hall: { category: "MAINTENANCE", title: "Limpeza do hall", body: "Limpeza programada do hall. Mantenha a passagem livre durante o serviço.", recurrence: "WEEKLY" as const },
    };
    setForm({ ...form, ...templates[kind] });
  }
  return <>
    <h1 className="text-2xl font-bold text-slate-900">Avisos e agenda</h1>
    {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
    <ParkingPanel buildingId={buildingId} />
    <div className="grid items-start gap-5 xl:grid-cols-3">
      {canManage && <Card title={editing ? "Editar aviso" : "Novo aviso"}>
        <div className="space-y-3">
          {!editing && <div className="flex flex-wrap gap-1"><Button variant="ghost" onClick={() => template("trash")}>Dia do lixo</Button><Button variant="ghost" onClick={() => template("meeting")}>Reunião</Button><Button variant="ghost" onClick={() => template("hall")}>Limpeza do hall</Button></div>}
          <Field label="Categoria"><Select value={form.category} onChange={category => setForm({ ...form, category })} options={CATEGORIES.filter(category => category.value !== "GESTAO" || flags.enabled("TRANSPARENCY"))} /></Field>
          <Field label="Título"><Input value={form.title} onChange={title => setForm({ ...form, title })} placeholder="Coleta de lixo" /></Field>
          <Field label="Mensagem"><TextArea value={form.body} onChange={body => setForm({ ...form, body })} rows={4} /></Field>
          <Field label="Fuso horário"><Select value={form.timeZone} onChange={timeZone => setForm({ ...form, timeZone })} options={[...new Set([...ZONES, form.timeZone])].map(zone => ({ value: zone, label: zone.replace("America/", "").replaceAll("_", " ") }))} /></Field>
          <Field label="Data e hora do evento" hint="Opcional para comunicados sem evento."><Input type="datetime-local" value={form.eventAt} onChange={eventAt => setForm({ ...form, eventAt })} /></Field>
          <Field label="Repetição"><Select value={form.recurrence} onChange={recurrence => setForm({ ...form, recurrence })} options={[{ value: "NONE", label: "Não repetir" }, { value: "WEEKLY", label: "Toda semana, no mesmo dia e horário" }]} /></Field>
          <Field label="Publicar em" hint="Deixe vazio para publicar agora. Antes desse horário, o aviso fica visível somente à gestão."><Input type="datetime-local" value={form.publishAt} onChange={publishAt => setForm({ ...form, publishAt })} /></Field>
          <Field label="Encerrar aviso em" hint="Opcional. Também encerra a agenda semanal."><Input type="datetime-local" value={form.expiresAt} onChange={expiresAt => setForm({ ...form, expiresAt })} /></Field>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.pinned} onChange={event => setForm({ ...form, pinned: event.target.checked })} />Fixar no topo</label>
          <Button full onClick={() => void save()} disabled={busy || form.title.trim().length < 3 || form.body.trim().length < 3}>{busy ? "Salvando…" : editing ? "Salvar alterações" : form.publishAt ? "Salvar publicação" : "Publicar para os moradores"}</Button>
          {editing && <Button full variant="ghost" disabled={busy} onClick={() => { setEditing(null); setForm(emptyForm()); }}>Cancelar edição</Button>}
        </div>
      </Card>}
      <Card title={canManage ? "Publicados, agendados e encerrados" : "Avisos publicados"} className={canManage ? "xl:col-span-2" : "xl:col-span-3"} action={<Button variant="ghost" onClick={notices.reload}>Atualizar</Button>}>
        {notices.error && notices.data && <ErrorBanner message={notices.error} />}
        {notices.data?.items.length ? <ul className="space-y-3">{notices.data.items.map(notice => {
          const zone = notice.schedule?.timeZone ?? "America/Sao_Paulo";
          const scheduled = new Date(notice.publishedAt) > new Date();
          const expired = notice.expiresAt && new Date(notice.expiresAt) <= new Date();
          return <li key={notice.id} className="rounded-xl border border-slate-100 p-4">
            <div className="flex flex-wrap items-center gap-2"><Badge tone="info">{CATEGORIES.find(c => c.value === notice.category)?.label ?? notice.category}</Badge>{notice.pinned && <Badge tone="warning">fixado</Badge>}<Badge tone={expired ? "neutral" : scheduled ? "warning" : "success"}>{expired ? "Encerrado" : scheduled ? "Publicação agendada" : "Publicado"}</Badge></div>
            <p className="mt-2 font-medium text-slate-800">{notice.title}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{notice.body}</p>
            {notice.schedule && <div className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900"><p>{notice.nextOccurrenceAt ? `Próxima data: ${dateInZone(notice.nextOccurrenceAt, zone)}` : `Data do evento: ${dateInZone(notice.schedule.startsAt, zone)}`}</p><p className="mt-1 text-xs">{notice.schedule.recurrence === "WEEKLY" ? "Semanal" : "Evento único"} · {zone}</p></div>}
            <p className="mt-2 text-xs text-slate-500">Publicação: {dateInZone(notice.publishedAt, zone)} · {zone}{notice.expiresAt ? ` • Encerramento: ${dateInZone(notice.expiresAt, zone)}` : ""}</p>
            {canManage && <div className="mt-3 flex gap-2"><Button variant="secondary" disabled={busy} onClick={() => edit(notice)}>Editar</Button><Button variant="ghost" disabled={busy} onClick={() => void remove(notice.id)}>Remover</Button></div>}
          </li>;
        })}</ul> : <ResourceFeedback resource={notices} emptyText="Nenhum aviso cadastrado." />}
      </Card>
    </div>
  </>;
}
