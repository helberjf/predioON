# Eventos de telemetria por capacidade — plano de implementação

> **For agentic workers:** usar `subagent-driven-development`, com revisão de conformidade antes da revisão de qualidade. Execução integra o plano autorizado; sem stage ou commit.

**Goal:** aplicar as mesmas capacidades técnicas e de publicação às conexões SSE já abertas.

**Architecture:** preservar um barramento central e a serialização de entregas por assinante. Cada evento de telemetria recebe uma projeção autorizada consultada na transação atual, antes da escrita no socket; os demais eventos continuam isolados nas regras de seus módulos durante a migração.

**Tech Stack:** TypeScript, Express, PostgreSQL LISTEN/NOTIFY e SSE existentes.

## Dependência e arquivos

Iniciar somente após código estável, testes e duas revisões do [recorte HTTP/RLS de telemetria](2026-09-30-telemetry-capabilities.md). Worktree e banco de teste permanecem os mesmos; nenhum schema novo é necessário nesta subentrega.

- Criar `apps/api/src/modules/events/telemetry.ts`: projeção de um evento de telemetria ou null.
- Modificar `apps/api/src/modules/events/routes.ts`: ramo específico de telemetria antes dos guards legados dos outros eventos.
- Criar `apps/api/test/telemetry-events-capabilities.test.ts`: streams HTTP reais e mudanças de concessão com o mesmo access token.
- Reutilizar as projeções e a resolução de funcionalidades de `apps/api/src/modules/telemetry/authorization.ts`, sem duplicar regras de classificação.

## Contrato

```ts
type TelemetryEvent = Extract<RealtimeEvent, {kind: 'telemetry'}>;
async function projectTelemetryEvent(tx: AppTransaction, event: TelemetryEvent): Promise<TelemetryEvent | null>;
```

- Ler dispositivos autorizados no condomínio do evento com `authorizedTelemetryDevices(tx, buildingId, capability)`; exigir que condomínio e ID correspondam ao recurso retornado. Usar `telemetryFeatureKeys(device, metric)` e `readFeatures` após essa autorização.
- Para `telemetry:read`, entregar o envelope técnico existente somente se a funcionalidade da métrica estiver ativa e a observação posterior à retomada. Plataforma sem concessão privada não recebe o evento.
- Para apenas `telemetry:read-published`, aceitar exclusivamente `water_level_percent`. O envelope publicado contém somente `kind`, `buildingId`, `deviceId`, `metric`, `value`, `unit`, `quality`, `time`; value precisa ser um número finito de 0 a 100, unit é `%`, quality é um valor do enum existente. Validar a data e normalizar time em ISO; descartar datas inválidas. Strings, booleanos ou níveis inválidos são descartados, sem converter texto arbitrário em número. WATER_TANK precisa estar ativo e a observação posterior à retomada.
- Se houver ambas as capacidades, entregar uma única vez com a projeção técnica. Sem concessão, retornar null e continuar a conexão para eventos de outros escopos.
- Não usar `buildingRole`, `assertBuildingAccess` ou `buildingFeatures` para telemetria. Para os outros kinds, manter os guards existentes até as respectivas migrações.
- Continuar revalidando sessão/conta antes de cada evento e no heartbeat. Preservar vencimento do JWT, encerramento após revogação da sessão, limite de fila 100, serialização, locks de funcionalidades e limpeza ao desconectar. A consulta e a escrita no socket ficam na mesma transação protegida.

## Tarefa 1 — RED

- [x] Criar fixture isolada com manutenção por equipe e por equipamento sem membership legado, suporte apenas com concessão de telemetria, morador com binding e morador com membership legado, plataforma explícita e plataforma com flag legada.
- [x] Abrir streams reais, ler frame inicial, publicar eventos no canal `predioon_events`. Usar marcador global `features-changed` após o evento para delimitar a janela de verificação negativa; incluir timeout e cleanup de reader/controller/streams em finally.
- [x] Demonstrar manutenção bloqueada no comportamento antigo; demonstrar morador legado recebendo métrica técnica e plataforma legada recebendo leitura privada.

```ts
assert.ok(frames.includes('water_level_percent'));
assert.ok(!frames.includes('energy_total_kwh'));
assert.ok(frames.includes('event: features-changed'));
```

## Tarefa 2 — GREEN e integração

- [x] Implementar a projeção e fazer o ramo telemetria passar por ela antes dos guards de outros kinds.
- [x] Testar acesso técnico direto/equipe/recurso, vizinho/outro condomínio, suporte sem `devices:read`, publicação sanitizada e uma única entrega com permissões combinadas.
- [x] Com stream já aberto, revogar binding/equipe/concessão/papel global de suporte e confirmar que próximo evento não é entregue. Contas e sessões revogadas continuam encerrando o stream.
- [x] Testar pausa/retomada e amostras antigas; usar horário do banco para fixtures posteriores à retomada, evitando divergência do relógio Windows.
- [x] Confirmar que os eventos de outros kinds conservam o comportamento anterior e que o marcador global segue chegando.

Com as quatro DSNs do teste em 5436 e flags de integração ativas:

```powershell
pnpm --filter @predioon/api exec node --import tsx --test --test-concurrency=1 test/telemetry-events-capabilities.test.ts test/session-lifecycle.test.ts test/feature-enforcement.test.ts
pnpm --filter @predioon/api typecheck
pnpm check:boundaries
```

## Tarefa 3 — aceite

- [x] Revisão de conformidade; corrigir e rever achados.
- [x] Revisão de qualidade após conformidade aprovada; corrigir e rever achados.
- [x] Agente principal executa regressão completa após fonte estável e banco livre e atualiza evidências. Os outros domínios operacionais e kinds SSE ainda permanecem pendentes; esta entrega não encerra a etapa 2B.3.

Estado: concluído em 30/09/2026. Treze testes SSE novos, teste dirigido 29/29, tipos da API, fronteiras e ambas as revisões aprovadas. Regressão completa API 210/210, 28 suites, sem skips ou cancelamentos. A primeira execução cancelou os 13 casos SSE no before hook por CONNECT_TIMEOUT de LISTEN; testes dirigidos e repetição integral sem alterações passaram. Não foi confirmada a causa do timeout local.
