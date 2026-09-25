# Gestão transparente — plano de implementação

> Execução nesta sessão com as skills executing-plans e test-driven-development. O usuário autorizou implementar e continuar até finalizar.

**Objetivo:** completar chamados e oferecer transparência e prestação de contas aos moradores.
**Arquitetura:** ampliar occurrences, reutilizar notices, acrescentar financial_reports com RLS. Contratos compartilhados e painéis React reutilizados nos portais do síndico e do morador.
**Tecnologias:** TypeScript, Zod, Express, Drizzle, PostgreSQL e React.

- [x] Escrever testes HTTP/RLS em `apps/api/test/governance.test.ts` para gravidade, agrupamento, publicação e isolamento; executar e confirmar falhas nas funcionalidades ausentes.
- [x] Criar contratos em `packages/shared/src/governance.ts`: prioridades LOW/NORMAL/HIGH, normalização de assunto e prestação de contas com valores inteiros em centavos; rejeitar valores inválidos e links sem HTTPS.
- [x] Criar `infrastructure/011-governance.sql` aditiva e `packages/db/src/schema-finance.ts`; acrescentar groupId a ocorrências e políticas de rascunho/publicação. Aplicar sem reset.
- [x] Ampliar `apps/api/src/modules/occurrences/routes.ts`: autorização atual, comentários e histórico, prioridades com motivo, sugestão de três repetidos, agrupamento confirmado e atualizações transacionais. Cobrir cancelamento do morador e preservação de closedAt.
- [x] Criar `apps/api/src/modules/finance/routes.ts`: listar, salvar rascunho com controle de versão, publicar, preservar revisões e calcular totais. Registrar no app e auditar operações.
- [x] Criar componentes compartilhados `occurrences-panel.tsx` e `transparency-panel.tsx`; abrir chamados nos dois perfis, histórico e respostas, seleção de gravidade, agrupamento no síndico, contas e avisos públicos. Conectar rotas e menus.
- [x] Executar `pnpm --filter @predioon/api exec node --import tsx --test test/governance.test.ts`; corrigir até todos passarem. Revisar permissão, concorrência e validação de entrada.
- [x] Conferir no navegador abertura, agrupamento, alteração de gravidade, histórico e publicação de contas. Remover dados temporários.
- [x] Atualizar manual funcional e marketing com funções reais e limites. Executar testes dos três pacotes serialmente, typecheck e build, registrando evidências e limitações físicas.

## Evidências da conclusão local

Os nove testes iniciais falharam nas funções ausentes antes da implementação e passaram depois. A revisão ampliou para 12 testes, incluindo corrida de agrupamento, revisões de contas, preservação de chamados concluídos e publicação de aviso com relógio da API adiantado. Os dois últimos reproduziram falhas e passaram após correção.

A regressão completa passou com 144 testes (API 77, ingestão 50, interface 17); typecheck e build passaram. O comando padrão de testes passou a executar pacotes e arquivos serialmente para evitar disputa da fila compartilhada e memória excessiva. No navegador, contas temporárias confirmaram abertura nos dois perfis, três relatos, agrupamento, gravidade justificada, resposta/conclusão comum, privacidade e rascunho/publicação financeira. Dados de teste removidos e contas de demonstração restauradas. Documentação em `docs/GESTAO_TRANSPARENTE.md`, manual de implantação em Markdown e marketing atualizados; o Word anterior permanece identificado como versão 1.
