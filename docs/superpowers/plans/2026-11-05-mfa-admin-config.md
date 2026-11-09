# ADMIN/CONFIG: três ações comuns, sem 174 guards individuais

**Atualização de 09/11 — organizações:** [30 dirigidos e 17 regressões passaram](../../evidencias/mfa-organization-commands-2026-11-09.json), após quatro sucessos indevidos e dois 404 antes de MFA na baseline. Conferência explícita de MFA/capacidades, mantendo DML/lock/GET/políticas. [Resultado e limites](../../continuidade/2026-11-09-organizacoes/RESULTADO.md). Seguir legado/concorrências adicionais, demais domínios e integração.

**Atualização de 09/11 — promoção/alvo ausente:** [26 casos passaram](../../evidencias/mfa-feature-command-boundaries-2026-11-09.json): 16 promoções após admissão comum com recuperação na mesma sessão, oito retiradas de prova/fator em alvo ausente e dois controles 404. SQL real e contratos de dados/auditoria/notificação preservados. Produto inalterado; seguir demais domínios e integração. [Resultado](../../continuidade/2026-11-09-limites-configuracoes/RESULTADO.md).

**Atualização de 09/11 — revogação por outra conexão:** [24 casos de espera real passaram](../../evidencias/mfa-feature-transition-waits-2026-11-09.json), dois escopos/quatro efeitos/três retiradas de identidade. A API reverte dados e a revogação externa permanece confirmada. Produto preservado; faltam alvo ausente/promoção e demais integrações. [Resultado](../../continuidade/2026-11-09-transicoes-concorrentes/RESULTADO.md).

**Atualização de 09/11 — rollback de transições aprovado:** [32 casos passaram na V3](../../evidencias/mfa-feature-transition-2026-11-09.json), com produto e testes anteriores preservados. Prova/fator/vínculo global e exceções durante consumo, portão e entrega durável; reversão integral comprovada nos dois escopos. O checkpoint pendente abaixo foi concluído; faltam alvo ausente/promoção, corridas de outro cliente e integração completa. [Resultado](../../continuidade/2026-11-09-transicoes/RESULTADO.md).

**Checkpoint de 09/11 antes da pausa:** [32 testes negativos de transição preservados](../../continuidade/2026-11-09-transicoes-rascunho/README.md), sem execução funcional. Resolução passou; tipos, banco e classificação dos resultados pendentes. Retomar antes dos demais complementos.

**Complemento de 09/11 — pausa e retomada:** [oito casos de features-lifecycle passaram com inscrição/TOTP reais](../../evidencias/mfa-feature-lifecycle-2026-11-09.json), preservando produto e asserções/prazos. Consumo, portão, entrega de alerta, vagas e suporte receberam aceite positivo dirigido com publicador simulado e webhook local. As pendências de adaptação da fixture e execução positiva citadas abaixo foram atendidas; faltam cenários negativos adicionais e integração completa. [Resultado e fontes](../../continuidade/2026-11-09-ciclo-funcionalidades/RESULTADO.md).

**Atualização de 09/11 — ação 3 validada no recorte global/local:** [72 casos dirigidos e 48 TAP de regressão](../../evidencias/mfa-feature-commands-2026-11-09.json), com 117 casos independentes e três grupos; [fontes restauráveis e limites](../../continuidade/2026-11-09-configuracoes/RESULTADO.md). Guarda vinculada ao upsert, checagens após esperas/transições e reversão conjunta de estados, auditoria e NOTIFY. Mantidos lock, versões e herança. Alvo ausente/promoção, consumo/portão/entrega durável e regressão integrada continuam pendentes; isso não encerra toda a ação 3 nem os demais domínios. Os parágrafos seguintes conservam o plano e os resultados históricos.

**Sexto lote, 07/11:** concessões de suporte e lista pessoal passaram nos oito cenários de concorrência, quatro controles e 23 arquivos de regressão. [Prova](../../evidencias/mfa-support-read-2026-11-07.json). Próximo: [funcionalidades](2026-11-07-mfa-features-read.md).


**Quinto lote, revisado em 07/11 (execuções de 05/11):** detalhe de condomínio, usuários global/local e equipe de suporte passaram nos seis cenários de concorrência, quatro controles e 22 arquivos de regressão. [Prova e contagens](../../evidencias/mfa-admin-directory-read-2026-11-05.json). Próximos: concessões de suporte e funcionalidades; comandos e demais domínios continuam pendentes.


**Resultado do quarto lote em 05/11:** convites passaram nos quatro cenários de concorrência e quatro controles, mais 19 arquivos de regressão. [Prova e contagens](../../evidencias/mfa-invitations-read-2026-11-05.json). DTO, escopo, paginação e relógio de expiração preservados. Próximos: detalhe de condomínio, usuários e equipe de suporte; demais leituras e comandos continuam pendentes.


**Resultado do terceiro lote em 05/11:** vínculos de unidades, integrantes de equipes e papéis passaram nos seis cenários de concorrência, quatro controles e regressões de 17 arquivos. [Prova e contagens](../../evidencias/mfa-tenancy-binding-2026-11-05.json). A leitura de convites e os comandos seguem pendentes.


**Resultado do segundo lote em 05/11:** blocos, unidades e equipes passaram nos seis cenários de concorrência e quatro controles funcionais, mais 162 regressões. [Prova, contagens TAP e limites](../../evidencias/mfa-tenancy-structure-2026-11-05.json). Seguem as três listas de vínculos/papéis; comandos e convites continuam pendentes.


**Resultado do primeiro lote em 05/11:** o adaptador comum e GETs de prédios/pessoas passaram em oito testes dirigidos e 121 regressões. [Prova e limites](../../evidencias/mfa-guarded-read-2026-11-05.json). A próxima etapa cobre blocos, unidades e equipes; vínculos, comandos e convites continuam pendentes.


Análise estática sobre composição heartbeat72119 (base7b53, original25adaptado). Nenhum runtime/teste/DB executado. Inventário174 é heurístico; os achados abaixo descrevem arquitetura e oportunidades de redução, não vulnerabilidades reproduzidas.

## O que já está pronto e não deve ser refeito

`auth/middleware.ts` já exige MFA operacional no authenticate; inTenantContext passa SID, usa pool app e traduz PMF para403. Isso basta para rejeitar identidade restrita no instante da autenticação, não para promoção posterior antes do SQL. Mesma transação READ COMMITTED não equivale a mesmo snapshot. Adicionar apenas outro pre/postguard a assertCapability/assertGlobalCapability não fecha a janela e não deve ser vendido como solução global.

Leituras de organizations/devices/gateways já usam envelopes guard-first. As duas rotas authorization já usam app_mfa_platform_authorization/app_mfa_scope_authorization. Preservar esses contratos e regressões. As seis tabelas RLS existentes protegem linhas; não asseguram erro MFA para vazio/no-match nem cobrem SD-owner e demais tabelas. mfaQueryProjection é decoder, não guard.

## 1. Um adaptador SQL de leitura guardada, reutilizável por família

Prototipar somente para queries SELECT fornecidas pelo próprio servidor, com parâmetros Drizzle SQL preservados. Ideia de shape, não implementação pronta:

    SELECT CASE WHEN public.app_require_session_mfa()
      THEN COALESCE((SELECT jsonb_agg(to_jsonb(result)) FROM (<SELECT parametrizado>) result), '[]'::jsonb)
      ELSE NULL END AS rows

A decisão guard e a subconsulta pertencem ao mesmo statement/snapshot. A expressão externa produz uma linha mesmo se a subconsulta não retornar nada; CASE coloca a decisão antes do ramo de dados. Não usar CROSS JOIN/WHERE guard ingênuo, cujo ramo pode desaparecer com zero rows. Exigir PMF01/02 em vazio/NULL nos testes e validar plano/comportamento real antes de aceitar a abstração. Não receber SQL/texto de cliente, não usar SECURITY DEFINER nem EXECUTE dinâmico. Proibir queries com mutações/efeitos externos nesse adaptador.

O custo real é o contrato de DTO: JSON não aplica automaticamente os decoders Drizzle de Date/numeric. Definir uma interface explícita de decoder por projeção já existente (ou contrato Zod) e testar tipos/datas/null/paginação; não espalhar casts que escondam a conversão. Se o adaptador perder segurança de tipos ou ficar mais complexo que o domínio, usar poucos envelopes nomeados por família, não um por rota.

Primeiros consumidores: `modules/buildings/routes.ts` (lista/detalhe), `modules/users/routes.ts` (global e por prédio), `modules/tenancy/routes.ts` (people/blocos/unidades/teams/memberships/bindings/invites), `modules/support-access/routes.ts` (staff/grants), `modules/features/routes.ts` (global e building view). Esses callers têm SQL direto ou SD após assert separado. Uma projeção de contexto para features pode reunir global/local/runtime no mesmo envelope, reutilizando resolveFeatures; não montar três consultas independentes sob uma promessa de snapshot único.

Paths comuns: `auth/mfa-query.ts` (manter decoder atual; preferir novo módulo para executor), `auth/mfa-policy.ts`, `auth/middleware.ts`, `packages/db/src/context.ts`. RLS/capacidades atuais continuam decidindo escopo; o adaptador só acrescenta a obrigação MFA. Não alterar helper fundacional app_has_capability indiscriminadamente: usado também por policies, projeções e dependências bootstrap.

Critério mínimo: dois callers reais representativos (lista vazia e SD paginado), promoção entre assert e SELECT, PMF01/02 com target ausente, optional/satisfied sem ampliar escopo, DTO/date iguais. Depois migrar as demais leituras da mesma família mecanicamente com testes parametrizados de contrato; não repetir nove cenários por endpoint.

## 2. Um padrão de comando guardado para CRUD e vínculos, preservando locks

O reaproveitamento já existe no código: `modules/tenancy/routes.ts` centraliza edit e setStatus; `modules/equipment/authorization.ts` centraliza erros/capacidades e equipmentWrite; `modules/users/routes.ts` tem inUsers; `modules/support-access/routes.ts` centraliza revokeGrant. Use essas fronteiras para converter grupos de operações, não adicionar um SELECT guard antes do callback inteiro.

Contrato comum de banco: guard independente de correspondência, verificação da capacidade real, DML parametrizado com RETURNING e resultado explícito (changed/notfound/conflict). Para comandos simples, estudar CTE de guard+mutation+resultado escalar que force avaliação do guard mesmo com zero updates; guard deve ser dependência do DML e do resultado. Para fluxos com locks, guard/capacidade precisam ser reavaliados após obter o lock e integrados à escrita efetiva. Um SELECT guard anterior seguido de DML separado, mesmo dentro de função VOLATILE, não prova snapshot único.

Não criar executor genérico de callbacks SQL arbitrários nem mudar transaction isolation para REPEATABLE READ como atalho: isso congela autoridade antiga em vez de preservar os checks frescos existentes. Se um comando necessita vários statements, usar operação nomeada pequena com ordem explícita de locks e decisão fresca junto à escrita, mantendo auditoria na mesma transação. Efeitos físicos/e-mail externo ficam fora deste padrão; nunca replay automático.

Começar por edit/setStatus de blocks/units/teams: três tipos e dois comportamentos já compartilham funções. Em seguida aplicar o mesmo contrato a vínculos/memberships e suporte (incluindo seus limites de delegação), e a create/update de devices/gateways. Preservar deativação da própria equipe: a auditoria ocorre antes de o ator perder seu grant; um postcheck genérico tardio pode desfazer um fluxo legítimo. Organization PATCH mantém NO KEY UPDATE, equipment mantém locks e rechecagens da relação device/gateway.

Paths: `modules/tenancy/routes.ts`, `modules/users/routes.ts`, `modules/support-access/routes.ts`, `modules/organizations/routes.ts`, `modules/devices/routes.ts`, `modules/gateways/routes.ts`, `modules/equipment/authorization.ts`; migration candidata nova função por operação/família quando necessário, sem editar001–067.

Critério: dois modelos (edit com target ausente e status com perda legítima de grant), corrida depois de lock, zero efeitos/audit em rejeição MFA, mesmas respostas404/409/403 e payloads limpos. SQLSTATE deve passar por mfaDatabaseError antes de wrappers genéricos500; inTenantContext já fornece essa tradução, não duplicar.

## 3. Tratar configuração de funcionalidades como um único comando de domínio

`modules/features/routes.ts` já converge PUTglobal/:key e PUTbuildings/:buildingId/:key em update(). Essa é a alavanca: proteger o comando completo (versão, upsert, transições, auditoria e pg_notify) e as duas projeções de resposta. Não criar guard independente por chamada de app_apply_feature_transition.

Hoje update faz lockFeatureChanges, assertAdmin, snapshots de estados, upsert, transições e resposta em vários statements. A trava global de features serializa mudanças de funcionalidades, não mudanças de obrigação MFA em users/role_bindings/mfa_factors/sessions. Reusar essa trava como autorização sem participação de todos os escritores de identidade seria incorreto.

Proposta: envelope de comando de configuração com argumentos fechados (scope,key,enabled,version,reason), mantendo controle de versão e lockFeatureChanges. Guard e capacidade vinculados ao upsert real; transições/audit/notify devem permanecer transacionais e não ocorrer se o comando for rejeitado. Ler estado/resultados pelo contrato comum da ação1. Preservar semântica VOLATILE de app_apply_feature_transition e ausência de replay; é mais coeso revisar esse comando uma vez que remendar os vários statements dos dois endpoints.

Paths: `modules/features/routes.ts`, `packages/db/src/features.ts`/exports reais de lockFeatureChanges/readFeatures, SQL012/016/021 e definição vigente de app_apply_feature_transition em038 e migration candidata. Depois revisar `modules/demo/routes.ts` como comando vizinho, sem presumir que compartilha exatamente os mesmos efeitos.

Critério: duas formas global/building da mesma matriz; conflito de versão, alvo ausente, promoção em ponto controlado antes do upsert, zero alteração/transition/audit/notify após rejeição, recuperação optional/satisfied e resposta DTO idêntica. Nenhum teste individual adicional para /catalog quando ele só retorna catálogo estático: combinar MFA+capacidade na única consulta de decisão e preservar a classificação de metadado.

## Escolha recomendada

Executar a ação 1 primeiro como protótipo limitado e verificar se o adaptador elimina a necessidade de dezenas de novos wrappersSQL. Em paralelo apenas desenhar as ações 2 e 3, sem alegar cobertura global antecipada. A saída do lote deve ser mapa de operações agrupadas efetivamente migradas e exceções explícitas, não meta artificial de 174 rotas. Não introduzir lock universal por conta: exigiria que todos os escritores de flag/binding/fator/família (inclusive tarefas administrativas) participassem, ampliando muito o recorte e o risco de deadlock.
