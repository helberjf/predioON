import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import type { ApiClient } from "@predioon/api-client";
import type { Product, Scope } from "./scope.ts";
import { ownedTickets, reservationWindow } from "./scope.ts";
import type {
  CommonArea,
  List,
  Notice,
  Reservation,
  Ticket,
  TicketDetail,
} from "./models.ts";
import { useResource } from "./resource.ts";
import { useMutation } from "./mutation.ts";
import {
  Badge,
  Button,
  Card,
  dateTime,
  ErrorMessage,
  Feedback,
  Field,
  Pages,
  Refresh,
  styles,
} from "./ui.tsx";

type Props = { api: ApiClient; buildingId: string };
export function Notices({ api, buildingId }: Props) {
  const resource = useResource<List<Notice>>(
    api,
    `/notices?buildingId=${encodeURIComponent(buildingId)}`,
  );
  return (
    <>
      <Refresh resource={resource} />
      <Feedback
        resource={resource}
        empty={resource.data?.items.length === 0}
        emptyMessage="Nenhum aviso publicado."
      />
      {resource.data?.items.map((notice) => (
        <Card key={notice.id}>
          <View style={styles.row}>
            <Badge value={notice.category} />
            {notice.pinned && <Text style={styles.muted}>Fixado</Text>}
          </View>
          <Text style={styles.subtitle}>{notice.title}</Text>
          <Text style={styles.text}>{notice.body}</Text>
          <Text style={styles.muted}>{dateTime(notice.publishedAt)}</Text>
        </Card>
      ))}
    </>
  );
}

export function Tickets({
  api,
  buildingId,
  product,
  userId,
  scope,
}: Props & { product: Product; userId: string; scope: Scope }) {
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    location: "",
    unit: "",
  });
  const resource = useResource<List<Ticket>>(
    api,
    `/occurrences?buildingId=${encodeURIComponent(buildingId)}&limit=50&offset=${offset}`,
  );
  const mutation = useMutation();
  const items = ownedTickets(resource.data?.items ?? [], userId, product);
  if (selected)
    return (
      <TicketConversation
        key={selected}
        {...{ api, id: selected, product, scope }}
        back={() => {
          setSelected(null);
          resource.reload();
        }}
      />
    );
  return (
    <>
      <Refresh resource={resource} />
      {scope.capabilities.includes("occurrences:create-own") && (
        <Button
          label={showForm ? "Fechar formulário" : "Nova solicitação"}
          secondary={showForm}
          onPress={() => setShowForm((value) => !value)}
        />
      )}
      {mutation.error && <ErrorMessage message={mutation.error} />}
      {mutation.success && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {mutation.success}
        </Text>
      )}
      {showForm && (
        <Card>
          <Text style={styles.subtitle}>Conte o que aconteceu</Text>
          <Field
            label="Título"
            value={form.title}
            maxLength={160}
            onChangeText={(title) => setForm({ ...form, title })}
          />
          <Field
            label="Descrição"
            value={form.description}
            multiline
            maxLength={4000}
            onChangeText={(description) => setForm({ ...form, description })}
          />
          <Field
            label="Local (opcional)"
            value={form.location}
            maxLength={160}
            onChangeText={(location) => setForm({ ...form, location })}
          />
          <Field
            label="Unidade (opcional)"
            value={form.unit}
            maxLength={40}
            onChangeText={(unit) => setForm({ ...form, unit })}
          />
          <Button
            label={mutation.pending ? "Enviando…" : "Enviar solicitação"}
            disabled={
              mutation.pending ||
              form.title.trim().length < 3 ||
              form.description.trim().length < 3
            }
            onPress={() =>
              void mutation.run(async () => {
                const created = await api.post<Ticket>("/occurrences", {
                  buildingId,
                  category: "Geral",
                  title: form.title.trim(),
                  description: form.description.trim(),
                  location: form.location.trim() || undefined,
                  unit: form.unit.trim() || undefined,
                  priority: "NORMAL",
                });
                setForm({ title: "", description: "", location: "", unit: "" });
                setShowForm(false);
                resource.reload();
                setSelected(created.id);
              }, "Solicitação enviada.")
            }
          />
        </Card>
      )}
      <Feedback
        resource={resource}
        empty={items.length === 0 && resource.data !== null}
        emptyMessage={
          product === "resident"
            ? "Você não tem solicitações nesta página."
            : "Nenhuma solicitação nesta página."
        }
      />
      {items.map((ticket) => (
        <Card key={ticket.id}>
          <View style={styles.row}>
            <Badge value={ticket.status} />
            <Text style={styles.muted}>{ticket.protocol}</Text>
          </View>
          <Text style={styles.subtitle}>{ticket.title}</Text>
          <Text style={styles.muted}>
            {dateTime(ticket.createdAt)}
            {ticket.location ? ` • ${ticket.location}` : ""}
          </Text>
          <Button
            label="Acompanhar conversa"
            secondary
            onPress={() => setSelected(ticket.id)}
          />
        </Card>
      ))}
      {resource.data && (
        <Pages
          offset={offset}
          count={resource.data.items.length}
          setOffset={setOffset}
        />
      )}
    </>
  );
}

function TicketConversation({
  api,
  id,
  product,
  scope,
  back,
}: {
  api: ApiClient;
  id: string;
  product: Product;
  scope: Scope;
  back(): void;
}) {
  const resource = useResource<TicketDetail>(
    api,
    `/occurrences/${encodeURIComponent(id)}`,
  );
  const [message, setMessage] = useState("");
  const mutation = useMutation();
  const ticket = resource.data;
  const canManage =
    product === "operations" &&
    scope.capabilities.includes("occurrences:manage");
  function transition(status: string) {
    void mutation.run(async () => {
      await api.patch(`/occurrences/${encodeURIComponent(id)}`, { status });
      resource.reload();
    }, "Situação atualizada.");
  }
  return (
    <>
      <Button label="Voltar às solicitações" secondary onPress={back} />
      <Refresh resource={resource} />
      <Feedback resource={resource} />
      {mutation.error && <ErrorMessage message={mutation.error} />}
      {mutation.success && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {mutation.success}
        </Text>
      )}
      {ticket && (
        <>
          <Card>
            <Badge value={ticket.status} />
            <Text style={styles.subtitle}>{ticket.title}</Text>
            <Text style={styles.muted}>
              {ticket.protocol} • {dateTime(ticket.createdAt)}
            </Text>
            <Text style={styles.text}>{ticket.description}</Text>
            {ticket.location && (
              <Text style={styles.muted}>Local: {ticket.location}</Text>
            )}
            {canManage && (
              <View style={styles.row}>
                {[
                  ["IN_ANALYSIS", "Analisar"],
                  ["IN_PROGRESS", "Iniciar"],
                  ["DONE", "Concluir"],
                ]
                  .filter(([status]) => status !== ticket.status)
                  .map(([status, title]) => (
                    <Button
                      key={status}
                      label={title!}
                      disabled={mutation.pending}
                      onPress={() => transition(status!)}
                      secondary
                    />
                  ))}
              </View>
            )}
            {product === "resident" &&
              ["OPEN", "IN_ANALYSIS", "IN_PROGRESS"].includes(
                ticket.status,
              ) && (
                <Button
                  label="Cancelar solicitação"
                  disabled={mutation.pending}
                  secondary
                  onPress={() =>
                    Alert.alert(
                      "Cancelar solicitação?",
                      "O histórico continuará disponível.",
                      [
                        { text: "Voltar", style: "cancel" },
                        {
                          text: "Cancelar solicitação",
                          style: "destructive",
                          onPress: () => transition("CANCELLED"),
                        },
                      ],
                    )
                  }
                />
              )}
          </Card>
          {ticket.timeline.map((event) => (
            <Card key={event.id}>
              <Text style={styles.text}>{event.message}</Text>
              <Text style={styles.muted}>{dateTime(event.createdAt)}</Text>
            </Card>
          ))}
          <Card>
            <Field
              label="Nova mensagem"
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={2000}
            />
            <Button
              label={mutation.pending ? "Enviando…" : "Enviar mensagem"}
              disabled={mutation.pending || !message.trim()}
              onPress={() =>
                void mutation.run(async () => {
                  await api.post(
                    `/occurrences/${encodeURIComponent(id)}/comments`,
                    { message: message.trim() },
                  );
                  setMessage("");
                  resource.reload();
                }, "Mensagem enviada.")
              }
            />
          </Card>
        </>
      )}
    </>
  );
}

export function Reservations({ api, buildingId }: Props) {
  const areas = useResource<List<CommonArea>>(
    api,
    `/common-areas?buildingId=${encodeURIComponent(buildingId)}`,
  );
  const mine = useResource<List<Reservation>>(
    api,
    `/reservations?buildingId=${encodeURIComponent(buildingId)}&mine=true`,
  );
  const [form, setForm] = useState({
    areaId: "",
    date: "",
    time: "19:00",
    hours: "1",
    unit: "",
  });
  const mutation = useMutation();
  const selected = areas.data?.items.find((area) => area.id === form.areaId);
  return (
    <>
      <Text style={styles.subtitle}>Reservar um espaço</Text>
      <Feedback
        resource={areas}
        empty={areas.data?.items.length === 0}
        emptyMessage="Nenhuma área disponível."
      />
      <View style={styles.row}>
        {areas.data?.items.map((area) => (
          <Button
            key={area.id}
            label={area.name}
            secondary={area.id !== form.areaId}
            onPress={() => setForm({ ...form, areaId: area.id })}
          />
        ))}
      </View>
      {mutation.error && <ErrorMessage message={mutation.error} />}
      {mutation.success && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {mutation.success}
        </Text>
      )}
      {selected && (
        <Card>
          <Text style={styles.subtitle}>{selected.name}</Text>
          <Text style={styles.muted}>
            Horário de funcionamento: {selected.opensAt.slice(0, 5)} –{" "}
            {selected.closesAt.slice(0, 5)}. Máximo de{" "}
            {selected.maxHoursPerBooking} horas.
          </Text>
          {selected.requiresApproval && (
            <Text style={styles.muted}>
              Esta reserva depende de aprovação da administração.
            </Text>
          )}
          <Field
            label="Data (AAAA-MM-DD)"
            placeholder="2026-12-20"
            value={form.date}
            maxLength={10}
            keyboardType="numbers-and-punctuation"
            onChangeText={(date) => setForm({ ...form, date })}
          />
          <Field
            label="Início (HH:MM, horário deste aparelho)"
            value={form.time}
            maxLength={5}
            keyboardType="numbers-and-punctuation"
            onChangeText={(time) => setForm({ ...form, time })}
          />
          <Field
            label="Duração em horas"
            value={form.hours}
            keyboardType="decimal-pad"
            onChangeText={(hours) => setForm({ ...form, hours })}
          />
          <Field
            label="Unidade (opcional)"
            value={form.unit}
            maxLength={40}
            onChangeText={(unit) => setForm({ ...form, unit })}
          />
          <Button
            label={mutation.pending ? "Enviando…" : "Solicitar reserva"}
            disabled={mutation.pending || !form.date}
            onPress={() =>
              void mutation.run(
                async () => {
                  const window = reservationWindow(
                    form.date,
                    form.time,
                    form.hours.replace(",", "."),
                    selected.maxHoursPerBooking,
                  );
                  await api.post("/reservations", {
                    areaId: selected.id,
                    ...window,
                    unit: form.unit.trim() || undefined,
                  });
                  setForm({ ...form, areaId: "", date: "" });
                  mine.reload();
                },
                selected.requiresApproval
                  ? "Reserva enviada para aprovação."
                  : "Reserva confirmada.",
              )
            }
          />
        </Card>
      )}
      <Text style={styles.subtitle}>Minhas próximas reservas</Text>
      <Refresh resource={mine} />
      <Feedback
        resource={mine}
        empty={mine.data?.items.length === 0}
        emptyMessage="Você não tem reservas futuras."
      />
      {mine.data?.items.map((reservation) => (
        <Card key={reservation.id}>
          <Text style={styles.subtitle}>
            {areas.data?.items.find((area) => area.id === reservation.areaId)
              ?.name ?? "Área comum"}
          </Text>
          <Badge value={reservation.status} />
          <Text style={styles.text}>
            {dateTime(reservation.startsAt)} até {dateTime(reservation.endsAt)}
          </Text>
          {["PENDING", "CONFIRMED"].includes(reservation.status) && (
            <Button
              secondary
              label="Cancelar reserva"
              disabled={mutation.pending}
              onPress={() =>
                Alert.alert(
                  "Cancelar reserva?",
                  "O horário será liberado para outros moradores.",
                  [
                    { text: "Voltar", style: "cancel" },
                    {
                      text: "Cancelar reserva",
                      style: "destructive",
                      onPress: () =>
                        void mutation.run(async () => {
                          await api.delete(
                            `/reservations/${encodeURIComponent(reservation.id)}`,
                          );
                          mine.reload();
                        }, "Reserva cancelada."),
                    },
                  ],
                )
              }
            />
          )}
        </Card>
      ))}
    </>
  );
}
