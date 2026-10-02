import React, { useCallback, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import type { ApiClient } from "@predioon/api-client";
import type { FinancialReport } from "@predioon/contracts";
import type { Product, Scope } from "./scope.ts";
import {
  ownedTickets,
  reservationActions,
  reservationWindow,
  transparencySections,
} from "./scope.ts";
import type {
  CommonArea,
  List,
  Notice,
  Reservation,
  Ticket,
  TicketDetail,
} from "./models.ts";
import { useReadResource, useResource } from "./resource.ts";
import { readResourceAuthorization } from "./authorization.ts";
import { useMutation } from "./mutation.ts";
import { ReservationCalendarPanel } from "./reservation-calendar-panel.tsx";
import {
  money,
  publishedReports,
  reservationResultMessage,
  safeReceiptUrl,
  validReportMonth,
} from "./resident-services.ts";
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
export function Notices({
  api,
  buildingId,
  category,
}: Props & { category?: "GESTAO" }) {
  const resource = useResource<List<Notice>>(
    api,
    `/notices?buildingId=${encodeURIComponent(buildingId)}${category ? `&category=${category}` : ""}`,
  );
  const now = Date.now();
  const items = (resource.data?.items ?? []).filter(
    (notice) =>
      notice.buildingId === buildingId &&
      (!category || notice.category === category) &&
      Date.parse(notice.publishedAt) <= now &&
      (!notice.expiresAt || Date.parse(notice.expiresAt) > now),
  );
  return (
    <>
      <Refresh resource={resource} />
      <Feedback
        resource={resource}
        empty={resource.data !== null && items.length === 0}
        emptyMessage="Nenhum aviso publicado."
      />
      {items.map((notice) => (
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

export function Transparency({
  api,
  buildingId,
  scope,
}: Props & { scope: Scope }) {
  const sections = transparencySections(scope);
  return (
    <>
      {sections.notices && (
        <>
          <Text style={styles.subtitle}>Informes da gestão</Text>
          <Notices api={api} buildingId={buildingId} category="GESTAO" />
        </>
      )}
      {sections.finance && (
        <FinancialStatements api={api} buildingId={buildingId} />
      )}
    </>
  );
}

function FinancialStatements({ api, buildingId }: Props) {
  const [offset, setOffset] = useState(0);
  const [month, setMonth] = useState("");
  const [draftMonth, setDraftMonth] = useState("");
  const valid = validReportMonth(draftMonth);
  const resource = useResource<List<FinancialReport>>(
    api,
    `/finance?buildingId=${encodeURIComponent(buildingId)}&limit=50&offset=${offset}${month ? `&month=${month}` : ""}`,
  );
  const reports = publishedReports(resource.data?.items ?? [], buildingId);
  return (
    <>
      <Text style={styles.subtitle}>Prestação de contas</Text>
      <Text style={styles.muted}>
        Consulte as revisões publicadas e seus comprovantes. As revisões
        anteriores são preservadas.
      </Text>
      <Card>
        <Field
          label="Mês (AAAA-MM, vazio para todos)"
          value={draftMonth}
          onChangeText={setDraftMonth}
          maxLength={7}
          autoCapitalize="none"
          placeholder="2030-01"
        />
        {!valid && (
          <Text style={styles.muted}>
            Informe um mês válido no formato AAAA-MM.
          </Text>
        )}
        <Button
          label="Filtrar mês"
          disabled={!valid}
          onPress={() => {
            setOffset(0);
            setMonth(draftMonth);
          }}
        />
      </Card>
      <Refresh resource={resource} />
      <Feedback
        resource={resource}
        empty={resource.data !== null && reports.length === 0}
        emptyMessage="Nenhuma prestação publicada nesta página para o período selecionado."
      />
      {reports.map((report) => (
        <Statement key={report.id} report={report} />
      ))}
      <Pages
        offset={offset}
        count={resource.data?.items.length ?? 0}
        setOffset={setOffset}
      />
    </>
  );
}

function Statement({ report }: { report: FinancialReport }) {
  const [expanded, setExpanded] = useState(false);
  const [visibleEntries, setVisibleEntries] = useState(25);
  const [error, setError] = useState<string | null>(null);
  async function openReceipt(value: string | null) {
    const url = safeReceiptUrl(value);
    if (!url) return;
    setError(null);
    try {
      await Linking.openURL(url);
    } catch {
      setError("Não foi possível abrir o comprovante no navegador.");
    }
  }
  return (
    <Card>
      <Text style={styles.subtitle}>{report.title}</Text>
      <Text style={styles.muted}>
        {report.month} · Revisão {report.revision} · Publicada em{" "}
        {dateTime(report.publishedAt!)}
      </Text>
      <Text style={styles.text}>{report.summary}</Text>
      <Text style={styles.text}>
        Saldo inicial: {money(report.openingBalanceCents)}
      </Text>
      <Text style={styles.text}>
        Receitas: {money(report.totals.incomeCents)}
      </Text>
      <Text style={styles.text}>
        Despesas: {money(report.totals.expenseCents)}
      </Text>
      <Text style={styles.subtitle}>
        Saldo final: {money(report.totals.closingBalanceCents)}
      </Text>
      <Button
        secondary
        label={
          expanded
            ? "Ocultar lançamentos"
            : `Ver lançamentos (${report.entries.length})`
        }
        onPress={() => setExpanded((value) => !value)}
      />
      {expanded &&
        report.entries.slice(0, visibleEntries).map((entry, index) => (
          <View
            key={index}
            style={{
              gap: 6,
              borderTopWidth: 1,
              borderTopColor: "#dce5eb",
              paddingTop: 12,
            }}
          >
            <Text style={styles.text}>
              {entry.type === "INCOME" ? "Receita" : "Despesa"} ·{" "}
              {money(entry.amountCents)}
            </Text>
            <Text style={styles.text}>{entry.description}</Text>
            <Text style={styles.muted}>
              {entry.date.split("-").reverse().join("/")} · {entry.category}
            </Text>
            {safeReceiptUrl(entry.receiptUrl) && (
              <Button
                secondary
                label="Abrir comprovante no navegador"
                onPress={() => void openReceipt(entry.receiptUrl)}
              />
            )}
          </View>
        ))}
      {expanded && visibleEntries < report.entries.length && (
        <Button
          secondary
          label="Ver mais lançamentos"
          onPress={() => setVisibleEntries((value) => value + 25)}
        />
      )}
      {error && <ErrorMessage message={error} />}
    </Card>
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
  const readAuthorization = useCallback(
    () =>
      readResourceAuthorization(api, {
        buildingId: scope.buildingId,
        resourceType: "occurrence",
        resourceId: id,
      }),
    [api, scope.buildingId, id],
  );
  const authorization = useReadResource(
    product === "operations"
      ? `occurrence-actions:${scope.buildingId}:${id}`
      : null,
    readAuthorization,
  );
  const ticket = resource.data;
  const canManage =
    product === "operations" &&
    authorization.data?.capabilities.includes("occurrences:manage") === true;
  const canComment =
    product === "resident" ||
    canManage ||
    authorization.data?.capabilities.includes("occurrences:read-own") === true;
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
      {product === "operations" && <Feedback resource={authorization} />}
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
          {canComment && (
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
          )}
        </>
      )}
    </>
  );
}

export function Reservations({
  api,
  buildingId,
  scope,
}: Props & { scope: Scope }) {
  const actions = reservationActions(scope);
  const [calendarRevision, setCalendarRevision] = useState(0);
  const areas = useResource<List<CommonArea>>(
    api,
    actions.areas
      ? `/common-areas?buildingId=${encodeURIComponent(buildingId)}`
      : null,
  );
  const mine = useResource<List<Reservation>>(
    api,
    actions.read
      ? `/reservations?buildingId=${encodeURIComponent(buildingId)}&mine=true`
      : null,
  );
  const [form, setForm] = useState({
    areaId: "",
    date: "",
    time: "19:00",
    hours: "1",
    unit: "",
  });
  const mutation = useMutation();
  const selected = actions.create
    ? areas.data?.items.find((area) => area.id === form.areaId)
    : undefined;
  return (
    <>
      {actions.create && (
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
        </>
      )}
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
          <ReservationCalendarPanel
            key={`${buildingId}:${selected.id}`}
            api={api}
            buildingId={buildingId}
            areaId={selected.id}
            date={form.date}
            enabled={actions.create}
            revision={calendarRevision}
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
                  try {
                    const created = await api.post<Reservation>("/reservations", {
                      areaId: selected.id,
                      ...window,
                      unit: form.unit.trim() || undefined,
                    });
                    setForm({ ...form, areaId: "", date: "" });
                    mine.reload();
                    return created;
                  } finally {
                    // Refresh occupancy after conflict/uncertain response, never replay the POST.
                    setCalendarRevision((value) => value + 1);
                  }
                },
                (created) => reservationResultMessage(created.status),
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
          {actions.cancel &&
            ["PENDING", "CONFIRMED"].includes(reservation.status) && (
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
                            try {
                              await api.delete(
                                `/reservations/${encodeURIComponent(reservation.id)}`,
                              );
                              mine.reload();
                            } finally {
                              setCalendarRevision((value) => value + 1);
                            }
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
