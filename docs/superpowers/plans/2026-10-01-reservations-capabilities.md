# Reservas próprias e calendário mínimo — 029

> **For agentic workers:** usar subagent-driven-development e TDD; conformidade antes de qualidade. Executar depois de 028; o agente principal mantém documentação/Git.

**Goal:** migrar reservas para capacidades atuais e separar calendário de ocupação dos dados privados de cada solicitante.

**Architecture:** o GET de reservas completas retorna somente reservas próprias ou gerenciáveis. Uma projeção de disponibilidade entrega exclusivamente intervalos ocupados da área autorizada. A constraint de exclusão continua garantindo que PENDING/CONFIRMED não se sobreponham, inclusive sob concorrência.

**Tech Stack:** PostgreSQL, Express, Drizzle, shared e contracts existentes; sem biblioteca nova.

## Decisões e arquivos

Adicionar `reservations:create-own`, `reservations:read-own`, `reservations:cancel-own` e `reservations:read-calendar` aos quatro papéis locais; `reservations:manage` somente a BUILDING_ADMIN. Sem concessão global ou extensão da whitelist de suporte. Acrescentar recurso `reservation` aos validadores/constraints e resolver pertencimento pela PK/tenant/área reais. Read-own/cancel-own exigem o solicitante real. Capacidade em common_area pode valer para reservas dessa área somente nos helpers deste domínio, com vínculo real; área concedida não concede outra área nem seus solicitantes. Gestão precisa também de common-areas:read no contexto da área real ou da reserva concedida; neste último caso, usar somente uma projeção mínima do pai necessário à decisão, sem abrir seu cadastro/lista geral ou o calendário de outras reservas.

Criar `infrastructure/029-reservations-capabilities.sql`, `apps/api/src/modules/reservations/authorization.ts`, `apps/api/test/reservations-capabilities.test.ts` e `packages/contracts/src/reservations.ts`; modificar `apps/api/src/modules/reservations/routes.ts`, `packages/shared/src/rbac.ts`, `packages/contracts/src/index.ts` e as asserções necessárias de `apps/api/test/rbac-tenancy-unit.test.ts`. UI de gestão por capacidades/calendário é entrega posterior; a tela atual de Minhas reservas continua com o mesmo DTO.

## Tarefa 1 — RED e privacidade

- [ ] Fixtures próprias em dois condomínios/áreas, dois solicitantes, síndico inteiro/exato e equipe sem membership. Solicitação/lista própria funcionam; usuário, unit e notes de vizinhos não aparecem em GET sem gestão, inclusive mine=false e parâmetro ausente.
- [ ] Gestão inteira vê/decide o escopo; concessão em área gerencia somente reservas daquela área, concessão em reserva gerencia somente esse objeto. Suporte/global flag, concessão estrangeira/inexistente e capabilities de outros domínios não liberam conteúdo.
- [ ] GET `/reservations/availability?buildingId=...&areaId=...&from=...&to=...` entrega somente startsAt/endsAt ocupados de PENDING/CONFIRMED na área autorizada. Não devolve ID de reserva/usuário/unidade, notes, status individual, decidedBy ou timestamps de criação; dados cancelados/rejeitados não bloqueiam.
- [ ] Testar mine='false' como false real: corrigir o z.coerce.boolean atual que converte a string 'false' em true. Administrador não perde a fila por esse parâmetro; RLS continua escondendo terceiros do solicitante.
- [ ] SQL sem WHERE não lê terceiros, referências owner-inconsistentes permanecem ocultas; identidade/tenant/area/user/período/notas/criação não são alteráveis por UPDATE do app. INSERT forjando user_id, tenant ou decisão negado; DELETE físico negado.
- [ ] Registrar RED com `pnpm --filter @predioon/api exec node --import tsx --test --test-concurrency=1 test/reservations-capabilities.test.ts` antes das mudanças.

## Tarefa 2 — SQL, fluxo e concorrência

- [ ] Acrescentar apenas cinco permissões e seus vínculos, resource_type reservation nos validadores/constraints atuais e case de pertencimento real no helper owner-only de descoberta. Preservar tipos antigos, relógio 021, owner/ACLs e whitelist de suporte; ON CONFLICT não reativa concessões suspensas.
- [ ] Helpers pontuais/scoped SECDEF STABLE, public,pg_temp, owner RBAC, app-only. UUID inválido nega sem cast/oracle. Pai common_area precisa pertencer ao mesmo building; leitura/cancelamento de reserva existente continua possível quando área é desativada, mas criar exige área ativa.
- [ ] Substituir somente policies legadas de reservations. SELECT = usuário real+read-own ou manage do recurso/área real. INSERT exige ator igual a user_id, read-own/create-own e common-areas:read no pai ativo; status inicial corresponde a requiresApproval atual e nenhum decidedBy/At inicial fornecido pelo cliente. Concessão em reserva existente não cria outra reserva.
- [ ] UPDATE direto somente gestor, limitado a status/decided_by/decided_at/updated_at; nenhuma identidade ou período mutável. Cancelamento próprio por rotina VOLATILE SECDEF estreita sem parâmetros de status/ator/timestamps, com autorização antes do lock e revalidação após espera usando clock_timestamp interno, mantendo período/decisão anteriores. Não conceder UPDATE administrativo ao solicitante.
- [ ] Projeção de calendário autoriza read-calendar e área real antes de consultar intervalos; usa índice área/início e limite from/to máximo de 31 dias, com timezone/instantes explícitos. Não extrai metadata privada para depois descartá-la. Preservar a constraint reservations_no_overlap e reservations_valid_period; não recriar nem afrouxar estas constraints.
- [ ] Estado de funcionalidades por escopo do domínio, sem depender de buildings:read/manage; extender somente OR local de feature-event atual. Auditorias RESERVATION_CREATED/CANCELLED e CONFIRMED/REJECTED exigem ator/recurso/tenant reais e capacidade correspondente; demais branches ficam idênticas.
- [ ] Aplicar/reaplicar só 029 atomicamente no banco isolado; catálogo/grants/policies alheios preservados. EXPLAIN real da projeção de calendário não seleciona campos privados e o helper pontual usa PK.

## Tarefa 3 — handlers e integração

- [ ] Remover assertBuildingAccess/buildingRole/assertFeature legados deste módulo. Autorizar antes de readFeatures sob lock compartilhado, conservar RESERVATIONS. GET usa tempo PostgreSQL como default from, boolean explícito e RLS de dados privados; final statement revalida os recursos antes do DTO.
- [ ] POST valida duração/período futuro com relógio PostgreSQL, lê área real e revalida configuração antes de inserir; conserva maxHoursPerBooking e aprovação automática quando requiresApproval=false. Server UUID, INSERT e leitura em statement seguinte, auditoria na mesma transação. Nenhum campo do body altera tenant/solicitante/status inicial.
- [ ] Decisão/cancelamento leem/autorizam antes dos locks; reconsultam RLS/capacidades/estado após a espera. Decisão vale para PENDING, a repetição do mesmo estado decidido é idempotente; estado diferente já encerrado recebe 409. Cancelamento repetido é 204 idempotente; rejeição não é convertida em reserva ativa. Preservar histórico da decisão e auditar somente mudança efetiva.
- [ ] PostgreSQL 23P01 continua 409 genérico, inclusive concorrência real entre dois solicitantes e confirmação sobre intervalo já ocupado. Revogação/expiração individual/equipe durante row wait impede status/auditoria; falha na auditoria reverte reserva/decisão. Espera observada/limitada, finally libera locks e observa rejeições.
- [ ] Dirigido serial: reservations-capabilities, common-areas-capabilities, security, feature-enforcement/features-lifecycle, autorização de vigência, RBAC/tenancy. Tipos API/shared/contracts/consumidores, fronteiras/diff-check, catálogo preciso e cleanup zerado; conformidade, qualidade, API integral do agente principal e commit/push da meta verificada.

Estado: planejado, não implementado nem validado. Calendário mínimo é endpoint novo; dados privados continuam no DTO existente apenas para seu escopo. Depende de 028 e não encerra 2B.3 ou o plano total.
