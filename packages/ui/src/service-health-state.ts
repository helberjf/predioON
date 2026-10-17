import type { PlatformServiceHealth } from "@predioon/contracts";

export type ServiceTone = "ok" | "attention" | "idle";
export type ServiceStatus = { key: string; label: string; tone: ServiceTone; detail: string };

/** A reading older than this, with gateways online, means ingestion stopped. */
export const INGEST_STALE_MINUTES = 15;
/** A notification waiting longer than this means the worker is not draining its queue. */
export const NOTIFICATION_STALE_MINUTES = 10;

const minutesSince = (value: string | null, now: number) => value ? Math.max(0, Math.floor((now - Date.parse(value)) / 60_000)) : null;
const ago = (minutes: number) => minutes < 1 ? "agora há pouco" : minutes < 120 ? `há ${minutes} min` : `há ${Math.floor(minutes / 60)} h`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(unit === 0 ? 0 : 1).replace(".", ",")} ${units[unit]}`;
}

/** Turns the aggregate into one line per service, with the reason for any attention. */
export function serviceStatuses(health: PlatformServiceHealth, now = Date.parse(health.checkedAt)): ServiceStatus[] {
  const { ingest, notifications, physicalCommands, jobs, database } = health;
  const received = minutesSince(ingest.lastReceivedAt, now);
  const ingestStatus: ServiceStatus = ingest.gatewaysEnabled === 0
    ? { key: "ingest", label: "Recepção de leituras", tone: "idle", detail: "Nenhum gateway ativo." }
    : received === null
      ? { key: "ingest", label: "Recepção de leituras", tone: "attention", detail: "Nenhuma leitura recebida até agora." }
      : received > INGEST_STALE_MINUTES && ingest.gatewaysOnline > 0
        ? { key: "ingest", label: "Recepção de leituras", tone: "attention", detail: `Última leitura recebida ${ago(received)}, com ${plural(ingest.gatewaysOnline, "gateway online", "gateways online")}.` }
        : { key: "ingest", label: "Recepção de leituras", tone: "ok", detail: `${plural(ingest.readingsLastHour, "leitura", "leituras")} na última hora; última ${ago(received)}.` };

  const waiting = minutesSince(notifications.oldestWaitingSince, now);
  const notificationProblems = [
    waiting !== null && waiting > NOTIFICATION_STALE_MINUTES ? `${plural(notifications.waiting, "aviso aguardando", "avisos aguardando")} ${ago(waiting)}` : null,
    notifications.failedLastDay ? `${plural(notifications.failedLastDay, "falha", "falhas")} nas últimas 24 h` : null,
  ].filter(Boolean);
  const notificationStatus: ServiceStatus = notificationProblems.length
    ? { key: "notifications", label: "Envio de avisos", tone: "attention", detail: `${notificationProblems.join("; ")}.` }
    : { key: "notifications", label: "Envio de avisos", tone: "ok", detail: `${plural(notifications.deliveredLastDay, "entregue", "entregues")} nas últimas 24 h; ${plural(notifications.waiting, "na fila", "na fila")}.` };

  const commandStatus: ServiceStatus = physicalCommands.failedLastDay
    ? { key: "commands", label: "Comandos de portões", tone: "attention", detail: `${plural(physicalCommands.failedLastDay, "comando sem resposta ou com falha", "comandos sem resposta ou com falha")} nas últimas 24 h.` }
    : { key: "commands", label: "Comandos de portões", tone: physicalCommands.acknowledgedLastDay || physicalCommands.waiting ? "ok" : "idle",
        detail: `${plural(physicalCommands.acknowledgedLastDay, "confirmado", "confirmados")} nas últimas 24 h; ${plural(physicalCommands.waiting, "aguardando", "aguardando")}.` };

  const automations = jobs.find(job => job.name === "automations");
  const failing = jobs.filter(job => !job.scheduled || job.lastStatus === "Failed");
  const success = automations ? minutesSince(automations.lastSuccessAt, now) : null;
  const schedulerStatus: ServiceStatus = !automations
    ? { key: "scheduler", label: "Agendador do banco", tone: "attention", detail: "A tarefa das automações programadas não está registrada." }
    : failing.length
      ? { key: "scheduler", label: "Agendador do banco", tone: "attention", detail: failing.map(job => `${job.name === "automations" ? "automações" : job.name === "telemetry-retention" ? "retenção" : job.name}: ${job.scheduled ? "última execução falhou" : "pausada"}`).join("; ") + "." }
      : { key: "scheduler", label: "Agendador do banco", tone: "ok", detail: success === null ? "Aguardando a primeira execução." : `Automações executadas ${ago(success)}${jobs.some(job => job.name === "telemetry-retention") ? "; retenção ligada" : ""}.` };

  return [ingestStatus, notificationStatus, commandStatus, schedulerStatus,
    { key: "database", label: "Banco de dados", tone: "idle", detail: `${formatBytes(database.bytes)} no total, ${formatBytes(database.telemetryBytes)} de leituras.` }];
}
