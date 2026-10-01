# Prestação de contas publicada e gestão — 030

> **For agentic workers:** usar subagent-driven-development e TDD; conformidade antes de qualidade. Executar depois de 029; o agente principal mantém documentação/Git.

**Goal:** migrar `/finance` para leitura publicada, leitura administrativa e gestão explícitas, preservando revisões publicadas e cálculos em centavos.

**Architecture:** finance:read existente continua leitura administrativa; nova finance:read-published fornece somente relatórios publicados e finance:manage autoriza criação/edição/publicação. Cada relatório resolve o recurso finance real, sem grant global ou suporte técnico.

**Tech Stack:** PostgreSQL, Express, Drizzle e validações/cálculos shared existentes; sem integração bancária, processamento de pagamento ou nova biblioteca.

## Decisões e arquivos

Adicionar `finance:read-published` aos quatro papéis locais e `finance:manage` somente a BUILDING_ADMIN; preservar `finance:read` existente nos papéis aprovados. Finance:read-published não revela rascunhos. A concessão de telemetria/monitoramento não concede relatórios financeiros. Criar nova revisão exige read/manage inteiras, edição/publicação pode usar grant específico no relatório real. Não criar outro tipo RBAC: finance já resolve financial_reports.

Criar `infrastructure/030-finance-capabilities.sql`, `apps/api/src/modules/finance/authorization.ts`, `apps/api/test/finance-capabilities.test.ts`; modificar `apps/api/src/modules/finance/routes.ts`, `packages/shared/src/rbac.ts` e somente as asserções necessárias de `apps/api/test/rbac-tenancy-unit.test.ts`. DTO/centavos/HTTPS/version/revision/rotas permanecem; não baixar comprovantes ou publicar dados de chamados automaticamente.

## Tarefa 1 — RED

- [ ] Fixtures próprias com dois condomínios, relatórios publicados/rascunhos e duas revisões do mesmo mês. Morador com read-published lê publicados do seu escopo; manager read lê sem editar; síndico inteiro/exato configura o recurso concedido. Sem membership legado funciona para indivíduo/equipe.
- [ ] Mesmo JWT perde leitura/ação ao revogar/expirar vínculo/equipe/membro, papel/permission/conta/tenant. Global flag, plataforma sem concessão local, suporte técnico, telemetria, recurso alheio/inexistente e read-published sobre rascunho negam conteúdo privado.
- [ ] SQL sem WHERE respeita publicação e escopo; UPDATE não troca id/tenant/month/revision/created_by/created_at e nunca altera relatório publicado. DELETE negado. Leitura não concede ação; edição de rascunho escondido permanece 404.
- [ ] Registrar RED com `pnpm --filter @predioon/api exec node --import tsx --test --test-concurrency=1 test/finance-capabilities.test.ts`. Conservar testes existentes de centavos exatos, URLs HTTPS sem credenciais, revisão, versão e publicação.

## Tarefa 2 — SQL e autorização

- [ ] Migration aditiva acrescenta só duas permissões e seus vínculos idempotentes, sem reativar estado suspenso. Helper pontual SECDEF STABLE owner RBAC/public,pg_temp/app-only, UUID inválido false por CASE antes do cast/PK. Whitelist read/read-published/manage, relatório real no tenant e janela 021; read-published também exige published_at atual.
- [ ] Helper de escopo permite lista vazia em grant inteiro; grant específico exige relatório real legível, não aceita apenas existência de rascunho para read-published. State policies independentes de buildings:read/manage e OR local do marcador de feature atual preservam branches anteriores.
- [ ] Substituir somente financial_reports_read/insert/update. SELECT permite private read ou published read-published; INSERT exige read/manage inteiras, ator created_by e rascunho. UPDATE exige read/manage do objeto e published_at IS NULL; grant de colunas só title/summary/opening_balance_cents/entries/version/published_by/published_at/updated_at, sem identidade/mês/revisão/criação. DELETE segue revogado.
- [ ] Checagem de revisão publicada mais recente precisa considerar as revisões reais do mesmo tenant/mês, mesmo quando um grant específico esconde outras linhas. Projeção owner controlada retorna somente boolean após autorizar o relatório alvo; não revela ID/autor/texto de revisão escondida. Não usar ausência no SELECT filtrado por RLS como prova de que não existe revisão mais nova.
- [ ] Atualizar somente FINANCIAL_DRAFT_CREATED/UPDATED/FINANCIAL_REPORT_PUBLISHED na auditoria atual, com ator/tenant/recurso/read/manage reais; demais branches idênticas. Aplicar/reaplicar somente 030 atomicamente e provar ACL/catalog/grants/policies alheios e PK/índice tenant-mês-revisão nas consultas reais.

## Tarefa 3 — handlers e integração

- [ ] Remover assertFeature legado deste módulo; autorizar domínio antes de readFeatures sob lock compartilhado e conservar FINANCE/no-store. GET preserva ordenação/paginação/DTO e totals; revalida recursos atuais antes de enviar conteúdo em memória.
- [ ] POST autoriza concessão inteira, obtém advisory lock atual por tenant/mês e revalida em novo statement após espera antes de escolher próxima revisão. Gera UUID no servidor, INSERT e leitura em statement seguinte; rascunho/auditoria confirmam juntos. Não recalcular versão/revisão a partir do relógio do cliente.
- [ ] PUT/publicação autorizam sem lock primeiro, obtêm os locks necessários em ordem consistente e reconsultam RLS/capacidades/publicação/versão após esperar. Publicação já existente é idempotente somente após autorização atual; nenhuma alteração de conteúdo publicado. `version` e 409 de concorrência continuam controlados pelo banco.
- [ ] Revogação/expiração de indivíduo/equipe durante advisory/row wait impede conteúdo/publicação/auditoria. Testes observam a espera real, limitam aquisição/consulta, liberam locks e observam rejeições em finally; falha de auditoria reverte todos os efeitos. Erros PG genéricos sem SQL/params ou extratos privados nos logs.
- [ ] Dirigido serial: finance-capabilities, governance, feature-enforcement/features-lifecycle, autorização de vigência, RBAC/tenancy. Tipos API/shared/consumidores, fronteiras/diff-check, catálogo preciso e cleanup zerado; conformidade e qualidade, API integral do agente principal, documentação e commit/push da meta verificada.

Estado: planejado, não implementado nem validado. Não é conciliação, faturamento comercial nem processamento de pagamentos; mantém o módulo de prestação de contas existente e separa suas autorizações. Configuração/atuação e administração continuam nas próximas migrations, seguidas pelas demais etapas do produto.
