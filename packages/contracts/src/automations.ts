/** Public JSON contracts for automations. The only action opens a work order. */
export type AlertSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AutomationDefinition = {
  /** Empty means any alert type. */
  alertTypes: string[];
  minSeverity: AlertSeverity;
  /** Restricts the rule to alerts of one device. */
  deviceId: string | null;
  orderTitle: string;
  orderPriority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  assignedTeamId: string | null;
  assetId: string | null;
  /** After opening an order the rule stays quiet for this long; 0 disables the pause. */
  cooldownMinutes: number;
};
export type AutomationVersionView = AutomationDefinition & { number: number; createdAt: string };
export type AutomationRunView = {
  id: string; versionNumber: number; alertId: string;
  outcome: "CREATED" | "SKIPPED_COOLDOWN" | "FAILED"; workOrderId: string | null; createdAt: string;
};
export type AutomationView = {
  id: string; buildingId: string; name: string; enabled: boolean;
  /** `null` until a version is published; an unpublished rule never runs. */
  publishedVersion: number | null;
  latestVersion: number; ordersCreated: number; version: number; createdAt: string; updatedAt: string;
};
export type AutomationDetail = AutomationView & { versions: AutomationVersionView[]; runs: AutomationRunView[] };
export type AutomationListResponse = { items: AutomationView[]; canManage: boolean };
export type AutomationSimulation = { number: number; matches: Array<{ alertId: string; type: string; severity: AlertSeverity; message: string; triggeredAt: string }> };

export type CreateAutomationRequest = { buildingId: string; name: string; definition: Partial<AutomationDefinition> & { orderTitle: string } };
/** `version` is the rule's last read value; a stale one is answered with 409. */
export type AddAutomationVersionRequest = { version: number; definition: Partial<AutomationDefinition> & { orderTitle: string } };
export type PublishAutomationRequest = { version: number; number: number };
export type AutomationStateRequest = { version: number; enabled: boolean };
