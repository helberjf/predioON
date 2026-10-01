# Monitoramento e consumo por equipamento — 023

> **For agentic workers:** usar subagent-driven-development e TDD; revisão de conformidade antes de qualidade. O agente principal integra documentação e Git. Iniciar após o aceite e publicação de 022.

**Goal:** migrar `/monitoring`, perfis, totais diários e cursors para capacidades atuais do equipamento, preservando os cálculos e contratos existentes.

**Architecture:** consumo e análise derivados exigem `telemetry:read` no dispositivo real; configurar o perfil exige também `devices:read` e `devices:configure` nesse dispositivo. Uma projeção mínima fornece contexto necessário ao cálculo sem conceder inventário privado. RLS autoriza o par condomínio/perfil e valida todas as relações reais.

**Tech Stack:** PostgreSQL, Express, Drizzle e testes TypeScript existentes; nenhuma dependência, backend ou permissão de catálogo nova.

## Decisões e limites

O catálogo aprovado separa leitura de telemetria de configuração de equipamento. Reutilizar essa separação: `telemetry:read` inclui consumo, custos estimados e análise técnica já retornados pelo DTO de monitoramento. Estas estimativas não concedem acesso a lançamentos, relatórios financeiros ou faturamento comercial. `telemetry:read-published` continua restrita à projeção percentual de água de 017 e não libera estes perfis, custos ou histórico. Morador e administrador global sem concessão local não leem monitoramento privado. Suporte com leitura técnica temporária pode diagnosticar somente os dispositivos concedidos; não configura perfis nem recebe metadata/configuração bruta do equipamento.

Concessão em dispositivo não se propaga a gateway nem a outro dispositivo. Perfil é configuração de um dispositivo existente: concessão de configuração específica pode criar/editar seu perfil; não é criação de equipamento e não exige concessão inteira ao condomínio. Não introduzir o tipo de recurso `monitoring_profile` no RBAC; o perfil sempre resolve seu dispositivo real. Não mudar ingestão, algoritmos de consumo/análise, regras de alerta, feature transitions, atuação física ou projeções de outros domínios neste recorte.

Arquivos:

- Criar `infrastructure/023-monitoring-capabilities.sql`.
- Criar `apps/api/src/modules/monitoring/authorization.ts` para consultas mínimas e verificações.
- Modificar `apps/api/src/modules/monitoring/routes.ts`.
- Criar `apps/api/test/monitoring-capabilities.test.ts`.
- Fixtures anteriores só podem ser ajustadas quando a regressão demonstrar uma concessão local ausente ou uma expectativa incompatível; não afrouxar asserções de cálculo, pausa, RLS ou auditoria.

## Tarefa 1 — RED de HTTP e RLS

- [ ] Criar fixtures exclusivas em dois condomínios, dispositivos WATER/ENERGY/PUMP, gateway estrangeiro, perfis e totais/cursors. Usar relógio PostgreSQL para vigência; cleanup em finally, sem seed/db:push/reset.
- [ ] Manutenção individual/equipe sem membership legado lê seus perfis e derivados; concessão específica retorna somente seu dispositivo. Síndico configura; manutenção/manager e suporte são somente leitura. Síndico no A e morador no B não altera B.
- [ ] Suporte somente `telemetry:read`, sem `devices:read`, lê diagnóstico e preserva a forma do DTO; inventário e configuração continuam negados. Somente `devices:read`, `devices:configure`, `telemetry:read-published`, descoberta básica ou concessão em gateway não liberam consumo privado.
- [ ] Mesmo JWT perde a próxima consulta por revogação/expiração de binding, membro/equipe, suporte ou papel de suporte; conta, organização, condomínio, papel e permission inativos negam. `app.role` forjado e flag global não liberam monitoramento privado.
- [ ] SQL restrito sem WHERE não retorna perfis/totais/cursors alheios. Linhas criadas pelo owner com perfil/dispositivo/condomínio inconsistentes permanecem ocultas; UPDATE não troca tenant, dispositivo, kind ou ID, DELETE e DML de agregações permanecem negados.
- [ ] Registrar RED antes da migration. Exemplos de comportamento:

```ts
assert.equal((await f.request(f.support, `/monitoring?buildingId=${f.a}`)).status, 200);
assert.equal((await f.request(f.resident, `/monitoring?buildingId=${f.a}`)).status, 403);
assert.equal((await f.request(f.platform, `/monitoring?buildingId=${f.a}`)).status, 403);
assert.equal((await f.request(f.worker, `/monitoring/${f.profile}`, "PATCH", { tariff: 0 })).status, 403);
```

## Tarefa 2 — SQL e projeção mínima

- [ ] Helpers SECDEF STABLE, owner igual ao `app_has_capability`, search_path public,pg_temp. Validar PK do perfil, seu building/device e o tenant real do dispositivo/gateway por helper de pertencimento 020. Usar a janela corrigida por 021; não aceitar instante do cliente nem copiar a versão antiga dos helpers centrais.
- [ ] Helper pontual de autorização do perfil aceita somente `telemetry:read`, `devices:read` ou `devices:configure`, mapeia para seu dispositivo e não concede capacidades ao próprio condomínio. UUID textual inválido retorna false, sem erro de cast nem oracle de existência.
- [ ] Conjunto autorizado de perfis deriva de `app_telemetry_authorized_devices(..., 'telemetry:read')`, junta perfis com o mesmo par building/device e valida relações reais. Não percorrer histórico para determinar permissão. Projeção mínima retorna somente profile_id, building_id, device_id, device_name, device_type, device_enabled, device_status e timezone. Não alterar a assinatura pública da projeção de telemetria existente.
- [ ] Escopo técnico do GET exige tenant ativo e concessão inteira `telemetry:read` ou ao menos um dispositivo real autorizado. Permitir lista vazia para escopo autorizado sem perfis. Retornar timezone somente após essa autorização, sem depender de `buildings:read`; para isto usar projeção pontual owner controlada, sem expor cadastro/configurações do prédio.
- [ ] Substituir monitoring_read/write por SELECT, INSERT e UPDATE específicas. Leitura usa o conjunto de perfis autorizado; escrita exige leitura técnica e leitura/configuração do dispositivo real. INSERT valida dispositivo ativo e referência no mesmo tenant. Configuração de perfil existente desativado permanece possível; alterações não podem mudar sua identidade/referências/kind.
- [ ] daily_usage e usage_cursors SELECT verificam o par condomínio/perfil autorizado e relações reais. Calcular o conjunto uma vez por statement com mapa escalar de pares ordenados, seguindo a prova de 021, para evitar RBAC por linha do histórico:

```sql
USING ((SELECT coalesce(
  jsonb_object_agg(jsonb_build_array(scope.building_id, scope.profile_id)::text, true),
  '{}'::jsonb)
  FROM app_monitoring_authorized_profiles(NULL) scope)
  ? jsonb_build_array(building_id, profile_id)::text)
```

- [ ] Retirar UPDATE amplo/DELETE de monitoring_profiles; conceder UPDATE somente tariff, daily_limit, daily_cost_limit, continuous_limit_minutes, max_gap_seconds, adaptive_enabled, minimum_history_days, deviation_percent, enabled e updated_at. Manter SELECT/INSERT necessários, sem conceder DML de daily_usage/usage_cursors ao app, identidade ou broker.
- [ ] Atualizar somente branches MONITORING_CREATED/UPDATED na policy atual de auditoria: perfil real, tenant/ator corretos e três capacidades necessárias, sem fallback legado. Preservar integralmente branches migradas e ainda legadas de outros módulos. Funções executáveis apenas pelo app quando necessárias; helpers internos não são oracles acessíveis a runtime.
- [ ] Provar ACL/owner/STABLE/path, assinaturas dos helpers existentes, catálogo/grants alheios intactos. EXPLAIN pontual usa PK; RLS de histórico tem uma execução do conjunto autorizado em fixture própria com cerca de mil totais e pares adversariais sem colisão.

## Tarefa 3 — handlers e preservação funcional

- [ ] Remover assertBuildingAccess dos três handlers. GET verifica escopo técnico na transação, lê perfis sujeitos à RLS e usa projeção mínima em vez de JOIN em inventário privado. Preservar day/timezone, período de 28 dias, campos do DTO, estimativas, cobertura, fresh, reference/deviation e histórico, sem transformar dado indisponível em dado saudável.
- [ ] Ler funcionalidades por readFeatures após autorização operacional e sob o lock compartilhado existente. Retirar dependência em buildings:read/buildings:manage para essa decisão; policies de estado já permitem a leitura técnica por 017. Testar pausa independente após retirar essas capacidades do papel: filtros WATER/ENERGY/PUMP e AI continuam corretos, sem defaults habilitados por RLS oculta.
- [ ] POST autoriza o dispositivo real e suas três capacidades antes do INSERT, exige funcionalidade do kind ativa e valida limites atuais. Criar ID no servidor, INSERT e leitura em statement seguinte na mesma transação para não depender de INSERT RETURNING com helper STABLE que ainda não vê a linha. Confirmar perfil e auditoria juntos; duplicata device/kind conserva 409.
- [ ] PATCH lê sem lock para autorizar primeiro, valida configure antes do FOR UPDATE, bloqueia, reconsulta RLS e as capacidades em novos statements após espera; só então valida/aplica config e audita. Permissão expirada/revogada durante espera nega sem alterar perfil/auditoria. ID inválido/inacessível recebe 404; visível sem ação recebe 403.
- [ ] Preservar MonitoringPatchSchema estrito/sem materializar defaults de campos omitidos. Bomba não aceita tarifa/custo, outros kinds não aceitam continuousLimitMinutes. Campos de AI exigem AI_ANALYSIS ativa; editar campo não relacionado com AI pausada conserva configuração adaptativa armazenada. Erros PostgreSQL recebem mensagens genéricas, sem params de config/logs privados.
- [ ] Testes reais de row wait com aquisição/consulta limitadas e finally: revogar e expirar pessoa/equipe/suporte entre autorização inicial e liberação do lock; erro na auditoria faz rollback da configuração. Verificar explicitamente a espera em pg_locks/pg_stat_activity, sem retry do resultado de autorização.

## Tarefa 4 — GREEN e integração

- [ ] Aplicar e reaplicar atomicamente somente 023 em predioon-product-test localhost:5436, com ON_ERROR_STOP/single-transaction. Quatro DSNs de teste e RUN_ACCESS_DB_TESTS/RUN_RBAC_DB_TESTS ativas; arquivo de testes com concorrência1.
- [ ] Dirigido: monitoring-capabilities, monitoring.integration, authorization-time-windows, equipment-capabilities, telemetry-capabilities, feature-enforcement, features-lifecycle, runtime-credentials, rbac e tenancy. Ingestão usage/analysis deve continuar passando se a fonte compartilhada for afetada; não iniciar testes DB em paralelo.
- [ ] API typecheck, fronteiras, diff-check; comparar policies/ACLs fora do recorte e confirmar cleanup sem fixtures/transações/locks. Evidências em .local, sem segredos.
- [ ] Conformidade e depois qualidade, corrigir/revisar achados. Agente principal executa API integral na fonte estável e banco livre, atualiza AUTORIZACAO/tracker e faz commit/push autorizado. Consumidores web e dashboards são entregas seguintes; não dar por concluída a etapa 2B.3.

Estado: planejado após a inspeção dos handlers e policies de 007. Ainda não implementado nem validado; depende do aceite de 022. A sequência restante inclui dashboards, comunicação/atendimento, configuração/atuação, administração, gestão web, identidade, workers duráveis, domínios de produto, apps nativos e operação.
