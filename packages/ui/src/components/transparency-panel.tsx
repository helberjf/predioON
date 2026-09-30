import { useState } from "react";
import type { FinancialReport } from "@predioon/shared";
import { useFeatures } from "../features.js";
import { api } from "../api.js";
import type { Notice, Paged } from "../types.js";
import { useResource } from "../use-resource.js";
import { formatDateTime } from "../format.js";
import { Badge, Button, Card, ErrorBanner, ResourceFeedback } from "./primitives.js";
import { Field, Input, TextArea } from "./fields.js";
import { FinancialEditor, money } from "./financial-editor.js";

function ManagementUpdate({ buildingId, onSaved }: { buildingId: string; onSaved: () => void }) {
  const [title, setTitle] = useState(""), [body, setBody] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function publish() {
    setBusy(true); setError("");
    try { await api.post("/notices", { buildingId, category: "GESTAO", title, body }); setTitle(""); setBody(""); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao publicar atualização"); } finally { setBusy(false); }
  }
  return <form className="space-y-3" onSubmit={e => { e.preventDefault(); void publish(); }}>
    {error && <ErrorBanner message={error} />}
    <Field label="Título da atualização"><Input value={title} onChange={setTitle} placeholder="Reparo do portão: serviço agendado" required /></Field>
    <Field label="Informações para os moradores" hint="Informe andamento, prazo, responsável e próximos passos. Publique apenas informações destinadas a todos."><TextArea value={body} onChange={setBody} /></Field>
    <Button type="submit" disabled={busy || title.trim().length < 3 || body.trim().length < 3}>{busy ? "Publicando…" : "Publicar atualização da gestão"}</Button>
  </form>;
}
function ReportView({ report }: { report: FinancialReport }) {
  return <>
    <div className="flex flex-wrap items-center gap-2"><Badge tone={report.publishedAt ? "info" : "neutral"}>{report.publishedAt ? "Publicado" : "Rascunho privado"}</Badge><span className="text-xs text-slate-500">{report.month.split("-").reverse().join("/")} · Revisão {report.revision}</span></div>
    <h3 className="mt-3 font-semibold text-slate-900">{report.title}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{report.summary}</p>
    <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Saldo inicial", report.openingBalanceCents], ["Receitas", report.totals.incomeCents], ["Despesas", report.totals.expenseCents], ["Saldo final", report.totals.closingBalanceCents]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-sm font-bold text-slate-900">{money(Number(value))}</dd></div>)}</dl>
    <details className="mt-4"><summary className="cursor-pointer text-sm font-medium text-emerald-700">Lançamentos e comprovantes ({report.entries.length})</summary>
      {report.entries.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[540px] text-left text-xs"><thead><tr className="border-b"><th className="p-2">Data</th><th className="p-2">Tipo / categoria</th><th className="p-2">Descrição</th><th className="p-2">Valor</th><th className="p-2">Comprovante</th></tr></thead><tbody>{report.entries.map((entry, i) => <tr key={i} className="border-b border-slate-100"><td className="p-2">{entry.date.split("-").reverse().join("/")}</td><td className="p-2">{entry.type === "INCOME" ? "Receita" : "Despesa"} · {entry.category}</td><td className="max-w-xs break-words p-2">{entry.description}</td><td className="whitespace-nowrap p-2">{money(entry.amountCents)}</td><td className="p-2">{entry.receiptUrl ? <a className="text-emerald-700 underline" href={entry.receiptUrl} target="_blank" rel="noopener noreferrer">Ver comprovante {i + 1}</a> : "Não informado"}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-sm text-slate-500">Sem lançamentos neste relatório.</p>}
    </details>
    {report.publishedAt && <p className="mt-4 text-xs text-slate-500">Publicado em {formatDateTime(report.publishedAt)}. Revisões anteriores permanecem disponíveis.</p>}
  </>;
}
function Workspace({ buildingId, canManage }: { buildingId: string; canManage: boolean }) {
  const flags = useFeatures();
  const [month, setMonth] = useState(""), [offset, setOffset] = useState(0), [editing, setEditing] = useState<{ report?: FinancialReport; copy?: boolean } | null>(null);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const reports = useResource<Paged<FinancialReport>>(flags.enabled("FINANCE") ? `/finance?buildingId=${encodeURIComponent(buildingId)}&limit=50&offset=${offset}${month ? `&month=${month}` : ""}` : null);
  const notices = useResource<Paged<Notice>>(flags.enabled("TRANSPARENCY") ? `/notices?buildingId=${encodeURIComponent(buildingId)}&category=GESTAO` : null);
  const updates = notices.data?.items.filter(n => n.category === "GESTAO") ?? [];
  async function publish(report: FinancialReport) {
    setBusy(true); setError("");
    try { await api.post(`/finance/${report.id}/publish`, { version: report.version }); setMessage("Prestação publicada para os moradores do condomínio."); reports.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao publicar prestação"); } finally { setBusy(false); }
  }
  return <div className="space-y-5">
    <div><h1 className="text-2xl font-bold text-slate-900">Transparência e prestação de contas</h1><p className="mt-2 text-sm text-slate-500">Acompanhe decisões, serviços e os recursos do condomínio.</p></div>
    {error && <ErrorBanner message={error} />}{message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {flags.enabled("TRANSPARENCY") && <Card title="Acompanhamento da gestão">
      {canManage && <details className="mb-5"><summary className="mb-4 cursor-pointer text-sm font-medium text-emerald-700">Escrever atualização para os moradores</summary><ManagementUpdate buildingId={buildingId} onSaved={() => { notices.reload(); setMessage("Atualização publicada na transparência e nos avisos."); }} /></details>}
      {updates.length ? <ul className="space-y-4">{updates.map(update => <li key={update.id} className="rounded-xl border border-slate-200 p-4"><h2 className="font-semibold text-slate-800">{update.title}</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{update.body}</p><p className="mt-3 text-xs text-slate-500">{formatDateTime(update.publishedAt)}</p></li>)}</ul> : notices.error || notices.loading ? <ResourceFeedback resource={notices} emptyText="" /> : <p className="text-sm text-slate-500">Nenhuma atualização de gestão publicada.</p>}
      <p className="mt-4 text-xs text-slate-500">Problemas individuais podem ser acompanhados em Chamados, com respostas e histórico da administração.</p>
    </Card>}
    {flags.enabled("FINANCE") && <><Card title="Prestação de contas mensal" action={canManage && <Button disabled={Boolean(editing)} onClick={() => setEditing({})}>Nova prestação</Button>}>
      <div className="flex flex-wrap items-end gap-3"><Field label="Filtrar mês"><input className="rounded-xl border border-slate-300 px-3 py-2 text-sm" type="month" value={month} onChange={e => { setMonth(e.target.value); setOffset(0); }} /></Field><Button variant="secondary" onClick={() => { setMonth(""); setOffset(0); }}>Todos os meses</Button><Button variant="secondary" onClick={reports.reload}>Atualizar contas</Button></div>
      <p className="mt-4 text-xs text-slate-500">Saldo final = saldo inicial + receitas − despesas. Valores e comprovantes são informados pela administração. Para cada mês, a maior revisão publicada substitui as anteriores; rascunhos não alteram a publicação vigente.</p>
    </Card>
    {editing && <Card title={editing.copy ? "Nova revisão da prestação" : editing.report ? "Editar rascunho" : "Preparar prestação de contas"}><FinancialEditor key={`${editing.report?.id ?? "new"}:${editing.copy ?? false}`} buildingId={buildingId} initial={editing.report} copy={editing.copy} onCancel={() => setEditing(null)} onSaved={saved => { setEditing(null); setMonth(saved.month); setOffset(0); reports.reload(); setMessage("Rascunho salvo. Confira o relatório antes de publicar."); }} /></Card>}
    {reports.error && <ErrorBanner message={reports.error} />}
    {reports.data?.items.length ? reports.data.items.map(report => <Card key={report.id}>
      <ReportView report={report} />
      {canManage && <div className="mt-4 flex flex-wrap gap-2">{report.publishedAt ? <Button variant="secondary" disabled={Boolean(editing)} onClick={() => setEditing({ report, copy: true })}>Criar correção deste mês</Button> : <><Button variant="secondary" disabled={Boolean(editing) || busy} onClick={() => setEditing({ report })}>Editar rascunho</Button><Button disabled={Boolean(editing) || busy} onClick={() => void publish(report)}>Publicar para os moradores</Button></>}</div>}
    </Card>) : <Card><ResourceFeedback resource={reports} emptyText={canManage ? "Nenhuma prestação cadastrada nesta seleção." : "Nenhuma prestação publicada nesta seleção."} /></Card>}
    <div className="flex items-center gap-3"><Button variant="secondary" disabled={offset === 0 || reports.loading} onClick={() => setOffset(offset - 50)}>Anterior</Button><span className="text-xs text-slate-500">Página {offset / 50 + 1}</span><Button variant="secondary" disabled={reports.loading || (reports.data?.items.length ?? 0) < 50} onClick={() => setOffset(offset + 50)}>Próxima</Button></div></>}
  </div>;
}
export function TransparencyPanel({ buildingId, canManage = false }: { buildingId: string; canManage?: boolean }) {
  return <Workspace key={buildingId} buildingId={buildingId} canManage={canManage} />;
}
