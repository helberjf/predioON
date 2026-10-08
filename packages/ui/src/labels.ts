/** Words for the codes the API stores. An unknown code is shown as it came, never hidden. */
export const readableCode = (code: string) => code.replaceAll("_", " ");

export const SEVERITY_LABELS: Record<string, string> = { INFO: "Informativa", LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta", CRITICAL: "Crítica" };

const AUDIT_ACTIONS: Record<string, string> = {
  ACCESS_COMMAND_CANCELLED_BY_FEATURE: "Comando de acesso cancelado por pausa da funcionalidade",
  ACCESS_COMMAND_SENT: "Comando de acesso enviado",
  ACCESS_CONFIG_CREATED: "Acesso cadastrado",
  ACCESS_CONFIG_UPDATED: "Configuração de acesso alterada",
  ACCESS_OPEN_REQUESTED: "Abertura de acesso solicitada",
  ACCESS_REQUEST_REJECTED: "Pedido de abertura recusado",
  ALERT_ACKNOWLEDGED: "Alerta assumido",
  ALERT_RESOLVED: "Alerta resolvido",
  ALERT_RULE_CREATED: "Regra de alerta criada",
  ALERT_RULE_DELETED: "Regra de alerta removida",
  ALERT_RULE_UPDATED: "Regra de alerta alterada",
  ASSET_CREATED: "Ativo cadastrado",
  ASSET_UPDATED: "Ativo alterado",
  AUTOMATION_CREATED: "Automação criada",
  AUTOMATION_DISABLED: "Automação desativada",
  AUTOMATION_ENABLED: "Automação ativada",
  AUTOMATION_PUBLISHED: "Automação publicada",
  AUTOMATION_VERSION_ADDED: "Nova versão de automação",
  BLOCK_CREATED: "Bloco cadastrado",
  BUILDING_CREATED: "Condomínio cadastrado",
  BUILDING_UPDATED: "Condomínio alterado",
  COMMON_AREA_CREATED: "Área comum cadastrada",
  COMMON_AREA_UPDATED: "Área comum alterada",
  DEVICE_CREATED: "Equipamento cadastrado",
  DEVICE_METRIC_CREATED: "Métrica de equipamento cadastrada",
  DEVICE_UPDATED: "Equipamento alterado",
  FEATURE_CONFIGURATION_CHANGED: "Funcionalidade alterada",
  FINANCIAL_DRAFT_CREATED: "Rascunho de prestação de contas criado",
  FINANCIAL_DRAFT_UPDATED: "Rascunho de prestação de contas alterado",
  FINANCIAL_REPORT_PUBLISHED: "Prestação de contas publicada",
  GATEWAY_CREATED: "Gateway cadastrado",
  GATEWAY_UPDATED: "Gateway alterado",
  INVITATION_ACCEPTED: "Convite aceito",
  INVITATION_CREATED: "Convite emitido",
  INVITATION_REVOKED: "Convite revogado",
  MEMBERSHIP_REVOKED: "Vínculo com o condomínio encerrado",
  MONITORING_CREATED: "Monitoramento de consumo criado",
  MONITORING_UPDATED: "Monitoramento de consumo alterado",
  NOTICE_DELETED: "Aviso removido",
  NOTICE_PUBLISHED: "Aviso publicado",
  NOTICE_UPDATED: "Aviso alterado",
  OCCURRENCE_UPDATED: "Chamado atualizado",
  OCCURRENCES_GROUPED: "Chamados agrupados",
  ORGANIZATION_CREATED: "Cliente cadastrado",
  ORGANIZATION_UPDATED: "Cliente alterado",
  PARKING_OCCUPANCY_UPDATED: "Ocupação de vagas informada",
  PASSWORD_CHANGED: "Senha alterada",
  PRIORITY_CHANGED: "Gravidade do chamado alterada",
  RESERVATION_CANCELLED: "Reserva cancelada",
  RESERVATION_CREATED: "Reserva criada",
  RESERVATION_REJECTED: "Reserva recusada",
  ROLE_BINDING_CREATED: "Permissão concedida",
  ROLE_BINDING_REVOKED: "Permissão revogada",
  STATUS_CHANGED: "Situação alterada",
  SUPPORT_REQUESTED: "Suporte remoto solicitado",
  TEAM_CREATED: "Equipe criada",
  TEAM_MEMBER_ADDED: "Integrante adicionado à equipe",
  TEAM_MEMBER_REVOKED: "Integrante removido da equipe",
  UNIT_CREATED: "Unidade cadastrada",
  UNIT_MEMBERSHIP_CREATED: "Morador vinculado à unidade",
  UNIT_MEMBERSHIP_REVOKED: "Vínculo com a unidade encerrado",
  USER_CREATED: "Conta criada",
  WORK_ORDER_CREATED: "Ordem de serviço aberta",
  WORK_ORDER_STATUS_CHANGED: "Situação da ordem de serviço alterada",
  WORK_ORDER_UPDATED: "Ordem de serviço alterada",
};
export const auditActionLabel = (action: string): string => AUDIT_ACTIONS[action] ?? readableCode(action);

const RESOURCE_TYPES: Record<string, string> = {
  alert: "Alerta", alert_rule: "Regra de alerta", asset: "Ativo", automation: "Automação", block: "Bloco", building: "Condomínio",
  common_area: "Área comum", device: "Equipamento", gate: "Acesso", gateway: "Gateway", invitation: "Convite", notice: "Aviso",
  occurrence: "Chamado", organization: "Cliente", reservation: "Reserva", team: "Equipe", unit: "Unidade", user: "Conta", work_order: "Ordem de serviço",
};
export const resourceTypeLabel = (type: string): string => RESOURCE_TYPES[type] ?? type;

/**
 * "Chrome no Windows" instead of the browser's whole identification string.
 * What cannot be recognised is returned unchanged, so nothing is ever invented.
 */
export function describeUserAgent(userAgent: string): string {
  const has = (pattern: RegExp) => pattern.test(userAgent);
  const system = has(/Android/) ? "Android" : has(/iPhone|iPad|iPod/) ? "iOS" : has(/Windows/) ? "Windows" : has(/Mac OS X|Macintosh/) ? "macOS" : has(/Linux|X11/) ? "Linux" : null;
  if (has(/okhttp/i)) return "Aplicativo Prédio ON no Android";
  if (has(/CFNetwork|Darwin/)) return "Aplicativo Prédio ON no iOS";
  // Order matters: Edge and Opera also announce Chrome, and Chrome also announces Safari.
  const browser = has(/Edg\//) ? "Edge" : has(/OPR\/|Opera/) ? "Opera" : has(/Firefox\//) ? "Firefox" : has(/Chrome\/|CriOS\//) ? "Chrome" : has(/Safari\//) ? "Safari" : null;
  return browser && system ? `${browser} no ${system}` : userAgent;
}
