# Regras de alerta por capacidades — 032

**Objetivo:** migrar `/alert-rules` para leitura e gestão explícitas, mantendo regras, thresholds, mensagens, operadores, cooldown e classificação de funcionalidades existentes. A evidência de execução está registrada ao final; a regressão integral posterior a 032 ainda depende do checkpoint do agente principal.

**Execução:** TDD com PostgreSQL real em banco isolado, revisão de conformidade antes de qualidade. O agente principal mantém Git e regressão integral; congelar fonte de produção durante essa regressão. Aplicar depois de 030/031. Nenhuma alteração no processamento MQTT, comando físico, notificações ou algoritmo de disparo pertence a este recorte.

## Evidência atual

- `apps/api/src/modules/alert-rules/routes.ts` usa `requireRole("BUILDING_ADMIN")`, `assertBuildingAccess`, `scopedBuildingIds`, `buildingFeatures` e `assertSensorFeatures`. Vínculos RBAC individuais/equipe não substituem essas decisões legadas.
- `alert_rules_scope_policy` ainda é a policy ALL de 001. Sua leitura depende de `app_can_access_building`; a escrita permite administrador global ou síndico legado. As ações `ALERT_RULE_CREATED/UPDATED/DELETED` ainda chegam ao fallback genérico de auditoria.
- `UpdateSchema = CreateSchema.partial()` materializa defaults omitidos. Prova local com o Zod instalado em 02/10/2026: PATCH de nome resultou em `{"name":"Renomeado","severity":"MEDIUM","cooldownSeconds":300}`. Renomear uma regra pode apagar gravidade/cooldown escolhidos anteriormente.
- `alert_rules.device_id` referencia somente a PK de `devices`, sem chave composta de condomínio. Fixtures inconsistentes gravadas pelo owner precisam ficar ocultas e não modificáveis, mesmo quando o caller passa um ID real.
- `sensorFeatureKeys` lê configuração de equipamento sob RLS. Com uma futura capacidade somente de regra, não encontrar o equipamento nessa consulta não pode significar “nenhuma funcionalidade necessária”. A classificação precisa de projeção mínima autorizada, como a usada pelo domínio de alertas.
- DELETE atualmente apaga a regra antes de auditar; depois da migração, o helper de recurso real não encontrará esse pai. PATCH/DELETE também não bloqueiam nem revalidam o recurso depois de esperar.

## Decisões de escopo propostas

Adicionar `alert-rules:read` e `alert-rules:manage`, ambas somente a `BUILDING_ADMIN` no catálogo padrão. Manutenção, morador e papéis globais não recebem configuração de regras por inferência de `alerts:read`, `devices:read` ou `telemetry:read`. Papéis/concessões locais explícitos podem fornecer leitura sem gestão. Não ampliar a whitelist de suporte.

Adicionar o recurso concreto `alert_rule`. Permitir autorização no recurso regra ou no equipamento explicitamente associado à regra, além de concessão inteira do condomínio. `device_id IS NULL` é regra geral: uma concessão em equipamento não a alcança. Concessão em `building` não equivale a concessão inteira.

POST sobre equipamento exige read/manage inteiras ou read/manage no equipamento real. POST de regra geral exige ambas inteiras. Uma concessão somente em regra existente não cria outras. PATCH preserva identidade, condomínio e autoria; mudar `deviceId` exige autoridade sobre o destino (read/manage inteiras ou no novo equipamento), além de read/manage sobre a regra atual. Tornar uma regra geral exige ambas inteiras. Isso impede que um grant específico amplie os equipamentos atingidos ao remover ou trocar o pai.

Conta/organização/condomínio ativos e janelas vigentes são obrigatórios. Se houver equipamento, validar existência e mesmo condomínio; se houver gateway vinculado, validar seu pertencimento. Hardware disabled continua legível e configurável, inclusive em criação/retarget, como em020; o estado de processamento não vira permissão. Testar essa compatibilidade explicitamente. Uma regra `enabled=false` continua gerenciável para reativação por quem tem direito. Pausa da funcionalidade conserva o comportamento atual de bloquear atuação e esconder regras nas listas, sem apagar configurações.

Plano aprovado pelo agente principal em02/10/2026, incluindo read/manage somenteBUILDING_ADMIN por padrão, regra/dispositivo exatos, retarget explícito e configuração de hardware disabled preservada.

## Arquivos previstos

Criar `infrastructure/032-alert-rules-capabilities.sql`, `apps/api/src/modules/alert-rules/authorization.ts` e `apps/api/test/alert-rule-capabilities.test.ts`. Alterar somente o módulo de rotas correspondente, catálogo `packages/shared/src/rbac.ts`, validadores de recurso/constraints necessários na migration e asserções de catálogo/isolação afetadas. Não alterar o helper legado compartilhado para destravar este domínio.

Se for necessária nova projeção de classificação, colocá-la na mesma migration e authorization do domínio; reutilizar funções puras existentes (`metricFeature`, `deviceFeatures`, `gateFeature`, `parkingFeature`). Não conceder SELECT adicional em equipamento, gate, estacionamento ou regras a leitores de alertas.

## Tarefa 1 — RED comportamental

- [ ] Fixtures próprias de dois condomínios: regras gerais, regras por dispositivo, regra desabilitada, gate de garagem/pedestre e estacionamento de carro/moto. Pessoa/equipe sem membership, leitor, gestor inteiro, gestor de dispositivo, gestor de regra exata, morador, plataforma/flag, suporte, estranho e síndico no A/morador no B.
- [ ] GET explícito e geral preservam ordenação e contrato `{items}`; concessão inteira sem regras devolve 200 vazio. Escopo explícito não autorizado devolve 403; recurso oculto/ausente/UUID malformado devolve 404 nas mutações, sem erro de cast. Leitor de regra não ganha leitura de configuração de equipamento nem acesso a regras vizinhas.
- [ ] POST aceita exatamente os escopos definidos; regras gerais e retarget para equipamento não concedido são negados. Rejeitar equipamento estrangeiro/inexistente e gateway inconsistente; preservar configuração quando dispositivo/gateway estiver disabled. Inserir inconsistências pelo owner e comprovar negação HTTP e SQL sem WHERE.
- [ ] PATCH somente `name` preserva `severity`, `cooldownSeconds`, `enabled`, métrica e todos os campos omitidos; schemas estritos recusam identidade/tenant/createdBy/createdAt e chaves desconhecidas. Limites numéricos continuam finitos e validados.
- [ ] Mesmo JWT perde direito por revogação/expiração de pessoa/equipe/membro, papel/permissão/conta/tenant. `app.role` forjado, admin global e capacidade de alerta/telemetria/equipamento isolada não substituem regra read/manage.
- [ ] Testes de feature usam grants apenas do domínio, sem buildings:read, devices:read ou telemetry:read. Métrica canônica mantém precedência; fallback de tipo/gate/parking exige projeção real. Pausa do estado antigo ou proposto impede PATCH que tente trocar a classificação para contornar pausa.
- [ ] Registrar RED antes de editar código. Se necessário inserir temporariamente as novas permissões apenas para satisfazer FKs de fixtures, rastrear e apagar somente os registros criados pela fixture; não tratar erro de setup como RED de comportamento.

## Tarefa 2 — SQL e helpers

- [ ] Migration aditiva/idempotente, `ON CONFLICT DO NOTHING`, sem reativar permissões/vínculos suspensos nem regravar timestamps existentes. Estender somente `alert_rule` nos validadores e constraints atuais, preservando todo recurso anterior e whitelist de suporte. Descoberta resolve regra real por PK/condomínio; não copiar versão antiga do helper.
- [ ] Helper pontual SECDEF STABLE, owner RBAC, `search_path=public,pg_temp`, whitelist read/manage, UUID textual inválido false antes do cast. Validar regra e pais reais com as janelas atuais de 021. Helpers privados com instante explícito, se necessários, ficam owner-only.
- [ ] Helper de escopo aceita conjunto vazio somente com leitura inteira ou concessão válida no dispositivo real. Concessão em regra inexistente não abre o domínio. Candidatos vêm de bindings/membership/equipe vigentes, não de scans de alertas/telemetria.
- [ ] Projeção mínima de classificação retorna somente IDs/condomínio e tipo de equipamento/kind de gate/veículo de estacionamento necessários, após autorização; não retorna metadata, segredo, threshold ou template de outro recurso. Também deve validar alvo proposto para POST/retarget sem pressupor que a regra já existe.
- [ ] Substituir somente `alert_rules_scope_policy` por SELECT/INSERT/UPDATE/DELETE específicas. Leitura exige read; atuação exige read/manage e pais válidos. INSERT valida `created_by=app_current_user_id()`; UPDATE concede somente campos de configuração autorizados, preservando id/building/creator/created_at. Proibir ampliação de destino em SQL direto, não apenas no handler; usar check/guard específico se necessário para comparar OLD/NEW.
- [ ] Policies aditivas para settings/runtime e OR local de `app_can_read_feature_event` conservam funções globais e todas as branches atuais. Exigir autorização antes de `readFeatures` para estado oculto não aparentar habilitado.
- [ ] Alterar apenas as três branches `ALERT_RULE_*` da política de auditoria vigente; exigir ator/tenant/recurso e read/manage reais. Preservar todas as branches 016–031 e futuras sentinelas. Não inserir CASE aninhado nas branches manipuladas pelo padrão atual de reaplicação; encapsular condições complexas em helper booleano.
- [ ] Aplicar/reaplicar atomicamente com `ON_ERROR_STOP`. Comparar catálogo, ACLs, policies e bodies alheios; comparar branches por ação sem supor ordem textual. EXPLAIN do corpo real confirma PK e índice tenant/dispositivo/métrica apropriados, sem forçar opções do planner.

## Tarefa 3 — handlers, concorrência e auditoria

- [ ] Retirar guards legados somente deste módulo; manter paths/DTO/ordenação, `Cache-Control: no-store`, erros genéricos sem SQL/params/templates nos logs. Em lista geral, selecionar somente regras atuais sob RLS, carregar features dos condomínios autorizados e revalidar IDs/escopo antes de entregar conteúdo em memória.
- [ ] POST gera UUID no servidor, valida destino e funcionalidades, insere e lê em statement seguinte para helpers STABLE enxergarem o pai. Audita na mesma transação. PATCH usa schema de campos opcionais sem defaults de criação e `updated_at=clock_timestamp()`.
- [ ] PATCH/DELETE autorizam antes de bloquear, usam row lock da regra e depois reconsultam recurso, pais, capacidades e estado sob novo statement. Revalidar tanto contexto antigo quanto proposto antes da mudança. Não criar retries genéricos.
- [ ] DELETE audita enquanto a regra ainda existe, apaga com resultado observado e confirma ambos juntos; zero linhas após perda de direito gera erro e desfaz a auditoria. Duas exclusões concorrentes produzem uma única exclusão/auditoria, com 404 para a segunda, sem 500 de FK ou resposta de sucesso para operação inexistente.
- [ ] Exercitar esperas reais observadas em `pg_stat_activity/pg_blocking_pids`, com aquisição limitada, revogação/expiração individual/equipe durante o bloqueio e `finally` liberando/observando todos os resultados. Corridas com troca/remoção de pai não deixam escrita ou auditoria parcial; desativação do hardware mantém o direito de configuração.
- [ ] Avaliar ordem de locks com ingestão: ela bloqueia dispositivo antes de avaliar regras e inserir alerta com FK. Não acrescentar lock de dispositivo depois do lock da regra sem demonstrar ausência de deadlock. Testar FK `alerts.rule_id ON DELETE SET NULL`, preservação de alertas históricos e rollback de exclusão se auditoria falhar; não mudar o pipeline MQTT por conveniência de teste.
- [ ] Forçar falha de auditoria em POST/PATCH/DELETE e comprovar rollback do domínio, associações de alertas e logs privados ausentes. Testar grants read/manage independentes e SQL direto de identidade/retarget/atores falsos.

## Aceite

Dirigidos seriais: novo arquivo, feature-enforcement/lifecycle, alert-capabilities, alert-events, equipment, monitoring, autorização de vigência, RBAC DB/unit e tenancy. Flags DB ativas, cleanup zerado, tipos API/shared/consumidores, fronteiras e diff-check. Testes de isolação de feature devem suspender também `alert-rules:read` se esse for um novo caminho legítimo de leitura do estado, sem relaxar a policy de produção.

Depois de revisões de conformidade/qualidade, congelar produção, executar API integral e Playwright pertinente e registrar contagens reais e limitações. O agente principal faz commit/push do recorte validado. Não declarar concluída a migração geral de RBAC: acessos físicos, demais módulos legados, configurações de clientes e requisitos operacionais continuam separados no tracker.

## Evidência de execução local — 02/10/2026

SQL032, helpers, handlers, catálogo e testes implementados no recorte previsto. PostgreSQL/Timescale real, container isolado `predioon-test-backend`, porta 5437; nenhum teste deste recorte modifica os bancos dos outros agentes.

RED anterior à implementação: três falhas comportamentais confirmadas — gestor RBAC recebia 403, flag global recebia 200 indevidamente e PATCH de nome apagava a gravidade escolhida. O primeiro GREEN também revelou o builder INSERT incluindo timestamps omitidos como DEFAULT; o handler passou a inserir apenas colunas autorizadas, sem ampliar ACL.

A revisão independente identificou um ciclo real de bloqueios entre retarget e ingestão. O teste coordenado observou o PATCH esperando o dispositivo e então inseriu o alerta com FK para a regra: resposta 409 por deadlock antes da correção. `FOR NO KEY UPDATE` inicial sozinho também falhou, pois alterar `device_id` afeta o índice UNIQUE da regra e o UPDATE efetivo promove o bloqueio. A solução bloqueia o dispositivo de destino antes da regra, na mesma ordem da ingestão, por helper SECDEF booleano com validação antes/depois da espera. Nenhum SELECT de inventário foi concedido e nenhum retry foi adicionado. DELETE mantém seu bloqueio exclusivo. Concessão exata pode preservar seu pai inalterado, mas não escolher outro destino.

Validação registrada:

- 222/222 testes, 14 suites, sem skips/falhas na regressão dirigida de alertas/SSE/equipamentos/monitoramento/features/vigência/RBAC/tenancy, antes do ajuste final de ordem dos locks.
- Após a correção, 23/23 testes do domínio e 13/13 do catálogo passaram juntos. Dois testes adicionais passaram em execução dirigida: revogação da regra de origem e do equipamento proposto durante a espera pelo dispositivo. O arquivo final contém 25 casos do domínio.
- Reaplicação atômica dupla preserva policies e branches alheias, permissões/vínculos inativos, owner/search_path e ACLs; UUID malformado, helper privado e acesso de identity/broker são negados. EXPLAIN do corpo persistido confirma consulta pontual por PK e escopo sem varrer histórico.
- Tipos API/shared, fronteiras de dependência e diff-check passaram. Cleanup confirmado: zero organizações, usuários e papéis com prefixos das fixtures.

Pendências de integração deste checkpoint: revisão final do novo helper de bloqueio, commit/push pelo agente principal, aplicação032 nos demais bancos, regressão integral e navegador pertinente. A UI deve usar capacidades de regras, sem inferir gestão de `devices:configure`. Este recorte não conclui os outros domínios legados nem equivale a validação em hardware físico.
