# Próximo lote: criação de estrutura e fila de concessões/convites

**Aceite de partida confirmado depois desta auditoria:** o lote de revogações passou nos [21 casos dirigidos e sete regressões](../../evidencias/mfa-tenancy-revocations-2026-11-07.json), com [restauração de 1.034 fontes](../../evidencias/mfa-tenancy-revocations-restore-2026-11-07.json). Este novo lote de criação ainda está em autoria, sem execução ou aceite. A matriz escolhida tem 17 casos independentes: seis negativos após capacidade, seis controles positivos, quatro contratos e um rollback de trigger em teams. Baseline 10/7 e fixed 17/0 são expectativas, não resultados.

Inventário estático de 07/11/2026. Fonte isolada: `work/mfa-tenancy-revocation-fixed-qa-20261107/source`, prepared `c2bb641f60ff44d847f4b34cf472cddcf235e0897c93659767eab514816a3c25`, 1.034 arquivos. Nenhum produto, fonte congelada ou documento publicado foi alterado; nenhum teste, tipo, banco ou serviço foi executado pelo autor. A aceitação do lote de revogações deve ser conferida na prova que o root publicar; esta nota não a antecipa.

Recomendação: depois de fechar a prova dos três DELETEs, implementar **somente POST blocks/units/teams**. É a menor família coesa de criação: três fluxos iguais, duas capacidades, INSERT simples e auditoria posterior, sem renovação de vínculo, recência de senha ou e-mail. Manter concessões e convites em lotes seguintes. Não criar executor universal de comandos, papéis ou permissões novas.

## Proteção existente e lacuna

`apps/api/src/app.ts:61` autentica antes de montar `/v1/tenancy`; o gate HTTP já recusa sessão que chega restrita. `inTenancy` (`modules/tenancy/routes.ts:178`) usa `inTenantContext`, conexão restrita e identidade/SID reais, lock compartilhado de funcionalidades e tradução PMF01/02. Converte constraint23503/23514 em400, unique23505 em409 e RLS42501 em403. Capacidade, RLS e constraints continuam obrigatórias.

As oito operações abaixo ainda não vinculam MFA ao statement de efeito nem possuem guarda final própria. A preocupação é mudança posterior ao gate, não ausência total de autenticação. O lock de funcionalidades não serializa fator, prova ou autoridade administrativa. Policies restritivas068 das seis tabelas de plataforma/equipamentos não se estendem automaticamente às tabelas abaixo. A presença de GETs protegidos também não protege RETURNING de uma mutação. São lacunas estáticas, não RED observado.

## Inventário exato no router tenancy

Prefixo de todas as rotas: `/v1/tenancy`. Linhas em `apps/api/src/modules/tenancy/routes.ts` desta composição.

| Endpoint | Autorização e operação | Retorno, vazio e contrato a preservar |
| --- | --- | --- |
| POST `/blocks` :220 | `units:manage`; INSERT blocks; auditoria BLOCK_CREATED/block | 201 com a linha ORM inteira; duplicate de código409; sem no-op normal. |
| POST `/units` :244 | `units:manage`; INSERT units; auditoria UNIT_CREATED/unit | 201; blockId e floor aceitam ausência ou null explícito; FK composta impede bloco estrangeiro; metadata e datas integram o retorno. |
| POST `/teams` :268 | `teams:manage`; INSERT teams; auditoria TEAM_CREATED/team | 201; kind padrão MAINTENANCE, metadata e datas; sem renovação ou concessão automática de autoridade. |
| POST `/unit-memberships` :292 | `memberships:manage`; INSERT vínculo; auditoria UNIT_MEMBERSHIP_CREATED/unit_membership | 201; kind OWNER/OCCUPANT/DEPENDENT, janelas e FKs de usuário/unidade/prédio. Não é upsert. |
| POST `/team-members` :316 | `teams:manage`; INSERT ou UPDATE condicional do par teamId/userId; leitura `app_tenancy_is_resident`; auditoria TEAM_MEMBER_ADDED/team_member | 201 ao criar/renovar; zero RETURNING no conflito ativo vira409. Renova inativo/expirado sem trocar ID, limpa/substitui janelas conforme input; resultado residente vira400 e rollback. |
| POST `/role-bindings` :352 | `memberships:manage`; `requireRecentVerification(req)`; INSERT com grantedBy=ator; auditoria ROLE_BINDING_CREATED/role_binding | 201; exatamente userId XOR teamId; só BUILDING_ADMIN, MAINTENANCE_MANAGER, MAINTENANCE, RESIDENT. Delegação RLS não pode ampliar poder do ator. |
| POST `/invitations` :577 | `memberships:manage`; revoga abertos do mesmo prédio/e-mail e audita cada um; INSERT com hash e validade7dias; audita criação | 201 `{ invitation, token, emailRequested }`. Zero convites anteriores é normal. E-mail começa somente depois do commit; segredo aparece uma vez, nunca em log ou listagem. |
| DELETE `/invitations/:id` :603 | Leitura sem FOR UPDATE; capacidade; UPDATE condicional só enquanto accepted_at/revoked_at nulos; audita apenas RETURNING não vazio | UUID válido ausente/oculto404; malformado404 antes da transação; já aceito/revogado204 sem efeito. Aceitação concorrente pode tornar UPDATE vazio e ainda retornar204 sem falsa auditoria. Expirado porém ainda aberto continua revogável. |

A leitura inicial de DELETE invitation é deliberadamente distinta dos três DELETEs novos: a policy de UPDATE042 oculta convite já fechado. Copiar FOR UPDATE mecanicamente removeria a idempotência204. O UPDATE vazio por aceitação concorrente também não deve virar o404 adotado para revogação de vínculos.

## Helpers e fronteiras que impedem agrupar tudo

- Estrutura/vínculos usam RLS014, validação de recurso019, vigência021 e auditoria036; esquema ORM em `packages/db/src/schema-rbac.ts`. A view estreita usada por GET/PATCH não equivale ao `.returning()` integral dos POSTs. Preservar aliases camelCase, UUID, active, defaults, null, metadata de units/teams e datas ISO; blocks não tem campo metadata no esquema ORM.
- `app_tenancy_is_resident` de060 é STABLE SECURITY DEFINER, somente classifica dentro de memberships:manage OU teams:manage. A checagem pós-upsert evita que a equipe de destino torne a pessoa residente. Não transformar sua função em mutador nem usar guard externo como prova de snapshots internos de um mutador VOLATILE.
- `requireRecentVerification` (`auth/verification.ts:24`) lê `sessions.verified_at` pelo pool identity, fora da transação app do comando. Recência055 e geração/prova MFA são requisitos distintos; enrollment não renova automaticamente a senha recente. Conservar ordem e reason VERIFICATION_REQUIRED sem substituir esse controle por MFA.
- Convites usam ACL por coluna e policies042: runtime não pode SELECT token_hash, trocar accepted_at ou DELETE físico. `identity_accept_invitation` é o mutador separado, usa locks e verifica novamente o convite/autoridade; `/auth/invitations/{preview,accept}` não representa sessão do administrador. Não inventar SID humano para esse fluxo público nem incluí-lo automaticamente no guard administrativo.
- Fora deste router, `POST /users`, `POST /users/memberships` e `DELETE /users/memberships/:membershipId` permanecem outra família (`users/routes.ts:105,140,179`). Usam inUsers, capacidades globais/locais, recência seletiva, renovação de janelas e auditoria antes de autorrevogação. Não contam entre as oito operações acima nem entram no primeiro lote.

## Desenho mínimo para os três POSTs recomendados

Preservar a capacidade real antes da operação, a transação atual e a auditoria posterior. Vincular o guard MFA ao INSERT e a um resultado escalar verificável, mesmo que nenhuma linha seja produzida. Não usar `readMfaRows` para DML. Exigir exatamente uma linha com ID válido antes de auditar; retorno vazio inesperado não é sucesso201. Fazer uma decisão MFA nova após a auditoria permite demonstrar rollback se um trigger estreito remover a prova dentro da transação.

A decisão precisa ser dependência real da escrita: CTE declarada e não consumida não basta. Não prometer serialização universal até commit. Capacidade/RLS continuam decidindo a escrita; não ampliar concessões de plataforma para autorizar gestão local. Conservar mapeamento de duplicate/FK/validação e caracterizar precedência quando MFA muda após a validação, antes de uma recusa derivada do banco.

## Prova dirigida proposta, sem contagem TAP aceita

1. Para cada POST, ator ADMIN inicialmente satisfeito por login/enrollment/TOTP HTTP reais e vínculo local explícito. Pausar após o SELECT separado de assertCapability retornar permitido; remover fator (PMF01) ou prova do mesmo SID (PMF02). Não fabricar nem restaurar aprovação SQL. Mesmo teste nas fontes baseline/fixed.
2. Antes de esperar403 no negativo, se o baseline responder201, comprovar DTO completo, linha real criada e auditoria exata. Identificar a criação por campos únicos da fixture/ID retornado; comparar estado e auditorias antes/depois, sem supor um UUID gerado determinístico. Falha de setup,500 ou timeout não é RED válido.
3. Controles por rota: gestor opcional e ADMIN satisfeito criam uma linha e uma auditoria. Conferir active/defaults, trims, metadata quando existente, datas ISO e ausência de campos extras; para units cobrir ausência/presença/null de blockId, floor omitido resultando null e floor:null explícito aceito conforme o schema original.
4. Controles finitos de foreign/sem gestão, bloco estrangeiro, código repetido, FK inexistente e input inválido: preservar status original e zero efeitos. Não chamar todo erro de autorização de MFA.
5. Um caso separado com trigger de auditoria estreito removendo a prova da família demonstra rollback conjunto de criação/auditoria/prova, com testemunha não transacional do trigger. Só aceitar esse caso quando fixture, limpeza e fronteira estiverem revisadas; sem trigger de produção.

Promoção pós-gate, concorrência de unicidade/FK com espera real, perda de capacidade durante espera e combinações completas permanecem fila explícita. Não alegar espera de lock a partir de uma simples barreira de código. Root executa tipos, baseline/fixed e regressões serialmente na fixture UUID oficial, com guards de memória e arquivos congelados; sem reinício.

## Cobertura existente que pode ser reutilizada

| Arquivo | Utilidade e limite |
| --- | --- |
| `tenancy-http.test.ts` | Criação de hierarquia/auditoria, foreign/validação, vínculos, rejeição de residentes em equipe, renovação concorrente e autorrevogação. Nove casos existentes não são prova MFA dos POSTs. |
| `tenancy-people.test.ts` | Nove casos de catálogo de pessoas/elegibilidade e escopo, inclusive teams:manage isolado. Não protege o comando de concessão por si só. |
| `tenancy-edit.test.ts` e `platform-mfa-tenancy-commands.test.ts` | Contratos de estrutura e metodologia de fronteira/rollback dos PATCHs. O teste antigo de comandos usa setup sintético de prova; reusar só metodologia, não essa aprovação positiva. |
| `platform-mfa-tenancy-revocations.test.ts` | Modelo novo de cerimônia HTTP real, atores distintos, barreira assertCapability precisa, diagnóstico de efeito e cleanup rastreado. Seus21 casos não cobrem POST. |
| `invitations.test.ts` | Nove casos de segredo/ACL, e-mail, preview/aceitação, reemissão/revogação, escopo e validade. Ler fixtures antes de executar sob068; não mudar provas SQL de ACL para SIDs fictícios. Não integra a seleção atual de sete regressões92. |
| `membership-lifecycle.test.ts` | Quatro casos de readmissão/janelas do membership legado via /users, fora do lote inicial. |

Começar a regressão pertinente por tenancy-http, estrutura/edit e people; selecionar os arquivos concretos antes de fechar contagens. Se depois alterar convites, executar sua suíte e testes de leitura de convites; se alterar concessões, acrescentar vigência/eligibilidade/delegação. Não somar históricos como uma nova rodada integrada.

Referências de fila: `docs/superpowers/plans/2026-11-07-mfa-proximos-comandos.md` e `work/mfa-next-revocation-static-20261107/PLAN.md`. A ordenação de suporte e os seis PATCHs já avançaram depois do plano antigo; não reabrir essas etapas com base em números de linha históricos. Todo o plano maior, mobile/portais, operação e aprovação de produção continuam separados.

## Pins consultados

- `apps/api/src/modules/tenancy/routes.ts`: `37754d794909989eff26550ebe1a7fc549c939795961fe44fea2cc005f75967e`.
- `apps/api/src/modules/users/routes.ts`: `18b586a50cf0851f1f7a36a7404f8f3573c0d6ff98286a83aa94d77b118a1cd0`.
- `apps/api/src/auth/verification.ts`: `a8f96c45aa8cf055564803f0b116fa6ce87dd16be81ab974778c47fd2cda7608`.
- `packages/db/src/schema-rbac.ts`: `e2e193d745cb17ddf844785f7a42e18a6c4aef6b29b4ed2b4ca0e74435663726`.
- `infrastructure/014-rbac-tenancy.sql`: `31dc59f66f0b5cb7d62be06708a8f94a47ffd89281e8c7104e76d1acabd6e88b`.
- `infrastructure/042-resident-invitations.sql`: `b66d49c15a0718c7c4c1a6c6fca9c251351ae95951ff008c1d3540af9a4913ce`.
- `infrastructure/060-team-member-eligibility.sql`: `db7494a1858e5cc96e7c28c856bf894c91f29d544edbca327df62a35e6e1ebbb`.
- `infrastructure/068-platform-mfa-required.sql`: `231ba481ebed3a1867fcb0332daba3850a53a6674c4cdd4dd019984de280c5a5`.
