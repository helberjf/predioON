import { config } from "../config.js";

export type AlertNotification = {
  alertId: string;
  buildingId: string;
  deviceId: string;
  severity: string;
  type: string;
  message: string;
  triggeredAt: string;
};

/**
 * Channels are intentionally dumb: log always, POST to a webhook when configured.
 * A webhook is enough to reach WhatsApp/e-mail through an integration service
 * without pulling a provider SDK into the ingest process.
 */
async function sendWebhook(alert: AlertNotification): Promise<void> {
  if (!config.ALERT_WEBHOOK_URL) return;
  try {
    await fetch(config.ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alert),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    console.error("Webhook de alerta falhou:", error);
  }
}

export async function notifyAlert(alert: AlertNotification): Promise<void> {
  console.log(`[alerta:${alert.severity}] ${alert.buildingId} · ${alert.deviceId} · ${alert.message}`);
  if (alert.severity === "HIGH" || alert.severity === "CRITICAL") await sendWebhook(alert);
}
