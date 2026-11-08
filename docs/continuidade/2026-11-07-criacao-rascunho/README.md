# Checkpoint de autoria: criação de estrutura com MFA

**Produto e teste revisados estaticamente, ainda sem tipos ou execução funcional deste incremento.** Este pacote salva o trabalho em andamento para outro computador. Não altera o runtime da main nem declara aprovação de produção.

Somente POST `/v1/tenancy/blocks`, `/units` e `/teams` mudam. A decisão MFA participa do INSERT e uma nova decisão ocorre após auditoria. Os DTOs completos, defaults, schemas, capacidades e RLS são preservados; `floor:null` continua válido. Resultado inesperadamente vazio causa erro interno e rollback. [Produto](PRODUTO.md), [revisão](REVISAO-PRODUTO.md) e [plano](PLANO.md).

O [teste comum](TESTES.md) contém 17 casos independentes: seis negativas após capacidade, seis controles positivos, quatro contratos e uma negativa com trigger de auditoria em teams. Expectativas: baseline com dez aprovações e sete falhas específicas; fixed com 17 aprovações. Não são resultados executados. Os negativos exigem diagnóstico do DTO completo, criação e auditoria antes da comparação 201 versus 403; o trigger usa testemunha não transacional e compara a prova da família, inclusive o timestamp. [Revisão do teste](REVISAO-TESTE.md).

Restaure primeiro a [composição de revogações com 1.034 arquivos](../2026-11-07-revogacoes/RESULTADO.md), seguindo sua cadeia desde core85. O before de routes deve ser `37754d794909989eff26550ebe1a7fc549c939795961fe44fea2cc005f75967e` e o teste novo não deve existir. Crie duas árvores novas: ambas recebem o mesmo teste, baseline conserva a rota anterior e fixed recebe a rota `3f0f4db1d92fdb8ed991d0e173d9aa82123f17b6376f137d7d543c60797b790b`. Cada composição terá 1.035 fontes. Os payloads são arquivos completos com extensão .txt apenas para armazenamento. Não sobrescrever fontes ensaiadas ou aplicar o arquivo isoladamente na main 001–067, sem suas dependências candidatas.

[Manifesto de produto](PRODUCT-MANIFEST.json), [manifesto do teste](TEST-MANIFEST.json) e [checksums](CHECKSUMS.json) identificam os bytes. A nota original de revisão pendente descreve o instante da autoria; a revisão estática posterior não substitui tipos, SQL e execução real.

Próxima sequência: preparar dependências apontando ao src de cada árvore, resolver e compilar 31 arquivos de teste e 13 fontes obrigatórias, executar baseline e classificar cada falha, executar fixed e oito regressões seriais. Previsão da regressão: 113 TAP, com 103 casos independentes e dez grupos. Não somar testes históricos ou contar a preparação como teste funcional.

Use a fixture UUID oficial, conexões restritas, guard de memória, logs sem segredos e comprovação de limpeza/restauração das seis roles. A aprovação MFA vem de login/enrollment/TOTP reais nos atores obrigados; controles opcionais fazem login comum. Não fabricar prova positiva por SQL, iniciar outra instância de banco ou reiniciar computador, Docker ou WSL.

Não são cobertos ainda locks concorrentes, promoção durante espera, INSERT suprimido por trigger, todos os domínios, browser, Android/iOS ou operação. Concessões/renovações e convites permanecem lotes posteriores.
