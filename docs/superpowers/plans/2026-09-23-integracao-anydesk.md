# Integração AnyDesk — plano de implementação

> Executar com as skills de desenvolvimento com testes e revisão. A escolha foi autorizada pelo usuário após a comparação de alternativas.

**Objetivo:** iniciar e acompanhar atendimentos remotos a partir do painel de administração, usando o AnyDesk instalado.

**Arquitetura:** contrato Zod compartilhado, duas tabelas com RLS, rotas Express autenticadas, página React e link nativo validado. Continuar na branch de funcionalidades existente para preservar as alterações da entrega anterior.

- [x] Contrato e testes: `packages/shared/src/support.ts`, exportação e `apps/api/test/support-unit.test.ts`. Validar ID, ausência de senhas/URLs, motivo e resultado.
- [x] Persistência: `packages/db/src/schema-support.ts`, exportação em `schema.ts` e `infrastructure/010-support.sql`. Migração aditiva, administrador ativo, checks e idempotência.
- [x] API e testes HTTP/RLS: `apps/api/src/modules/support/routes.ts`, registro em `app.ts`, `apps/api/test/support.test.ts`. Cadastro, solicitação e encerramento; configuração desabilitada, usuário revogado, concorrência, idempotência e isolamento.
- [x] Interface: `apps/admin-web/src/pages/Support.tsx`, componentes auxiliares, rota e menu. Cadastro, solicitação, link/cópia, resultado, histórico, erros e troca de condomínio.
- [x] Verificar no navegador sem acionar um ID externo: fluxo de cadastro, resultado, histórico e destino do link gerado. Nenhum teste deve tentar conexão com um computador real.
- [x] Documentar instalação/uso em `docs/SUPORTE_REMOTO.md`, atualizar README, próximos passos e registrar os limites de validação física.
- [x] Revisar escopo e qualidade, executar testes afetados e regressão, typecheck e build. Confirmar migração local e preservar os dados existentes.

Contrato HTTP: `GET /support?buildingId=...`; `PUT /support/:buildingId` com `displayName`, `anydeskId`, `enabled`; `POST /support/:buildingId/requests` com `requestId` e `reason`; `PATCH /support/:buildingId/requests/:id` com `outcome` e `notes`. Respostas tipadas no contrato compartilhado. As credenciais remotas não entram na plataforma.

## Evidências da conclusão local

Contrato e API passaram por testes antes da implementação. A revisão identificou identificadores malformados, recuperação da tela após falha de consulta e divergência de relógios no encerramento; todos foram corrigidos e verificados. Migração 010 aplicada, fluxo conferido no navegador com dados temporários removidos e nenhum cliente externo acionado. A regressão posterior de gestão inclui o suporte: API 77, ingestão 50, interface 17; tipos e build aprovados. Detalhes em `docs/REVISAO_FUNCIONALIDADES.md`.
