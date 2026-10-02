# Alertas por capacidade — plano de implementação

> **For agentic workers:** usar subagent-driven-development com TDD, revisão de conformidade e depois revisão de qualidade. Integrado ao produto autorizado; não fazer stage ou commit.

**Goal:** consultar, reconhecer e resolver alertas somente no escopo atual autorizado.

**Architecture:** PostgreSQL decide a capacidade por alerta ou por seu equipamento/gateway explícito. Uma projeção mínima permite classificar funcionalidades sem dar acesso às configurações de equipamentos ou regras. A aplicação não recebe DML de alertas; uma função de transição restrita bloqueia regressão de estado e grava a auditoria atomicamente.

**Tech Stack:** TypeScript, Express, Drizzle e PostgreSQL existentes; sem dependências novas.

## Arquivos e contrato

- Criar infrastructure/018-alert-capabilities.sql.
- Criar apps/api/src/modules/alerts/authorization.ts: contexto mínimo autorizado e classificação de funcionalidades.
- Modificar apps/api/src/modules/alerts/routes.ts: remover guards legados deste módulo; preservar caminhos, paginação e DTOs.
- Modificar packages/shared/src/rbac.ts: adicionar alerts:resolve somente a BUILDING_ADMIN e MAINTENANCE_MANAGER.
- Criar apps/api/test/alert-capabilities.test.ts.
- Alterar teste antigo somente se esperar um bypass privado global que esta migração intencionalmente remove; não relaxar controles.
- Documentação, tracker e execução da regressão integral pertencem ao agente principal.
- Eventos SSE de alertas são uma subentrega dependente após estabilizar HTTP/RLS; não editar events neste recorte.

Capacidades: alerts:read, alerts:acknowledge e alerts:resolve. Suporte permanece somente diagnóstico/read, sem ampliar allowlist de suporte. Plataforma global não recebe acesso privado por flag nem papel global; precisa de concessão local atual.

Escopo: capacidade no alerta (resource_type alert), ou no device_id/gateway_id explicitamente registrado nele, ou concessão inteira do condomínio. Validar que todos os recursos relacionados não nulos pertencem ao mesmo condomínio; rule_id também pertence ao condomínio e seu dispositivo, quando definido, é consistente. Uma concessão em equipamento não promove acesso a alertas sem relação com ele. Um recurso building não equivale a concessão inteira do tenant.

Contrato recomendado:
```ts
type AlertCapability = "alerts:read" | "alerts:acknowledge" | "alerts:resolve";
type AlertContext = {
  building_id: string; alert_id: string; device_id: string | null;
  gateway_id: string | null; rule_id: string | null; rule_metric: string | null;
  device_type: string | null; gate_kind: string | null; parking_vehicle_type: string | null;
};
async function authorizedAlertContexts(tx: AppTransaction, buildingId: string | null, alertId?: string): Promise<AlertContext[]>;
function alertFeatureKeys(context: AlertContext, type: string): FeatureKey[];
```

## Tarefa 1 — RED de leitura e transição

- [x] Criar fixtures com dois condomínios, pessoa direta, equipe, concessões em alerta/equipamento/gateway, morador, administrador global, suporte e estranho, sem membership legado nos novos papéis.
- [x] Demonstrar manutenção negada pelo comportamento anterior; demonstrar leitura privada indevida de plataforma/morador legados.
- [x] Cobrir seleção por buildingId e lista geral, status/paginação; zero alertas com capacidade inteira deve retornar 200 vazio, fora do escopo explícito deve retornar 403.
- [x] Demonstrar leitura correta por suporte apenas alerts:read, sem devices:read ou telemetry:read.
- [x] Demonstrar que MAINTENANCE reconhece e não resolve; MAINTENANCE_MANAGER e BUILDING_ADMIN resolvem. Mesmo JWT perde permissão após revogar binding/equipe/suporte.
- [x] Cobrir alertas com referências de outro condomínio, inclusive dado inconsistente inserido pelo owner: não expor nem alterar.

Exemplos de asserções de comportamento:
```ts
assert.equal((await list(worker, a)).status, 200);
assert.equal((await list(worker, b)).status, 403);
assert.equal((await acknowledge(worker, ownAlert)).status, 200);
assert.equal((await resolve(worker, ownAlert)).status, 403);
assert.equal((await acknowledge(worker, foreignAlert)).status, 404);
```

## Tarefa 2 — GREEN da migration e projeção

- [x] Catálogo SQL/TypeScript concordante; sem concessão global ou suporte de escrita.
- [x] Função privilegiada booleana de capacidade em alerta valida relação e whitelist; reutilizada em transição/auditoria.
- [x] Projeção privilegiada mínima limitada aos condomínios candidatos dos vínculos, memberships e suporte do solicitante; consultar RBAC por alerta e retornar só classificação, nunca configuração, metadata, limiares ou templates.
- [x] Consultas por ID e transições usam acesso indexado ao alerta, sem enumerar todo o histórico. Pode-se usar filtro opcional alert_id na projeção ou predicado de capacidade por linha na RLS; registrar a estratégia e verificar o plano de consulta.
- [x] Remover política ALL anterior de alerts, instalar SELECT por conjunto de pares building_id/alert_id autorizados; revogar INSERT/UPDATE/DELETE de predioon_app. Owner de ingestão segue inalterado.
- [x] Tornar settings/runtime de funcionalidades legíveis por autorização de alertas independentemente de buildings:read. Não ampliar acesso a outros dados nem escrita de funcionalidades.
- [x] Helpers SECURITY DEFINER com search_path public,pg_temp, owner administrativo explicitamente preservado; revogar PUBLIC/identity/broker e conceder somente app. Aplicação atômica e reaplicação idempotente, sem BEGIN/COMMIT no arquivo.
- [x] Classificação preserva precedência de tipos ADAPTIVE/DAILY WATER/ENERGY/PUMP, AI_ANALYSIS e PUMP_CONTINUOUS_LIMIT; depois métrica canônica da regra e classificação do dispositivo/gate/parking. Reutilizar helpers puros existentes onde aplicável.
- [x] Lista HTTP consulta recursos atuais dentro de inTenantContext, lê readFeatures após autorização e filtra funcionalidades desativadas sem assertGovernanceAccess/buildingFeatures. Alerta histórico volta a ser consultável após reativação, preservando semântica atual.

## Tarefa 3 — transição controlada e auditoria

- [x] Função app_transition_alert(alert UUID, target_status text, ip text DEFAULT NULL, user_agent text DEFAULT NULL) recebe somente alvo/estado/contexto de requisição. Não aceita actor, timestamps, mensagem, severidade ou outros campos de alerta.
- [x] Exigir alerts:read e a capacidade do estado solicitado no recurso atual; acesso ausente não revela dados. Route obtém alerta por RLS: inacessível/ausente 404; visível sem capacidade de ação 403.
- [x] Bloquear linha FOR UPDATE, revalidar autorização atual; OPEN -> ACKNOWLEDGED ou RESOLVED, ACKNOWLEDGED -> RESOLVED. Mesmo estado é idempotente sem sobrescrever ator/data nem gerar nova auditoria; RESOLVED -> ACKNOWLEDGED é 409 e não altera linha.
- [x] Estampar actor com app_current_user_id() e data do banco, nunca app.role ou dados do caller. Validar target_status com whitelist.
- [x] Inserir audit_logs dentro da mesma função/transação para cada mudança efetiva, actions fixas ALERT_ACKNOWLEDGED/ALERT_RESOLVED, resource_type alert, actor_type USER, resource_id/tenant corretos. Falha de auditoria desfaz transição; rollback explícito também.
- [x] Migration atualiza CASE da política de INSERT de audit_logs para essas duas actions exigirem capacidade exata do alerta, sem fallback legado; copiar as branches migradas de 016 e preservar outras actions.
- [x] Route conserva lock compartilhado de funcionalidades e verifica todas as keys ativas antes de chamar a função. Retornar DTO camelCase existente por SELECT autorizado após transição.
- [x] Testar chamada SQL direta autorizada e negada, estado inválido, app.role forjado, DML direto proibido, repetição, concorrência acknowledge/resolve sem regressão e rollback transação/auditoria.

## Tarefa 4 — verificação e aceite

- [x] Testar pausa e retomada da funcionalidade, inclusive depois de revogar buildings:read independentemente de alerts:read. Não elevar papéis para contornar guards.
- [x] Testar conta, condomínio e organização inativos; equipe inativa/expirada; suporte expirado/revogado/papel global revogado; scopes mistos e legacy membership compatível sem bypass global.
- [x] Executar testes novos e feature-enforcement/security/rbac unit com todas as quatro DSNs de teste e flags RUN_ACCESS_DB_TESTS=1/RUN_RBAC_DB_TESTS=1.
```powershell
pnpm --filter @predioon/api exec node --import tsx --test --test-concurrency=1 test/alert-capabilities.test.ts test/feature-enforcement.test.ts test/security.test.ts test/rbac-tenancy-unit.test.ts
pnpm --filter @predioon/api typecheck
pnpm check:boundaries
```
- [x] Revisão de conformidade; resolver e rever achados.
- [x] Revisão de qualidade após aprovação de conformidade; resolver e rever achados.
- [x] Regressão integral pelo agente principal com fonte estável e banco livre; registrar evidências e limitações.

## Banco e preservação

Worktree: C:/Users/default.LAPTOP-K8F2QHAF/.codex/worktrees/product-platform/predioON, branch codex/product-platform.
Banco isolado: predioon-product-test-db-1, localhost:5436, predioon. SQL 001–017 já aplicado. Não rodar seed, db:push, reset ou migrations antigas.
Copiar somente 018 ao container e aplicar com psql -v ON_ERROR_STOP=1 --single-transaction. DSNs dos quatro papéis usam usuário/senha correspondentes: predioon, predioon_app, predioon_identity, predioon_broker_auth.
Preservar alterações anteriores; nenhuma escrita no checkout original, nenhum stage/commit.
Estado: HTTP/RLS concluído e ambas as revisões aprovadas em 30/09/2026. Migration 018 aplicada/reaplicada atomicamente; 21 testes novos e teste dirigido 48/48 passaram. A consulta de estado de funcionalidades foi corrigida para validar concessões e recursos exatos sem percorrer o histórico de alertas. EXPLAIN das duas leituras reais de funcionalidades confirmou zero scans de histórico; consulta exata usa alerts_pkey, uma linha/um loop. A revisão de qualidade encontrou somente a criação ausente do diretório de diagnóstico: corrigida e verificada com .local inicialmente ausente (1/1). O agente principal verificou o conjunto estável HTTP/SSE: API 248/248, 30 suites, sem falhas/skips/cancelamentos, dez typechecks e fronteiras passaram. A revisão de qualidade final do recorte SSE foi aprovada; 2B.3 continua aberta.

## Evidências e histórico

- RED inicial: .local/alerts-red.log, 15 falhas esperadas, sem cancelamentos/skips. A execução foi interrompida por limite de uso antes da implantação inicial; os drafts foram preservados fora do checkpoint 357756d.
- Retomada após autorização de commit/push: implementação HTTP e catálogo completos, 018 aplicada/reaplicada atomicamente. .local/alert-feature-scope-final.log registra 48/48, incluindo os dois testes novos que reproduziram o scan de histórico antes da correção.
- Planos efetivos: .local/alert-feature-inner-plans.json; versão RED preservada separadamente. As leituras reais de settings/runtime não percorrem o histórico; o contexto pontual limita a consulta ao ID do alerta.
- Portabilidade: .local/alert-portability-fresh-dir.log, 1/1 com .local inicialmente ausente, diretório original restaurado. Revisões de conformidade e qualidade aprovadas após as correções.
- Regressão do agente principal: .local/api-alerts-combined-full.log, 248/248; .local/types-alerts-combined.log, dez pacotes. O script check:boundaries também passou. Só documentação mudou após essa execução; nenhuma fonte de execução alterada.
- Banco de teste preservado; nenhum reset, seed, aplicação em produção ou alteração no checkout original.
