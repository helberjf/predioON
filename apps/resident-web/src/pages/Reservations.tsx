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
  useResource,
} from "@predioon/ui";
import type { CommonArea, Paged, Reservation } from "@predioon/ui";

export function Reservations({ buildingId }: { buildingId: string }) {
  const areas = useResource<Paged<CommonArea>>(`/common-areas?buildingId=${buildingId}`);
  const mine = useResource<Paged<Reservation>>(`/reservations?buildingId=${buildingId}&mine=true`);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ areaId: "", date: "", start: "19:00", hours: "4", unit: "" });

  const area = areas.data?.items.find((item) => item.id === form.areaId);
  const areaName = (areaId: string) => areas.data?.items.find((item) => item.id === areaId)?.name ?? "Área";

  async function book() {
    try {
      const startsAt = new Date(`${form.date}T${form.start}:00`);
      const endsAt = new Date(startsAt.getTime() + Number(form.hours) * 3_600_000);
      await api.post("/reservations", {
        areaId: form.areaId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        unit: form.unit || undefined,
      });
      setError(null);
      mine.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao reservar");
    }
  }

  async function cancel(id: string) {
    await api.delete(`/reservations/${id}`);
    mine.reload();
  }

  return (
    <>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <Card title="Nova reserva">
        <div className="space-y-3">
          <Field label="Área comum">
            <Select
              value={form.areaId}
              onChange={(areaId) => setForm({ ...form, areaId })}
              options={[
                { value: "", label: "Escolha uma área" },
                ...(areas.data?.items ?? []).map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data">
              <Input type="date" value={form.date} onChange={(date) => setForm({ ...form, date })} />
            </Field>
            <Field label="Início">
              <Input value={form.start} onChange={(start) => setForm({ ...form, start })} placeholder="19:00" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Duração (h)" hint={area ? `máx. ${area.maxHoursPerBooking}h` : undefined}>
              <Input type="number" value={form.hours} onChange={(hours) => setForm({ ...form, hours })} />
            </Field>
            <Field label="Unidade">
              <Input value={form.unit} onChange={(unit) => setForm({ ...form, unit })} placeholder="101" />
            </Field>
          </div>
          {area?.requiresApproval && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Esta área precisa da aprovação da administração.
            </p>
          )}
          <Button full onClick={() => void book()} disabled={!form.areaId || !form.date}>
            Reservar
          </Button>
        </div>
      </Card>

      <Card title="Minhas reservas">
        {mine.data?.items.length ? (
          <ul className="space-y-3">
            {mine.data.items.map((reservation) => (
              <li
                key={reservation.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{areaName(reservation.areaId)}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(reservation.startsAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge>{reservation.status}</Badge>
                  {reservation.status !== "CANCELLED" && (
                    <Button variant="ghost" onClick={() => void cancel(reservation.id)}>
                      Cancelar
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState text="Você não tem reservas." />
        )}
      </Card>
    </>
  );
}
