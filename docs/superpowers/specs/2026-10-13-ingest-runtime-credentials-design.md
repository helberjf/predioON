# Credenciais de runtime para ingestão e acesso físico

**Data:** 13/10/2026. **Estado:** desenho para implementação; nenhuma migration, role, credencial ou implantação foi executada por este documento.

**Fonte funcional examinada:** branch `codex/continue-product-plan`, commit `f83e3c645e13681bf3825b9b5f767a4b348c3304`. O HEAD avançou para `466881cdd3ec5718efdffeffb847d991dff61920` somente com documentação de publicação de f83. A conferência remota de 13/10 encontrou `origin/main` em `6989248e2e6f5d63a9855939de643f458096abcc` e migrations 001–051. O número 052 abaixo é a próxima posição proposta; o executor deve conferir novamente o remoto antes de criar o arquivo SQL.

## 1. Resultado e decisão já autorizados

Retirar a conexão proprietária do processo produtivo iniciado por `services/ingest/src/index.ts`, incluindo telemetria, status de gateway, varredura offline, consumo, regras, estacionamento, produção de outbox, SSE, dispatcher e ACK de acesso. O administrador continua restrito aos CLIs de bootstrap, migrations, provisionamento, seed, demonstração e fixtures.

Este é o recorte de menor privilégio de 2B.5/etapa 3 do [plano do produto](../plans/2026-09-27-product-execution.md). A [decisão 048](../../INBOX_DECISOES.md) mantém a ingestão transacional existente. As seções 07/10 de [MELHORIAS_E_EVOLUCOES.md](../../MELHORIAS_E_EVOLUCOES.md) registram que retirar owner é independente da fila. Não criar inbox, consumidor separado, lease, retry, retenção ou replay neste recorte; não executar o plano antigo de inbox como implementação desta meta.

| Alternativa | Consequência | Decisão |
|---|---|---|
| Duas conexões: `predioon_ingest` e `predioon_access_service` | Separa permissões de observação e atuação no banco; permite extrair serviços depois | Adotar |
| Uma role com a união das duas cargas | Menos configuração, mas concentra direitos físicos na conexão de observação | Não escolher |
| Restringir telemetria e manter dispatcher/ACK com owner | Deixa owner dentro do mesmo processo produtivo | Não encerra a meta |

As duas credenciais continuam no mesmo processo e na mesma sessão MQTT. O processo conserva a autoridade combinada das duas cargas; isto não constitui isolamento de processos nem isolamento por mensagem. `app.user_id`, `app.role` e outros GUCs mutáveis não concedem autoridade de máquina.

## 2. O que existe e o que precisa mudar

| Caminho atual | Dependência e obrigação preservada |
|---|---|
| `src/index.ts` → `pipeline/telemetry.ts` | Owner; lock de features, device → gateway, receipt048, raw, consumo, estacionamento, alertas/outbox e heartbeat numa transação |
| `pipeline/gateway-status.ts` | Owner; somente estado, contato e firmware do gateway habilitado |
| `offline-sweeper.ts` | Owner; candidato é uma dica, reler/travar fonte, corte com relógio PostgreSQL e status+alerta+outbox atômicos |
| `analytics/usage.ts` | Owner; perfil é travado `FOR UPDATE`, mas nenhuma configuração é escrita; cursors e daily usage têm upsert |
| `rules/evaluate.ts` | Owner; regra global do condomínio pode ter cooldown causado por outro device do mesmo condomínio |
| `notify/index.ts` | Owner; `notification_enqueue_alert()` privado e snapshot direto de quatro tabelas privadas de outbox |
| `parking/index.ts` | Owner; apenas observação SENSOR, incremento de versão e auditoria SYSTEM; trigger humano invoca helpers privados |
| `realtime.ts` / `features.ts` | Owner; reler features e propriedade do alerta depois do commit, publicar `pg_notify`; perda de SSE não desfaz nem repete trabalho durável |
| `access/dispatcher.ts` | Owner; expirar, selecionar PENDING com `FOR UPDATE SKIP LOCKED`, validar autoridade em `app_mark_access_sent`, publicar depois do commit SENT e processar ACK |
| `packages/db/src/index.ts` | Constrói pool owner ao importar; seu barrel não é um entrypoint de runtime |
| `packages/db/src/runtime.ts` | Importa `context.ts` e constrói pool `predioon_app`; também não serve à ingestão |
| `services/ingest/src/config.ts` / ambos `env.ts` | Config exige `DATABASE_URL`; dotenv central introduz owner no ambiente de ingestão |

`gateways.metadata` contém `mqttUsername`/`mqttPasswordHash`. Hoje telemetria e offline fazem `select()` e `returning()` da linha inteira e usam `assertPersisted` nela. A nova role não terá `SELECT(metadata)`; substituir a linha completa por projeção explícita em todas as leituras, retornos e releituras de confirmação. Proibir metadata também em devices evita um futuro campo secreto ganhar acesso acidentalmente.

## 3. Fronteiras de módulos e inicialização

Criar dois exports de `@predioon/db`:

```ts
// @predioon/db/ingest
export const ingestSqlClient: postgres.Sql;
export const ingestDb: PostgresJsDatabase<typeof schema>;
export type IngestTransaction = Parameters<Parameters<typeof ingestDb.transaction>[0]>[0];
export async function closeIngestDb(): Promise<void>;

// @predioon/db/access-service
export const accessServiceSqlClient: postgres.Sql;
export const accessServiceDb: PostgresJsDatabase<typeof schema>;
export type AccessServiceTransaction = Parameters<Parameters<typeof accessServiceDb.transaction>[0]>[0];
export async function closeAccessServiceDb(): Promise<void>;
```

Cada módulo cria somente seu pool, com `createRuntimeSqlClient`, role fixa e `max: 10`. Exportar somente tabelas/tipos de schema necessários à própria carga, funções de features neutras e seus próprios adapters. Não reexportar `context`, `index`, identidade, broker-auth, notificações ou módulos administrativos. `schema.ts` e submódulos de schema não constroem pools; podem ser compartilhados. O `import type` de `AppTransaction` em `features.ts` não cria pool, mas seu contrato deve passar a um executor estrutural neutro, sem depender de `context.ts` para representar a carga de serviço.

Adicionar `packages/db/src/transaction.ts` com tipo estrutural derivado de `PostgresJsDatabase<typeof schema>` usando imports exclusivamente de tipo. `features.ts` recebe esse tipo; `IngestTransaction` e `AccessServiceTransaction` continuam aliases locais do pool que efetivamente usam. Não mover tabelas nem duplicar o algoritmo `resolveFeatures`.

`runtime-connection.ts` torna-se um construtor/verificador sem side effect de dotenv. Os entrypoints existentes `context.ts`, `identity.ts` e `broker-auth.ts` passam a importar explicitamente o loader que já lhes fornecia `.env`; `notifications.ts` já faz isso. Esta é a primeira meta preparatória independente: testes de importação em subprocessos com mocks ESM de dotenv/postgres/Drizzle comprovam ausência do loader no construtor e presença/compatibilidade em cada entrypoint, sem ler `.env` real ou conectar banco. Pode ser revisada, commitada e publicada antes de 052. Não adiciona roles/credenciais novas nem muda config/env/funcionamento da ingestão; owner continua aberto nessa etapa. Esta refatoração de carga não declara novos privilégios nem uma nova garantia sobre o processo API.

O ambiente de ingestão vem de `services/ingest/.env.runtime`, ignorado pelo Git, ou de variáveis explicitamente injetadas no container. O loader de `services/ingest/src/env.ts` aceita somente as duas URLs de serviço e as chaves MQTT/operacionais já usadas por `config.ts`; nunca lê `.env` central. Arquivo ausente é permitido quando as variáveis estão injetadas; URL ausente continua sendo erro em qualquer `NODE_ENV`. Criar exemplo público dedicado e CLI administrativo `scripts/write-ingest-runtime-env.mjs` para projetar somente essas chaves do ambiente administrativo local; seu output não inclui valores nem paths de certificados privados. Esse CLI é chamado pelo setup local, não pelo runtime.

O runtime rejeita um arquivo dedicado que contenha `DATABASE_URL` ou URLs de app/identity/broker/notifications e rejeita `process.env.DATABASE_URL` não vazio antes de construir pools. Fixtures administrativas usam processo separado e importação dinâmica posterior com somente as duas URLs necessárias. O CLI demo-data carrega o ambiente administrativo diretamente e não importa o loader produtivo.

`config.ts` substitui `DATABASE_URL` por `DATABASE_URL_INGEST` e `DATABASE_URL_ACCESS_SERVICE`, com role fixa, sem owner fallback. Validar que as duas URLs apontam para o mesmo host/porta/banco sem exigir conhecer a URL owner. A fronteira de URL recusa protocolo inválido, usuário errado, escapes inválidos e parâmetros `role`, `options`, `session_authorization`, inclusive variações de caixa; erros nunca mostram DSN, senha ou causa do driver.

`index.ts` carrega configuração primeiro e importa dinamicamente `startup.ts`. O startup verifica ambas as identidades autenticadas com `verifyRestrictedDatabaseRole` antes de chamar `connectIngest`, iniciar sweeper ou dispatcher. A consulta mantém `pg_stat_activity.usesysid`, `current_user`, `session_user`, atributos de role e ownership e exige ausência de memberships em ambos os sentidos para as duas novas roles. Se uma verificação falhar, encerrar os dois pools, sair com erro sanitizado e não conectar MQTT. Shutdown para timers/dispatcher e fecha MQTT e pools sem criar mecanismo de replay.

## 4. Matriz de privilégios

As duas roles são `NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`, inicialmente `NOLOGIN`, sem objetos próprios e sem memberships como membro ou como role concedida. Possuem CONNECT/USAGE e não possuem CREATE/TEMP. A mesma validação existe no provisionamento e startup. Dados operacionais cobrem o conjunto de condomínios atendidos pela carga; não são capacidades humanas por condomínio/recurso.

| Objeto | `predioon_ingest` | `predioon_access_service` |
|---|---|---|
| `buildings` | SELECT `id,active,timezone` | Nenhum acesso direto; validação física pelos helpers |
| `devices` | SELECT projeção segura; UPDATE `status,last_seen_at,updated_at` | Nenhum acesso direto |
| `gateways` | SELECT projeção segura; UPDATE `status,last_seen_at,firmware_version,updated_at` | Nenhum acesso direto |
| `global_feature_settings`, `building_feature_settings`, `feature_runtime` | SELECT das colunas existentes; advisory lock compartilhado | SELECT das colunas existentes; advisory lock compartilhado |
| `ingest_events` | SELECT + INSERT; sem UPDATE/DELETE | Nenhum |
| `telemetry` | SELECT + INSERT; sem UPDATE/DELETE | Nenhum |
| `ingest_rejections` | Somente `ingest_count_rejection` | Nenhum |
| `monitoring_profiles` | SELECT; lock fechado por `ingest_lock_monitoring_profiles`; sem UPDATE de configuração | Nenhum |
| `usage_cursors` | SELECT/INSERT; UPDATE `last_at,last_value,good,continuous_seconds` | Nenhum |
| `daily_usage` | SELECT/INSERT; UPDATE quantidade/custo/cobertura/resets/samples/incomplete/first_at/last_at | Nenhum |
| `alert_rules` | SELECT projeção de avaliação, sem autor/cadastro | Nenhum |
| `alerts` | SELECT envelope para cooldown/revalidação; INSERT somente por produtor privado; sem UPDATE/DELETE | Nenhum |
| `parking_lots` | SELECT; lock pelo helper `ingest_lock_parking_lot`; observação/auditoria somente por helper, sem UPDATE/INSERT/DELETE direto | Nenhum |
| `gates` | SELECT `id,building_id,device_id,kind` para features de dispositivos | Candidato privado já retorna `gate_kind`; nenhum acesso direto |
| `gate_commands` | Nenhum | Sem ACL de tabela; selecionar/travar/transicionar apenas por helpers fechados |
| `audit_logs` | Sem ACL; somente evento SENSOR pelo helper de estacionamento | Sem ACL; somente eventos de comando pelos helpers |
| `outbox_events`, `event_deliveries`, `delivery_witnesses`, `delivery_witness_features`, `notification_attempts` | Sem ACL; produtor e assinatura opaca controlados | Nenhum |
| users/sessions/refresh tokens/password reset/MFA, RBAC, equipes/unidades, convites, organizações comerciais, finanças e demais domínios | Nenhum | Nenhum |
| `schema_migrations`, schemas de extensão, sequences, DDL | Nenhum | Nenhum |
| Helpers humanos `app_*`, `identity_*`, worker `notification_claim/complete/...`, enqueue original | Sem EXECUTE direto | Sem EXECUTE direto, inclusive `app_request_access` e `app_mark_access_sent` |

RLS de SELECT operacional é amplo dentro da tabela autorizada, por role PostgreSQL fixa, para não suprimir cooldowns e histórico necessários. INSERT de receipt/raw verifica building ativo, device habilitado do mesmo building e gateway habilitado/associado quando presente. Ledger exige `source='MQTT'`; não cria fingerprint para receipt legado. Upserts de uso verificam perfil/building/device associados. Não conceder UPDATE de `profile_id`, `building_id`, `day`; retirar essas identidades do `set` de `onConflictDoUpdate` em TS. UPDATE de hardware usa apenas colunas operacionais e `WITH CHECK` de associação; não concede mudança de enabled, nomes, tipo, parents ou metadata. Não acrescentar `building.active` a gateway-status/offline: os caminhos atuais continuam registrando comunicação de fontes habilitadas mesmo em condomínio inativo. A política e o produtor devem permitir esse contrato; telemetria/consumo mantêm seu filtro ativo atual.

Retargetar para `predioon_app` somente políticas herdadas `TO PUBLIC` dos objetos operacionais concedidos às novas roles, preservando qual/with_check e policies explícitas de identity/broker/app. Exemplos existentes: `ingest_events_scope_policy`, `usage_cursor_read`, `daily_usage_read`, `feature_global_read/feature_global_write`. Criar policies próprias por operação para as novas roles; não depender de curto-circuito entre policy humana e policy de serviço. Não usar `app.role='SYSTEM'` ou `app.user_id` em policies de máquina.

Migration nova remove ACLs preexistentes de tabela, coluna, sequence, função e memberships **das duas novas roles**; não basta `REVOKE ALL ON ALL TABLES` para grants de coluna. PUBLIC é implícito: `REVOKE TEMP FROM predioon_ingest` não anula TEMP concedido a PUBLIC. A instalação canônica 051 já revoga CREATE/TEMPORARY de PUBLIC na migration 015;052 preserva e testa `has_database_privilege` efetivo das novas roles. Se database/schema, tabela/coluna privada ou helper sensível tiver acesso PUBLIC reintroduzido, abortar 052 atomicamente com diagnóstico sanitizado; não executar revoke global sem inventário. A recuperação administrativa de uma instalação contaminada exige inventário de ACL e consumidores e teste de compatibilidade; não é remediação silenciosa desta migration.

Inventariar defaults do owner e acrescentar revogação de EXECUTE de futuras funções a PUBLIC no schema público, com efeito declarado: helpers novos deixam de ganhar PUBLIC automaticamente, enquanto funções existentes mantêm suas ACL explícitas. Preservar defaults existentes para consumidores antigos e excluir grants diretos das novas roles em novos objetos; todos os grants de serviço são explícitos. Snapshot/teste registra essa mudança intencional de default ACL, em vez de prometer catálogo inteiro idêntico. Uma role que já possua objetos provoca abort e rollback integral; não transferir esses objetos silenciosamente.

## 5. Projeções e adapters de observação

`packages/db/src/ingest-projections.ts` contém objetos Drizzle explícitos. A projeção de device é `id,buildingId,gatewayId,name,type,status,enabled,lastSeenAt,createdAt,updatedAt`. A de gateway é `id,buildingId,name,serialNumber,model,firmwareVersion,protocolVersion,status,enabled,lastSeenAt,createdAt,updatedAt`. Nenhuma possui `metadata` ou campos secretos; as colunas de cadastro lidas permanecem imutáveis para a role. A projeção de building é `id,active,timezone`; a de regra é `id,buildingId,deviceId,metric,operator,threshold,severity,alertType,messageTemplate,cooldownSeconds,enabled`.

Em telemetria e offline, comparar `expected={...safeSource, status/lastSeenAt/updatedAt}` com `returning(safeProjection)`, reler a mesma projeção e repetir no final com `PersistenceChecks`. Reescrita de coluna incluída, skip de UPDATE e alteração posterior por trigger continuam derrubando a transação. Não conceder metadata para manter uma comparação antiga. Campos proibidos são protegidos pela ACL; não se promete detectar no runtime uma alteração administrativa simultânea em um segredo invisível.

As funções puras `assertPersisted` e `PersistenceChecks` podem permanecer no módulo atual durante o recorte. Os callbacks devem usar `IngestTransaction`; não mudar a forma de comparação JSON, a projeção especial de JSONB de telemetry ou o último write esperado por chave.

Adapters novos em `packages/db/src/ingest-operations.ts`:

```ts
type RejectionCategory = "INVALID_ENVELOPE" | "FUTURE_TIMESTAMP" | "UNKNOWN_SOURCE" | "CONTENT_CONFLICT" | "RETAINED_REPLAY";
export function countIngestRejection(executor: Pick<IngestTransaction, "execute">, category: RejectionCategory, buildingId?: string): Promise<void>;
export function lockMonitoringProfiles(tx: IngestTransaction, buildingId: string, deviceId: string): Promise<Array<typeof monitoringProfiles.$inferSelect>>;
export function lockParkingLot(tx: IngestTransaction, buildingId: string, deviceId: string): Promise<typeof parkingLots.$inferSelect | null>;
export function persistIngestAlert(tx: IngestTransaction, expected: typeof alerts.$inferSelect): Promise<{ eventId: string; signature: string }>;
export function ingestAlertOutboxSignature(tx: IngestTransaction, alertId: string, eventId: string): Promise<string>;
export function writeParkingObservation(tx: IngestTransaction, input: { lotId: string; buildingId: string; deviceId: string; eventId: string; occupied: number; observedAt: Date; updatedAt: Date; expectedVersion: number }): Promise<boolean>;
```

`lockMonitoringProfiles` chama helper que trava e retorna IDs de perfis habilitados do par building/device; em seguida faz SELECT normal mapeado por Drizzle. Assim datas e nomes de campos mantêm os tipos existentes, enquanto nenhuma UPDATE de configuração é concedida. Lock de sensor vem antes do de perfil; múltiplos perfis são travados por ID em ordem estável. `lockParkingLot` faz o mesmo para o lote associado ao sensor: helper trava e retorna ID, SELECT mapeado normal devolve a linha sob o mesmo lock. `SELECT FOR UPDATE` direto em parking_lots exigiria UPDATE de pelo menos uma coluna, que esta matriz deliberadamente não concede.

## 6. Contratos SQL privados de observação

Todos os wrappers são `SECURITY DEFINER`, com owner igual ao owner fixado em `app_has_capability(text,text,text,text)`, `search_path=pg_catalog,public,pg_temp` e relações qualificadas `public.*`. Revogar PUBLIC e todas as roles de runtime; conceder EXECUTE somente a `predioon_ingest`. Helpers internos de guard/signature não têm EXECUTE de runtime, exceto o wrapper de assinatura abaixo. O guard interno `service_runtime_guard(expected_role name)` aceita apenas as duas roles fixas e confere `pg_stat_activity.usesysid`/`session_user`, flags, ownership e memberships; comparar `current_user` dentro de SECURITY DEFINER confundiria o owner do helper com o login.

```sql
ingest_count_rejection(category text, target_building_id text DEFAULT '') RETURNS void
ingest_lock_monitoring_profiles(target_building_id text, target_device_id text)
  RETURNS TABLE(profile_id uuid)
ingest_lock_parking_lot(target_building_id text, target_device_id text)
  RETURNS TABLE(lot_id uuid)
ingest_persist_alert(
  source_id uuid, target_building_id text, target_device_id text,
  target_gateway_id text, target_rule_id uuid, severity public.alert_severity,
  alert_type text, alert_message text, triggered_value jsonb,
  triggered_at timestamptz, source_created_at timestamptz)
  RETURNS TABLE(event_id uuid, signature text)
ingest_alert_outbox_signature(source_id uuid, target_event_id uuid) RETURNS text
ingest_write_parking_observation(
  target_lot_id uuid, target_building_id text, target_device_id text,
  target_event_id text, occupancy integer, observation_at timestamptz,
  written_at timestamptz, expected_version integer) RETURNS boolean
```

`ingest_count_rejection` só aceita as cinco categorias048. Deriva dia UTC, incremento de total e `last_at` no PostgreSQL. Categorias pré-validação exigem building vazio; `CONTENT_CONFLICT`/`RETAINED_REPLAY` exigem building existente, com origem validada pelo pipeline. `UNKNOWN_SOURCE` mantém o bucket vazio. Inputs diferentes provocam `22023`; nenhum dado do pacote é gravado.

`ingest_lock_parking_lot` exige login observacional real, IDs não vazios, device do mesmo condomínio e lot.sensor_id associado ao device. Trava `FOR UPDATE OF lot` e retorna o ID, ou nenhuma linha quando não há associação. Não aceita alvo arbitrário de outro sensor e não escreve nada. O pipeline já segura device/gateway e validou enabled/active antes de chamar; o helper preserva a associação e a ordem device → lot, sem criar UPDATE grant. O adapter faz SELECT normal pela identidade retornada na mesma transação.

`ingest_persist_alert` valida source ID/building não nulos, existência do building, exatamente um device/gateway habilitado de origem no mesmo condomínio e regra, quando presente, do mesmo building e global ou vinculada ao device de origem. Não exigir building ativo neste produtor comum: comunicação/offline têm contrato válido em condomínio inativo, enquanto telemetria/consumo já aplicam o filtro ativo em seus caminhos. Não acrescentar uma exigência de gateway habilitado ao alerta offline de device que hoje só exige device habilitado. Não aceitar rule em alerta gateway. Severity é enum; type/message/triggered value/timestamps continuam derivados do algoritmo TS existente. Insere os mesmos campos esperados pelo `persistAlert`, força OPEN e todos os campos de ação humana a NULL, compara RETURNING e releitura, chama `notification_enqueue_alert(source_id)` privado na mesma transação, confirma fonte de novo e retorna event ID + assinatura. Não tornar o enqueue original público e não conceder funções de worker à ingestão. Chamadas duplicadas ao produtor não alteram fonte existente; uniqueness deve rejeitar a duplicação.

`ingest_alert_outbox_signature` verifica relação persistida event → alert → building/source, monta exatamente o snapshot ordenado usado hoje em TS (evento, deliveries, witnesses e features) e retorna SHA-256 opaco, sem rows, mensagem, token de claim ou metadados de tentativa. Ausência/vínculo errado dá `40001`. Não faz claim nem revalidate de worker. O valor inicial e o final são comparados antes do commit; até esse momento o worker não vê a transação. Esse wrapper substitui a consulta direta das quatro tabelas e preserva a prova contra triggers tardios que modificam o resultado de enqueue. O produtor ainda confirma alert/raw/receipt/usage/heartbeat após escritores posteriores.

`ingest_write_parking_observation` confirma/reobtém o lock adquirido por `ingest_lock_parking_lot`, IDs, vínculo do sensor, versão atual igual à esperada e receipt/raw persistidos do mesmo event/building/device para `parking_occupied`, qualidade GOOD e valor numérico igual à occupancy. Escreve somente occupied/source SENSOR/observed_at/updated_at/version+1; o CHECK de capacity permanece ativo. Não troca sensor, capacity, stale timeout ou vehicle type. A decisão temporal e de aceitação continua em `acceptParkingReading` em TS, sob o lock do helper de leitura, antes de qualquer escrita. Insere auditoria com user NULL, ator SYSTEM, ação `PARKING_SENSOR_UPDATED`, resource derivado do lot e metadata fechado derivado do before/after e da origem; confirma atualização e auditoria antes de retornar true. Entrada sem correspondência é false; persistência silenciosamente ignorada/reescrita é `40001`.

O trigger `app_parking_target_guard()` é SECURITY INVOKER e chama `app_current_user_id()` mesmo numa UPDATE operacional. Executar a UPDATE pelo helper owner resolve a ACL dessas chamadas; limpar e restaurar `app.user_id` localmente, com restauração também em EXCEPTION, mantém o ramo administrativo já existente. Essa limpeza não concede autoridade nem substitui o guard de login PostgreSQL. Não mudar as branches humanas ou conceder helpers de RBAC à role de ingestão.

## 7. Acesso físico: transições fechadas e lock externo

`packages/db/src/access-service-operations.ts` é a única fronteira de TS para comandos. Nenhuma query de DML de `gate_commands` ou `audit_logs` permanece em `services/ingest/src/access/dispatcher.ts`.

```ts
export type AccessDispatchCandidate = {
  id: string; buildingId: string; gatewayId: string; gateId: string; deviceId: string;
  createdAt: Date; expiresAt: Date; gateKind: "GARAGE" | "PEDESTRIAN" | null;
};
export type PendingFailureCode = "NO_LIVE_CONNECTION" | "BEFORE_CONNECTION" | "FEATURE_PAUSED";
export type PublishFailureCode = "DISCONNECTED" | "OFFLINE_QUEUE" | "DEADLINE" | "BEFORE_CONNECTION" | "SEND_TIMEOUT" | "PUBLISH_FAILURE";
export function nextPendingAccess(tx: AccessServiceTransaction): Promise<AccessDispatchCandidate | null>;
export function expireAccessCommands(tx: AccessServiceTransaction): Promise<number>;
export function failPendingAccess(tx: AccessServiceTransaction, id: string, reason: PendingFailureCode): Promise<boolean>;
export function markAccessSent(tx: AccessServiceTransaction, id: string): Promise<string | null>;
export function failAccessPublish(tx: AccessServiceTransaction, id: string, reason: PublishFailureCode): Promise<boolean>;
export function applyAccessAck(tx: AccessServiceTransaction, ack: AccessAck): Promise<boolean>;
```

SQL, guard de login real e EXECUTE exclusivo de `predioon_access_service`:

```sql
access_service_next_pending() RETURNS TABLE(
  id uuid, building_id text, gateway_id text, gate_id uuid, device_id text,
  created_at timestamptz, expires_at timestamptz, gate_kind text)
access_service_expire_commands() RETURNS integer
access_service_fail_pending(target_command_id uuid, reason_code text) RETURNS boolean
access_service_mark_sent(target_command_id uuid) RETURNS text
access_service_fail_publish(target_command_id uuid, reason_code text) RETURNS boolean
access_service_apply_ack(target_command_id uuid, target_building_id text,
  target_gateway_id text, target_gate_id text, target_device_id text, ack_result text)
  RETURNS boolean
```

`next_pending` seleciona exclusivamente PENDING, ordena `created_at,id`, usa `FOR UPDATE SKIP LOCKED` e mantém lock até o commit da transação chamadora. Não muda status e não cria reserva durável; gateKind é projetado do gate atual. `expire_commands` deriva clock PostgreSQL após locks e muda exclusivamente PENDING/SENT vencidos para EXPIRED, com auditoria derivada e confirmação de efeitos. Não escreve identidades, actor, created/expires ou estados terminais.

O dispatcher conserva `dispatcherTail` e duas transações simultâneas: a externa segura `pg_advisory_xact_lock_shared(814772,1)` desde antes da seleção até depois da publicação; a interna trava/decide comando e faz commit SENT antes de MQTT. Nenhum helper remove essa barreira externa. `access_service_mark_sent` chama o `app_mark_access_sent` já existente como owner: ator vem de requested_by persistido, device → gateway → gate são travados, capacidades/ciclo de vida/features/clock são relidos depois das esperas. Não duplicar RBAC em TS ou em outra função SQL e não usar `withUserContext` no dispatcher. O wrapper, quando recebe uma razão canônica de recusa e o comando ainda está PENDING, grava FAILED + auditoria na mesma transação; não aceita razão nem usuário enviados pelo cliente.

Falhas de conexão/preconexão/feature aceitam somente os códigos fechados acima. Falha após publicar só muda SENT para FAILED; não interfere numa confirmação que já venceu a corrida. Mapear erros do publisher a mensagens públicas fixas, sem persistir `error.message` arbitrária. `access/publish.ts` mantém seus predicados atuais e produz erro com código fechado para esse mapeamento, sem alterar opções MQTT, timeout ou tentativas.

ACK é filtrado em TS por tamanho, parse, `AccessAckSchema` e identidade do tópico. O helper volta a verificar, sob lock, command ID + building/gateway/gate/device persistidos, estado SENT e prazo futuro. `target_gate_id` é text para ACK com gate malformado virar negativa, sem cast UUID de valor não validado. Valida gateway habilitado e gate/parents associados ao mesmo building. Não usa GUC/actor de input nem recria autorização humana depois de uma atuação já enviada. Deriva ACKNOWLEDGED/FAILED, acknowledged_at e razão canônica do resultado EXECUTED/REJECTED; grava auditoria SYSTEM com requested_by do pedido, mas não altera esse ator. Revalidar o prazo com `clock_timestamp` no statement final depois de esperas de parents/audit; se expirou, nenhum ACK ou audit de sucesso é confirmado. Confirmar UPDATE e releitura para detectar skip/rewrite e triggers posteriores. Duplicata, ACK de PENDING/terminal/vencido ou alvo estrangeiro retorna false sem efeito.

## 8. Invariantes que não mudam

- Telemetria QoS1 só recebe PUBACK depois de finalizar a transação; falha fecha o stream e permite reentrega pelo broker. Callback antigo não ACKa uma conexão nova. QoS0 de entrada não ganha essa garantia.
- `retain` de telemetria é histórico uma vez: sem heartbeat, consumo, estacionamento, alertas/outbox ou SSE. Dedup é `(building,device,eventId)`; corpo conflitante não muda o primeiro; receipt anterior a048 permanece sem fingerprint.
- Validação UTF-8/schema/tópico/tamanho e futuro60s permanecem; freshness de regra é300s; leitura histórica válida continua disponível.
- Feature lock814772/1, ALL de leituras e ANY de comunicação, global/local/runtime e fronteiras de pause/resume permanecem. Hardware saudável atualiza contato mesmo quando módulos estão pausados.
- Consumo mantém cálculo TS, timezone do building, baseline depois de resume, incompletude do dia e seleção do histórico adaptativo. Perfis são serializados sem conceder alteração de configuração.
- Source+alert+outbox têm uma única transação. `PersistenceChecks` continua conferindo o último estado esperado depois de todos os escritores. Nenhum envio HTTP é feito pelo produtor.
- SSE é pós-commit, com revalidação de feature/propriedade do alerta. Falha é conveniência perdida; não reexecuta a ingestão ou o enqueue.
- Comando físico usa QoS0, retain false, queueQoSZero false, TTL original até15s, sem retry, replay ou fila offline. Crash depois de SENT e antes de publish pode perder uma abertura; não a reenvia. Expiração ou recusa exige novo pedido humano.

## 9. Provisionamento, migrations, configuração e restore

Acrescentar `DATABASE_URL_INGEST → predioon_ingest` e `DATABASE_URL_ACCESS_SERVICE → predioon_access_service` a `runtimeRoles`. Validar owner+seis URLs completamente antes de abrir cliente ou mudar qualquer senha; host/porta/banco/role/parâmetros devem corresponder ao owner no CLI administrativo. Alterar senhas das seis roles dentro da transação existente. Erro no último papel deixa todas as credenciais anteriores intactas; provar com autenticação antes/depois, sem registrar hashes de senha. O provisionamento não concede privilégios: exige migration e catálogo já seguros.

Adicionar ambas à lista de hardening do ledger em `infrastructure-migrations.ts`; não editar SQL001–051. A migration nova é integral e atômica: duas roles, ACL/RLS/defaults, helpers de ambas cargas. Não publicar um runtime de observação restrita que ainda deixe acesso em owner. Commits locais podem separar adapters de observação e acesso, mas a release que migra o serviço inclui tudo e verifica ambos os logins.

Compose produtivo injeta somente as duas URLs e MQTT/operacionais no container ingest, com NODE_ENV production; não injeta DATABASE_URL nem credenciais de outra carga. Setup administrativo recebe owner+seis credenciais explicitamente para provisionar. Os seis papéis não se tornam credenciais do container API por conveniência; passá-los apenas ao CLI administrativo de provisionamento. Atualizar exemplos públicos, script de setup local, testes de contrato de deployment, guias de migrations/deploy/notificações e CI.

Restauração deve comparar conteúdo, RLS, ACLs de tabela/coluna, defaults, ownership e funções. O filtro de funções em `backup-restore.test.ts` inclui hoje somente `app_`, `identity_`, `notification_`; acrescentar `ingest_`, `access_service_`, `service_`. Contagens evoluem de51 para52 migrations e de4 para6 roles. Roles são estado do cluster: restaurar em outro cluster físico vazio exige criar as seis roles NOLOGIN antes do pg_restore, aplicar ACL de database, restaurar serialmente Timescale, verificar catalogue e provisionar depois. Executar os testes reais tanto no mesmo quanto em outro cluster, incluindo novas operações positivas e negativas; mocks e um banco distinto no mesmo cluster não provam isolamento de credenciais.

A rotina de rollout continua parar produtores/worker → confirmar término → backup e ensaio de restore → aplicar migration atômica → provisionar/verificar → iniciar runtime compatível preservando MQTT_CLIENT_ID e sessão durável. Um produtor externo exige drenagem/stop verificáveis no runbook. Falha em stop, backup/restore, migration, provisionamento ou verificação impede startup. Não voltar ao runtime antigo com owner como fallback automático; após falha, manter serviço parado e usar recuperação administrativa registrada. Este recorte entrega contrato e ensaio local/CI, não autoriza implantação real.

## 10. Provas exigidas para encerrar o recorte

| Família | Evidência necessária |
|---|---|
| Credenciais/startup | URLs obrigatórias em dev/test/prod, nenhum owner fallback, valores secretos nunca em erro; login real, owner mascarado via SET ROLE/SESSION AUTHORIZATION e memberships de ida/volta rejeitados; MQTT/timers não iniciam se qualquer role falha |
| ACL/RLS/identidade | Conexões autenticadas das duas roles; positivo por operação; negativas DDL/configuração/segredos/humanos/comercial/outbox/ledger; GUC PLATFORM_ADMIN/user forjado não amplia autoridade; role não tem ownership, memberships ou default grants excessivos |
| Observação | Integrar pipeline/receipt-policy/water/sensors/usage/parking/offline/features reais usando role de ingestão; todas as provas048 e lock de perfil sem UPDATE da configuração |
| Atomidade/trigger | Produtores038 com role real: BEFORE skip, BEFORE/AFTER rewrite, alteração tardia de source/heartbeat/outbox/witness/cursor; rollback de raw/receipt/usage/alert/audit e não confirmação MQTT antes do commit |
| Físico | Dispatcher/ACK com role real; autoridade corrente034 preservada, SKIP LOCKED/conexão/pause/audit wait, ACK estrangeiro/errado/vencido/terminal, corrida publish/ACK, crash SENT sem replay, QoS0/retain/offline queue sem alterações |
| Grafo de imports/env | Caminho transitivo desde `src/index.ts`, ambos exports de DB e helpers; alias de package, relativo, reexport, require e dynamic literal; import calculado não resolvido é erro no grafo produtivo; nenhuma abertura/leitura de owner no processo; CLI/fixtures separados e loaders existentes compatíveis |
| Migrations/provision/restore | Falha052 reverte roles/ACL/ledger; reexecução do runner não reaplica SQL; credenciais inválidas não abrem conexão; falha tardia reverte seis senhas; restore mesmo/outro cluster preserva dados/ACL/RLS/defaults/helpers e novos logins |
| Broker e publicação | Testes MQTT existentes e ensaio broker real com banco, sessão durável e PUBACK; catálogo antes/depois em cluster físico exclusivo; CI dedicado de roles e produtores sem skips |

Fixtures owner servem somente para preparar, injetar falhas e observar resultado; o handler sob teste deve autenticar com a nova role. Substituir mocks que hoje interceptam `@predioon/db` pelo entrypoint efetivamente usado mantém testes unitários, mas não conta como prova SQL. Testes que alteram roles cluster-wide executam em cluster físico descartável próprio, sequenciais e sem compartilhar credenciais com API/navegador.

## 11. Limites e critérios de aceite

Não há medição de capacidade nem extração de serviços neste recorte. Não se promete identidade de publisher autenticada por pacote, entrega durável de SSE, resultado físico sem ACK, inexistência de atraso no broker ou homologação de firmware/produção. O processo compartilha as duas credenciais; a redução de privilégio não torna uma mensagem MQTT incapaz de alcançar o código de acesso se o processo for comprometido.

Aceite requer: zero conexão/import/env owner no grafo produtivo, ambas identidades verificadas antes de qualquer side effect, matriz de negativos conferida em PostgreSQL real, regressões existentes preservadas, migration/provisionamento/restore atômicos demonstrados, Compose e runbooks coerentes, evidência com fonte/comandos/totais/skips/catalogue e revisão. Só então atualizar o progresso de2B.5 para este recorte de ingestão/acesso; workers restantes, capacidade, firmware e operação real continuam explícitos no plano do produto.
