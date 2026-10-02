# Contador de chamados no dashboard — 027

> **For agentic workers:** usar subagent-driven-development e TDD; conformidade antes de qualidade. Integrar somente após o aceite/publicação de 024/025/026; o agente principal mantém documentação e Git.

**Goal:** restaurar o contador de chamados abertos pela autorização própria de 026, distinguindo visão do solicitante de cobertura administrativa completa.

**Architecture:** projeção agregada do escopo atual de chamados, sem relatos ou históricos. O DTO informa cobertura e o alcance da contagem; o painel não apresenta um subconjunto como situação completa do condomínio.

**Tech Stack:** PostgreSQL, Express, contracts e painéis React existentes, sem nova biblioteca.

## Arquivos e decisões

Criar `infrastructure/027-overview-occurrences.sql` e `apps/api/test/overview-occurrences.test.ts`. Modificar `apps/api/src/modules/overview/authorization.ts`, `apps/api/src/modules/overview/routes.ts`, `packages/contracts/src/overview.ts`, `packages/ui/src/overview-state.ts`, `packages/ui/test/overview-state.test.ts` e `apps/building-web/src/pages/Dashboard.tsx`. Estes arquivos existirão após 024. Não modificar helpers centrais, catálogo RBAC, políticas de outros domínios ou resumo global da plataforma.

Preservar `counts.open_occurrences`, nullable. Acrescentar cobertura de occurrences e `occurrenceVisibility: 'all' | 'own' | 'scoped' | 'none'`. Manage inteira produz cobertura whole/all; concessão específica ou visão própria produz partial/scoped ou partial/own. None é null e o texto “Acompanhar ocorrências”. Zero é conjunto autorizado vazio. Gestão parcial combinada com leitura própria deve informar scoped, pois o conjunto pode incluir relatos de terceiros expressamente concedidos.

## Tarefa 1 — RED e projeção

- [ ] Fixtures próprias com dois condomínios, dois solicitantes, gestor inteiro, gestor exato sem membership e equipe. Verificar chamados próprios/terceiros, abertos/encerrados e grupo com relatos privados. Suporte técnico, plataforma sem concessão local e actor somente de telemetria recebem null/none.
- [ ] Registrar RED com `pnpm --filter @predioon/api exec node --import tsx --test --test-concurrency=1 test/overview-occurrences.test.ts` e `pnpm --filter @predioon/ui test` antes da implementação. Exemplos:

```ts
assert.equal(resident.counts.open_occurrences, 1);
assert.equal(resident.occurrenceVisibility, 'own');
assert.equal(resident.coverage.occurrences, 'partial');
assert.equal(support.counts.open_occurrences, null);
assert.equal(manager.coverage.occurrences, 'whole');
```

- [ ] SECDEF STABLE, mesmo owner do RBAC, public,pg_temp e EXECUTE somente app. Usar o helper atual de escopo/pai de 026; respeitar conta/tenant/papel/equipe/vigência. Retornar somente count/cobertura/visibilidade, sem IDs, autor, protocolo, texto, responsável ou group_id.
- [ ] Contar somente OPEN/IN_ANALYSIS/IN_PROGRESS nos chamados reais que o ator pode ler. Não considerar assigned_to como concessão. Autorização não consulta occurrence_events; usar índices de chamados para tenant/status/autor e provar consulta real sem scans do histórico, com concessões próprias e específicas.
- [ ] Aplicar/reaplicar somente 027 atomicamente no banco isolado. Policies/grants de tabelas e catálogo permanecem idênticos; adicionar apenas a função estreita necessária.

## Tarefa 2 — integração e interface

- [ ] Overview local consulta a projeção depois de autorizar seu escopo e ler funcionalidades. TICKETS pausada produz contador indisponível, sem zero saudável. Revalidar no statement final antes de entregar contagem em memória; expiração/revogação entre consultas não preserva dados do escopo perdido.
- [ ] DTO e decisões de apresentação informam “Seus chamados abertos”, “Chamados abertos no seu escopo” ou “Chamados abertos”, conforme alcance. None, pausa e erro mostram acesso ao módulo com texto neutro. Não converter null em zero e não inferir saúde do condomínio a partir de visão própria/parcial.
- [ ] Mesmo JWT perde o contador ao revogar/expirar vínculo individual/equipe, papel/permission ou conta/tenant. Enquanto há outro direito de descoberta/monitoramento, manter overview com occurrences none; perder todo o escopo do overview preserva a negação definida por 024.
- [ ] Testar labels e null/zero/cobertura na função pura de UI; navegador local verifica próprio, gestão inteira, parcial e indisponível. Nenhum relato de vizinho pode aparecer como efeito da integração.

## Tarefa 3 — validação e publicação

- [ ] Dirigido serial: overview-occurrences, overview-capabilities, occurrences-capabilities, governance, features e autorização de vigência. API/contracts/UI/building-web tipos, UI testes, build building-web, fronteiras e diff-check.
- [ ] Comparar catálogo/ACLs, limpeza de fixtures/transações/locks e duas revisões. Agente principal roda API integral em fonte estável e banco livre, atualiza tracker/AUTORIZACAO e faz commit/push da meta verificada.

Estado: planejado, não implementado nem validado. Depende das APIs/DTOs de 024 e da autorização de chamados de 026. Reservas, financeiro, configuração/atuação, administração, identidade, workers, apps nativos e operação continuam nas etapas seguintes.
