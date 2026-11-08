# Próximo lote proposto: concessões simples de tenancy

Inventário somente leitura sobre `work/mfa-tenancy-create-fixed-qa-20261107/source`, prepared `ce90003f2777c890195c814b6560f0ca26edb2989f1770a2c4aabea8939d54ff`, com 1.035 arquivos. Os resultados do lote de criação devem ser conferidos na prova publicada pelo root; este inventário não os reexecuta. Nenhum runtime, fonte QA, teste, banco, serviço, pacote histórico ou documento publicado foi alterado pelo autor.

Recomendação após o aceite do incremento atual: proteger **somente POST `/v1/tenancy/unit-memberships` e POST `/v1/tenancy/role-bindings`**. Ambos usam `memberships:manage`, INSERT simples, retorno ORM integral e auditoria posterior. Preservar o requisito adicional de recência de senha dos papéis. Depois tratar o único upsert de `/team-members`; por último, tratar o par criação/revogação de convites. Não implementar os cinco endpoints juntos nem criar um executor universal de comandos.

## Inventário residual e diferenças relevantes

| Endpoint | Contrato existente | Fronteira MFA que ainda falta neste handler |
| --- | --- | --- |
| POST `/unit-memberships` | `memberships:manage`; INSERT; 201 com 10 campos; eventos `UNIT_MEMBERSHIP_CREATED` / `unit_membership`. Kind obrigatório no input; datas opcionais ou null. | Guard dependente do INSERT e decisão final após auditoria. Não há recência055 nem renovação/upsert. |
| POST `/role-bindings` | `memberships:manage`, depois `requireRecentVerification`; INSERT com `grantedBy` real; 201 com 14 campos; auditoria `ROLE_BINDING_CREATED` / `role_binding`, metadata `{ roleKey }`. | Guard dependente do INSERT após a recência e decisão final após auditoria, conservando delegação RLS. |
| POST `/team-members` | `teams:manage`; INSERT ou renovação do par equipe/pessoa; conflito ativo produz 409 quando RETURNING está vazio; checagem de morador após a escrita; 201 e metadata de vigência. | Guard no efeito, no vazio normal de conflito, na classificação posterior e após auditoria. O vazio não tem a mesma semântica dos INSERTs simples. |
| POST `/invitations` | Revoga convites abertos anteriores do mesmo e-mail/prédio e audita; cria segredo de uso único e convite de sete dias; audita criação; retorna token uma vez; e-mail somente após commit. | Decisões ligadas às duas escritas, inclusive zero revogações anteriores, e à resposta final; rollback conjunto antes de qualquer e-mail. |
| DELETE `/invitations/:id` | SELECT sem lock; capacidade; convite fechado produz 204 sem efeito; UPDATE condicional pode ficar vazio após aceitação concorrente e ainda responder 204 sem auditoria falsa. | Guard no lookup, resultado ausente, no-op e UPDATE/final, preservando essas diferenças. UUID malformado conserva 404 anterior à transação. |

O gate HTTP, a transação restrita, o contexto real de identidade/SID e o lock compartilhado de funcionalidades já existem. Esses mecanismos não substituem as decisões do statement de efeito. As policies restritivas068 não abrangem automaticamente essas tabelas. A lacuna é estática, ainda sem RED observado para os próximos endpoints.

## Desenho restrito do lote de dois INSERTs

Modificar apenas os dois handlers e helpers privados estritamente necessários em `modules/tenancy/routes.ts`. Preservar todas as outras rotas e os contratos de criação, PATCH e DELETE já congelados. O helper `insertStructure` atual declara três chamadores específicos; não ampliar silenciosamente esse contrato. Um helper privado para as duas concessões pode reproduzir o padrão de dependência, com statements e projeções do servidor, sem virar API SQL genérica ou alterar helpers compartilhados.

Ordem de `/unit-memberships`: validação existente → `assertCapability` real → INSERT guardado com retorno escalar → validação de exatamente uma linha/UUID e DTO → auditoria existente → nova decisão MFA → retorno201. Ordem de `/role-bindings`: mesma sequência, mas **preservar `requireRecentVerification(req)` depois da capacidade e antes do INSERT**. `grantedBy` continua sendo `currentAuth(req).userId`, nunca input do cliente.

O INSERT SELECT deve consumir o guard MATERIALIZED e o resultado escalar deve consumi-lo também quando RETURNING não produzir linha. Não usar `readMfaRows` para DML. Uma CTE apenas declarada não basta. Preservar defaults por omissão de campos ausentes, parâmetros tipados e aliases camelCase; datas nullable devem voltar a Date/null antes da serialização HTTP. Exigir uma linha antes de auditar. Para vazio inesperado, adotar explicitamente erro interno500 com rollback, consistente com o lote de criação, sem inventar404,409 ou sucesso201 vazio. Esse caminho anômalo precisa de prova própria se for incluído no aceite.

DTO de unit-memberships: `id`, `buildingId`, `unitId`, `userId`, `kind`, `active`, `startsAt`, `endsAt`, `createdAt`, `updatedAt` — 10 campos. DTO de role-bindings: `id`, `buildingId`, `userId`, `teamId`, `roleKey`, `resourceType`, `resourceId`, `active`, `startsAt`, `endsAt`, `grantedBy`, `reason`, `createdAt`, `updatedAt` — 14 campos. Os schemas de leitura existentes já descrevem essas colunas e os decoders de datas; conferir equivalência ao esquema ORM integral antes de reutilizar qualquer projeção.

Não há unicidade do par unidade/pessoa em `unit_memberships`, nem unicidade semântica geral de concessões em `role_bindings`: não acrescentar deduplicação, upsert ou409. O usuário destinatário pode ser alguém que recebe agora seu vínculo; não inventar exigência de vínculo prévio no prédio. FKs, RLS e schemas existentes continuam decidindo o contrato, incluindo ausência de uma regra nova de elegibilidade por conta/unidade ativa.

## Recência, delegação e precedência

`requireRecentVerification` consulta o pool identity, fora da transação app, e exige `verified_at` recente da mesma sessão não revogada. A prova055 é diferente da geração/prova MFA. Enrollment não deve renovar a recência de senha por conveniência deste lote. Não alterar verification.ts, sessões, MFA helpers, policies, grants ou roles de runtime para simplificar os testes.

Preservar o erro403 com `details.reason = VERIFICATION_REQUIRED` quando a recência já estiver vencida, e a capacidade anterior a essa consulta. Não prometer atomicidade de recência até commit nem corrigir sua janela concorrente neste incremento. Para testar perda de MFA depois da capacidade, manter a recência originalmente válida para que uma recusa055 não mascare PMF01/02; para testar recência, manter MFA satisfeita.

`role_bindings_write` chama `app_rbac_can_delegate`, que exige que o ator possua as capacidades do papel delegado. `memberships:manage` isolada não autoriza ampliar poder. O input exige exatamente userId XOR teamId, permite somente os quatro papéis locais e não aceita resourceType/resourceId. `PLATFORM_ADMIN` no body permanece erro de validação400, não uma concessão global seguida de403. O banco conserva scope, FK composta da equipe, janelas e ator real. Auditoria036 exige a linha existente e o `granted_by` correto para criação.

Não introduzir checagem tardia genérica de capacidade que altere a semântica dos comandos; a nova decisão final é MFA. Manter mapeamentos de unique/FK/check/RLS existentes. Os testes devem caracterizar precedência em fronteiras concretas, sem alegar que MFA sempre vence toda falha possível de constraint.

## Casos dirigidos propostos, sem contagem TAP congelada

1. Matriz dos dois endpoints × remoção de fator/prova. Ator administrativo com MFA satisfeita por login, enrollment e TOTP HTTP reais, mesma família/SID e vínculo local explícito. Pausar após o SELECT separado de `assertCapability` retornar allowed=true; remover somente fator ou prova pelo owner da fixture. Em role-bindings, confirmar que verifiedAt continua recente. Esperar403 PMF01/02 no fixed. Se baseline responder201, verificar antes do mismatch o DTO integral, a linha efetiva e exatamente a auditoria esperada.500, timeout, ausência da barreira ou falha de fixture não são RED.
2. Controles de ambos endpoints com gestor opcional e administrador satisfeito: defaults, UUID, Date/ISO, active, kind, reason trim, grantedBy e auditoria do ator real. Cobrir recipient user e equipe em role-bindings; ausência e null de vigência; janela futura válida; rejeição de janela invertida pelo schema. Não usar prova MFA positiva escrita por SQL.
3. Contratos sem efeito: prédio estrangeiro ou ator sem gestão, unidade/equipe de outro prédio por FK composta, destinatário inexistente, body extra, kind/papel inválido, XOR inválido e reason curta. Conferir estado/auditoria antes/depois e o status original concreto. Não assumir que um usuário existente sem vínculo prévio seja proibido.
4. Delegação menor que o papel pretendido: fixture com capacidade memberships:manage, mas sem todas as capacidades do papel local alvo; o gate de capacidade deve passar e a policy deve recusar403 sem linha/auditoria. Reaproveitar o desenho estático de `rbac-db.integration.test.ts`, sem alterar o catálogo/ACL de runtime do produto. A fixture e sua limpeza precisam de revisão específica.
5. Recência055: manter MFA satisfeita e envelhecer somente verifiedAt da sessão de teste para provocar `VERIFICATION_REQUIRED` no POST role-bindings, sem efeito. Renovar por `/auth/verify` real com senha e segundo fator quando aplicável; repetir com sucesso. Uma segunda sessão permanece vencida. Contrastar que unit-memberships não ganha requisito055 novo. Ator sem capacidade e recência vencida deve continuar recebendo a recusa de capacidade anterior.
6. Um trigger estreito por endpoint, limitado a ator, família, prédio, action e recurso da fixture, remove a prova durante a auditoria. Uma sequência/testemunha não transacional comprova que o trigger executou. No fixed, esperar403 e comprovar rollback de concessão, auditoria e do timestamp exato da prova anterior. No baseline201, comprovar os efeitos reais antes do mismatch. Desmontar trigger/função/testemunha após settlement de todas as transações reais.
7. Caracterizar repetição legítima das concessões sem inventar unicidade: dois INSERTs com payload compatível podem gerar IDs diferentes conforme o contrato atual. Caso apareça constraint em versão posterior, conferir sua origem antes de mudar expectativa. Este controle pode ser pequeno e separado da matriz de segurança.

Para a nova suíte, seguir o rastreamento de todas as promises reais e cleanup já usado em `platform-mfa-tenancy-create.test.ts`. Não devolver transação fictícia ou mockar uma autorização permitida. Owner fica restrito ao setup, fronteiras negativas, inspeção e limpeza; operações HTTP usam app/identity restritos. Não reaproveitar o mecanismo antigo de aprovação MFA sintética de outros testes.

## Por que equipes e convites vêm depois

`POST /team-members` precisa de um lote próprio: renovação inativa/expirada preserva ID, substitui ou limpa janelas e usa `current_timestamp` na condição atual; conflito ativo produz409 com RETURNING vazio. O helper060 é STABLE SECURITY DEFINER e precisa observar o estado resultante depois do upsert, pois a própria equipe pode conceder RESIDENT. Conservar essa consulta em outro statement; movê-la ingenuamente para uma leitura irmã da CTE de escrita perderia a mesma visibilidade de estado. Não transformar o classificador em mutador VOLATILE.

Casos mínimos desse futuro lote: criação e renovação × PMF01/02; conflito ativo com guard no vazio; gestor com teams:manage sem memberships:manage; rejeição de morador já existente e de equipe que concederia RESIDENT após inserção; renovação mantendo ID e limpando datas; duas solicitações concorrentes com201/409; rollback após auditoria. Espera real de lock, perda de capacidade durante espera e promoção posterior precisam de fronteiras próprias, não podem ser inferidas da simples barreira de código.

Convites mantêm outro contrato: ACL por coluna impede SELECT de token_hash, UPDATE de accepted_at e DELETE físico pelo app. Criação deve proteger revogação/substituição e INSERT sem publicar token quando a transação falha; testar zero convites anteriores e convite aberto expirado, ordem de auditorias e rollback integral. Nenhum e-mail pode sair em uma transação recusada; usar transporte de teste local, sem mensagens externas. O segredo não deve aparecer em logs, screenshots, vídeos ou documentação.

Na revogação, não copiar mecanicamente o FOR UPDATE dos vínculos: a policy042 de UPDATE oculta convites fechados, enquanto o contrato atual permite lê-los e responder204. Testar UUID ausente/oculto, fechado, aberto, expirado, aceito entre SELECT e UPDATE e mudança MFA nessas fronteiras. A aceitação pública `/auth/invitations/accept` usa helper identity separado, lock e autoridade do convidador; não inventar SID administrativo para esse fluxo público nem ampliá-lo neste lote.

## Regressões e continuidade

Começar pela seleção tenancy já congelada e pelo teste atual de criação, preservando os arquivos anteriores. Definir a seleção final e sua contagem somente na autoria do próximo harness; não somar históricos como execução integrada. `tenancy-http.test.ts` cobre vínculo de unidade, concessão por equipe, rejeição de plataforma e autorrevogação; `tenancy-people.test.ts` cobre classificação/elegibilidade e escopo. Eles não substituem o novo dirigido MFA.

`recent-verification.test.ts` contém ator global sem enrollment no setup antigo: sua execução integral sob068 precisa de auditoria da fixture antes de integrar a regressão. Não alegar PASS com o setup atual nem corrigir a aprovação por SQL. `rbac-db.integration.test.ts` e `authorization-time-windows.test.ts` também precisam de revisão de seus contextos diretos/roles/SIDs antes de acrescentar números ao aceite. Para convites, revisar separadamente `invitations.test.ts` e o teste de leitura; a suíte antiga inclui ACL e transporte de e-mail de teste, que devem permanecer intactos.

Usar cópias novas da fonte1035, mesmo teste comum em baseline/fixed, bibliotecas src da própria árvore e fixture UUID oficial. Root executa serialmente com guard de 1.536 MiB e cluster já ligado. Nenhum reinício. Guardar tentativas, logs, provas e restauração de roles; segurar cleanup se filhos diretos registrados não encerraram. Após eventual GREEN, gerar overlay próprio sobre a composição atual, sem reescrever core85 ou os overlays históricos.

MFA dos outros domínios, endpoints `/users`, mobile, portais, operação e integração de produção permanecem fora desta proposta. Decisões STABLE são por statement; não há promessa de linearização até commit, desempenho ou fechamento de toda concorrência.

## Referência de semântica

A separação da consulta pós-upsert considera a documentação oficial de [DML em CTE](https://www.postgresql.org/docs/17/queries-with.html#QUERIES-WITH-MODIFYING), que descreve snapshot compartilhado e comunicação via RETURNING. A decisão final em novo statement respeita a documentação de [volatilidade STABLE](https://www.postgresql.org/docs/17/xfunc-volatility.html). São fundamentos de desenho; os casos concretos ainda exigem PostgreSQL real.

## Pins da inspeção

Os hashes abaixo serão registrados a partir dos arquivos desta composição; nenhuma execução funcional é inferida da inspeção.

| Arquivo | SHA-256 |
| --- | --- |
| `apps/api/src/modules/tenancy/routes.ts` | `3f0f4db1d92fdb8ed991d0e173d9aa82123f17b6376f137d7d543c60797b790b` |
| `apps/api/src/auth/verification.ts` | `a8f96c45aa8cf055564803f0b116fa6ce87dd16be81ab974778c47fd2cda7608` |
| `packages/db/src/schema-rbac.ts` | `e2e193d745cb17ddf844785f7a42e18a6c4aef6b29b4ed2b4ca0e74435663726` |
| `infrastructure/014-rbac-tenancy.sql` | `31dc59f66f0b5cb7d62be06708a8f94a47ffd89281e8c7104e76d1acabd6e88b` |
| `infrastructure/019-building-discovery-resource-validation.sql` | `04749c7a36d2ea68e3f43a1303d85992ab8b3833621e273a0d934e928e6fff3c` |
| `infrastructure/021-authorization-time-windows.sql` | `28a210101540a71d6c5136e5bd8aa45fcd0288b76aaff7f9e0b37bf00914d2de` |
| `infrastructure/036-audit-capabilities.sql` | `085e57f736c32ced3b778fbb1df4b62bcfff5056bb9a2bf67a16bf542264118d` |
| `infrastructure/042-resident-invitations.sql` | `b66d49c15a0718c7c4c1a6c6fca9c251351ae95951ff008c1d3540af9a4913ce` |
| `infrastructure/055-session-recent-verification.sql` | `0269bb7a722a6851c572291e402acebad746fc213acaeae243ed7ee4fad96e42` |
| `infrastructure/060-team-member-eligibility.sql` | `db7494a1858e5cc96e7c28c856bf894c91f29d544edbca327df62a35e6e1ebbb` |
| `apps/api/test/tenancy-http.test.ts` | `16dd4e1cc684c9053c10438ebb4843ce89a193b5b192aa53d318f134a61ee286` |
| `apps/api/test/recent-verification.test.ts` | `1dc8b6b4b4690a03bc177ae9882e0231de3d43f1d56fbb96a8bf7a93527e049c` |
| `apps/api/test/platform-mfa-tenancy-create.test.ts` | `d36843c3459083a096ffffe1d9ac323b9e13efe3151ec2bdb36d4709d03d29ab` |
