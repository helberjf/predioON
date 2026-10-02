# Eventos de alertas por capacidade — plano de implementação

> **For agentic workers:** usar subagent-driven-development; TDD, revisão de conformidade e depois revisão de qualidade. Não fazer stage/commit.

**Goal:** entregar eventos de alertas somente aos usuários atualmente autorizados no recurso.

**Architecture:** o envelope NOTIFY identifica o alerta, mas os campos entregues vêm do registro atual no banco, sujeito à RLS e à capacidade alerts:read. A classificação mínima do módulo de alertas permite respeitar pausa/retomada sem conceder leitura de configurações.

**Tech Stack:** TypeScript, PostgreSQL LISTEN/NOTIFY e SSE existentes.

## Dependência e arquivos

Iniciar após HTTP/RLS de alertas passar os testes dirigidos e as duas revisões. Worktree product-platform e banco isolado em 5436; sem nova migration neste recorte.

- Criar apps/api/src/modules/events/alerts.ts.
- Modificar apps/api/src/modules/events/routes.ts: ramo alert antes da decisão legada buildingRole; remover somente o ramo legado específico de alert.
- Criar apps/api/test/alert-events-capabilities.test.ts.
- Reutilizar authorizedAlertContexts/alertFeatureKeys do módulo alerts/authorization.ts e readFeatures/observationIsCurrent. Não copiar regras de RBAC/classificação.

## Contrato

```ts
type AlertEvent = Extract<RealtimeEvent, {kind: "alert"}>;
async function projectAlertEvent(tx: AppTransaction, event: AlertEvent): Promise<AlertEvent | null>;
```

- Exigir correspondência building_id/alert_id no contexto autorizado por alerts:read.
- Carregar o registro atual pela RLS na mesma transação, por consulta indexada do ID específico. Evento com ID inválido/ausente/inacessível ou condomínio divergente retorna null; validar UUID antes de consultar para não encerrar o stream por SQLSTATE 22P02.
- Não confiar em deviceId/gatewayId/severity/type/message/status do envelope recebido: projetar kind e os oito campos do registro atual (buildingId, alertId, deviceId, gatewayId, severity, type, message, status). gatewayId pode ser null. Não enviar triggeredValue, regra, configurações ou campos adicionais.
- Aplicar readFeatures depois de autorizar. observationIsCurrent com alertFeatureKeys e triggeredAt persistido: nenhuma entrega enquanto pausado, nenhum alerta anterior à retomada entregue como novo. O histórico HTTP permanece consultável.
- Manter revalidação da sessão/conta antes de cada evento e no heartbeat, mesma transação/lock compartilhado até res.write, limite de fila 100, serialização e cleanup. Null não encerra o stream.
- Telemetria já migrada permanece intacta; device-status/gateway-status/features-changed preservam seus caminhos atuais até suas migrações.

## Tarefa 1 — RED

- [x] Fixtures únicas com pessoa direta, equipe, equipamento/alerta/gateway específico, suporte apenas alerts:read, morador legado e plataforma global. Sem memberships legados para novos papéis.
- [x] Abrir stream real e aguardar retry inicial antes de emitir NOTIFY. Marcador global features-changed delimita negativa; timeout e cleanup abort/cancel em finally.
- [x] Demonstrar manutenção atual sem evento pelo guard legado; demonstrar campos falsificados no envelope sendo entregues pelo código antigo para um usuário legado autorizado.

```ts
assert.equal(frames.filter(f => f.event === "alert").length, 1);
assert.equal(alertFrame.message, storedMessage);
assert.equal(alertFrame.deviceId, storedDeviceId);
assert.ok(!frames.some(f => f.event === "alert" && f.alertId === neighborAlert));
```

## Tarefa 2 — GREEN e integração

- [x] Implementar projectAlertEvent e integrá-lo antes de buildingRole.
- [x] Testar leitura direta/equipe/recurso/suporte, morador e global sem concessão privados negados, vizinho/outro tenant, IDs inexistentes e envelope divergente.
- [x] Mesmo stream/token: revogar binding/equipe/concessão/papel global do suporte e verificar ausência da próxima entrega; conta e sessão revogadas encerram stream.
- [x] Pausa/retomada: alerta antigo não chega após retomada; novo triggeredAt posterior ao horário PostgreSQL chega. Retirada independente de buildings:read não faz estado pausado desaparecer.
- [x] Concessões combinadas entregam um único frame; outros eventos e marcador mantêm comportamento.
- [x] Confirmar projeção deriva severidade/tipo/mensagem/estado/IDs do banco e não do evento recebido.

```powershell
pnpm --filter @predioon/api exec node --import tsx --test --test-concurrency=1 test/alert-events-capabilities.test.ts test/telemetry-events-capabilities.test.ts test/session-lifecycle.test.ts test/feature-enforcement.test.ts
pnpm --filter @predioon/api typecheck
pnpm check:boundaries
```

## Tarefa 3 — aceite

- [x] Revisão de conformidade, correções e nova revisão.
- [x] Revisão de qualidade após conformidade aprovada, correções e nova revisão.
- [x] Regressão completa pelo agente principal com fonte estável e banco livre; registrar resultado sem skips/cancelamentos.

Estado: concluído, com revisões de conformidade e qualidade aprovadas. RED inicial reproduziu as duas falhas previstas; RED expandido teve 14 falhas e três comportamentos já corretos. GREEN 17/17 e dirigido 46/46, sem skips/cancelamentos. O agente principal verificou o conjunto estável HTTP/SSE: API 248/248, 30 suites, sem falhas/skips/cancelamentos, dez typechecks e fronteiras passaram. Fixtures limpas e buildings:read restaurada. Evidências .local/alert-events-{red,expanded-red,green,targeted,typecheck,boundaries,cleanup}.log e .local/api-alerts-combined-full.log. Não encerra 2B.3.
