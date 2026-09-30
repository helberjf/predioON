# Vigência de permissões após esperas — recorte corretivo 021

> **For agentic workers:** usar subagent-driven-development, TDD, revisão de conformidade e depois qualidade. Implementador não altera Git nem documentação; o agente principal integra e publica.

**Goal:** impedir que uma transação HTTP mantenha permissões vencidas porque PostgreSQL `now()` conserva o horário de início da transação. Preservar autorização por recurso, privilégios de runtime e planos de consulta já verificados.

**Architecture:** consultas de autorização usam um instante confiável por statement, `statement_timestamp()`. Funções públicas continuam STABLE com as assinaturas atuais. As transições privilegiadas de alertas e funcionalidades capturam `clock_timestamp()` novamente após obter o lock e passam esse instante a helpers internos, executáveis somente pelo owner. Não aceitar horário do cliente nem GUC para decidir vigência.

**Tech Stack:** PostgreSQL e testes TypeScript existentes; sem nova dependência ou alteração de schema/catálogo.

## Evidência e dependência

Executar após 020 aprovada/verificada/publicada. `.local/020-window-clock-probe.log` reproduz: transaction_time 19:01:27.480985, expiração 19:01:27.634292, wallclock 19:01:27.689093; app_rbac_window retornou true apesar da expiração. O probe terminou em ROLLBACK.

Banco isolado localhost:5436, quatro DSNs existentes. Aplicar/reaplicar somente nova migration 021 com ON_ERROR_STOP e single-transaction. Não reaplicar 014–020, seed/db:push/reset, nem tocar produção.

Arquivos do implementador:

- Criar `infrastructure/021-authorization-time-windows.sql`.
- Criar `apps/api/test/authorization-time-windows.test.ts`.
- Nenhum handler HTTP precisa de alteração: 020 já reconsulta RLS e configure em novos statements após obter a linha; as rotas mantêm locks de funcionalidades e auditoria transacional.

## Tarefa 1 — RED com tempo do próprio banco

- [ ] Fixture exclusiva, cleanup finally, relógio PostgreSQL para agendar janelas. Não usar relógio Windows para comparar expiração.
- [ ] Dentro da mesma transação app: primeira consulta aceita, aguardar o banco ultrapassar a expiração e segunda consulta nega. Cobrir binding individual, integrante de equipe, binding da equipe, membership legado, suporte temporário e papel global PLATFORM_SUPPORT. Para suporte, provar também que retirar o papel global continua negando.
- [ ] Janela começa depois do início da transação: primeira consulta nega, segunda aceita após o início. Finite/null/active e ends>starts preservados. Conta/tenant/equipe/papel/permissão inativos continuam negando.
- [ ] HTTP real mantém o mesmo JWT: bloquear linha, iniciar PATCH device/gateway, criação de métrica e emissão de credencial; confirmar espera real via pg_stat_activity/pg_locks antes de aguardar vencimento e liberar. Permissão vencida após a espera nega alteração e auditoria; hash existente não muda. Garantir limites/finally para não pendurar testes. Cobrir binding expirado e equipe expirada entre operações, sem modificar catálogo global em paralelo.
- [ ] SQL restrito chama app_transition_alert enquanto owner mantém row lock. Após expiração de leitura ou ação durante a espera, função nega, estado/carimbos/auditoria permanecem iguais. Uma concessão válida equivalente conclui e preserva idempotência/409/rollback. Detectar que a chamada é um único statement externo: statement_timestamp sozinho não corrige essa função.
- [ ] SQL restrito chama app_apply_feature_transition enquanto owner mantém advisory lock exclusivo de funcionalidades. Papel PLATFORM_ADMIN concedido por binding com prazo, sem flag legada: vencer durante espera nega a transição e conserva runtime/parking/comandos. HTTP de edição de funcionalidades também reconsulta o papel após obter seu lock. Fixtures exclusivas e restauração das configurações globais se alteradas.

## Tarefa 2 — relógio confiável e helpers internos

- [ ] `app_rbac_window(boolean,timestamptz,timestamptz)` usa statement_timestamp, preservando semântica finite/null/active/intervalo e assinatura/grants.
- [ ] Helpers internos `_at` para janela, papel global, integrante de equipe e capacidade propagam **o mesmo** instante explícito às verificações de binding, membership, equipe, suporte e papel de suporte. Helper de capacidade mantém toda a lógica atual, inclusive whitelist de suporte, razão, granted_by, scope, conta/tenant, roles e permissions. Não promover administração global a operação privada.
- [ ] Wrappers públicos app_rbac_platform_role, app_rbac_team_member, app_has_capability e app_has_global_capability conservam assinaturas, defaults, STABLE, SECURITY DEFINER e search_path public,pg_temp; chamam internos com statement_timestamp. Criar também helper global _at privado: conservar o catálogo ampliado por 016, sem substituir pela versão inicial de 014. Flag legada global segue a compatibilidade atual e não concede operação privada; sua retirada pertence à migração administrativa posterior.
- [ ] O helper privado de janela pode ser IMMUTABLE/puro. Demais helpers que consultam tabelas são STABLE SECURITY DEFINER. Todos os internos têm owner igual ao app_has_capability administrativo e EXECUTE revogado de PUBLIC, app, identity, broker e demais ACLs não owner, inclusive default ACLs. Wrappers públicos preservam grants anteriores; app não pode escolher um horário histórico e recuperar acesso por funções internas. Não usar clock_timestamp dentro de uma função declarada STABLE nem criar GUC de horário confiável.
- [ ] app_rbac_own_unit e demais dependências existentes passam a obter a janela por statement via helper público, preservando comportamento; não alterar funções sem necessidade.

## Tarefa 3 — filtros candidatos e transição de alerta

- [ ] Substituir somente predicados de vigência `created_at<=now()/expires_at>now()` dos candidatos de app_telemetry_authorized_devices (017), app_alert_authorized_contexts e app_alert_can_read_feature_state (018), app_equipment_can_read_scope (020) por statement_timestamp. Manter MATERIALIZED, união e gates pontuais/índices; não copiar versões antigas de outros helpers ou policies.
- [ ] Atualizar somente checks de vigência das duas policies support_grants_read/write de 014 para statement_timestamp, preservando os demais predicados. Não alterar timestamps de defaults, retenção de telemetria, sessão/refresh, clocks de observação ou status. Nenhum filtro candidato pode reintroduzir o horário de início da transação na autorização migrada.
- [ ] Criar app_alert_has_capability_at privado com instante explícito, whitelist e validação integral de pertencimento atuais. Public app_alert_has_capability mantém assinatura/ACL/STABLE e wrapper por statement_timestamp. Sem ler configuração bruta de equipamentos.
- [ ] Substituir app_transition_alert na 021 preservando assinatura, erros 22023/P0002/42501/P0409, autorização antes do lock, idempotência, ator do banco, carimbo e auditoria atômica. Após FOR UPDATE, capturar clock_timestamp uma vez e revalidar leitura/ação por helper privado _at; nunca usar o instante externo anterior à espera. Não conceder DML de alertas ao app.
- [ ] Substituir app_apply_feature_transition conservando assinatura/grants e efeitos atuais de 016: antes do advisory lock exige capacidade global; após lock revalida por helper global _at com clock_timestamp. Atribuir changed ao instante após lock; preservar controle de versão HTTP, gerações, cursors/usage, parking e cancelamento de comandos sem replay. Não ampliar o conteúdo que a plataforma pode ler.
- [ ] A autorização normal define um instante por statement, não por amostra ou por linha. Uma consulta já em andamento pode terminar no seu snapshot. As revalidações explícitas após espera devem usar instante novo; futuras operações físicas também precisam desse padrão antes do despacho. Não adicionar triggers globais nem mudar volatilidade de todos os helpers.

## Tarefa 4 — GREEN, preservação e aceite

- [ ] Dirigido inclui novo teste, equipment-capabilities, alert-capabilities, rbac, tenancy, building-feature-capabilities, telemetry-capabilities, feature-enforcement e runtime-credentials; localizar nomes exatos com rg --files. RUN_ACCESS_DB_TESTS=1 e RUN_RBAC_DB_TESTS=1, concorrência de arquivo 1.
- [ ] Provar ownership/search_path/volatilidade/ACL dos internos e assinaturas/grants públicos, incluindo tentativa de app invocar helper histórico negada. Aplicação e reaplicação atômicas idempotentes. Comparar catálogo de permissions/role_permissions e grants de tabelas antes/depois: idênticos. Policies distintas de support_grants não mudam.
- [ ] Regressão conserva consultas pontuais com PK e conjuntos de telemetria avaliados uma vez por consulta; não ampliar consulta de funcionalidades para histórico de alertas. Testes/plans anteriores entram no dirigido.
- [ ] Cleanup confirma ausência de fixtures/locks/policies temporárias. Evidências distintas em .local, mkdir se necessário; não expor credenciais/metadata privada em logs.
- [ ] Revisão de conformidade e depois qualidade, corrigir/revisar achados; agente principal executa API integral e tipos/fronteiras na fonte estável, atualiza AUTORIZACAO/tracker, commit/push.

Estado: planejado com causa reproduzida; depende do aceite de 020. SSE de status de equipamentos/gateways e avisos de mudança de funcionalidades vêm depois. As etapas de identidade, web, processamento durável, domínios comerciais, mobile e implantação seguem no tracker total.
