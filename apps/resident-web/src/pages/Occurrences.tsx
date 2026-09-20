import { useState } from "react";
import {
  api,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  formatDateTime,
  Input,
  Select,
  TextArea,
  useResource,
} from "@predioon/ui";
import type { Occurrence, Paged } from "@predioon/ui";

const CATEGORIES = [
  { value: "HIDRAULICA", label: "Hidráulica / vazamento" },
  { value: "ELETRICA", label: "Elétrica" },
  { value: "ILUMINACAO", label: "Iluminação" },
  { value: "ELEVADOR", label: "Elevador" },
  { value: "PORTAO", label: "Portão" },
  { value: "LIMPEZA", label: "Limpeza" },
  { value: "OUTROS", label: "Outros" },
];

export function Occurrences({ buildingId }: { buildingId: string }) {
  const list = useResource<Paged<Occurrence>>(`/occurrences?buildingId=${buildingId}&limit=50`);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ category: "HIDRAULICA", title: "", description: "", location: "", unit: "" });

  async function submit() {
    try {
      await api.post("/occurrences", {
        buildingId,
        category: form.category,
        title: form.title,
        description: form.description,
        location: form.location || undefined,
        unit: form.unit || undefined,
      });
      setForm({ category: "HIDRAULICA", title: "", description: "", location: "", unit: "" });
      setOpen(false);
      list.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao abrir chamado");
    }
  }

  return (
    <>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {open ? (
        <Card title="Abrir chamado">
          <div className="space-y-3">
            <Field label="Categoria">
              <Select value={form.category} onChange={(category) => setForm({ ...form, category })} options={CATEGORIES} />
            </Field>
            <Field label="Resumo">
              <Input value={form.title} onChange={(title) => setForm({ ...form, title })} placeholder="Lâmpada queimada" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Local">
                <Input value={form.location} onChange={(location) => setForm({ ...form, location })} placeholder="Garagem" />
              </Field>
              <Field label="Unidade">
                <Input value={form.unit} onChange={(unit) => setForm({ ...form, unit })} placeholder="101" />
              </Field>
            </div>
            <Field label="Descrição">
              <TextArea value={form.description} onChange={(description) => setForm({ ...form, description })} rows={4} />
            </Field>
            <div className="flex gap-2">
              <Button variant="secondary" full onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button full onClick={() => void submit()} disabled={!form.title || !form.description}>
                Enviar
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Button full onClick={() => setOpen(true)}>
          Abrir novo chamado
        </Button>
      )}

      {list.data?.items.length ? (
        list.data.items.map((occurrence) => (
          <Card key={occurrence.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs text-slate-400">#{occurrence.protocol}</p>
                <p className="mt-1 font-medium text-slate-900">{occurrence.title}</p>
                <p className="mt-1 text-sm text-slate-600">{occurrence.description}</p>
                <p className="mt-2 text-xs text-slate-400">
                  {occurrence.location ?? "sem local"} · {formatDateTime(occurrence.createdAt)}
                </p>
              </div>
              <Badge>{occurrence.status}</Badge>
            </div>
          </Card>
        ))
      ) : (
        <Card>
          <EmptyState text="Você ainda não abriu chamados." />
        </Card>
      )}
    </>
  );
}
