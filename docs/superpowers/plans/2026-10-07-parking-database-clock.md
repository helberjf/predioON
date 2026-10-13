# Disponibilidade do estacionamento com o relógio do banco

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** impedir que diferenças entre os relógios da API e do PostgreSQL tornem uma contagem válida desconhecida ou vencida.

**Architecture:** conservar o cálculo compartilhado e fornecer explicitamente o relógio do PostgreSQL à projeção HTTP. Ler esse relógio dentro da mesma transação, depois das consultas finais e, nas escritas, depois dos locks, da alteração e da auditoria. Não acrescentar tolerância para datas futuras.

**Tech Stack:** TypeScript, Express, Drizzle, PostgreSQL/Timescale e node:test; nenhuma dependência ou migration nova.

## Base e limites

Base inicial publicada: `425f5acfe3ceae6f380fe8fc0ccf9d773e5ddd8b`. Na retomada de 12/10 foi integrado o estado da main `6989248`, com as migrations 001–051 e as decisões048–051. O commit nativo `7289e18` permanece na continuação. A falha está registrada em `docs/MELHORIAS_E_EVOLUCOES.md`, seção de 06/10. O `observed_at` manual usa `clock_timestamp()`, enquanto `parkingAvailability(row)` toma implicitamente o horário do processo HTTP. Uma diferença de milissegundos já reproduziu `UNKNOWN` indevido; um relógio adiantado também pode gerar `STALE` indevido.

O trabalho anterior de avisos foi preservado em stash local; a fonte atual já contém a verificação de linhas removidas por DELETE. A migration antiga de avisos025 não pode ser aplicada sobre a atual025 de tenancy. Seu container/volume foi preservado; a verificação final usa um banco descartável novo com 51 migrations, sem porta publicada no host e com credenciais de execução restritas. A ativação explícita de funcionalidades físicas no seed de teste segue o CI atual; os padrões de produção049/050 continuam desligados.

A correção conserva RBAC/RLS, estados de funcionalidades, privacidade, versionamento otimista e auditoria transacional. Não altera ingestão, publicação MQTT, comandos físicos, firmware, políticas de replay, dados reais ou configurações de produção.

## Tarefa 1 — reproduzir a diferença de relógio

**Files:** `apps/api/test/parking-capabilities.test.ts`.

- [x] Reutilizar a fixture real de condomínio/pessoas/equipamentos e criar as sessões antes de alterar o relógio do teste. Usar somente o mock de `Date`; os timers de espera continuam reais.
- [x] Com hora obtida pelo PostgreSQL e `staleAfterSeconds=30`, provar que ocupação manual, GET e PATCH de configuração sem troca de sensor retornam `CURRENT` e a capacidade restante correta, tanto com a API 60s atrás quanto 60s à frente.
- [x] Provar que observações realmente futuras no PostgreSQL continuam `UNKNOWN` e que as realmente vencidas continuam `STALE`, sem tolerância adicional. Os testes compartilhados conservam a recusa de um instante futuro por apenas 1ms.
- [x] Reutilizar o helper de lock real para provar que uma ocupação gravada depois da espera não é comparada com o horário do início da transação. Restaurar mocks e fixtures em `finally`.
- [x] Executar os novos casos contra o código anterior e preservar o RED com as falhas de estado, não erros de configuração ou autorização.

```powershell
docker exec predioon-current-plan-api-check corepack pnpm --filter @predioon/api exec node --import tsx --test --test-concurrency=1 --test-name-pattern="host skew|fresh database clock" test/parking-capabilities.test.ts
```

## Tarefa 2 — corrigir todas as projeções HTTP

**Files:** `apps/api/src/modules/parking/routes.ts`.

- [x] Exigir o parâmetro `now` no helper local da projeção, conservando o cálculo de `parkingAvailability`:

```typescript
const view = (row: typeof parkingLots.$inferSelect, now: Date) => ({
  ...row,
  ...parkingAvailability(row, now),
});

async function databaseNow(tx: AppTransaction): Promise<Date> {
  const [clock] = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
  return new Date(clock!.now);
}
```

- [x] Em GET, obter `now` depois da consulta dos IDs atualmente permitidos e usar a mesma hora para todos os itens da resposta. Continuar aplicando `observationIsCurrent` e os filtros existentes.
- [x] Em POST e nos dois PATCH, retornar a projeção de dentro da transação, depois da auditoria: `return view(createdOrUpdated, await databaseNow(tx));`. Fora da transação, responder com o resultado já projetado.
- [x] Reexecutar os casos novos e a suíte completa de capacidades do estacionamento, sem modificar assertivas antigas para obter verde.

## Correção adicional da fixture herdada de ativos

**File:** apps/api/test/assets.test.ts. A integral antiga 799/799 passou, mas a comparação exata encontrou apenas created_at diferente na tupla MAINTENANCE/devices:read: o finally removia e recriava o grant usando DEFAULT. Essa é evidência RED de limpeza, não falha da autorização HTTP.

- [x] Capturar e exigir a tupla original antes de remover, com created_at::text preservando microssegundos.
- [x] Conservar a negativa HTTP de falta de permissão; restaurar a tupla em finally mesmo se a assertiva lançar, com comparação exata do RETURNING. Não criar grant quando o original não existe.
- [x] Revisões independentes e execução dirigida atual aprovadas; catálogo exato antes/depois da integral final preservado sem reparo manual neste cluster.

## Tarefa 3 — revisão, regressão e publicação

- [x] Revisão independente de conformidade e, depois, de qualidade; corrigir achados materiais e revisar novamente.
- [x] Executar `parking-capabilities.test.ts`, `parking-notices.test.ts` e `parking-notices-unit.test.ts` com banco real e as flags de integração ativas. Confirmar limpeza das próprias fixtures e catálogo/ledger inalterados.
- [x] Executar a regressão integral da API em ambiente isolado; registrar o resultado próprio sem somar suítes dirigidas à integral.
- [x] Executar tipos da API/DB/shared, fronteiras e `git diff --check`.
- [x] Atualizar o tracker, continuidade e melhorias com a evidência e os limites reais. Nenhum teste HTTP aceita Android/iOS, aparelhos, Resend real, firmware ou produção.
- [ ] Commitar somente a entrega verificada, fazer push do branch de continuação e conferir que o SHA remoto corresponde ao local.

## Estado

Implementação e verificação concluídas em 12/10; commit/push é o último checkpoint.

RED original:7 casos,2 aprovados/5 falhas de estado. As três fontes conservaram os hashes congelados nas revisões originais e nas duas revisões atuais após integrar a main. Dirigido atual54/54,5 suítes,32.188,410742ms; integral API própria804/804,63 suítes,645.143,501119ms; ingestão própria129/129,16 suítes,12.837,180992ms. Zero falhas/skips/cancelamentos nessas execuções; não somar dirigidos às integrais.

Catálogo de funções/policies/grants/roles/permissões, ledger 51 e credenciais runtime conferidos após o dirigido, a API e a ingestão; somente ordem/whitespace conhecido de OR em app_can_read_feature_event e branches CASE da inserção de auditoria é normalizado, sem alterar corpos. Seis contadores de fixtures/transações/waiters/advisories zerados. Tipos dos14 pacotes executáveis no Windows e API/DB/shared no Linux, fronteiras/diff-check passaram. Cliente 75/75, mobile 127/127 e UI 93/93 foram repetidos na integração antes de qualquer draft de Consumo nativo.

Histórico preservado: primeira integral 799 teve falhas de autenticação runtime após alteração de credenciais, causa não estabelecida; a privada 799 ficou verde com o defeito de limpeza de ativos acima; a repetição final antiga foi interrompida sem resumo e não é aceite. O 804 final usa o banco privado novo 051 e inclui a correção da fixture, com preservação automática.

[Evidência sanitizada](../../evidencias/parking-database-clock-2026-10-12.json). Sem nova migration ou dependência relativa à main, aceite nativo/firmware/Resend real/produção ou nova matriz de navegador. Drafts da meta seguinte de Consumo ficam fora desta publicação.
