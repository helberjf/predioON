/** Public JSON contracts for maintenance work orders. */
export type WorkOrderStatus = "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";
export type WorkOrderPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type WorkOrderView = {
  id: string; buildingId: string; title: string; description: string;
  priority: WorkOrderPriority; status: WorkOrderStatus; occurrenceId: string | null; assetId: string | null;
  /** Name of the linked asset when the caller may read it; `null` otherwise, even with an `assetId`. */
  assetName: string | null;
  assignedUserId: string | null; assignedTeamId: string | null; dueAt: string | null;
  /** Person or company entered without a user account. Does not grant access. */
  assignedName?: string | null;
  createdBy: string; version: number; createdAt: string; updatedAt: string;
  startedAt: string | null; closedAt: string | null;
  /** Assigned to the caller directly or through a team they belong to now. */
  assignedToMe: boolean;
};
export type WorkOrderEventView = {
  id: string; actorId: string | null; kind: "CREATED" | "UPDATED" | "ASSIGNED" | "STATUS_CHANGED" | "NOTE";
  fromStatus: WorkOrderStatus | null; toStatus: WorkOrderStatus | null; note: string; createdAt: string;
};
export type WorkOrderDetail = WorkOrderView & { events: WorkOrderEventView[] };
/** `canDistribute` tells the client whether creation and assignment controls apply. */
export type WorkOrderListResponse = { items: WorkOrderView[]; nextCursor: string | null; canDistribute: boolean };

type Assignee = { assignedUserId?: string | null; assignedTeamId?: string | null; assignedName?: string | null };
export type CreateWorkOrderRequest = Assignee & {
  buildingId: string; title: string; description?: string; priority?: WorkOrderPriority;
  dueAt?: string | null; occurrenceId?: string | null; assetId?: string | null;
};
/** `version` is the one last read; a stale value is answered with 409. */
export type UpdateWorkOrderRequest = Assignee & {
  version: number; title?: string; description?: string; priority?: WorkOrderPriority;
  dueAt?: string | null; occurrenceId?: string | null; assetId?: string | null;
};
export type WorkOrderTransitionRequest = { version: number; status: WorkOrderStatus; note?: string };
export type WorkOrderNoteRequest = { note: string };
