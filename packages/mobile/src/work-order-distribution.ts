import type { ApiClient } from "@predioon/api-client";
import type {
  CreateWorkOrderRequest, UpdateWorkOrderRequest, WorkOrderListResponse,
  WorkOrderPriority, WorkOrderStatus, WorkOrderView,
} from "@predioon/contracts/work-orders";
import type { Scope } from "./scope.ts";

export type DistributionScope = Pick<Scope, "buildingId" | "capabilities">;
export type DirectorySource = "people" | "teams";
export type DirectoryOption = { id: string; name: string };
export type DirectoryPage = { items: DirectoryOption[]; nextCursor: string | null };
export type AssigneeOptions = { people: readonly DirectoryOption[]; teams: readonly DirectoryOption[] };
export type AssigneeSelection = { kind: "none" } | { kind: "person" | "team"; id: string };
export type WorkOrderDraft = { title: string; description?: string; priority?: WorkOrderPriority };
type Reader = Pick<ApiClient, "get">;

export const distributionMessages = {
  list: "Não foi possível carregar as ordens de serviço.",
  invalid: "Revise os dados e escolha um responsável válido para este condomínio.",
  denied: "Esta ação não está disponível no acesso atual. Confira a lista atualizada.",
  conflict: "A ordem foi alterada. Abra a atribuição novamente após conferir a lista atualizada.",
  uncertain: "Não foi possível confirmar a gravação. Confira a lista antes de abrir uma nova ação.",
  directory: "Não foi possível carregar o diretório. Tente carregar novamente.",
  peopleDenied: "Pessoas indisponíveis no acesso atual.",
  teamsDenied: "Equipes indisponíveis no acesso atual.",
} as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses: readonly WorkOrderStatus[] = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"];
export const workOrderPriorities: readonly WorkOrderPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const textId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const uuidId = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const date = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 19) === value.slice(0, 19);
};
const nullable = (value: unknown, valid: (v: unknown) => boolean) => value === null || valid(value);

/** Validate before rendering or trusting action hints, keeping only contract fields. */
export function validateWorkOrder(value: unknown, buildingId: string, complete = false): WorkOrderView {
  if (!record(value) || !uuidId(value.id) || value.buildingId !== buildingId
    || typeof value.title !== "string" || !value.title.trim() || value.title.trim().length > 160
    || typeof value.description !== "string" || value.description.length > 4000
    || !statuses.includes(value.status as WorkOrderStatus) || !workOrderPriorities.includes(value.priority as WorkOrderPriority)
    || !Number.isSafeInteger(value.version) || (value.version as number) < 1 || typeof value.assignedToMe !== "boolean"
    || !date(value.createdAt) || !nullable(value.assetId, uuidId)
    || !nullable(value.assetName, v => typeof v === "string") || !nullable(value.assignedUserId, textId)
    || !nullable(value.assignedTeamId, uuidId) || (value.assignedUserId && value.assignedTeamId)
    || !nullable(value.dueAt, date)
    || (complete && (!textId(value.createdBy) || !date(value.updatedAt) || !nullable(value.occurrenceId, uuidId)
      || !nullable(value.startedAt, date) || !nullable(value.closedAt, date))))
    throw new Error(distributionMessages.list);
  const { id, title, description, status, priority, version, occurrenceId, assetId, assetName,
    assignedUserId, assignedTeamId, dueAt, createdBy, createdAt, updatedAt, startedAt, closedAt, assignedToMe } = value;
  return { id, buildingId, title, description, status, priority, version, occurrenceId, assetId, assetName,
    assignedUserId, assignedTeamId, dueAt, createdBy, createdAt, updatedAt, startedAt, closedAt, assignedToMe } as WorkOrderView;
}

export function validateWorkOrderList(value: unknown, buildingId: string): WorkOrderListResponse {
  if (!record(value) || !Array.isArray(value.items) || value.items.length > 100 || typeof value.canDistribute !== "boolean"
    || !nullable(value.nextCursor, uuidId)) throw new Error(distributionMessages.list);
  const items = value.items.map(item => validateWorkOrder(item, buildingId));
  if (new Set(items.map(item => item.id)).size !== items.length
    || (value.nextCursor !== null && value.nextCursor !== items.at(-1)?.id)) throw new Error(distributionMessages.list);
  return { items, nextCursor: value.nextCursor as string | null, canDistribute: value.canDistribute };
}

export async function readWorkOrderList(api: Reader, buildingId: string): Promise<WorkOrderListResponse> {
  try {
    return validateWorkOrderList(await api.get<unknown>(`/v1/work-orders?buildingId=${encodeURIComponent(buildingId)}&limit=100`), buildingId);
  } catch { throw new Error(distributionMessages.list); }
}

export function canDistributeWorkOrders(scope: DistributionScope, buildingId: string, list: unknown): boolean {
  if (scope.buildingId !== buildingId || !scope.capabilities.includes("work-orders:assign")) return false;
  try { return validateWorkOrderList(list, buildingId).canDistribute; }
  catch { return false; }
}

export function workOrderDirectorySources(capabilities: readonly string[]) {
  return { people: capabilities.includes("memberships:manage") || capabilities.includes("teams:manage"), teams: capabilities.includes("teams:read") };
}

/** Independent, explicit pages. People IDs are text; team IDs are UUIDs. */
export async function readWorkOrderDirectory(
  api: Reader, source: DirectorySource, buildingId: string, after: string | null, previous: DirectoryPage,
): Promise<DirectoryPage> {
  const validId = source === "teams" ? uuidId : textId;
  if ((after !== null && (!validId(after) || previous.nextCursor !== after || previous.items.at(-1)?.id !== after))
    || (after === null && previous.items.length !== 0)) throw new Error(distributionMessages.directory);
  const query = new URLSearchParams({ buildingId, limit: "100" });
  if (after !== null) query.set("after", after);
  const page = await api.get<unknown>(`/v1/tenancy/${source}?${query}`);
  if (!record(page) || !Array.isArray(page.items) || page.items.length > 100 || !nullable(page.nextCursor, validId))
    throw new Error(distributionMessages.directory);
  const items: DirectoryOption[] = [];
  const seen = new Set(previous.items.map(item => item.id));
  for (const value of page.items) {
    if (!record(value) || !validId(value.id) || typeof value.name !== "string" || !value.name.trim()
      || value.name.length > 200 || seen.has(value.id)
      || (source === "teams" && (value.buildingId !== buildingId || value.active !== true)))
      throw new Error(distributionMessages.directory);
    items.push({ id: value.id, name: value.name }); seen.add(value.id);
  }
  if (page.nextCursor !== null && (items.length === 0 || page.nextCursor !== items.at(-1)?.id || page.nextCursor === after))
    throw new Error(distributionMessages.directory);
  return { items: [...previous.items, ...items], nextCursor: page.nextCursor as string | null };
}

function assignment(selection: AssigneeSelection, options: AssigneeOptions) {
  if (selection.kind === "none") return { assignedUserId: null, assignedTeamId: null };
  const current = selection.kind === "person" ? options.people : selection.kind === "team" ? options.teams : [];
  if (!current.some(item => item.id === selection.id)) throw new Error("Escolha um responsável disponível no diretório atual.");
  return { assignedUserId: selection.kind === "person" ? selection.id : null, assignedTeamId: selection.kind === "team" ? selection.id : null };
}

export function createWorkOrderPayload(
  buildingId: string, draft: WorkOrderDraft, selection: AssigneeSelection, options: AssigneeOptions,
): CreateWorkOrderRequest {
  const title = draft.title?.trim(); const description = (draft.description ?? "").trim();
  const priority = draft.priority ?? "NORMAL";
  if (!title || title.length > 160) throw new Error("Título deve ter de 1 a 160 caracteres.");
  if (description.length > 4000) throw new Error("Descrição deve ter até 4000 caracteres.");
  if (!workOrderPriorities.includes(priority)) throw new Error("Prioridade inválida.");
  if (!textId(buildingId)) throw new Error(distributionMessages.invalid);
  return { buildingId, title, description, priority, ...assignment(selection, options) };
}

export function assignmentWorkOrderPayload(
  target: WorkOrderView, selection: AssigneeSelection, options: AssigneeOptions,
): UpdateWorkOrderRequest {
  validateWorkOrder(target, target.buildingId);
  if (target.status !== "OPEN" && target.status !== "IN_PROGRESS") throw new Error("A ordem já foi encerrada.");
  return { version: target.version, ...assignment(selection, options) };
}

/** An incompatible write response means confirmation is uncertain, never retry. */
export async function createDistributedWorkOrder(api: Pick<ApiClient, "post">, userId: string, payload: CreateWorkOrderRequest): Promise<WorkOrderView> {
  const response = await api.post<unknown>("/v1/work-orders", payload);
  try {
    const order = validateWorkOrder(response, payload.buildingId, true);
    if (order.createdBy !== userId || order.version !== 1 || order.status !== "OPEN" || order.title !== payload.title
      || order.description !== payload.description || order.priority !== payload.priority || order.assetId !== null || order.occurrenceId !== null || order.dueAt !== null
      || order.assignedUserId !== payload.assignedUserId || order.assignedTeamId !== payload.assignedTeamId) throw new Error();
    return order;
  } catch { throw new Error(distributionMessages.uncertain); }
}

export async function assignDistributedWorkOrder(api: Pick<ApiClient, "patch">, target: WorkOrderView, payload: UpdateWorkOrderRequest): Promise<WorkOrderView> {
  const response = await api.patch<unknown>(`/v1/work-orders/${encodeURIComponent(target.id)}`, payload);
  try {
    const order = validateWorkOrder(response, target.buildingId, true);
    if (order.id !== target.id || order.version !== target.version + 1 || order.status !== target.status
      || order.title !== target.title || order.description !== target.description || order.priority !== target.priority
      || order.assignedUserId !== payload.assignedUserId || order.assignedTeamId !== payload.assignedTeamId) throw new Error();
    return order;
  } catch { throw new Error(distributionMessages.uncertain); }
}
