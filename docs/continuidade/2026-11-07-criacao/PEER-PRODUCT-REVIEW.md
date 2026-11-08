# Revisão independente do produto de criação de estrutura

Leitura estática de 07/11/2026, sem execução de Node, tipos, PostgreSQL, testes ou serviços. Nenhum bloqueador concreto identificado no recorte. Não alterei o candidato nem PRODUCT-REVIEW.md do root.

Candidato `work/mfa-tenancy-create-candidate-20261107/after/apps/api/src/modules/tenancy/routes.ts`: SHA256 `3f0f4db1d92fdb8ed991d0e173d9aa82123f17b6376f137d7d543c60797b790b`, 44.397 bytes. Before `37754d794909989eff26550ebe1a7fc549c939795961fe44fea2cc005f75967e`, 40.987 bytes. Manifesto `a4fba414ffb1ca8498462d0b60818f0810d9619164094583bf1ecb9902cf417c`; patch `b82fbe040a46da6eb4caf13b3c902a7a49c34bc801f8da93164858db787f9203`.

A reconstrução estática removeu somente o bloco de helpers novos e substituiu os três handlers POST por suas versões anteriores; o resultado ficou byteidêntico ao before. Portanto não há edição oculta nos schemas, GETs, seis PATCHs, três DELETEs, concessões ou convites. A comparação de texto não executou produto.

## Decisão e transação

O guard `public.app_require_session_mfa()` está em CTE materializado e é consumido pelos três INSERT SELECTs e pelo resultado escalar. O helper é privado e seus únicos três chamadores fornecem SQL de servidor. Tabelas, colunas e projeções não são entrada HTTP; valores passam pelos schemas existentes e parâmetros. O DML não é enviado a readMfaRows.

O helper exige uma linha de envelope e exatamente uma linha RETURNING decodificável com UUID antes de auditar. Zero/múltiplas linhas inesperadas causam erro interno e rollback, sem201 vazio nem404/409 inventado. A capacidade explícita original e as policies INSERT continuam presentes. A auditoria mantém ator, prédio, ação, resourceType e a ordem posterior à criação.

O check final usa requireStructureOutcomeMfa existente, em novo statement após auditoria. Não acrescenta nova capacidade nem altera helpers globais. Sob a política068, app_require_session_mfa é STABLE e retorna true ou PMF01/02 segundo identidade/família; o inTenantContext conserva a tradução, e inTenancy mantém mapeamentos de constraint/RLS. O guard final permite demonstrar rollback de mudanças de prova feitas por trigger da própria transação; não é lock universal até commit.

## DTO e valores

Comparei as projeções com schema-rbac.ts: blocks conserva sete campos, units nove e teams oito. Metadata permanece somente em units/teams; active, kind e timestamps usam defaults do banco. Os decoders reaproveitam o Date válido existente após JSON, preservando a serialização HTTP em ISO/milissegundos do ORM. Não substituem o DTO completo por uma view de GET/PATCH.

Em units, colunas opcionais são omitidas se o input é undefined. Valores explícitos null continuam incluídos e tipados como uuid/integer, como requer o schema original. **floor:null é aceito**, além de ausência e inteiro válido; o erro do plano está documentado separadamente. Não há coerção nova de string/fração nem aceitação de propriedades extras. Constraints de duplicidade e FK continuam no mesmo banco e wrapper de erros.

## Limites

Esta revisão não prova compilação, plano SQL real, retorno vazio induzido, espera de lock, corrida de constraints, promoção, perda de capacidade ou performance. O teste comum congelado de17 casos, baseline/fixed e as regressões precisam de execução/revisão root. Os seis negativos após capacidade e o trigger estreito pós-auditoria são demonstrações propostas, não resultados desta nota. Não há mudança de SQL068, roles/grants/ACL ou aceite de produção.
