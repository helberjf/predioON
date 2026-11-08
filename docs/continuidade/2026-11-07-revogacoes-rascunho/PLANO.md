# Próximo lote recomendado: três revogações de vínculos

Revisão estática em 07/11/2026. Não foram executados Node, banco, serviços, tipos ou testes. Nenhum arquivo de produto, fonte congelada ou migration foi alterado. As lacunas abaixo são hipóteses fundamentadas em código, não um RED observado nem demonstração de exploração.

Fonte: `work/mfa-mandatory-browser-qa-20261107/source`, 1.032 arquivos compostos; prepared SHA256 `2abbf1a7fa9c7d54f6f0a6fc12938b3b14a27fa8da823590e8d9acb71a09087f`. Todas as referências de código abaixo são relativas a essa fonte. O inventário de 05/11 e o plano `docs/superpowers/plans/2026-11-07-mfa-proximos-comandos.md` foram consultados como histórico, sem repetir suas contagens como cobertura atual. A ordem de suporte e os seis PATCHs de estrutura já estão presentes nesta fonte; este recorte não os reabre.

## Escopo finito

Somente `DELETE /v1/tenancy/unit-memberships/:id`, `DELETE /v1/tenancy/team-members/:id` e `DELETE /v1/tenancy/role-bindings/:id`. Os três são registrados pelo loop de `apps/api/src/modules/tenancy/routes.ts:620–640`, com descritores fechados nas linhas622–624. São revogações lógicas (`active=false`), não DELETE físico.

Este lote é menor que agrupar criação, renovação, convites e revogação: compartilha um fluxo de comando, resposta204 sem DTO, três ações de auditoria e duas capacidades. Não inclui os POSTs, usuários/memberships legados, convites, concessões de suporte, funcionalidades, acesso físico ou alterações de política068.

## Evidência atual e risco concreto

| Fronteira | Código atual | Propriedade ainda a demonstrar |
| --- | --- | --- |
| Entrada humana | `auth/middleware.ts:40–43`, `app.ts:61` | O gate HTTP impede uma sessão já restrita na autenticação; não decide mudanças posteriores de autoridade/fator/prova. Não afirmar que a entrada está desprotegida. |
| Contexto | `auth/middleware.ts:94–99`, `packages/db/src/context.ts:33–41` | Transporta identidade/SID e usa a conexão restrita; o lock de funcionalidades não serializa alterações MFA. `inTenantContext` traduz PMF01/02, mas não injeta guard em cada statement. |
| Busca com lock | `tenancy/routes.ts:630` | `SELECT id,buildingId,active ... FOR UPDATE` tem RLS, mas não envelope MFA. Uma mudança após o gate ou durante a espera precisa de decisão efetiva após a espera. |
| Ausência e escopo | `tenancy/routes.ts:631` | UUID válido ausente/oculto e binding global (`buildingId=null`) terminam404 antes de `assertCapability`; um guard somente sobre linhas não cobre o vazio. |
| Autorização | `tenancy/routes.ts:632`, `auth/middleware.ts:73–78` | `assertCapability` consulta `app_has_capability` separadamente, sem MFA no mesmo statement. Preservar memberships:manage ou teams:manage; nenhuma autoridade nova deve ser concedida. |
| Revogação repetida | `tenancy/routes.ts:633` | Linha inativa retorna204 sem UPDATE/auditoria. Esse ramo precisa decisão MFA e autorização atual, mesmo que nada seja escrito. |
| Auditoria e efeito | `tenancy/routes.ts:634–637`, `modules/audit/repo.ts:14–25` | Auditoria precede UPDATE para autorrevogação legítima. Guard anterior isolado não fecha promoção/perda de prova entre a decisão e o efeito; guard posterior isolado também não fecha promoção transitória. |

As policies originais continuam necessárias: `infrastructure/014-rbac-tenancy.sql:363–368` (unit_memberships), `376–381` (team_members), `401–412` (role_bindings). As duas primeiras usam capacidades; role_bindings usa `app_rbac_can_delegate` em USING/WITH CHECK. As seis policies restritivas068 cobrem organizations/support_hosts/support_requests/devices/gateways/device_metrics (`068-platform-mfa-required.sql:95–103,188–196`), não essas três tabelas. A ausência de policy específica não elimina as demais defesas RLS.

Auditoria: `036-audit-capabilities.sql:150–159` exige capacidade, recurso e prédio correspondentes; os resourceType públicos de revogação são **unit-memberships**, **team-members**, **role-bindings** (com hífen), diferentes dos nomes de criação. `041-tenancy-edit-audit.sql` amplia somente ações de estrutura, não substitui esse contrato. Preservar append-only, owner, ACL e rollback.

## Desenho mínimo a validar antes de implementar

1. Autorizar apenas três descritores de servidor neste arquivo, preservando tabelas, capacidade, ação e recurso. Não aceitar identificadores SQL do usuário e não construir executor universal de comandos.
2. Preservar o comportamento do lock original. `SELECT FOR UPDATE` aciona policies de UPDATE; copiar uma busca inicial sem lock dos PATCHs pode mudar **404 para403** para um leitor que não pode revogar. Caracterizar esse controle primeiro. Binding global com buildingId nulo continua404; estes endpoints não viram revogação global.
3. Fazer o guard MFA observável independentemente da cardinalidade, inclusive antes do404 por UUID válido e no204 inativo. Depois da espera real, reavaliar estado/autoridade/prova em statement novo. Não tratar CTE declarada mas sem dependência como garantia de execução.
4. Vincular MFA ao statement de efeito, manter capacidade e RLS existentes, e conferir o desfecho após triggers/auditoria quando necessário. `readMfaRows` é somente leitura e não deve transportar UPDATE ou função VOLATILE mutadora.
5. Manter auditoria antes da revogação; não acrescentar uma exigência de capacidade após remover a própria concessão. A checagem final de MFA não deve se transformar numa nova exigência de gestão já revogada legitimamente. Revogação idempotente não cria segunda auditoria.
6. Manter `inTenancy`/`inTenantContext` e seus mapeamentos de erro. ID malformado mantém seu404 de validação anterior à transação; distinguir de UUID válido sem alvo. Nenhum retry automático, fallback owner ou mudança de migrations publicadas.

## Prova dirigida proposta, ainda sem contagem TAP aceita

- Para cada rota: sessão inicialmente operacional, barreira após decisão real de capacidade, remover fator (PMF01) e remover prova da mesma família/SID (PMF02) em casos separados. Comparar o snapshot completo do vínculo e auditorias antes/depois; não aceitar apenas status. Se o baseline retornar204, confirmar a revogação/auditoria reais antes de registrar o RED.
- Para cada rota: UUID válido ausente e vínculo inativo, com perda de prova depois do gate. Negativa explícita403/reason correto, nenhum efeito/auditoria; controles satisfeitos preservam404 e204, respectivamente. Caso de promoção após gate de gestor opcional deve preservar sua capacidade local, isolando a nova obrigação MFA.
- Espera real em uma linha de cada tabela: transação de fixture detém o lock, HTTP bloqueia e `pg_blocking_pids` confirma a espera, então remover prova ou promover o ator e liberar o lock. Reavaliar depois da espera; atraso artificial antes do SELECT não prova essa propriedade.
- Caso de perda de capacidade durante espera, com leitura ainda possível: não permitir204 idempotente nem efeito. Comparar o contrato atual de invisibilidade sob FOR UPDATE antes de definir o status esperado.
- Trigger de auditoria que remove a prova da sessão, e trigger que falha: conferir rollback conjunto de vínculo/auditoria/prova nas intervenções da própria transação. Fazer a barreira acompanhar o statement real; falha genérica, erro de fixture ou timeout não contam como RED MFA.
- Gestor local sem obrigação e administrador satisfeito com capacidade local: revogam os três tipos; retorno204 vazio, active=false, demais campos preservados exceto updatedAt, uma auditoria exata. Repetição autorizada permanece204 sem nova auditoria.
- Autorrevogação: papel local direto e participação em equipe que é a única origem da gestão. A primeira revogação completa e audita uma vez; a operação seguinte perde acesso. Não introduzir postcheck de capacidade que faça rollback desse sucesso legítimo.
- Escopo: tenant estrangeiro, leitor sem gestão, alvo global, UUID malformado; não vazar linha nem ampliar gestão. Dados expostos na negativa e estados/auditorias devem permanecer iguais aos controles originais.

Setup deve usar fixture UUID oficial, role runtime restrita e cerimônia MFA HTTP real no bearer/SID usado. Escritas owner são exclusivamente construção/interleaving/inspeção do teste descartável. Não inventar SID para regressões SQL de ACL. Baseline e fixed precisam de fontes congeladas separadas, mesmo teste novo e logs nativos revisados antes da prova; totais de casos só serão definidos pelo teste autorado e execução real.

## Reuso de testes existentes

| Arquivo | Evidência útil e limite |
| --- | --- |
| `apps/api/test/tenancy-http.test.ts:64–75` | Revogar integrante retira capacidade derivada da equipe. |
| `apps/api/test/tenancy-http.test.ts:111–125` | Renovação concorrente de integrante, identidade preservada e auditorias; regressão dos POSTs que devem ficar intactos. |
| `apps/api/test/tenancy-http.test.ts:127–135` | Autorrevogação do único binding administrativo local, active=false, uma auditoria e perda de acesso posterior. |
| `apps/api/test/platform-mfa-tenancy-links.test.ts:98–127` | Três GETs dos vínculos, vazios, DTO/datas, escopo e flags de atividade. Seu aceite não cobre DELETE. |
| `apps/api/test/platform-mfa-tenancy-commands.test.ts:302–429` | Modelo de barreiras reais, lock com pg_blocking_pids, triggers, rollback, controles e guard sem alvo dos seis PATCHs. Reutilizar metodologia, sem enfraquecer nem alterar o teste existente. |
| `apps/api/test/tenancy-people.test.ts:108–208` | Diretório/elegibilidade e perda imediata de vínculos; regressão do efeito observado nos vínculos. |
| `apps/api/test/rbac-db.integration.test.ts:155–173,201–224` | Delegação limitada, privacidade de vínculos e escopo. Rodada SQL precisa inventário de atores; não acrescentar autenticação fictícia. |

Sugestão de execução posterior: dirigido baseline/fixed primeiro; regressão serial restrita a tenancy-http, links, PATCHs e people na mesma composição. Expandir RBAC SQL somente após revisar suas fixtures sob068, com a fonte correta. Os resultados anteriores não podem ser somados como uma nova execução integrada. Root coordena memória/banco e todas as execuções; esta nota não autoriza serviço adicional.

## Pins da análise

- `apps/api/src/modules/tenancy/routes.ts`: `4089f119bb6e38367a09c7b17abeb950120e4524d9c379c49ea689ea870ef7f4`.
- `infrastructure/068-platform-mfa-required.sql`: `231ba481ebed3a1867fcb0332daba3850a53a6674c4cdd4dd019984de280c5a5`.
- `apps/api/test/tenancy-http.test.ts`: `16dd4e1cc684c9053c10438ebb4843ce89a193b5b192aa53d318f134a61ee286`.

Após esse lote, permanecem POSTs de estrutura/vínculos, convites/usuários, staff/concessões de suporte, demais comandos e domínios HTTP do inventário; aceites mobile/portais/matriz completa/operação continuam separados. Nenhum aceite de produção ou conclusão de performance decorre desta revisão.
