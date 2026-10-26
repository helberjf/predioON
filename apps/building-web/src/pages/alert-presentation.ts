import type { Alert, Tone } from "@predioon/ui";

const TYPES: Record<string, { title: string; guidance: string }> = {
  PUMP_CONTINUOUS: { title: "Bomba ligada por mais tempo que o esperado", guidance: "Solicite uma verificação da bomba à manutenção." },
  PUMP_CONTINUOUS_LIMIT: { title: "Bomba ligada por mais tempo que o esperado", guidance: "Solicite uma verificação da bomba à manutenção." },
  LOW_WATER_LEVEL: { title: "Nível da caixa d’água baixo", guidance: "Peça à equipe responsável para verificar o abastecimento." },
  WATER_LOW: { title: "Nível da caixa d’água baixo", guidance: "Peça à equipe responsável para verificar o abastecimento." },
  CRITICAL_WATER_LEVEL: { title: "Nível da caixa d’água muito baixo", guidance: "Solicite uma verificação urgente do abastecimento." },
  WATER_LEAK_DETECTED: { title: "Possível vazamento de água", guidance: "Peça à manutenção para verificar o local indicado pelo sensor." },
  SEWAGE_LEAK_DETECTED: { title: "Possível vazamento de esgoto", guidance: "Peça à manutenção para verificar o local indicado pelo sensor." },
  HIGH_TEMPERATURE: { title: "Temperatura acima do esperado", guidance: "Solicite uma verificação do ambiente à equipe responsável." },
  COMMUNICATION_LOST: { title: "Equipamento sem comunicação", guidance: "Solicite uma verificação da conexão do equipamento. As leituras podem estar desatualizadas." },
  GAS_DETECTED: { title: "Sensor identificou presença de gás", guidance: "Siga o procedimento de emergência do condomínio e acione a equipe responsável." },
  SMOKE_DETECTED: { title: "Sensor identificou fumaça", guidance: "Siga o procedimento de emergência do condomínio e acione a equipe responsável." },
  DAILY_WATER_LIMIT: { title: "Consumo de água acima do limite diário", guidance: "Peça à equipe responsável para verificar o consumo de água." },
  DAILY_ENERGY_LIMIT: { title: "Consumo de energia acima do limite diário", guidance: "Peça à equipe responsável para verificar o consumo de energia." },
  DAILY_PUMP_LIMIT: { title: "Bomba funcionou além do limite diário", guidance: "Solicite uma verificação da bomba à manutenção." },
  ADAPTIVE_WATER_ANOMALY: { title: "Consumo de água diferente do habitual", guidance: "Peça à equipe responsável para verificar essa mudança no consumo." },
  ADAPTIVE_ENERGY_ANOMALY: { title: "Consumo de energia diferente do habitual", guidance: "Peça à equipe responsável para verificar essa mudança no consumo." },
  ADAPTIVE_PUMP_ANOMALY: { title: "Tempo de uso da bomba diferente do habitual", guidance: "Solicite uma verificação da bomba à manutenção." },
};

export const ALERT_GROUPS = [
  { id: "attention", title: "Precisam de atenção", description: "Confira estes alertas e combine os próximos passos com a equipe responsável.", empty: "Nenhum alerta aguardando acompanhamento nesta lista." },
  { id: "following", title: "Em acompanhamento", description: "Alertas cujo acompanhamento já foi iniciado.", empty: "Nenhum alerta em acompanhamento nesta lista." },
  { id: "resolved", title: "Resolvidos", description: "Histórico de alertas marcados como resolvidos. Não representa a situação atual dos equipamentos.", empty: "Nenhum alerta resolvido nesta lista." },
] as const;

const PRIORITY: Record<string, { label: string; tone: Tone; rank: number }> = {
  CRITICAL: { label: "Prioridade urgente", tone: "danger", rank: 0 },
  HIGH: { label: "Prioridade alta", tone: "danger", rank: 1 },
  MEDIUM: { label: "Atenção necessária", tone: "warning", rank: 2 },
  LOW: { label: "Prioridade baixa", tone: "info", rank: 3 },
  INFO: { label: "Informativo", tone: "info", rank: 4 },
};

export function presentAlert(alert: Alert) {
  const known = Object.hasOwn(TYPES, alert.type) ? TYPES[alert.type] : undefined;
  const electrical = /^(LOW_VOLTAGE|HIGH_VOLTAGE|PHASE_LOSS)_L[123]$/.test(alert.type);
  const description = known ?? (electrical ? { title: "Alteração na energia elétrica", guidance: "Solicite uma avaliação à equipe de manutenção elétrica." } : undefined);
  const demo = /^\s*\[DEMO\]/i.test(alert.message);
  const message = alert.message.replace(/^\s*\[DEMO\]\s*/i, "");
  const group = alert.status === "RESOLVED" ? "resolved" : alert.status === "ACKNOWLEDGED" ? "following" : "attention";
  const status = group === "resolved" ? "Resolvido" : group === "following" ? "Em acompanhamento" : alert.status === "OPEN" ? "Precisa de atenção" : "Situação a confirmar";
  const tone: Tone = group === "resolved" ? "success" : group === "following" ? "info" : "warning";
  const guidance = group === "resolved" ? "Este alerta foi marcado como resolvido. Os dados do registro estão nas informações técnicas."
    : group === "following" ? "O acompanhamento deste alerta foi iniciado. Confira o andamento com a equipe responsável."
    : description?.guidance ?? "Confira a mensagem e combine os próximos passos com a equipe responsável.";
  const priority = Object.hasOwn(PRIORITY, alert.severity) ? PRIORITY[alert.severity]! : { label: "Prioridade a confirmar", tone: "neutral" as Tone, rank: 5 };
  return { title: description?.title ?? "Alerta do condomínio", message: description ? null : message, demo, group, status, tone, guidance, priority };
}
