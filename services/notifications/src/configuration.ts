export type NotificationConfiguration = { destination?: string };

export function notificationConfiguration(environment: Record<string, string | undefined>): NotificationConfiguration {
  const configured = environment.ALERT_WEBHOOK_URL?.trim();
  if (!configured) return {};
  try {
    const destination = new URL(configured);
    if (!destination.hostname || destination.username || destination.password || destination.hash ||
        !["http:", "https:"].includes(destination.protocol) ||
        (environment.NODE_ENV === "production" && destination.protocol !== "https:")) throw new Error();
    return { destination: destination.toString() };
  } catch {
    throw new Error("ALERT_WEBHOOK_URL inválida: use um destino HTTP(S) sem credenciais ou fragmento; produção exige HTTPS");
  }
}
