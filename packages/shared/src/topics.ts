/**
 * MQTT topic contract between gateway and platform.
 * The gateway may only publish under its own building/gateway prefix (enforced by the broker ACL).
 */
export const TELEMETRY_TOPIC = "predio/+/device/+/telemetry";
export const GATEWAY_STATUS_TOPIC = "predio/+/gateway/+/status";

export function telemetryTopic(buildingId: string, deviceId: string): string {
  return `predio/${buildingId}/device/${deviceId}/telemetry`;
}

export function gatewayStatusTopic(buildingId: string, gatewayId: string): string {
  return `predio/${buildingId}/gateway/${gatewayId}/status`;
}

type TelemetryTopicParts = { buildingId: string; deviceId: string };
type GatewayTopicParts = { buildingId: string; gatewayId: string };

/** Returns null when the topic does not match the contract, so callers can drop it without throwing. */
export function parseTelemetryTopic(topic: string): TelemetryTopicParts | null {
  const parts = topic.split("/");
  if (parts.length !== 5) return null;
  const [prefix, buildingId, deviceSegment, deviceId, suffix] = parts;
  if (prefix !== "predio" || deviceSegment !== "device" || suffix !== "telemetry") return null;
  if (!buildingId || !deviceId) return null;
  return { buildingId, deviceId };
}

export function parseGatewayStatusTopic(topic: string): GatewayTopicParts | null {
  const parts = topic.split("/");
  if (parts.length !== 5) return null;
  const [prefix, buildingId, gatewaySegment, gatewayId, suffix] = parts;
  if (prefix !== "predio" || gatewaySegment !== "gateway" || suffix !== "status") return null;
  if (!buildingId || !gatewayId) return null;
  return { buildingId, gatewayId };
}
