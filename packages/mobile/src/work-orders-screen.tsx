import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import type { ApiClient } from "@predioon/api-client";
import type { WorkOrderDetail, WorkOrderListResponse, WorkOrderTransitionRequest, WorkOrderView } from "@predioon/contracts/work-orders";
import { useResource } from "./resource.ts";
import { useMutation } from "./mutation.ts";
import { Badge, Button, Card, dateTime, ErrorMessage, Feedback, Field, Refresh, styles } from "./ui.tsx";
import { sortWorkOrders, workOrderActions, workOrderPriorityLabels, workOrderStatusLabels, type WorkOrderAction } from "./work-orders.ts";

type Props = { api: ApiClient; buildingId: string };

/** Work assigned to the technician or their team; distribution stays on the web panel. */
export function WorkOrders({ api, buildingId }: Props) {
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const resource = useResource<WorkOrderListResponse>(api, `/v1/work-orders?buildingId=${encodeURIComponent(buildingId)}&limit=100`);
  const mutation = useMutation();
  const canDistribute = resource.data?.canDistribute === true;
  const orders = sortWorkOrders(resource.data?.items ?? []).filter((order) => !onlyOpen || order.status === "OPEN" || order.status === "IN_PROGRESS");

  function transition(order: WorkOrderView, action: WorkOrderAction) {
    const send = () => void mutation.run(async () => {
      await api.post(`/v1/work-orders/${encodeURIComponent(order.id)}/status`, { version: order.version, status: action.status } satisfies WorkOrderTransitionRequest);
      resource.reload();
    }, action.status === "DONE" ? "Ordem de serviço concluída." : action.status === "IN_PROGRESS" ? "Execução iniciada." : "Execução pausada.");
    if (!action.confirm) return send();
    Alert.alert(`${action.label}?`, action.confirm, [{ text: "Voltar", style: "cancel" }, { text: action.label, onPress: send }]);
  }

  return (
    <>
      <View style={styles.row}>
        <Button label="Em aberto" secondary={!onlyOpen} onPress={() => setOnlyOpen(true)} />
        <Button label="Todas" secondary={onlyOpen} onPress={() => setOnlyOpen(false)} />
      </View>
      <Refresh resource={resource} />
      <Feedback resource={resource} empty={resource.data !== null && orders.length === 0}
        emptyMessage={onlyOpen ? "Nenhuma ordem de serviço em aberto para você." : "Nenhuma ordem de serviço registrada."} />
      {mutation.error && <ErrorMessage message={mutation.error} />}
      {mutation.success && <Text accessibilityLiveRegion="polite" style={styles.text}>{mutation.success}</Text>}
      {orders.map((order) => (
        <Card key={order.id}>
          <Text style={styles.subtitle}>{order.title}</Text>
          {order.description ? <Text style={styles.text}>{order.description}</Text> : null}
          <View style={styles.row}>
            <Badge value={workOrderStatusLabels[order.status]} />
            <Badge value={workOrderPriorityLabels[order.priority]} />
          </View>
          <Text style={styles.muted}>
            {order.assignedToMe ? "Atribuída a você ou à sua equipe" : order.assignedUserId || order.assignedTeamId ? "Atribuída a outra pessoa" : "Sem responsável"}
            {order.dueAt ? ` • Prazo ${dateTime(order.dueAt)}` : ""}
          </Text>
          <View style={styles.row}>
            {workOrderActions(order, canDistribute).map((action) => (
              <Button key={action.status} label={action.label} secondary={action.status === "OPEN"} disabled={mutation.pending} onPress={() => transition(order, action)} />
            ))}
            <Button secondary label={expanded === order.id ? "Ocultar histórico" : "Histórico"} onPress={() => setExpanded((current) => (current === order.id ? null : order.id))} />
          </View>
          {expanded === order.id && <History key={`${order.id}:${order.version}`} api={api} order={order} />}
        </Card>
      ))}
    </>
  );
}

const EVENT_LABELS = { CREATED: "Ordem aberta", UPDATED: "Dados alterados", ASSIGNED: "Responsável alterado", NOTE: "Anotação", STATUS_CHANGED: "Estado alterado" } as const;

function History({ api, order }: { api: ApiClient; order: WorkOrderView }) {
  const detail = useResource<WorkOrderDetail>(api, `/v1/work-orders/${encodeURIComponent(order.id)}`);
  const mutation = useMutation();
  const [note, setNote] = useState("");
  function add() {
    const text = note.trim();
    if (!text) return;
    void mutation.run(async () => {
      await api.post(`/v1/work-orders/${encodeURIComponent(order.id)}/notes`, { note: text });
      setNote("");
      detail.reload();
    }, "Anotação registrada.");
  }
  return (
    <View style={{ gap: 6 }}>
      <Feedback resource={detail} />
      {detail.data?.events.map((event) => (
        <View key={event.id}>
          <Text style={styles.muted}>
            {event.kind === "STATUS_CHANGED" && event.toStatus ? `${EVENT_LABELS.STATUS_CHANGED}: ${workOrderStatusLabels[event.toStatus]}` : EVENT_LABELS[event.kind]} • {dateTime(event.createdAt)}
          </Text>
          {event.note ? <Text style={styles.text}>{event.note}</Text> : null}
        </View>
      ))}
      {mutation.error && <ErrorMessage message={mutation.error} />}
      <Field label="Anotação" value={note} onChangeText={setNote} maxLength={2000} />
      <Button label="Registrar anotação" secondary disabled={mutation.pending || !note.trim()} onPress={add} />
    </View>
  );
}
