import { alertRules, alerts, buildings, devices, gateways } from "./schema.js";

/** Explicit read projections exclude metadata credentials and administrative fields. */
export const ingestDeviceColumns = {
  id: devices.id,
  buildingId: devices.buildingId,
  gatewayId: devices.gatewayId,
  name: devices.name,
  type: devices.type,
  status: devices.status,
  enabled: devices.enabled,
  lastSeenAt: devices.lastSeenAt,
  createdAt: devices.createdAt,
  updatedAt: devices.updatedAt,
};

export const ingestGatewayColumns = {
  id: gateways.id,
  buildingId: gateways.buildingId,
  name: gateways.name,
  serialNumber: gateways.serialNumber,
  model: gateways.model,
  firmwareVersion: gateways.firmwareVersion,
  protocolVersion: gateways.protocolVersion,
  status: gateways.status,
  enabled: gateways.enabled,
  lastSeenAt: gateways.lastSeenAt,
  createdAt: gateways.createdAt,
  updatedAt: gateways.updatedAt,
};

export const ingestBuildingColumns = {
  id: buildings.id,
  active: buildings.active,
  timezone: buildings.timezone,
};

export const ingestRuleColumns = {
  id: alertRules.id,
  buildingId: alertRules.buildingId,
  deviceId: alertRules.deviceId,
  metric: alertRules.metric,
  operator: alertRules.operator,
  threshold: alertRules.threshold,
  severity: alertRules.severity,
  alertType: alertRules.alertType,
  messageTemplate: alertRules.messageTemplate,
  cooldownSeconds: alertRules.cooldownSeconds,
  enabled: alertRules.enabled,
};

/** Alert envelope; the human acknowledgement/resolution actors stay out of reach. */
export const ingestAlertColumns = {
  id: alerts.id,
  buildingId: alerts.buildingId,
  deviceId: alerts.deviceId,
  gatewayId: alerts.gatewayId,
  ruleId: alerts.ruleId,
  severity: alerts.severity,
  type: alerts.type,
  status: alerts.status,
  message: alerts.message,
  triggeredValue: alerts.triggeredValue,
  triggeredAt: alerts.triggeredAt,
  createdAt: alerts.createdAt,
};

export type IngestDevice = Pick<typeof devices.$inferSelect, keyof typeof ingestDeviceColumns>;
export type IngestGateway = Pick<typeof gateways.$inferSelect, keyof typeof ingestGatewayColumns>;
export type IngestBuilding = Pick<typeof buildings.$inferSelect, keyof typeof ingestBuildingColumns>;
export type IngestRule = Pick<typeof alertRules.$inferSelect, keyof typeof ingestRuleColumns>;
export type IngestAlert = Pick<typeof alerts.$inferSelect, keyof typeof ingestAlertColumns>;
