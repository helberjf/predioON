# Funcionalidades do Prédio ON — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Subsistemas independentes têm arquivos próprios; a integração e a revisão ficam com o agente principal.

**Goal:** Implementar a lista aprovada pelo usuário, excluindo disjuntor/extintor, e atualizar o marketing com a entrega verificável.

**Architecture:** Manter Express/Drizzle/PostgreSQL, ingestão MQTT e os três painéis React. Separar consumo e análise histórica, acessos, estacionamento/avisos e sensores; usar autorização por prédio, RLS, auditoria e migrações aditivas. Simuladores demonstram a integração de hardware sem acionar equipamentos reais.

**Tech Stack:** TypeScript, Zod, Drizzle, Node test, PostgreSQL/TimescaleDB, MQTT, React/Vite.

## Escopo e decisões

- Energia: medidor acumulado em kWh, consumo diário, tarifa em R$/kWh, estimativa diária e alertas por limites ou histórico aprendido.
- Água: medidor acumulado em m³, consumo diário e custo estimado opcional; preservar nível/volume da caixa. Sensores de vazamento de água e esgoto distintos.
- Bomba: estado, tempo contínuo e total diário; considerar fuso e períodos sem leitura. Alerta de 1h para 2h por dia conforme limite configurado.
- Análise inteligente: modelo estatístico não supervisionado treinado com histórico válido, com referência, desvio e explicação. Sem histórico suficiente, informar aprendizado; não inventar diagnóstico de causa.
- Sensores: contratos, unidades, telas e regras de gás, fumaça, temperatura, água/esgoto e parâmetros elétricos. Nenhum módulo novo de disjuntor/extintor.
- Portões: garagem e pedestre, ativação explícita, permissão de moradores configurável, comando curto com expiração/idempotência, ACK do gateway, auditoria e tratamento de falha/offline.
- Avisos: coleta, reunião e limpeza com data/recorrência; preservar reservas do salão e fila de serviços. Vagas separadas de carros/motos com capacidade, ocupação, origem e atualização; manual e por telemetria.
- Imóveis: usar o cadastro existente com tipo residencial/condomínio/comercial, mantendo compatibilidade com registros existentes.

## Tarefas

- [x] **Consumo e análise histórica (principal):** criar `packages/shared/src/monitoring.ts`, `packages/shared/src/usage.ts`, `packages/db/src/schema-monitoring.ts`, `services/ingest/src/analytics/*`, `apps/api/src/modules/monitoring/routes.ts` e telas de monitoramento. Testes de deltas de medidores, reset, duplicatas, lacunas, fuso, ciclos de bomba e modelo aprendido. Executar teste vermelho antes do código, depois testes de domínio e integração.
- [x] **Portões (agente de acessos):** criar contratos, tabelas, rotas, serviço MQTT de comandos/ACK e componente compartilhado. Testar RBAC/RLS, ACK forjado/duplicado, comando expirado, conexão perdida e idempotência. Trabalhar apenas nos arquivos atribuídos.
- [x] **Estacionamento e avisos (agente de convivência):** criar tabelas/rotas/componentes próprios para vagas e metadados de agenda de avisos. Testar limites, concorrência, isolação por prédio, origem/horário e recorrência com fuso; preservar reservas/chamados.
- [x] **Sensores e simulação (agente de sensores):** definir métricas conhecidas, validar tipos/unidades, adicionar catálogo de sensores, regras e simulador de cenários de gás/fumaça/esgoto/consumo/bomba. Testar payload inválido e leituras distintas. Criar tela de sensores críticos.
- [x] **Integração (principal):** exportar schemas/contratos, ligar rotas, menus e ingestão, migrar banco sem reset, completar seed, integrar os componentes aos painéis e corrigir configuração de produção.
- [x] **Revisão de especificação e qualidade:** conferir cobertura de todos os itens, testar autorização e integridade, corrigir os achados antes de concluir.
- [x] **Validação:** executar testes de domínio/API/ingestão, `pnpm -r --workspace-concurrency=1 typecheck` e `pnpm -r --workspace-concurrency=1 build`; verificar navegação no navegador e simulação MQTT quando infraestrutura local disponível.
- [x] **Documentação:** atualizar contrato de hardware e instruções de instalação, matriz de funcionalidades e os dois materiais de marketing. Distinguir implementação/testes locais de comissionamento físico.

## Exemplos de aceitação

```ts
assert.equal(usageFromCounters(100, 150), 50);
assert.equal(estimatedCost(50, 1), 50);
assert.equal(percentChange(50, 10), 400);
assert.equal(pumpMinutes([{ on: true, minutes: 60 }, { on: false, minutes: 30 }, { on: true, minutes: 60 }]), 120);
assert.equal(availableSpaces({ capacity: 20, occupied: 12 }), 8);
```

Os exemplos expressam resultados esperados; os testes usam as funções reais dos módulos. Um ACK válido confirma o comando no controlador; confirmar a posição física do portão exige retorno de um sensor apropriado. Publicação MQTT sozinha não significa portão aberto. Estimativa de custo não equivale à fatura da concessionária.

## Registro final desta etapa

Implementação e validação local concluídas em 23/09/2026. Os 114 testes passaram, sem falhas ou testes ignorados: 51 da API, 50 da ingestão e 13 da interface. Typecheck e build passaram. As nove migrações e o seed complementar foram aplicados sem reset do banco. A navegação autenticada do síndico e do morador foi conferida, incluindo consumo, sensores, portões, avisos e vagas. Os dois acessos passaram pelo fluxo API → banco → EMQX → controlador simulado → ACK, sem duplicar o comando ao repetir a solicitação. A revisão corrigiu recuperação/idempotência da interface e a leitura de vazamento no painel inicial. A instalação e o comissionamento dos equipamentos físicos continuam necessários. Consulte [REVISAO_FUNCIONALIDADES.md](../../REVISAO_FUNCIONALIDADES.md) para as evidências.
