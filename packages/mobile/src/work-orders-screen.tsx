import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Text, View } from "react-native";
import type { ApiClient } from "@predioon/api-client";
import type { WorkOrderDetail, WorkOrderListResponse, WorkOrderTransitionRequest, WorkOrderView } from "@predioon/contracts/work-orders";
import { useReadResource, useResource } from "./resource.ts";
import { useMutation } from "./mutation.ts";
import { Badge, Button, Card, dateTime, ErrorMessage, Feedback, Field, Refresh, styles } from "./ui.tsx";
import { sortWorkOrders, workOrderActions, workOrderCanWrite, workOrderPriorityLabels, workOrderStatusLabels, type WorkOrderAction } from "./work-orders.ts";
import { canDistributeWorkOrders, readWorkOrderList, type DistributionScope } from "./work-order-distribution.ts";
import { createWorkOrderDistributionController } from "./work-order-distribution-controller.ts";
import { WorkOrderDistributionScreen } from "./work-order-distribution-screen.tsx";

type Props = { api: ApiClient; buildingId: string; userId: string; scope: DistributionScope };

/** Execution and distribution use the current building authority and validated list. */
export function WorkOrders({ api, buildingId, userId, scope }: Props) {
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const authority = `${scope.buildingId}:${[...scope.capabilities].sort().join(",")}`;
  const read = useCallback(async () => ({ api, userId, authority, list: await readWorkOrderList(api, buildingId) }), [api, userId, buildingId, authority]);
  const resource = useReadResource(`${userId}:${buildingId}:${authority}:work-orders`, read);
  const list: WorkOrderListResponse | null = resource.data?.api === api && resource.data.userId === userId && resource.data.authority === authority ? resource.data.list : null;
  const mutation = useMutation();
  const canDistribute = canDistributeWorkOrders(scope, buildingId, list);
  const capabilities = scope.buildingId === buildingId ? scope.capabilities : [];
  const orders = sortWorkOrders(list?.items ?? []).filter((order) => !onlyOpen || order.status === "OPEN" || order.status === "IN_PROGRESS");
  const reload = useRef(resource.reload); reload.current = resource.reload;
  const [, revise] = useState(0);
  const [distribution] = useState(() => createWorkOrderDistributionController({ reload: () => reload.current(), changed: () => revise(value => value + 1) }));
  distribution.sync({ api, userId, buildingId, scope, list });
  const form = distribution.snapshot();
  const workflow = distribution.captureWorkflow();
  useEffect(() => {
    distribution.setActive(AppState.currentState === "active");
    const listener = AppState.addEventListener("change", next => distribution.setActive(next === "active"));
    return () => { distribution.dispose(); listener.remove(); };
  }, [distribution]);
  const execution = useRef({ api, list, canDistribute, capabilities });
  execution.current = { api, list, canDistribute, capabilities };

  function transition(order: WorkOrderView, action: WorkOrderAction) {
    const send = () => {
      const current = execution.current;
      if (current.api !== api || !current.list?.items.some(item => item.id === order.id && item.version === order.version
        && workOrderActions(item, current.canDistribute, current.capabilities).some(candidate => candidate.status === action.status))) return;
      void mutation.run(async () => {
        await api.post(`/v1/work-orders/${encodeURIComponent(order.id)}/status`, { version: order.version, status: action.status } satisfies WorkOrderTransitionRequest);
        resource.reload();
      }, action.status === "DONE" ? "Ordem de serviço concluída." : action.status === "IN_PROGRESS" ? "Execução iniciada." : "Execução pausada.");
    };
    if (!action.confirm) return send();
    Alert.alert(`${action.label}?`, action.confirm, [{ text: "Voltar", style: "cancel" }, { text: action.label, onPress: send }]);
  }

  return (
    <>
      <View style={styles.row}>
        <Button label="Em aberto" secondary={!onlyOpen} onPress={() => setOnlyOpen(true)} />
        <Button label="Todas" secondary={onlyOpen} onPress={() => setOnlyOpen(false)} />
      </View>
      {canDistribute && <Button label="Nova ordem" disabled={form.pending || !distribution.canOpen()} onPress={() => workflow.openCreate()} />}
      {form.mode && <WorkOrderDistributionScreen key={`${form.generation}:${form.mode}:${form.target?.id ?? "new"}:${form.target?.version ?? "new"}`} state={form} controller={distribution} />}
      {form.feedback && <Text accessibilityLiveRegion="polite" style={styles.text}>{form.feedback}</Text>}
      {form.uncertain && <Button label="Conferir lista" secondary onPress={workflow.checkList} />}
      <Refresh resource={resource} />
      <Feedback resource={resource} empty={list !== null && orders.length === 0}
        emptyMessage={onlyOpen ? "Nenhuma ordem de serviço em aberto para você." : "Nenhuma ordem de serviço registrada."} />
      {mutation.error && <ErrorMessage message={mutation.error} />}
      {mutation.success && <Text accessibilityLiveRegion="polite" style={styles.text}>{mutation.success}</Text>}
      {orders.map((order) => (
        <Card key={order.id}>
          <Text style={styles.subtitle}>{order.title}</Text>
          {order.description ? <Text style={styles.text}>{order.description}</Text> : null}
          {order.assetName ? <Text style={styles.muted}>Ativo: {order.assetName}</Text> : null}
          <View style={styles.row}>
            <Badge value={workOrderStatusLabels[order.status]} />
            <Badge value={workOrderPriorityLabels[order.priority]} />
          </View>
          <Text style={styles.muted}>
            {order.assignedToMe ? "Atribuída a você ou à sua equipe" : order.assignedUserId || order.assignedTeamId ? "Atribuída a outra pessoa" : "Sem responsável"}
            {order.dueAt ? ` • Prazo ${dateTime(order.dueAt)}` : ""}
          </Text>
          <View style={styles.row}>
            {canDistribute && (order.status === "OPEN" || order.status === "IN_PROGRESS") && <Button label="Atribuir" secondary disabled={form.pending || !distribution.canOpen()} onPress={() => workflow.openAssign(order.id)} />}
            {workOrderActions(order, canDistribute, capabilities).map((action) => (
              <Button key={action.status} label={action.label} secondary={action.status === "OPEN"} disabled={mutation.pending} onPress={() => transition(order, action)} />
            ))}
            <Button secondary label={expanded === order.id ? "Ocultar histórico" : "Histórico"} onPress={() => setExpanded((current) => (current === order.id ? null : order.id))} />
          </View>
          {expanded === order.id && <History key={`${userId}:${order.id}:${order.version}`} api={api} order={order} canWrite={workOrderCanWrite(order, canDistribute, capabilities)} />}
        </Card>
      ))}
    </>
  );
}

const EVENT_LABELS = { CREATED: "Ordem aberta", UPDATED: "Dados alterados", ASSIGNED: "Responsável alterado", NOTE: "Anotação", STATUS_CHANGED: "Estado alterado" } as const;

function History({ api, order, canWrite }: { api: ApiClient; order: WorkOrderView; canWrite: boolean }) {
  const detail = useResource<WorkOrderDetail>(api, `/v1/work-orders/${encodeURIComponent(order.id)}`);
  const mutation = useMutation();
  const [note, setNote] = useState("");
  const writable = useRef(canWrite); writable.current = canWrite;
  useEffect(() => { if (!canWrite) setNote(""); }, [canWrite]);
  function add() {
    const text = note.trim();
    if (!text || !writable.current) return;
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
      {canWrite && <>
        <Field label="Anotação" value={note} onChangeText={setNote} maxLength={2000} />
        <Button label="Registrar anotação" secondary disabled={mutation.pending || !note.trim()} onPress={add} />
      </>}
    </View>
  );
}
