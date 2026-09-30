# Descoberta de condomínio por recursos existentes — plano de implementação

> **For agentic workers:** usar subagent-driven-development, TDD e revisões de conformidade e qualidade. O agente principal integra, verifica, faz commit e push; o implementador não altera Git nem documentação.

**Goal:** impedir descoberta do cadastro e do estado básico de um condomínio por concessões que apontem para recursos inexistentes ou pertencentes a outro condomínio.

**Architecture:** migration aditiva substitui somente a função de descoberta de 016 e introduz um validador interno de pertencimento do recurso. A autorização vigente continua sendo decidida por app_has_capability. O validador não concede capacidades operacionais e não pode ser chamado diretamente pelas credenciais da aplicação, identidade ou broker.

**Tech Stack:** PostgreSQL existente, TypeScript e testes reais de HTTP/RLS, sem dependências novas.

## Dependência e responsabilidade dos arquivos

Executar após HTTP e SSE de alertas estarem estáveis, aprovados e verificados. Worktree product-platform, branch codex/product-platform; banco isolado localhost:5436 com scripts 001–018. Nunca seed, db:push, reset ou reaplicação de migration antiga.

- Criar infrastructure/019-building-discovery-resource-validation.sql.
- Criar apps/api/test/building-discovery-resources.test.ts.
- Modificar somente a fixture de apps/api/test/building-feature-capabilities.test.ts: substituir o ID fictício sensor-a por um dispositivo real e único do condomínio A, usando o mesmo ID nas concessões. Hoje a fixture concede um recurso que não existe; manter suas asserções positivas e negativas.
- Não alterar catálogos, guards compartilhados, policies operacionais, identidade/broker ou arquivos 014–018. O agente principal atualiza o tracker e docs/AUTORIZACAO.md.

## Contrato de descoberta

Preservar app_has_global_capability('buildings:read') para diretório global, inclusive cadastros inativos. No ramo local, manter tenant ativo e capacidade inteira buildings:read. Nos ramos de pessoa/equipe com resource_type não nulo e suporte, exigir autorização atual E pertencimento real do recurso.

```sql
-- Interna: owner administrativo de app_has_capability, search_path fixo.
-- Nenhuma permissão de EXECUTE a PUBLIC, app, identity ou broker.
app_discovery_resource_belongs(
  target_building_id text,
  target_resource_type text,
  target_resource_id text
) RETURNS boolean
```

O helper deve usar uma whitelist fixa e consultas por chave do recurso, sem SQL dinâmico. Par nulo representa concessão inteira; somente um nulo, IDs vazios/inválidos, tipo desconhecido ou entidade ausente retornam false. UUID inválido retorna false sem SQLSTATE 22P02. Não consultar conteúdo privado nem retornar dados do recurso.

Mapeamentos existentes:

| Tipo | Entidade / identidade | Pertencimento |
| --- | --- | --- |
| building | buildings.id text | ID igual ao target; não promove grant a tenant inteiro |
| device | devices.id text | devices.building_id igual ao target |
| gateway | gateways.id text | gateways.building_id igual ao target |
| block | blocks.id UUID | blocks.building_id igual ao target |
| unit | units.id UUID | units.building_id igual ao target |
| team | teams.id UUID | teams.building_id igual ao target |
| membership | memberships.id OU unit_memberships.id UUID | building_id da entidade encontrada igual ao target |
| alert | alerts.id UUID | alerts.building_id igual ao target; não amplia leitura do alerta |
| finance | financial_reports.id UUID | financial_reports.building_id igual ao target |
| notice | notices.id UUID | notices.building_id igual ao target |
| occurrence | occurrences.id UUID | occurrences.building_id igual ao target |
| support_grant | support_grants.id UUID | support_grants.building_id igual ao target |

work_order e automation ainda não possuem as entidades do produto; retornar false até suas migrations criarem um mapeamento concreto. telemetry não possui identidade UUID global única independente de time/device; retornar false para esse tipo na descoberta básica. A leitura técnica continua autorizada por device, conforme 017. Não inventar mapeamento para ID ambíguo nem enumerar o histórico de telemetria.

Pertencimento não significa recurso habilitado ou operacional: equipamento desativado pode continuar visível para diagnóstico autorizado. Conta, papel, permissão, equipe, vínculo, suporte e tenant vigentes continuam sendo responsabilidade dos helpers atuais. A projeção global de cadastro permanece intacta e não recebe conteúdo privado.

## Tarefa 1 — RED com fixtures válidas e inconsistentes

- [ ] Criar dois tenants, IDs e fixtures únicos; pessoa com binding limitado a recurso e suporte com PLATFORM_SUPPORT vigente, sem memberships inteiros que mascarem a falha.
- [ ] Inserir concessão declarada no A e gateway/dispositivo real do B pelo owner. No comportamento de 016, demonstrar descoberta indevida do A por SQL e HTTP. Inserir também ID de recurso inexistente.
- [ ] Verificar GET /buildings, GET /buildings/:id, GET /features/buildings/:id e SELECT sem filtro das três tabelas buildings/building_feature_settings/feature_runtime.

```ts
assert.equal((await request(user, `/buildings/${a}`)).status, 403);
assert.equal((await request(user, `/features/buildings/${a}`)).status, 403);
assert.deepEqual((await request(user, '/buildings')).body.items, []);
assert.equal(await discoveryAs(user, a), false);
assert.equal(await featureRowsAs(user, a), 0);
```

GET individual de buildings e features usa assertBuildingDiscovery e retorna 403 para escopo ausente; preservar esse contrato. A lista e SQL não podem expor dados do A. A conta desativada é recusada pela sessão antes do domínio e recebe 401.

- [ ] Corrigir a fixture sensor-a antiga para recurso real sem enfraquecer asserções. O RED novo deve falhar por descoberta indevida, não por setup.

## Tarefa 2 — GREEN da migration

- [ ] Implementar CASE fixo de pertencimento com casts UUID seguros; consultas por PK. Helper owner administrativo, STABLE SECURITY DEFINER, search_path public,pg_temp, EXECUTE somente do owner.
- [ ] Substituir app_can_discover_building preservando assinatura/owner/grant app: aplicar pertencimento dentro dos ramos existentes de binding de recurso e suporte. Concessão de suporte inteira com null/null preserva comportamento.
- [ ] Aplicar 019 via docker cp e psql -v ON_ERROR_STOP=1 --single-transaction, sem BEGIN/COMMIT no arquivo; reaplicar e confirmar idempotência. Não reaplicar 016.
- [ ] Verificar chamadas autorizadas de descoberta passam; chamada direta do helper interno pela credencial app/identity/broker falha 42501. app.role forjado não deve autorizar descoberta.

## Tarefa 3 — acesso atual e preservação

- [ ] Testar os mapeamentos existentes com recurso do A, mesmo tipo do B, ausência e UUID inválido; tipos futuros/telemetry negados. Testes de helper puro com owner não substituem provas HTTP/RLS com credencial restrita.
- [ ] Acesso positivo por pessoa, equipe e suporte em recurso real, tenant inteiro e membership legado vigente. Pessoa com duas concessões inválidas mais uma válida descobre somente o tenant válido.
- [ ] Mesmo JWT perde descoberta após exclusão do recurso, revogação/expiração do binding, equipe desativada/integrante revogado, concessão de suporte revogada/expirada ou papel global de suporte revogado.
- [ ] Global com buildings:read continua listando tenant inativo; local com organização/condomínio/conta inativos não descobre. Preservar restrição operacional: recurso válido não concede devices:read/telemetry:read/alerts:read no tenant inteiro, nem alteração de cadastro/funcionalidades.
- [ ] Comparar policies/grants de identidade/broker e catálogo para comprovar ausência de alterações laterais. Alertas e telemetria mantêm acesso ao estado de funcionalidades pelas policies 017/018 mesmo sem descoberta básica.

```powershell
pnpm --filter @predioon/api exec node --import tsx --test --test-concurrency=1 test/building-discovery-resources.test.ts test/building-feature-capabilities.test.ts test/alert-capabilities.test.ts test/telemetry-capabilities.test.ts
pnpm --filter @predioon/api typecheck
pnpm check:boundaries
git diff --check
```

Configurar as quatro DSNs de teste com papéis predioon, predioon_app, predioon_identity e predioon_broker_auth, usuário/senha iguais ao papel somente nesse banco local. RUN_ACCESS_DB_TESTS=1 e RUN_RBAC_DB_TESTS=1. Logs distintos em .local; cleanup de fixtures/sessões em finally. Não registrar DSNs de produção.

## Tarefa 4 — aceite e integração

- [ ] Revisão de conformidade read-only; corrigir e rever achados.
- [ ] Revisão de qualidade após conformidade aprovada; corrigir e rever achados.
- [ ] Agente principal executa regressão completa com fonte estável e banco livre, registra contagens reais sem skips/cancelamentos, atualiza autorização/tracker e integra por commit/push na branch existente.

Estado: planejado para corrigir o achado de descoberta básica identificado durante a revisão de alertas. Não encerra 2B.3 nem concede escopos operacionais novos.
