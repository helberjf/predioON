import { useState } from "react";
import { FinancialContentSchema, financialTotals, type FinancialReport } from "@predioon/shared";
import { api } from "../api.js";
import { Button, ErrorBanner } from "./primitives.js";
import { Field, Input, Select, TextArea } from "./fields.js";

export const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function toCents(value: string) {
  if (!/^-?\d+(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error("Informe valores como 1234,56, com no máximo duas casas decimais.");
  return Math.round(Number(value.trim().replace(",", ".")) * 100);
}
type EntryForm = { type: string; category: string; description: string; amount: string; date: string; receiptUrl: string };
export function FinancialEditor({ buildingId, initial, copy = false, onSaved, onCancel }: { buildingId: string; initial?: FinancialReport; copy?: boolean; onSaved: (report: FinancialReport) => void; onCancel: () => void }) {
  const [month, setMonth] = useState(initial?.month ?? new Date().toISOString().slice(0, 7));
  const [title, setTitle] = useState(initial?.title ?? ""), [summary, setSummary] = useState(initial?.summary ?? "");
  const [opening, setOpening] = useState(((initial?.openingBalanceCents ?? 0) / 100).toFixed(2));
  const [entries, setEntries] = useState<EntryForm[]>(initial?.entries.map(e => ({ ...e, amount: (e.amountCents / 100).toFixed(2), receiptUrl: e.receiptUrl ?? "" })) ?? []);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const update = (index: number, changes: Partial<EntryForm>) => setEntries(entries.map((entry, i) => i === index ? { ...entry, ...changes } : entry));
  function content() {
    return { month, title, summary, openingBalanceCents: toCents(opening), entries: entries.map(e => ({ type: e.type, category: e.category, description: e.description, date: e.date, amountCents: toCents(e.amount), receiptUrl: e.receiptUrl.trim() || null })) };
  }
  let preview: ReturnType<typeof financialTotals> | null = null;
  try { const parsed = FinancialContentSchema.safeParse(content()); if (parsed.success) preview = financialTotals(parsed.data); } catch { /* Incomplete money inputs have no preview. */ }
  async function save() {
    setBusy(true); setError("");
    try {
      const parsed = FinancialContentSchema.safeParse(content());
      if (!parsed.success) throw new Error(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
      const saved = initial && !copy ? await api.put<FinancialReport>(`/finance/${initial.id}`, { ...parsed.data, version: initial.version }) : await api.post<FinancialReport>("/finance", { ...parsed.data, buildingId });
      onSaved(saved);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar prestação"); } finally { setBusy(false); }
  }
  return <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save(); }}>
    {error && <ErrorBanner message={error} />}
    <p className="text-sm text-slate-500">Salve como rascunho, confira os totais e depois publique. A publicação ficará visível aos moradores deste condomínio.</p>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Mês da prestação"><input className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" type="month" value={month} disabled={Boolean(initial)} onChange={e => setMonth(e.target.value)} required /></Field><Field label="Saldo inicial (R$)"><Input value={opening} onChange={setOpening} placeholder="0,00" /></Field></div>
    <Field label="Título da prestação"><Input value={title} onChange={setTitle} placeholder="Prestação de contas de setembro" required /></Field>
    <Field label={copy ? "Resumo e motivo da correção" : "Resumo da prestação"}><TextArea value={summary} onChange={setSummary} placeholder="Explique os serviços, despesas e decisões do mês." /></Field>
    <div className="space-y-4">{entries.map((entry, index) => <fieldset key={index} className="rounded-xl border border-slate-200 p-4"><legend className="px-1 text-sm font-medium">Lançamento {index + 1}</legend>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Tipo de lançamento"><Select value={entry.type} onChange={type => update(index, { type })} options={[{ value: "INCOME", label: "Receita" }, { value: "EXPENSE", label: "Despesa" }]} /></Field><Field label="Valor (R$)"><Input value={entry.amount} onChange={amount => update(index, { amount })} placeholder="1234,56" /></Field><Field label="Categoria financeira"><Input value={entry.category} onChange={category => update(index, { category })} placeholder="Manutenção, energia, cotas…" /></Field><Field label="Data do lançamento"><Input type="date" value={entry.date} onChange={date => update(index, { date })} /></Field></div>
      <div className="mt-3 space-y-3"><Field label="Descrição do lançamento"><Input value={entry.description} onChange={description => update(index, { description })} /></Field><Field label="Link do comprovante (opcional)" hint="Link HTTPS. Configure no serviço de arquivos a permissão de leitura para os moradores."><Input value={entry.receiptUrl} onChange={receiptUrl => update(index, { receiptUrl })} placeholder="https://…" /></Field><Button variant="secondary" disabled={busy} onClick={() => setEntries(entries.filter((_, i) => i !== index))}>Remover lançamento {index + 1}</Button></div>
    </fieldset>)}</div>
    <Button variant="secondary" disabled={busy || entries.length >= 500} onClick={() => setEntries([...entries, { type: "EXPENSE", category: "", description: "", amount: "", date: `${month}-01`, receiptUrl: "" }])}>Adicionar lançamento</Button>
    {preview && <div className="rounded-xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-900"><p>Receitas: {money(preview.incomeCents)} · Despesas: {money(preview.expenseCents)}</p><p className="font-semibold">Saldo final: {money(preview.closingBalanceCents)}</p></div>}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar rascunho"}</Button><Button variant="secondary" disabled={busy} onClick={onCancel}>Fechar edição</Button></div>
  </form>;
}
