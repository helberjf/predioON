# Áreas comuns por capacidades — 028

> **For agentic workers:** usar subagent-driven-development e TDD; conformidade antes de qualidade. Executar depois de 027; o agente principal mantém documentação/Git.

**Goal:** migrar `/common-areas` para escopo atual e impedir que um PATCH de nome redefina silenciosamente a configuração de reservas.

**Architecture:** leitura e gestão explícitas no condomínio/área real. Helpers pontuais e policies separadas preservam tenant/identidade; a configuração e sua auditoria confirmam juntos. Reservas recebem sua própria migration subsequente.

**Tech Stack:** PostgreSQL, Express, Drizzle e catálogo compartilhado existentes, sem nova biblioteca.

## Decisões e arquivos

Adicionar `common-areas:read` aos quatro papéis locais e `common-areas:manage` somente a BUILDING_ADMIN. Não adicionar estas capacidades aos papéis globais nem ao suporte temporário. Acrescentar o recurso `common_area` ao catálogo/schema RBAC, às constraints de escopo e ao validador atual; o pertencimento de descoberta resolve a PK real e seu building. Não modificar relógio/whitelist de suporte ou capacidades operacionais de outros domínios.

Criar `infrastructure/028-common-areas-capabilities.sql`, `apps/api/src/modules/common-areas/authorization.ts`, `apps/api/test/common-areas-capabilities.test.ts`; modificar `apps/api/src/modules/common-areas/routes.ts`, `packages/shared/src/rbac.ts` e somente as asserções necessárias de `apps/api/test/rbac-tenancy-unit.test.ts`. Consumidores continuam com DTO e rotas existentes; ações de UI por capacidade são integração posterior de 2B.4.

Prova local em 01/10/2026 com a versão instalada do Zod: `z.object({ name, opensAt: z.string().default('08:00'), ... }).partial().parse({name:'Renomeado'})` materializa opensAt/closesAt/requiresApproval/maxHoursPerBooking omitidos. O schema PATCH atual usa esse padrão. Este recorte deve construir campos opcionais sem herdar defaults de criação; renomear não pode restaurar horários/limites/aprovação.

## Tarefa 1 — RED

- [ ] Fixtures próprias com dois condomínios e áreas ativas/inativas; indivíduos/equipe sem membership, síndico específico e síndico no A/morador no B. Leitura/gestão no recurso real funcionam; concessão em área alheia/inexistente, global flag e suporte técnico não liberam o módulo.
- [ ] POST exige read/manage inteiras, pois cria nova área. Gestor de área exata edita sua área, inclusive inativa, mas não cria outras. Leitor sem gestão recebe 403 na ação sobre objeto legível; objeto oculto ou ID inválido recebe 404.
- [ ] Testar PATCH somente name em área com horários customizados, requiresApproval false e maxHoursPerBooking diferente de 6: todos os campos omitidos permanecem idênticos. Rejeitar chaves desconhecidas e tentativa de trocar identidade/tenant/created_at.
- [ ] Mesmo JWT perde acesso por revogação/expiração de pessoa/equipe/membro, papel/permission/conta/tenant inativos. SQL app sem filtro esconde áreas alheias; escrita sem configuração e DELETE permanecem negados.
- [ ] Registrar RED com `pnpm --filter @predioon/api exec node --import tsx --test --test-concurrency=1 test/common-areas-capabilities.test.ts` antes da migration e das alterações dos handlers.

## Tarefa 2 — SQL e autorização

- [ ] Nova migration aditiva acrescenta somente duas permissões, seus vínculos de catálogo e o resource_type concreto. ON CONFLICT não reativa grants/permissões manualmente suspensos e conserva timestamps existentes. Estender app_rbac_scope_valid e as constraints atuais de role_bindings/support_grants apenas com common_area, preservando todas as outras condições e a whitelist diagnóstica de suporte.
- [ ] Estender somente os cases/tipos necessários de app_discovery_resource_belongs vigente para validar common_area por PK/building. Preservar owner/ACL owner-only, demais cases e negação de tipos ainda sem entidade real; não copiar helpers centrais antigos ou reaplicar 019.
- [ ] Helper pontual SECDEF STABLE, public,pg_temp, owner do RBAC e app-only; UUID textual inválido retorna false antes do cast. Whitelist read/manage, tenant/área real e vigência 021. Helper de escopo permite conjunto vazio em concessão inteira e exige área real para concessão específica.
- [ ] Substituir somente common_areas_read_policy/write_policy por SELECT/INSERT/UPDATE específicas. SELECT exige read; INSERT read/manage inteiras; UPDATE exige ambas no recurso real. Grant de UPDATE somente name/description/capacity/rules/opens_at/closes_at/requires_approval/max_hours_per_booking/active/updated_at, sem identidade/tenant/criação; DELETE revogado.
- [ ] State policies aditivas permitem readFeatures no escopo real sem depender de buildings:read/manage. Estender somente o OR local de app_can_read_feature_event atual, conservando autorização global e branches dos domínios anteriores.
- [ ] Auditoria COMMON_AREA_CREATED e novo COMMON_AREA_UPDATED exigem ator/tenant/área reais e read/manage; criação exige também concessão inteira. Demais branches do CASE ficam idênticas.
- [ ] EXPLAIN do helper real usa PK; estado/escopo não consulta bookings/histórico. Comparar catálogo e ACLs fora das adições autorizadas, incluindo microsegundos; aplicar/reaplicar somente 028 atomicamente no banco isolado com ON_ERROR_STOP.

## Tarefa 3 — handlers e integração

- [ ] Remover assertBuildingAccess/assertFeature legados somente deste módulo. Autorizar domínio antes de readFeatures sob lock compartilhado; conservar RESERVATIONS e filtro active=true do GET, sem default habilitado por estado escondido.
- [ ] POST gera UUID no servidor, insere e lê em statement seguinte, confirma auditoria na mesma transação. PATCH usa schema estrito sem defaults, leitura/autorização antes de FOR UPDATE, novas consultas de RLS/capacidades após espera e updated_at do PostgreSQL.
- [ ] Revalidar escopo/recursos antes de entregar linhas em memória. Espera de row lock real, limitada/observada, com revogação/expiração individual/equipe e cleanup finally; alteração e auditoria não persistem ao perder direito ou falhar auditoria.
- [ ] Dirigido serial: common-areas-capabilities, security, feature-enforcement, features-lifecycle, autorização de vigência, RBAC e tenancy. Compatibilidade das reservas antigas não exige reintroduzir o bypass global de áreas; a autorização restante de reservas é tarefa seguinte.
- [ ] Tipos da API/shared/consumidores afetados, fronteiras, diff-check, catálogo/ACL e cleanup zerados; conformidade, qualidade e correções. Agente principal API integral em fonte estável/DB livre, documentação, commit/push da meta verificada.

Estado: planejado, não implementado nem validado. A materialização de defaults foi reproduzida localmente; a correção e a migração ainda não existem. Depende de 024–027. Reservas, financeiro, demais domínios, identidade, workers, mobile e operação seguem abertos.
