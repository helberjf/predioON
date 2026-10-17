import { ApiError, type ApiClient } from "@predioon/api-client";
import type { WorkOrderListResponse, WorkOrderView } from "@predioon/contracts/work-orders";
import {
  assignDistributedWorkOrder, assignmentWorkOrderPayload, canDistributeWorkOrders,
  createDistributedWorkOrder, createWorkOrderPayload, distributionMessages,
  readWorkOrderDirectory, workOrderDirectorySources,
  type AssigneeSelection, type DirectoryPage, type DirectorySource,
  type DistributionScope, type WorkOrderDraft,
} from "./work-order-distribution.ts";

export type DistributionContext = {
  api: ApiClient; userId: string; buildingId: string;
  scope: DistributionScope; list: WorkOrderListResponse | null;
};
export type DirectoryState = DirectoryPage & { state: "idle" | "loading" | "ready" | "denied" | "error" };
export type DistributionState = {
  mode: "create" | "assign" | null; target: WorkOrderView | null;
  draft: WorkOrderDraft; selection: AssigneeSelection;
  people: DirectoryState; teams: DirectoryState;
  pending: boolean; uncertain: boolean; feedback: string | null;
};
const emptyDirectory = (): DirectoryState => ({ items: [], nextCursor: null, state: "idle" });
const emptyState = (): DistributionState => ({ mode: null, target: null, draft: { title: "", description: "", priority: "NORMAL" },
  selection: { kind: "none" }, people: emptyDirectory(), teams: emptyDirectory(), pending: false, uncertain: false, feedback: null });
const authority = (context: DistributionContext) => `${context.scope.buildingId}:${[...context.scope.capabilities].sort().join(",")}`;

/** Owns private form state and a synchronous send barrier, independent of generic mutations. */
export function createWorkOrderDistributionController(callbacks: {
  reload(): void; changed?(): void; beforeSend?: () => Promise<void>;
}) {
  let context: DistributionContext | null = null;
  let currentAuthority = "", currentGate = false, active = false, generation = 0;
  let state = emptyState();
  const staleVersions = new Map<string, number>();
  let verificationRequired = false, awaitingVerification = false;
  let verificationEvidence: WorkOrderListResponse | null = null;
  let foregroundEvidence: WorkOrderListResponse | null = null;
  let needsForegroundEvidence = false;
  let writeInFlight = false;
  let deniedEvidence: WorkOrderListResponse | null = null;
  let needsPermissionEvidence = false;
  const changed = () => callbacks.changed?.();
  const gated = () => Boolean(active && context && currentGate && !needsForegroundEvidence && !needsPermissionEvidence);
  function clear(notify = true) { generation++; state = emptyState(); if (notify) changed(); }
  function isCurrent(captured: number) { return generation === captured && gated() && state.mode !== null; }
  function sync(next: DistributionContext) {
    const gate = canDistributeWorkOrders(next.scope, next.buildingId, next.list);
    const nextAuthority = authority(next);
    const identityChanged = context !== null && (context.api !== next.api || context.userId !== next.userId || context.buildingId !== next.buildingId);
    const targetChanged = state.target !== null && !next.list?.items.some(item => item.id === state.target!.id
      && item.buildingId === state.target!.buildingId && item.version === state.target!.version && item.status === state.target!.status);
    if (identityChanged || currentAuthority !== nextAuthority || currentGate !== gate || targetChanged) {
      clear(false);
      if (identityChanged) { staleVersions.clear(); verificationRequired = false; awaitingVerification = false; needsForegroundEvidence = false; needsPermissionEvidence = false; }
    }
    context = next; currentAuthority = nextAuthority; currentGate = gate;
    if (needsForegroundEvidence && next.list !== foregroundEvidence && next.list !== null && gate) needsForegroundEvidence = false;
    if (needsPermissionEvidence && next.list !== deniedEvidence && next.list !== null && gate) needsPermissionEvidence = false;
    if (awaitingVerification && next.list !== verificationEvidence && next.list !== null && gate) {
      verificationRequired = false; awaitingVerification = false; state = { ...state, uncertain: false, feedback: null };
    }
  }
  function setActive(value: boolean) {
    if (active === value) return;
    active = value;
    if (!value) {
      foregroundEvidence = context?.list ?? null; needsForegroundEvidence = true;
      verificationRequired = false; awaitingVerification = false; clear();
    } else changed();
  }
  async function load(source: DirectorySource, more: boolean) {
    if (!gated() || !context || !state.mode || state.pending || state.uncertain) return;
    const allowed = workOrderDirectorySources(context.scope.capabilities)[source];
    if (!allowed || state[source].state === "loading" || state[source].state === "denied") return;
    const previous = more ? state[source] : emptyDirectory();
    const after = more ? previous.nextCursor : null;
    if (more && after === null) return;
    const captured = generation, client = context.api, buildingId = context.buildingId;
    state = { ...state, [source]: { ...previous, state: "loading" } }; changed();
    try {
      const page = await readWorkOrderDirectory(client, source, buildingId, after, previous);
      if (!isCurrent(captured)) return;
      state = { ...state, [source]: { ...page, state: "ready" } }; changed();
    } catch (error) {
      if (!isCurrent(captured)) return;
      const denied = error instanceof ApiError && error.status === 403;
      const sourceSelection = source === "people" ? "person" : "team";
      state = { ...state, [source]: denied ? { ...emptyDirectory(), state: "denied" } : { ...previous, state: "error" },
        selection: denied && state.selection.kind === sourceSelection ? { kind: "none" } : state.selection };
      changed();
    }
  }
  function open(mode: "create" | "assign", target: WorkOrderView | null): boolean {
    if (!gated() || !context || state.pending || verificationRequired) return false;
    clear(false);
    const sources = workOrderDirectorySources(context.scope.capabilities);
    state = { ...state, mode, target: target ? { ...target } : null,
      people: { ...emptyDirectory(), state: sources.people ? "idle" : "denied" },
      teams: { ...emptyDirectory(), state: sources.teams ? "idle" : "denied" } };
    changed(); void load("people", false); void load("teams", false); return true;
  }
  function openAssign(id: string) {
    const target = context?.list?.items.find(item => item.id === id);
    if (!target || (target.status !== "OPEN" && target.status !== "IN_PROGRESS") || staleVersions.get(id) === target.version) return false;
    return open("assign", target);
  }
  function close() {
    const uncertain = verificationRequired;
    clear(false); state = { ...state, uncertain, feedback: uncertain ? distributionMessages.uncertain : null }; changed();
  }
  function checkList() {
    if (!gated() || !context) return;
    const uncertain = verificationRequired;
    clear(false); state = { ...state, uncertain, feedback: uncertain ? distributionMessages.uncertain : null };
    if (uncertain) { awaitingVerification = true; verificationEvidence = context.list; }
    changed(); callbacks.reload();
  }
  function setDraft(draft: Partial<WorkOrderDraft>) {
    if (!gated() || state.mode !== "create" || state.pending || state.uncertain) return;
    state = { ...state, draft: { ...state.draft, ...draft }, feedback: null }; changed();
  }
  function select(selection: AssigneeSelection) {
    if (!gated() || !state.mode || state.pending || state.uncertain) return;
    state = { ...state, selection: { ...selection }, feedback: null }; changed();
  }
  async function submit() {
    if (!gated() || !context || !state.mode || state.pending || writeInFlight || state.uncertain || verificationRequired) return;
    const captured = generation, capturedContext = context, target = state.target, mode = state.mode;
    const draft = { ...state.draft }, selection = { ...state.selection };
    let payload;
    try {
      const options = { people: state.people.items, teams: state.teams.items };
      payload = mode === "create" ? createWorkOrderPayload(context.buildingId, state.draft, state.selection, options)
        : assignmentWorkOrderPayload(target!, state.selection, options);
    } catch {
      state = { ...state, feedback: distributionMessages.invalid }; changed(); return;
    }
    // Set before the first await; React batching cannot permit a second request.
    state = { ...state, pending: true, feedback: null }; changed();
    let sent = false;
    try {
      await (callbacks.beforeSend?.() ?? Promise.resolve());
      if (!isCurrent(captured)) return;
      try {
        const options = { people: state.people.items, teams: state.teams.items };
        if (mode === "create") createWorkOrderPayload(capturedContext.buildingId, draft, selection, options);
        else assignmentWorkOrderPayload(target!, selection, options);
      } catch {
        state = { ...state, pending: false, feedback: distributionMessages.invalid }; changed(); return;
      }
      writeInFlight = true; sent = true;
      if (mode === "create") await createDistributedWorkOrder(capturedContext.api, capturedContext.userId, payload as Parameters<typeof createDistributedWorkOrder>[2]);
      else await assignDistributedWorkOrder(capturedContext.api, target!, payload as Parameters<typeof assignDistributedWorkOrder>[2]);
      if (!isCurrent(captured)) return;
      clear(false); state = { ...state, feedback: mode === "create" ? "Ordem de serviço criada." : "Responsável atualizado." };
      changed(); callbacks.reload();
    } catch (error) {
      if (!isCurrent(captured)) return;
      if (error instanceof ApiError && error.code === "SESSION_CHANGED") { clear(); return; }
      if (error instanceof ApiError && error.status === 400) {
        state = { ...state, pending: false, feedback: distributionMessages.invalid }; changed(); return;
      }
      if (error instanceof ApiError && [403, 404, 409].includes(error.status)) {
        if (error.status === 409 && target) staleVersions.set(target.id, target.version);
        if (error.status !== 409) { deniedEvidence = context!.list; needsPermissionEvidence = true; }
        clear(false); state = { ...state, feedback: error.status === 409 ? distributionMessages.conflict : distributionMessages.denied };
        changed(); callbacks.reload(); return;
      }
      verificationRequired = true;
      state = { ...state, pending: false, uncertain: true, feedback: distributionMessages.uncertain }; changed();
    } finally {
      // Only releases the transport barrier; old results never edit the current form.
      if (sent) { writeInFlight = false; if (active) changed(); }
    }
  }
  return {
    sync, setActive, openCreate: () => open("create", null), openAssign, close, checkList, setDraft, select, submit,
    loadMore: (source: DirectorySource) => load(source, true),
    retryDirectory: (source: DirectorySource) => load(source, state[source].items.length > 0),
    snapshot: () => {
      const uncertain = state.uncertain || (verificationRequired && gated());
      return { ...state, generation, pending: state.pending || writeInFlight, uncertain,
        feedback: state.feedback ?? (uncertain ? distributionMessages.uncertain : null) };
    },
    canOpen: () => gated() && !verificationRequired,
    captureWorkflow() {
      const captured = generation;
      const current = () => generation === captured && gated();
      return {
        openCreate: () => current() ? open("create", null) : false,
        openAssign: (id: string) => current() ? openAssign(id) : false,
        checkList() { if (current()) checkList(); },
      };
    },
    captureForm() {
      const captured = generation;
      return {
        setDraft(draft: Partial<WorkOrderDraft>) { if (isCurrent(captured)) setDraft(draft); },
        select(selection: AssigneeSelection) { if (isCurrent(captured)) select(selection); },
        submit: () => isCurrent(captured) ? submit() : Promise.resolve(),
        close() { if (isCurrent(captured)) close(); },
        loadMore: (source: DirectorySource) => isCurrent(captured) ? load(source, true) : Promise.resolve(),
        retryDirectory: (source: DirectorySource) => isCurrent(captured) ? load(source, state[source].items.length > 0) : Promise.resolve(),
      };
    },
    dispose() { active = false; foregroundEvidence = context?.list ?? null; needsForegroundEvidence = true; clear(false); },
  };
}
export type WorkOrderDistributionController = ReturnType<typeof createWorkOrderDistributionController>;
