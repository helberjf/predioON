# TDD — Prédio ON

Documento de design técnico. Revisão de 30/09/2026. Complementa o [PRD](PRD.md): aqui está **como**
o sistema é construído, por quê cada decisão foi tomada e o que muda na evolução em andamento.

Fontes: o código desta árvore, a
[arquitetura de produto de 27/09/2026](superpowers/specs/2026-09-27-arquitetura-produto-design.md),
o [tracker de execução](superpowers/plans/2026-09-27-product-execution.md) e o
[plano de 29/09/2026](superpowers/plans/2026-09-29-rbac-domain-migration.md).

As marcas **Entregue**, **Em execução** (linha `codex/product-platform`, ainda sem commit) e
**Planejado** têm o mesmo significado do PRD.

## 1. Visão de arquitetura

Estado entregue:

```text
Sensores / medidores / controladores
   ↓ RS485 · Modbus RTU · entrada digital
Gateway embarcado (polling local, buffer, credencial própria)
   ↓ MQTTS (8883 em produção)
EMQX
   ↓ QoS 1, sessão durável
services/ingest  ── valida (Zod) · checa funcionalidade · deduplica · grava
   ↓                 contabiliza consumo · avalia regras · atualiza liveness
PostgreSQL 16 + TimescaleDB  ──NOTIFY──→  apps/api (LISTEN) ──SSE──→ painéis
   ↑
apps/api (Express 5) ←── HTTPS ──  admin-web · building-web · resident-web
```

Destino aprovado: a mesma API central modular, com a ingestão reduzida a recepção durável e o
processamento movido para workers por carga (telemetria, comandos, notificações, jobs), todos
sobre o banco central. Nenhum aplicativo fala com banco ou broker diretamente.

| Processo | Responsabilidade | Estado |
|---|---|---|
| `api` | HTTP, autenticação da requisição, autorização e streams | Entregue |
| `ingest` | Conexão MQTT, validação e persistência da entrada | Entregue (hoje também processa) |
| `worker-telemetry` | Leituras, projeções de estado atual, consumo e alertas | Planejado |
| `worker-commands` | Publicação de comandos e ciclo de confirmação | Planejado |
| `worker-notifications` | Push e integrações de mensagem | Planejado |
| `worker-jobs` | Agendamentos, automações, relatórios e rotinas | Planejado |

## 2. Repositório

pnpm workspaces, TypeScript em todos os pacotes, ESM.

```text
apps/api            API Express, autenticação e módulos por domínio
apps/admin-web      Painel da plataforma (Vite + React 19)
apps/building-web   Painel do síndico
apps/resident-web   Portal do morador (web adaptada a celular)
services/ingest     MQTT, pipeline, regras, consumo, acessos e simuladores
packages/db         Schema Drizzle, contexto RLS, migrações e seeds
packages/shared     Contratos Zod, regras puras e catálogo de funcionalidades
packages/ui         Componentes, autenticação, cliente HTTP e estado das telas
infrastructure      Compose, SQL numerado, EMQX, Caddy e deploy
```

Em execução: `packages/contracts` (DTOs públicos versionados) e `packages/api-client` (cliente HTTP
portátil, sem dependência de navegador) já existem na linha `codex/product-platform`, com
exportações de compatibilidade a partir de `shared`/`ui`.

Destino: `packages/domain` (casos de uso sem Express, MQTT, React ou Drizzle), `packages/runtime`
(servidor, logs, métricas, execução de jobs), `packages/ui-web`, `packages/ui-mobile`,
`apps/resident-mobile` e `apps/operations-mobile`. Regras de dependência validadas no CI:
aplicativo nunca importa banco ou credencial; `domain` não conhece transporte; `contracts` não
exporta schema interno do banco.

## 3. Decisões de arquitetura

| # | Decisão | Por quê | Alternativa recusada | Consequência |
|---|---|---|---|---|
| 1 | RS485/Modbus com gateway embarcado | Sensores industriais já falam Modbus; o gateway faz polling local e guarda leitura na queda de link | LoRaWAN: mais rádio para depurar, payload apertado e sem ganho no prédio | Requer computador embarcado, não conversor serial puro |
| 2 | Express 5 + TypeScript, módulos por domínio | Equipe conhece Express; sem camada de DI para aprender | Nest: estrutura imposta e curva desnecessária neste tamanho | Disciplina de fronteiras é responsabilidade do time, não do framework |
| 3 | PostgreSQL + TimescaleDB em um banco central | Hypertable dá série temporal sem segundo banco; transação local mantém histórico, alerta e auditoria coerentes | Banco por domínio: coordenação distribuída antes de necessidade provada | Índices únicos de hypertable têm restrição de particionamento: dedup fica em tabela normal |
| 4 | Drizzle ORM | SQL explícito, tipos do schema, sem mágica de migração | Prisma: geração e runtime próprios | Migrações são SQL versionado escrito à mão |
| 5 | RLS com role **não-dona** (`predioon_app`) | Dono de tabela ignora política: sem isso o RLS não protege nada | Só filtro na aplicação: um `WHERE` esquecido vaza condomínio | Toda consulta autenticada passa por `withUserContext` |
| 6 | Zod compartilhado como contrato | Mesmo schema valida payload do gateway, corpo HTTP e tipos do cliente | Validação duplicada por camada | Mudança de contrato falha no typecheck de todos os consumidores |
| 7 | Idempotência por `eventId` em `ingest_events` | QoS 1 é ao menos uma vez; sem trava, uma reentrega duplica consumo e alerta | Confiar no broker | Retenção da dedup precisa cobrir a janela de replay aceita |
| 8 | Tempo real por `NOTIFY`/`LISTEN` + SSE | O dado já vive no banco; não vale um segundo broker para atualizar tela | WebSocket com Redis pub/sub | `NOTIFY` tem payload de 8 KB e não é fila durável — trabalho obrigatório não passa por ele |
| 9 | JWT curto + refresh opaco com hash | Dump de banco não entrega sessão válida | Sessão em tabela consultada a cada requisição | Revogação depende de checagem de conta/vínculo, não do TTL |
| 10 | Funcionalidades em dois níveis com versão otimista | Operador precisa pausar um recurso de um condomínio sem tocar em outro | Uma flag global | Toda leitura sob `pg_advisory_xact_lock_shared`; mudança toma o exclusivo |
| 11 | Comando físico sem replay (QoS 0, `retain: false`, fila de saída desativada, prazo) | Portão reenviado depois é risco de segurança, não conveniência | Retry genérico de fila | Perda de conexão vira falha explícita, nunca reenvio |
| 12 | Fila durável no PostgreSQL (destino) | Menos infraestrutura para operar na primeira VPS; contrato atrás de interface | Redis/Rabbit/Kafka desde já | Precisa de `FOR UPDATE SKIP LOCKED`, lease e quota por tenant |
| 13 | RBAC explícito no lugar de `hasAtLeast` (em execução) | Manutenção e suporte não cabem numa hierarquia linear | Novo degrau na ordem de papéis | Decisão passa a exigir sujeito + ação + escopo + recurso + condição |
| 14 | React Native **sem Expo** para os dois apps | Módulos nativos e configuração própria por produto | Expo | Build exige macOS, certificados e contas de loja |

## 4. Modelo de dados

`building_id` é a fronteira canônica de isolamento; não existe `tenant_id` paralelo.
`organizations` agrupa comercialmente e **não** concede acesso operacional.

| Domínio | Tabelas |
|---|---|
| Identidade | `users`, `refresh_tokens` |
| Tenancy | `organizations`, `buildings`, `memberships` |
| Campo | `gateways`, `devices`, `device_metrics` |
| Séries | `ingest_events` (dedup), `telemetry` (hypertable) |
| Monitoramento | `monitoring_profiles`, `usage_cursors`, `daily_usage` |
| Alertas | `alert_rules`, `alerts` |
| Acessos | `gates`, `gate_commands` |
| Vagas | `parking_lots` |
| Convivência | `notices`, `notice_schedules`, `occurrences`, `occurrence_events`, `common_areas`, `reservations` |
| Contas | `financial_reports` |
| Suporte | `support_hosts`, `support_requests` |
| Funcionalidades | `global_feature_settings`, `building_feature_settings`, `feature_runtime` |
| Auditoria | `audit_logs` |

Detalhes e ERD em [DATABASE_MODEL.md](DATABASE_MODEL.md).

**Telemetria.** `telemetry` é hypertable; o valor original fica em `value` e, quando numérico ou
booleano, também em `numeric_value` para limiar e agregação. Índices por `(device_id, time desc)`,
`(building_id, time desc)` e `(metric, time desc)`.

**Dinheiro** em centavos (`financial_reports`); custo de consumo é estimativa identificada como
tal, separada de faturamento.

**Versão otimista** em registros editáveis (funcionalidades, contas) para detectar alteração
concorrente em vez de sobrescrever.

Em execução (migrações `013`–`015`): `sessions` com famílias de refresh; catálogo de permissões,
`roles`, `role_bindings`, `support_grants`, `blocks`, `units`, `teams` e chaves compostas por
condomínio; roles de runtime separadas. Planejado: `iot_inbox`, `outbox_events`,
`event_deliveries`, `jobs`, `device_latest_state`, `assets`, `work_orders`, `automation_rules` e
versões, `plans`/`subscriptions`, `notifications` e preferências.

### Migrações

`infrastructure/NNN-*.sql`, numerados e **aditivos**, aplicados em ordem por
`packages/db/src/apply-infrastructure.ts` (`pnpm db:infra`) com `ON_ERROR_STOP=1`; todos os
scripts são idempotentes e podem ser reaplicados.

| Arquivo | Conteúdo |
|---|---|
| `001` | TimescaleDB, hypertable, índices, helpers de contexto e políticas RLS |
| `002` | Role `predioon_app` não-dona, grants e revogações (`ingest_events` negada, `telemetry` só leitura) |
| `003`–`006` | Reservas, ocorrências, inserção de auditoria, política de leitura de telemetria |
| `007`–`009` | Monitoramento/consumo, acessos, vagas e avisos |
| `010`–`012` | Suporte remoto, governança (transparência/contas) e controle de funcionalidades |
| `013`–`015` | **Em execução:** sessões, fundação RBAC/tenancy e roles restritas de runtime |

O bootstrap local usa `drizzle-kit push`; para produção o fluxo é substituído por migrações
registradas, com runner exclusivo, lock, checksum e histórico (5/5 testes na etapa em execução).
Nunca executar reset ou seed de demonstração sobre dados reais.

## 5. Contrato MQTT

```text
predio/{buildingId}/device/{deviceId}/telemetry     genérico, schemaVersion 1
predio/{buildingId}/caixa_agua/{deviceId}/telemetria  compacto da caixa d'água
predio/{buildingId}/gateway/{gatewayId}/status      retido + last will
predio/{buildingId}/gateway/{gatewayId}/access/{gateId}/command|ack
```

Definição única em `packages/shared/src/topics.ts` e `telemetry.ts`. O parser devolve `null`
quando o tópico não cumpre o formato, então a mensagem é descartada sem exceção. Curinga e NUL em
identificadores são rejeitados.

**O tópico é a identidade** — é ele que a ACL do broker restringe. O corpo é dado do equipamento.
A validação cruza tópico × payload, checa o intervalo e a unidade declarados no catálogo de
sensores e preserva métricas específicas de fabricante que não estejam no catálogo.

| Situação | Resultado |
|---|---|
| Payload fora do schema | Descarte com log |
| `buildingId`/`deviceId` divergente do tópico | Descarte |
| Dispositivo não cadastrado, desabilitado, ou prédio/gateway inativos | Descarte |
| `timestamp` mais de 60 s no futuro | Descarte |
| Mesmo `eventId` reenviado | Gravado uma vez |
| Funcionalidade do recurso pausada | Leitura daquele recurso descartada; o resto da mensagem segue |
| Gateway sem publicar além do timeout | `OFFLINE` e alerta de comunicação |

## 6. Ingestão

`services/ingest/src/index.ts` roteia por sufixo do tópico: `/ack` → despachante de acessos,
`/telemetry`/`/telemetria` → telemetria, `/status` → status do gateway. O cliente usa
`clean: false` (sessão durável), `queueQoSZero: false`, reconexão a cada 2 s e
`rejectUnauthorized: true`; uma mensagem ruim nunca derruba o processo.

`handleTelemetry` roda **uma transação** por envelope:

1. Normaliza (o contrato compacto da caixa d'água vira várias leituras genéricas).
2. Descarta o envelope se alguma leitura está mais de 60 s no futuro.
3. `lockFeatures` — trava compartilhada de configuração durante todo o efeito.
4. `SELECT ... FOR UPDATE` no dispositivo: serializa as mensagens do mesmo sensor, para que
   entregas concorrentes compartilhem a mesma checagem de cooldown.
5. Confirma prédio ativo e gateway habilitado.
6. Por leitura: checa a funcionalidade e a data de retomada; insere `ingest_events`
   (`onConflictDoNothing`) como trava de idempotência; grava `telemetry`; contabiliza consumo;
   aplica vagas; avalia regras quando a qualidade é `GOOD`.
7. Atualiza `status`/`lastSeenAt` do dispositivo e do gateway — **um pacote válido prova
   transporte mesmo com todos os módulos pausados**.
8. Depois do commit, publica tempo real e dispara webhook dos alertas criados.

Publicar fora da transação evita anunciar o que pode não ter sido gravado; a falha do tempo real
é registrada e ignorada, porque perder um quadro de tela não pode desfazer uma gravação.

**Ponto conhecido a corrigir (etapa 3):** o listener `message` inicia a Promise sem aguardá-la no
fluxo de confirmação MQTT. QoS 1 com `clean: false` não prova commit no PostgreSQL. O destino é
persistir na inbox antes de confirmar o transporte e provar, em teste com interrupção do
processo, a fronteira entre commit e ACK.

**Sweep de comunicação.** `offline-sweeper` marca gateway e dispositivo sem publicar além do
timeout configurado e abre alerta. Sensor que repete o mesmo valor **não** é o mesmo caso que
sensor que parou de publicar: heartbeat é comunicação, leitura antiga é frescor do dado.

## 7. Consumo e análise

`accountUsage` roda dentro da transação da leitura, sob o lock do dispositivo:

- `usage_cursors` guarda a última amostra válida por perfil; `advanceUsage` calcula a diferença,
  divide por dia do **fuso do condomínio**, aplica `maxGapSeconds` e tarifa.
- `daily_usage` acumula quantidade, custo estimado, segundos cobertos, resets e amostras; o dia
  afetado por retomada entra como `incomplete`.
- Cursor anterior à retomada é ignorado: o medidor estabelece nova referência e a diferença
  acumulada durante a pausa não vira consumo.
- Limites diário, de custo e de ciclo contínuo emitem no máximo um alerta por tipo por dia.
- Modelo adaptativo: até 28 dias anteriores, descartando dias incompletos, com reset ou cobertura
  abaixo de 80% do dia; `learnReference` aprende mediana e variação robusta e `assessDeviation`
  compara com o dia corrente. Histórico reprocessado treina o modelo mas **não** alerta: leitura
  com mais de 5 minutos, ou qualidade diferente de `GOOD`, não gera aviso.

## 8. Acessos e comandos físicos

Máquina de estados de `gate_commands`:

```text
PENDING ──despacho──→ SENT ──ACK válido──→ ACKNOWLEDGED
   │                    │
   ├─ sem conexão ──────┴─→ FAILED
   └─ prazo vencido ──────→ EXPIRED
```

- Prazo de 15 s (`ACCESS_COMMAND_TTL_MS`), throttle de 5 s por portão, comunicação exigida nos
  últimos 60 s (`ACCESS_LIVE_MAX_AGE_MS`) para gateway **e** controlador.
- Disponibilidade calculada por função pura (`accessAvailability`) e a recusa nomeia a causa.
- Despacho serializado por `dispatcherTail` e `FOR UPDATE SKIP LOCKED`: uma reivindicação por
  comando mesmo com vários workers.
- Comando criado antes da conexão atual vira `FAILED` com motivo — nunca é reenviado depois.
- Funcionalidade pausada no momento do pedido cancela o pendente com motivo explícito.
- ACK é validado por `validAccessAck`: estado `SENT`, prazo vigente e igualdade de comando,
  condomínio, gateway, portão e dispositivo.
- Idempotência do pedido por `requestId` (UUID): repetir não aciona duas vezes.
- Tudo auditado: pedido, envio, confirmação, falha e expiração.

Regra que não muda com os workers: **o módulo de comandos é o único caminho de atuação**, e a
política de retry de jobs não se aplica a ele.

## 9. API

`apps/api/src/app.ts` monta, em ordem: CORS com origens configuradas, `express.json` com limite de
1 MB, rotas públicas (`/`, `/health`, `/auth`, `/internal/mqtt`), `/events` (autentica-se sozinha),
`authenticate` e, atrás dele, os módulos de domínio; por fim `notFoundHandler` e `errorHandler`.

| Camada | Arquivo | Papel |
|---|---|---|
| Autenticação | `auth/middleware.ts` | Valida o JWT e popula `req.auth` |
| Autorização | `auth/middleware.ts`, `auth/features.ts`, `auth/governance.ts` | Papel, vínculo com o condomínio e disponibilidade da funcionalidade |
| Contexto de banco | `packages/db/src/context.ts` | `withUserContext` abre transação e define `app.user_id`/`app.role` |
| Validação | `http/validate.ts`, `http/params.ts` | Zod no corpo, na query e nos parâmetros |
| Erros | `http/errors.ts`, `http/error-handler.ts` | `HttpError` com status; resposta `{ error, details }`; erro desconhecido vira `500` genérico |
| Paginação | `http/pagination.ts` | `limit` 1–200 (padrão 50) e `offset` |

Convenções em vigor: bloqueio por funcionalidade retorna `403` com `details.code =
FEATURE_DISABLED`, **depois** da autorização, para não revelar existência de recurso a quem não
pode vê-lo; conflito de versão retorna `409` com `FEATURE_VERSION_CONFLICT`; código SQLSTATE do
PostgreSQL é extraído da cadeia de `cause` por `pgErrorCode` para traduzir violação de restrição.

Em execução: prefixo `/v1` com contratos documentados, rotas atuais preservadas por adaptador,
código de erro estável com identificador de correlação e chave de idempotência em operações com
risco de duplicação. As rotas `/v1/tenancy` e `/v1/authorization` já existem na linha em execução.

**Tempo real.** `modules/events/bus.ts` faz um único `LISTEN` por processo e distribui em memória;
`/events/stream` aceita `?access_token=` porque `EventSource` não envia cabeçalho — é a **única**
rota que aceita, e só com access token curto. Cada evento é filtrado pelo vínculo do assinante e
pela disponibilidade da funcionalidade antes de sair. Destino: autenticação de stream sem
credencial durável em log, e reconsulta após reconexão.

## 10. Autenticação e autorização

Hoje: Argon2 (`@node-rs/argon2`) para senha; access token HS256 de 15 min com `sub`, nome, e-mail,
papel e vínculos; refresh opaco de 48 bytes, guardado apenas como SHA-256, com validade de 30
dias e rotação; papel avaliado por `hasAtLeast` mais o vínculo do condomínio; conta inativa ou
vínculo revogado bloqueia a operação seguinte mesmo com token válido.

Limitações reconhecidas e o que a etapa 2 muda:

| Hoje | Destino | Estado |
|---|---|---|
| HS256 com segredo compartilhado | Ed25519 com `kid` e rotação; só identidade assina | Em execução (4/4 testes) |
| Rotação de refresh sem trava | Consumo atômico com detecção de reutilização e invalidação da família | Em execução (9/9 testes; diagnóstico reproduziu duas renovações aceitas em 4 de 5 tentativas antes da correção) |
| Token em `localStorage` | Cookie `HttpOnly`/`Secure` com CSRF na web; Keychain/Keystore no mobile | Planejado (2C) |
| Papel ordenado | Capacidade: sujeito + ação + escopo + recurso + condição | Em execução (2B) |
| Sem MFA | MFA para plataforma e ações privilegiadas | Planejado (2C) |

## 11. Defesa em camadas no banco

1. **Autorização na API** — papel, vínculo, capacidade e disponibilidade.
2. **Contexto transacional** — `set_config('app.user_id'/'app.role', ..., true)` vale só naquela
   transação.
3. **RLS** — políticas leem o contexto por `app_current_user_id()`, `app_is_platform_admin()` e
   `app_can_access_building()`; esta última é `SECURITY DEFINER` com `search_path` fixo para
   consultar vínculos sem recursão de política.
4. **Privilégios** — `predioon_app` não é dona: `ingest_events` é negada por completo e
   `telemetry` é somente leitura para a API (append é da ingestão); auditoria é de acréscimo.
5. **Separação de conexões** — `DATABASE_URL` (dona: migração, ingestão, seed) e
   `DATABASE_URL_APP` (API). Em execução: `DATABASE_URL_IDENTITY` e `DATABASE_URL_BROKER_AUTH`,
   retirando a credencial de dona dos processos HTTP (migração `015`).

`buildingId` vindo do cliente é dado validado, nunca prova de autorização. Política padrão é
negar, com `USING` e `WITH CHECK` por operação.

## 12. Controle de funcionalidades

Catálogo de 23 chaves com grupo e dependências em `packages/shared/src/features.ts`, em ordem
topológica. `resolveFeatures` aplica: global desligado é **teto**; preferência local sobrevive à
mudança global; dependência não atendida bloqueia o dependente.

Mapeamentos puros ligam o domínio ao catálogo: `metricFeature` (métrica → recurso),
`deviceFeatures` (tipo de dispositivo → recursos), `kindFeature` (consumo), `gateFeature` e
`parkingFeature`. É por eles que uma mensagem mista tem só a parte pausada descartada.

Concorrência: leitores tomam `pg_advisory_xact_lock_shared(814772, 1)` e o mantêm durante os
efeitos; a alteração administrativa toma o exclusivo. Assim uma pausa não pega um lote pela
metade. `feature_runtime.resumedAt` é o marco da retomada: leitura anterior a ele é recusada, para
que uma fila não recomponha o período pausado.

Alteração exige justificativa de 3 a 1.000 caracteres e versão vigente; grava auditoria
`FEATURE_CONFIGURATION_CHANGED` e notifica as telas, que também reconciliam ao recuperar foco e a
cada 30 s.

## 13. Interfaces web

Três apps Vite/React 19 com Tailwind, sobre `packages/ui`: cliente HTTP com renovação de sessão,
`auth.tsx`, `use-resource`/`resource-state` (carregando, erro, vazio, dados), `sse.ts`,
`features.tsx` para bloquear módulo indisponível, e painéis compartilhados (monitoramento,
acessos, vagas, ocorrências, transparência, financeiro).

Regras de tela: menu, atalho e cartão acompanham a disponibilidade; URL direta mostra
indisponibilidade e a API bloqueia de todo modo; falha ao consultar a configuração **impede**
exibir o módulo até uma consulta válida — o padrão é não mostrar, não é mostrar habilitado.

Em execução: cliente HTTP extraído para `packages/api-client`, sem dependência de navegador,
compartilhável com os aplicativos; o SSE web fecha a conexão no erro, renova a sessão e reconecta
com o token atual, com backoff e descarte de evento antigo.

## 14. Configuração

`apps/api/src/config.ts` valida o ambiente com Zod na subida e falha com a lista de problemas —
nada de valor padrão silencioso em segredo. `JWT_SECRET` exige 32 caracteres.

| Variável | Uso |
|---|---|
| `DATABASE_URL` | Conexão dona: migrações, ingestão e seed |
| `DATABASE_URL_APP` | Conexão restrita da API, onde o RLS vale |
| `API_PORT` / `VITE_API_URL` | Porta da API e endereço usado pelas telas |
| `JWT_SECRET`, `JWT_ACCESS_TTL_MINUTES`, `JWT_REFRESH_TTL_DAYS` | Sessão (15 min / 30 dias por padrão) |
| `CORS_ORIGINS` | Origens permitidas |
| `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_CA_FILE`, `MQTT_CERT_FILE`, `MQTT_KEY_FILE` | Conexão da ingestão |
| `MQTT_AUTH_SECRET`, `MQTT_INGEST_USERNAME`, `MQTT_INGEST_PASSWORD` | Autenticação/autorização HTTP do broker |
| `GATEWAY_OFFLINE_TIMEOUT_SECONDS`, `DEVICE_OFFLINE_TIMEOUT_SECONDS` | Prazos de comunicação |
| `ALERT_WEBHOOK_URL` | Encaminhamento opcional de `HIGH`/`CRITICAL` |

Em execução: `DATABASE_URL_IDENTITY`, `DATABASE_URL_BROKER_AUTH`, `JWT_ACTIVE_KID`,
`JWT_PRIVATE_KEY` e `JWT_PUBLIC_KEYS`.

## 15. Implantação

Local: `pnpm setup:local` sobe Compose (PostgreSQL/Timescale em 5434, EMQX em 1883/18083, só em
`127.0.0.1`), espera o banco, aplica schema, roda os SQL em ordem e semeia a demonstração.

Produção ([DEPLOY.md](DEPLOY.md)): `docker-compose.prod.yml` com Caddy para TLS, imagens próprias
(`Dockerfile.node`, `Dockerfile.web`), segredos exclusivos, conexão restrita da API, MQTTS,
credencial por gateway e backup. Expor apenas HTTPS e MQTTS; banco, métricas e dashboard do broker
ficam em rede privada.

Pendências registradas para a etapa 6: fixar versão/digest das imagens (hoje há `latest-pg16`),
substituir `drizzle-kit push` por migrações registradas no fluxo de atualização, limites de
CPU/memória e pool por processo, health/readiness específicos (API atendendo, ingestão
conectada/gravando, worker renovando lease), backup externo criptografado com restauração provada
e migração expandir/preencher/validar/trocar/remover.

## 16. Observabilidade e operação

Hoje: `GET /health` (processo) e `/health/ready` (banco); logs no stdout dos containers; sweep de
comunicação; webhook opcional de alertas graves.

Planejado: logs estruturados com correlação e métricas de latência HTTP, conexões, lag da inbox,
idade da outbox, falha de jobs, ACK de comandos, armazenamento, certificado e backup — evitando
label por usuário ou dispositivo, que explode cardinalidade. Coleta externa de disponibilidade
para detectar queda total da VPS.

## 17. Testes e verificação

Runner nativo (`node --test` via `tsx`), execução **serial** por pacote e por arquivo —
concorrência disputava o banco e estourava a memória desta máquina.

```bash
pnpm test        # ui, api e ingest em sequência
pnpm typecheck
pnpm build
```

`RUN_ACCESS_DB_TESTS=1` habilita os testes de acesso com banco; a linha em execução acrescenta
`RUN_RBAC_DB_TESTS=1`. Prepare com `pnpm setup:local`, com a plataforma e os simuladores parados.

| Marco | Resultado |
|---|---|
| 23/09/2026, versão entregue | 144 testes (API 77, ingestão 50, UI 17), typecheck e build aprovados |
| 28/09, etapa 2A | Sessões 9/9, JWT 4/4, API 116/116, runner de migrações 5/5 |
| 29/09, etapa 2B.1 | API **149/149** sem ignorados (17 de RBAC no PostgreSQL, 9 do modelo, 7 HTTP de tenancy), UI **32/32** |

Cobertura de comportamento que importa manter: autorização e RLS, sessão, contrato MQTT,
telemetria, alertas, acessos (com cliente MQTT em memória, sem acionar portão físico), vagas,
avisos, consumo, suporte, governança e pausa/retomada de funcionalidades. O ambiente em execução
usa banco isolado `predioon-product-test` na porta 5436.

Aceite de campo (não substituído por teste de software) em
[HARDWARE_SOFTWARE.md, seção 10](HARDWARE_SOFTWARE.md): leitura Modbus, publicação do gateway,
autenticação no broker, gravação, tela, tempo real, disparo de regra e detecção de queda.

## 18. Débitos técnicos e riscos de implementação

| # | Item | Efeito | Encaminhamento |
|---|---|---|---|
| 1 | Etapas 1–2B **não commitadas** (232 arquivos em `codex/product-platform`, 163 em `codex/funcionalidades-predio-on`, nenhum commit além de `84ffca7`) | Perda de árvore perde a entrega; nada é revisável por diff | Commitar e publicar as linhas antes de seguir para 2B.3 |
| 2 | Confirmação MQTT sem aguardar o commit | Mensagem pode ser confirmada e não persistida | Inbox durável na etapa 3, com teste de interrupção |
| 3 | `MQTT_CLIENT_ID` fixo | Impede mais de um receptor | Tratar antes de escalar recepção |
| 4 | `hasAtLeast` e bypasses legados ainda em uso | Um helper ampliado concede domínio inteiro por efeito colateral | 2B.3 migra por módulo, mantendo os guards legados isolados e documentados; encerrar só depois dos consumidores |
| 5 | Estado atual lido da série bruta | Dashboard degrada com o histórico | Projeção `device_latest_state` (etapa 3) |
| 6 | Sem retenção nem compressão no Timescale | Custo e desempenho | Políticas por categoria/plano, medindo custo |
| 7 | `NOTIFY` como único caminho de evento | Evento perdido na desconexão | Outbox com registro por consumidor |
| 8 | Fluxo de produção com `drizzle-kit push` | Atualização não reproduzível | Migrações registradas com runner exclusivo |
| 9 | VPS única | Ponto único de falha | Backup restaurado, monitoramento externo, HA depois |
| 10 | Sem ambiente Android/iOS na máquina | Build nativo não verificado | Etapa 5 separa teste local de build de loja |

Erros a não repetir, registrados na arquitetura: não derivar autorização do nome do aplicativo;
não usar papel ordenado como substituto de escopo; não usar `NOTIFY` como fila durável; não supor
que QoS MQTT confirma transação de negócio; não aplicar retry de job a comando físico; não
reescrever o produto para reorganizar pastas.

## 19. Arquivos de referência

| Assunto | Caminho |
|---|---|
| Contratos de telemetria e tópicos | `packages/shared/src/telemetry.ts`, `topics.ts`, `sensors.ts` |
| Catálogo e resolução de funcionalidades | `packages/shared/src/features.ts` |
| Regras puras de acesso | `packages/shared/src/access.ts` |
| Contexto RLS | `packages/db/src/context.ts` |
| Locks e leitura de funcionalidades | `packages/db/src/features.ts` |
| Pipeline de ingestão | `services/ingest/src/pipeline/telemetry.ts` |
| Consumo e modelo adaptativo | `services/ingest/src/analytics/usage.ts` |
| Despacho de comandos | `services/ingest/src/access/dispatcher.ts` |
| Sweep de comunicação | `services/ingest/src/offline-sweeper.ts` |
| Composição da API | `apps/api/src/app.ts` |
| Sessão e tokens | `apps/api/src/auth/tokens.ts`, `service.ts` |
| Barramento de tempo real | `apps/api/src/modules/events/bus.ts`, `routes.ts` |
| RLS e roles | `infrastructure/001-timescale-rls.sql`, `002-app-role.sql` |
| Runner de infraestrutura | `packages/db/src/apply-infrastructure.ts` |

## 20. Referências

[PRD](PRD.md) · [Arquitetura de produto (27/09)](superpowers/specs/2026-09-27-arquitetura-produto-design.md) ·
[Tracker de execução](superpowers/plans/2026-09-27-product-execution.md) ·
[Plano de 29/09](superpowers/plans/2026-09-29-rbac-domain-migration.md) ·
[Modelo de dados](DATABASE_MODEL.md) · [Preparação do banco](DATABASE_SETUP.md) ·
[Hardware/software](HARDWARE_SOFTWARE.md) · [Sensores](SENSORES.md) · [Acessos](ACESSOS.md) ·
[Consumo e análise](CONSUMO_E_ANALISE.md) · [Controle de funcionalidades](FUNCIONALIDADES.md) ·
[Deploy](DEPLOY.md) · [Plano total](PLANO_TOTAL.md) · [Próximos passos](NEXT_STEPS.md)
