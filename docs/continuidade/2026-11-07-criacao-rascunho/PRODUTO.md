# Candidato: MFA nos três POSTs de estrutura

Autoria estática de 07/11/2026 sobre a composição fixa de revogações, prepared `c2bb641f60ff44d847f4b34cf472cddcf235e0897c93659767eab514816a3c25`, 1.034 arquivos. Somente `apps/api/src/modules/tenancy/routes.ts` muda; a fonte congelada, o repositório, o core85 e os pacotes portáteis permanecem intactos. Nenhum Node, tipo, banco, serviço ou teste foi executado pelo autor. Ainda não há RED/GREEN nem aceite de produção para este lote.

## Recorte e comportamento

Os únicos handlers modificados são `POST /v1/tenancy/blocks`, `/units` e `/teams`. Os schemas de entrada continuam byte a byte iguais. Também permanecem idênticos todos os GETs, os seis PATCHs, os três DELETEs e os demais POSTs; a autoria verifica a reconstrução integral do original removendo apenas as adições aprovadas.

Cada handler conserva `assertCapability` real antes do comando e a transação `inTenancy`. Um helper privado, chamado somente por estes três INSERTs estáticos, cria uma CTE MFA `MATERIALIZED`. Cada `INSERT SELECT` consome essa CTE no `FROM` e no filtro; o SELECT escalar do resultado a consome também quando não existe linha de `RETURNING`. Não há CTE de decisão apenas declarada, mutador SQL novo, nem uso de `readMfaRows` para DML. Valores são parâmetros, e tabelas, colunas e aliases são escritos pelo servidor.

O retorno exige exatamente uma linha com UUID válido, decodificada antes da auditoria. A criação não tem no-op previsto. Se o INSERT inesperadamente não retornar uma linha, o helper lança erro interno, levando a500 e rollback da transação; não inventa404/409 nem responde201 vazio. Uma decisão false/null também não pode gerar sucesso. Essa fronteira anômala ainda precisa de prova própria se for adicionada à cobertura futura.

A auditoria continua depois do INSERT, com os mesmos ator, prédio, action, resourceType, resourceId e metadados (ausentes nestes três eventos). Depois dela, o helper privado já existente `requireStructureOutcomeMfa` faz uma nova decisão, na mesma transação. Não há nova checagem tardia de capacidade. Uma recusa MFA nessa decisão deve abortar criação e auditoria; a prova prática exige o caso dirigido com trigger estreito e testemunha, a ser executado pelo root.

## DTOs, defaults e erros

O JSON intermediário contém a projeção integral dos respectivos `.returning()` originais, com aliases camelCase e schemas estritos: blocks7 campos (`id`, `buildingId`, `code`, `name`, `active`, `createdAt`, `updatedAt`); units9 (`id`, `buildingId`, `blockId`, `code`, `floor`, `active`, `metadata`, `createdAt`, `updatedAt`); teams8 (`id`, `buildingId`, `name`, `kind`, `active`, `metadata`, `createdAt`, `updatedAt`). Datas passam pelo decoder existente para `Date`, mantendo a serialização HTTP ISO/milissegundos do ORM. Os defaults de UUID, active, datas, kind e metadata são aplicados pelo banco, pois essas colunas não são fornecidas no INSERT.

Em units, `blockId` e `floor` ausentes também são omitidos da lista SQL, preservando o comportamento de defaults; valores presentes usam parâmetros e casts uuid/integer. O schema original aceita ausência e null explícito em ambos; `floor:null` continua válido. A afirmação contrária no inventário scratch anterior foi comunicada ao root e ao autor dos testes. Trims, limites, rejeição de campos extras e demais validações não mudam. Blocks não ganha metadata; units/teams mantêm o objeto metadata retornado.

As capacidades units:manage/teams:manage, RLS, ACL e constraints continuam as mesmas, sem grants novos. `inTenancy` mantém unique23505→409, FK/check23503/23514→400 e RLS42501→403; PMF01/02 continuam no contexto de autenticação existente. Uma recusa de schema ou capacidade antes do INSERT mantém sua precedência. Para entradas que chegam ao INSERT, o guard participa do statement de efeito; não é prometida prioridade universal entre toda falha de banco possível e MFA. A matriz dirigida precisa caracterizar as recusas escolhidas, sem aceitar500, timeout ou erro de fixture como RED.

## Limites e próxima validação

O helper MFA existente é STABLE. A CTE cria uma dependência da escrita sobre o guard, mas não congela mudanças externas até commit nem equivale a uma nova decisão depois de toda espera de constraint. Promoção posterior, perda de capacidade durante espera, unicidade/FK concorrente, desempenho e combinações completas continuam fora deste lote. Nenhum lock ou função VOLATILE foi acrescentado. A guarda de funcionalidades existente permanece intacta e não é descrita como serialização do fator/prova MFA.

O root deve revisar `candidate.patch`, congelar teste comum e receitas, executar tipos e então baseline/fixed na fixture UUID oficial sob role restrita. A proposta de teste separado cobre PMF01/02 depois da capacidade real, DTOs/defaults/erros e rollback após auditoria, com limites próprios; este pacote não antecipa contagem nem sucesso. Serviços e computador não devem ser reiniciados. Um overlay portátil novo, se aprovado após os ensaios, deverá preservar a cadeia histórica, sem reescrever core85.

## Referências de semântica consultadas

- PostgreSQL17, [WITH e DML em CTE](https://www.postgresql.org/docs/17/queries-with.html#QUERIES-WITH-MODIFYING): RETURNING é a saída que comunica a escrita ao SELECT externo; CTEs de escrita compartilham o snapshot do statement. Isso fundamenta o desenho, não substitui execução dirigida.
- PostgreSQL17, [INSERT](https://www.postgresql.org/docs/17/sql-insert.html): colunas omitidas recebem defaults e RETURNING descreve linhas efetivamente inseridas.
- PostgreSQL17, [volatilidade](https://www.postgresql.org/docs/17/xfunc-volatility.html): STABLE lê o snapshot do statement chamador, portanto a decisão final é outro statement, não uma alegação de nova leitura dentro do INSERT.

`manifest.json` registra os hashes e os bytes do arquivo antes/depois. `HANDOFF.json` fixa os demais artefatos deste candidato. Não copiar o diretório before como implementação nem aplicar este delta sobre uma fonte diferente sem verificar o beforeSha256.
