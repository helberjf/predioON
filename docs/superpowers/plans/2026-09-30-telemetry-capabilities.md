# Telemetria por capacidade — plano de implementação

> **For agentic workers:** usar `subagent-driven-development` para implementação e revisões de conformidade e qualidade. Execução já autorizada pelo usuário; sem stage ou commit sobre as alterações anteriores.

**Goal:** autorizar leituras técnicas por equipamento e manter a informação básica de nível de água para moradores sem conceder acesso técnico completo.

**Architecture:** uma API e um banco central. A política da hypertable consulta um conjunto de pares condomínio/equipamento autorizados por consulta; não verifica concessões em cada amostra. Uma função separada expõe somente a projeção básica de água, com capacidade explícita e campos normalizados.

**Tech Stack:** TypeScript, Express, Drizzle, PostgreSQL/Timescale; reutilizar dependências existentes.

## Limites e arquivos

Worktree: `C:/Users/default.LAPTOP-K8F2QHAF/.codex/worktrees/product-platform/predioON`. Banco de teste exclusivo: porta 5436, container `predioon-product-test-db-1`. Não tocar dados de produção, seed ou schema anterior.

- Criar `infrastructure/017-telemetry-capabilities.sql`: políticas de leitura da telemetria, projeções privilegiadas restritas e catálogo aditivo.
- Modificar `apps/api/src/modules/telemetry/routes.ts`: conservar `/latest`, `/series` e os formatos atuais; consultar capacidade dentro da transação, sem guards legados.
- Criar `apps/api/src/modules/telemetry/authorization.ts`: funções e tipos locais para projeções autorizadas e resolução de funcionalidades.
- Modificar `packages/shared/src/rbac.ts`: adicionar `telemetry:read-published` aos quatro papéis locais, sem alterar a allowlist global ou de suporte.
- Criar `apps/api/test/telemetry-capabilities.test.ts`; adaptar fixtures dos testes afetados somente quando dependem da antiga leitura irrestrita da plataforma. Não mudar respostas esperadas de isolamento para esconder regressões.
- Documentação e tracker pertencem ao agente principal.

## Decisões obrigatórias

1. `telemetry:read` permanece uma capacidade privada, avaliada com recurso `device` e ID do equipamento. Vínculos de condomínio inteiro cobrem seus equipamentos; vínculos de recurso cobrem apenas o recurso exato. Conta, organização, condomínio, papel, equipe e concessão precisam estar vigentes. Administração global não concede leitura privada. Suporte exige sua concessão diagnóstica atual, inclusive tempo e recurso.
2. Substituir somente `telemetry_scope_policy`; não ampliar `app_can_access_building`, `app_governance_access` ou policies de equipamentos/alertas ainda pendentes. Rejeitar contexto `app.role` forjado. A credencial app continua sem escrita em telemetria.
3. Usar um conjunto autorizado com os dois identificadores para evitar que uma amostra com condomínio divergente herde acesso pelo ID do dispositivo:

```sql
USING ((building_id, device_id) IN (
  SELECT building_id, device_id FROM app_telemetry_authorized_devices(NULL)
));
```

A função recebe filtro opcional de condomínio; retorna somente `building_id`, `device_id`, nome, tipo e classificação mínima de portão/estacionamento necessária às funcionalidades. Considerar candidatos dos vínculos próprios, memberships e suporte antes de avaliar equipamentos. `app_has_capability(building_id,'telemetry:read','device',device_id)` decide a autorização final. O conjunto é avaliado uma vez por consulta, evitando consultas RBAC por amostra.
4. Não depender de `SELECT` na tabela `devices`: uma concessão de telemetria não implica `devices:read`. A projeção técnica mínima nunca retorna metadata, endereço de hardware, credenciais MQTT, gateway ou configuração. Usar a mesma projeção para localizar o dispositivo de `/series` e nomear `/latest`.
5. A capacidade nova `telemetry:read-published` autoriza somente a projeção de nível de água. A função `app_published_water_levels(target_building_id)` retorna a última leitura dos últimos sete dias, por equipamento, apenas da métrica `water_level_percent`. Avalia essa capacidade com recurso `device`; concede-a explicitamente aos quatro papéis locais, nunca como efeito do aplicativo utilizado. Suporte não recebe essa capacidade por sua allowlist.
6. A projeção publicada conserva os campos do DTO `LatestReading`: `device_id`, `device_name`, `metric`, `value`, `numeric_value`, `unit`, `quality`, `time`. `value` e `numeric_value` são exclusivamente o número finito do nível (0–100) ou null; não repassar JSON arbitrário da amostra. Métrica e unidade são constantes; quality deve ser normalizada ao enum existente. Sem event_id, metadata, outras métricas, série histórica ou configuração. Funcionalidade WATER_TANK pausada não publica leitura; após retomada, exigir amostra posterior a `resumed_at`.
7. `/latest?buildingId=…` aceita capacidade técnica ou publicada no escopo. Permitir concessão limitada a um equipamento sem promover ao condomínio inteiro. Unir resultados técnicos autorizados e publicados sem duplicar dispositivo/métrica, dando precedência à leitura técnica quando autorizada. Um condomínio descoberto apenas com `devices:read` não autoriza telemetria. Conta sem concessão de leitura nesse escopo recebe 403 mesmo quando não há amostras.
8. `/series` exige `telemetry:read` no equipamento; moradores com somente publicação não acessam a série. Recurso ausente ou alheio não expõe sua existência. Buckets continuam na whitelist; conservar intervalo, agregações e histórico técnico. Ler estado das funcionalidades com projeções autorizadas, sem chamar `buildingFeatures` que ainda tem guard legado. Preservar semântica de métricas, estacionamento, portões e retomada, e o lock compartilhado já obtido por `inTenantContext`.
9. Funções privilegiadas: owner consistente com `app_has_capability`, `STABLE`, `SECURITY DEFINER`, `search_path` fixo, revoke PUBLIC/identity/broker; grant EXECUTE somente app. São somente leitura, sem assumir app.role ou executar SQL dinâmico. Migration aditiva, reaplicável e aplicada via `psql --single-transaction`.
10. A leitura do estado de funcionalidades não pode depender de `buildings:read` permanecer concedida. Sua retirada independente não deve ocultar as configurações locais da consulta e fazer `readFeatures` resolver defaults habilitados. Adicionar políticas SELECT específicas em `building_feature_settings` e `feature_runtime`, limitadas à autorização atual de telemetria técnica/publicada, por condomínio ou equipamento. O helper `app_telemetry_can_read_feature_state` não lê tabelas de funcionalidades, evitando recursão. Preservar políticas da migration 016 e todos os direitos de escrita. Testar pausa/retomada quando somente a capacidade `buildings:read` é retirada.

## Tarefa 1 — reproduzir as lacunas

- [x] Criar fixture isolada com dois condomínios, dois equipamentos no A e um no B, várias métricas e amostras. Criar manutenção direta, por equipe, por equipamento, morador, suporte e plataforma com vínculo global explícito, sem memberships para os novos papéis.
- [x] Escrever testes antes da implementação: manutenção tem `/latest` e `/series`; equipamento limitado não revela vizinho; suporte de telemetria funciona sem `devices:read`; descoberta sem telemetria retorna 403; morador só recebe projeção água; JSON adversarial não aparece; plataforma global e papel forjado não leem amostras.

```ts
assert.equal((await call(server.url, `/telemetry/latest?buildingId=${a}`, {token: workerToken})).status, 200);
assert.equal((await call(server.url, `/telemetry/latest?buildingId=${b}`, {token: workerToken})).status, 403);
assert.equal((await call(server.url, `/telemetry/series?deviceId=${deviceA}&metric=water_level_percent`, {token: residentToken})).status, 404);
assert.deepEqual(items.map(row => row.metric), ['water_level_percent']);
assert.equal(items[0].value, 42);
```

- [x] Rodar o arquivo novo e registrar RED de comportamento, não erro de import/setup. Fixtures novas são as únicas linhas alteradas; limpeza exata em finally/after.

## Tarefa 2 — implementar e verificar

- [x] Adicionar catálogo e SQL017. Aplicar somente no teste com `docker cp` e `psql -v ON_ERROR_STOP=1 --single-transaction -f`, preservando UTF-8. Reaplicar para verificar idempotência.
- [x] Implementar os helpers locais e handlers acima; nenhum novo framework ou dependência.
- [x] Testar revogação e expiração com o mesmo JWT; equipe/conta/organização/condomínio inativos; suporte sem papel ou concessão; concessão de outro recurso; SQL sem filtro e pares divergentes; app sem INSERT/UPDATE/DELETE; privilégios das funções.
- [x] Verificar funcionalidades pausadas/retomadas e métricas mistas. O helper mínimo não pode ocultar a classificação de uma funcionalidade apenas porque o usuário não tem `devices:read`.
- [x] Executar EXPLAIN (ANALYZE, FORMAT JSON) com amostras próprias suficientes: conjunto de recursos avaliado por consulta, sem chamada RBAC por amostra. Não exigir tipo específico de plano dependente do volume.
- [x] Adaptar fixture de teste que antes esperava acesso técnico global: conferir existência com owner e negar plataforma sem concessão; quando testar funcionalidade técnica, dar concessão local temporária no escopo da fixture e removê-la. Não elevar seed nem produto.

Com as quatro DSNs do teste na porta 5436 e flags `RUN_ACCESS_DB_TESTS=1`, `RUN_RBAC_DB_TESTS=1`:

```powershell
pnpm --filter @predioon/api exec node --import tsx --test --test-concurrency=1 test/telemetry-capabilities.test.ts
pnpm --filter @predioon/api test
pnpm typecheck
pnpm check:boundaries
```

Esperado: todos os testes executados, sem skips, tipos e fronteiras aprovados. Testes de regressão completos pertencem ao agente principal após fonte estável e banco livre.

## Tarefa 3 — aceite técnico

- [x] Revisão independente de conformidade; resolver e rever achados.
- [x] Após conformidade aprovada, revisão independente de qualidade; resolver e rever achados.
- [x] Registrar evidência, limitações e documentação das duas capacidades. A migração de equipamentos, gateways, alertas, monitoramento, dashboards e SSE ainda permanece na etapa 2B.3.

Estado: concluído em 30/09/2026. TDD, reaplicação transacional idempotente, 21 testes novos, regressão completa API 197/197 sem skips, tipos dos dez pacotes e fronteiras passaram; revisões de conformidade/qualidade aprovadas. A [entrega SSE de telemetria](2026-09-30-telemetry-events-capabilities.md) foi concluída com regressão completa 210/210; os demais tipos de eventos seguem no recorte de eventos da etapa 2B.3.
