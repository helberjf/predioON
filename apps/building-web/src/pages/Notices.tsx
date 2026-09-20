import { useState } from "react";
import { api, Badge, Button, Card, EmptyState, ErrorBanner, Field, formatDateTime, Input, Select, TextArea, useResource } from "@predioon/ui";
import type { Notice, Paged } from "@predioon/ui";

const CATEGORIES = [
  { value: "COMMUNICATION" as const, label: "Comunicado" },
  { value: "MAINTENANCE" as const, label: "Manutenção" },
  { value: "EVENT" as const, label: "Evento" },
  { value: "WASTE_COLLECTION" as const, label: "Coleta de lixo" },
];

export function Notices({ buildingId }: { buildingId: string }) {
  const notices = useResource<Paged<Notice>>(`/notices?buildingId=${buildingId}`);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", body: "", category: "COMMUNICATION" as (typeof CATEGORIES)[number]["value"] });

  async function publish() {
    try {
      await api.post("/notices", { buildingId, ...form });
      setForm({ ...form, title: "", body: "" });
      notices.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao publicar aviso");
    }
  }

  async function remove(id: string) {
    await api.delete(`/notices/${id}`);
    notices.reload();
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Avisos</h1>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Novo aviso">
          <div className="space-y-3">
            <Field label="Categoria">
              <Select value={form.category} onChange={(category) => setForm({ ...form, category })} options={CATEGORIES} />
            </Field>
            <Field label="Título">
              <Input value={form.title} onChange={(title) => setForm({ ...form, title })} placeholder="Coleta de lixo" />
            </Field>
            <Field label="Mensagem">
              <TextArea value={form.body} onChange={(body) => setForm({ ...form, body })} rows={5} />
            </Field>
            <Button full onClick={() => void publish()} disabled={!form.title || !form.body}>
              Publicar para os moradores
            </Button>
          </div>
        </Card>

        <Card title="Avisos publicados" className="xl:col-span-2">
          {notices.data?.items.length ? (
            <ul className="space-y-3">
              {notices.data.items.map((notice) => (
                <li key={notice.id} className="rounded-xl border border-slate-100 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge tone="info">{CATEGORIES.find((c) => c.value === notice.category)?.label ?? notice.category}</Badge>
                        {notice.pinned && <Badge tone="warning">fixado</Badge>}
                      </div>
                      <p className="mt-2 font-medium text-slate-800">{notice.title}</p>
                      <p className="mt-1 text-sm text-slate-600">{notice.body}</p>
                      <p className="mt-2 text-xs text-slate-400">{formatDateTime(notice.publishedAt)}</p>
                    </div>
                    <Button variant="ghost" onClick={() => void remove(notice.id)}>
                      Remover
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState text="Nenhum aviso publicado." />
          )}
        </Card>
      </div>
    </>
  );
}
