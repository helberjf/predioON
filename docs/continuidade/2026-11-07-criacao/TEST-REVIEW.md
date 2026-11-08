# Revisão independente do teste de criação de estrutura

Revisão estática concluída em 07/11/2026, no fuso America/Sao_Paulo. Nenhum bloqueador estático foi identificado na versão congelada abaixo. Isso não constitui resultado de compilação, execução PostgreSQL ou aceitação dos 17 casos. O revisor não executou Node, tipos, testes, banco, serviços ou navegador e não alterou o teste, produto, fontes congeladas ou repositório.

## Arquivos conferidos

- Teste: `work/mfa-tenancy-create-test-20261107/apps/api/test/platform-mfa-tenancy-create.test.ts`, SHA-256 `d36843c3459083a096ffffe1d9ac323b9e13efe3151ec2bdb36d4709d03d29ab`, 25.593 bytes.
- Manifesto `new-test-v1`: `work/mfa-tenancy-create-test-20261107/manifest.json`, SHA-256 `ebce098eb5398ab5a16f3099883e1d47b77b52f82d92dd28d2fa117323635f0b`, 4.826 bytes.
- Base: prepared `c2bb641f60ff44d847f4b34cf472cddcf235e0897c93659767eab514816a3c25`, 1.034 arquivos; router tenancy `37754d794909989eff26550ebe1a7fc549c939795961fe44fea2cc005f75967e`.
- Produto candidato: router tenancy `3f0f4db1d92fdb8ed991d0e173d9aa82123f17b6376f137d7d543c60797b790b`; manifesto `a4fba414ffb1ca8498462d0b60818f0810d9619164094583bf1ecb9902cf417c`.

A leitura integral do rascunho foi complementada pela conferência dos schemas de entrada, tabelas ORM, criação/auditoria originais e candidato. A versão final acrescentou a comparação exata de `mfa_verified_at::text`; seu hash e manifesto foram conferidos novamente.

## Oráculos e fronteiras

Os 17 casos são independentes, com zero grupos agregadores e uma suíte: seis perdas de fator/prova após autorização real, seis controles positivos, quatro contratos e um trigger estreito de auditoria. A expectativa é baseline com 10 PASS / 7 FAIL e candidato com 17 PASS. Ainda não é resultado executado.

Os atores obrigados fazem login, enrollment e confirmação TOTP por HTTP, com o mesmo bearer/SID, dez códigos de recuperação distintos e leitura posterior de fator/prova real. Os gestores opcionais fazem login comum. O SQL privilegiado cria a fixture ou remove fator/prova; não fabrica nem restaura aprovação MFA positiva.

A barreira delega o SQL real e reconhece apenas o `SELECT app_has_capability(...)` separado, confere capacidade/prédio e `allowed=true`. Ela não confunde a presença do helper em outro statement com a autorização original. Cada negativo usa um ator novo, mantendo separado seu controle positivo anterior.

Quando o baseline responde 201, as assertivas comparam o DTO completo, a linha persistida e a auditoria antes da falha esperada 201 versus 403. Há sete diagnósticos `Baseline201`, mas dois textos distintos: seis após a barreira de capacidade e um após o trigger. O futuro verificador deve usar os nomes de casos e mapear explicitamente `baseline: FAIL_EXPECTED_201_VERSUS_403` do manifesto. Contagem isolada, erro 500, timeout, fixture inválida ou cancelamento não provam RED.

Os DTOs preservam sete campos em blocks, nove em units e oito em teams, incluindo datas ISO em milissegundos, defaults, campos nulos e metadata quando existente. As linhas completas do banco são comparadas separadamente. UUID gerado e timestamps são obtidos da linha real; não há pressuposto de ID determinístico. O contrato original aceita `blockId: null` e `floor: null`, além de ausência, e o teste final conserva isso. Código repetido em blocks/units, FK composta estrangeira/inexistente, escopo local e input estrito possuem controles sem efeitos adicionais.

O trigger de teste é restrito a ator, SID, prédio, ação, tipo e nome exclusivo da equipe criada. Sua função SECURITY DEFINER tem `search_path` fixo, EXECUTE público revogado e metadados conferidos. Uma sequência não transacional testemunha exatamente uma execução mesmo se houver rollback. O candidato deve restaurar por rollback a criação, auditoria e o estado anterior da prova, incluindo o timestamp PostgreSQL exato e geração. O baseline deve persistir a criação/auditoria e deixar a prova nula antes da diferença 201 versus 403.

As transações reais do app são acompanhadas e aguardadas; requisições/barreiras têm prazo de cinco segundos. A limpeza usa limites de lock de dois segundos e statement de três segundos, remove função/trigger/sequência, compara o catálogo anterior e fecha listener/pools. Isso é desenho estático de cleanup; a execução posterior ainda precisa confirmar seus resultados e o controlador externo da fixture.

## Limites preservados

Este lote não ensaia espera real de lock, promoção de autoridade, perda de capacidade durante espera, concorrência de constraints, INSERT vazio induzido, exceção de trigger ou todas as combinações de concorrência. Não cobre criação de vínculos, concessões ou convites. A leitura de arquivos e revisão não demonstram comportamento do PostgreSQL; RED/GREEN, tipos e regressão continuam a cargo do root.

A regressão proposta e aprovada para preparação contém oito arquivos: 113 resultados TAP, sendo 103 casos independentes e dez grupos. Com os 17 dirigidos aprovados futuramente, seriam 130 TAP / 120 independentes / dez grupos. Esses números são expectativas de seleção, sem antecipar execução, desempenho, navegador, Android, iOS ou prontidão de produção.
