import type { WorkOrderStatus, WorkOrderView } from "@predioon/contracts/work-orders";

export const workOrderStatusLabels: Record<WorkOrderStatus, string> = {
  OPEN: "Aberta",
  IN_PROGRESS: "Em execução",
  DONE: "Concluída",
  CANCELLED: "Cancelada",
};
export const workOrderPriorityLabels = {
  LOW: "Prioridade baixa",
  NORMAL: "Prioridade normal",
  HIGH: "Prioridade alta",
  URGENT: "Prioridade urgente",
} as const;

export type WorkOrderAction = { status: WorkOrderStatus; label: string; confirm?: string };

/**
 * Execution offered by this app. Cancelling and reassigning stay in the web
 * panel; the server still decides every request, so this only hides buttons.
 */
export function workOrderActions(
  order: Pick<WorkOrderView, "status" | "assignedToMe">,
  canDistribute: boolean,
): WorkOrderAction[] {
  if (!order.assignedToMe && !canDistribute) return [];
  if (order.status === "OPEN") return [{ status: "IN_PROGRESS", label: "Iniciar" }];
  if (order.status === "IN_PROGRESS")
    return [
      { status: "DONE", label: "Concluir", confirm: "A ordem será encerrada e não poderá ser reaberta." },
      { status: "OPEN", label: "Pausar" },
    ];
  return [];
}

/** Open work first, the most urgent first, then the oldest deadline. */
export function sortWorkOrders<T extends Pick<WorkOrderView, "status" | "priority" | "dueAt" | "createdAt">>(orders: readonly T[]): T[] {
  const live = (order: T) => (order.status === "OPEN" || order.status === "IN_PROGRESS" ? 0 : 1);
  const weight = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as const;
  const due = (order: T) => (order.dueAt ? Date.parse(order.dueAt) : Number.POSITIVE_INFINITY);
  return [...orders].sort((left, right) =>
    live(left) - live(right)
    || weight[left.priority] - weight[right.priority]
    || due(left) - due(right)
    || Date.parse(right.createdAt) - Date.parse(left.createdAt));
}
