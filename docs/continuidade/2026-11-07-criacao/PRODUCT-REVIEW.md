# Revisão root do candidato de criação

Revisão estática em 07/11/2026, sem execução de tipos, banco ou testes deste incremento. Fonte anterior: composição de revogações c2bb/1.034. Manifesto de produto `a4fba414ffb1ca8498462d0b60818f0810d9619164094583bf1ecb9902cf417c`; rota candidata `3f0f4db1d92fdb8ed991d0e173d9aa82123f17b6376f137d7d543c60797b790b`; patch `b82fbe040a46da6eb4caf13b3c902a7a49c34bc801f8da93164858db787f9203`.

O diff inteiro altera apenas os três POSTs de blocks, units e teams e acrescenta seus decoders/helper privado. Os schemas e handlers anteriores permanecem intactos. A decisão MFA materializada é consumida pelo INSERT SELECT e pelo resultado escalar; uma linha válida é exigida antes de auditar. O guard final usa a função já existente e fica após a auditoria. Resultado vazio anômalo causa erro interno e rollback, não sucesso 201; esse ramo ainda não foi induzido.

As projeções conferem com schema-rbac: sete campos de blocks, nove de units e oito de teams. Datas usam o decoder existente; metadata existe somente em units/teams. Valores ausentes não preenchem colunas de defaults; floor e blockId explícitos nulos continuam aceitos. O erro do inventário sobre floor foi corrigido no plano publicado. Parâmetros vêm dos schemas existentes; nomes SQL são do servidor, sem grants ou ampliação de capacidade. A função efetiva de capacidades da migration 021 exige gestão local para esses comandos e não transforma o flag de administrador em autorização local.

A documentação primária explica que o resultado RETURNING é o meio de ler o efeito de DML dentro de WITH e que as subinstruções compartilham o snapshot. Portanto, a inferência usada aqui é limitada à dependência da decisão no statement; o guard posterior é outra instrução, sem promessa de serialização universal até commit. [PostgreSQL 17: WITH](https://www.postgresql.org/docs/17/queries-with.html#QUERIES-WITH-MODIFYING).

Colunas omitidas recebem os defaults do banco, e RETURNING fornece as linhas efetivamente inseridas. Isso sustenta a preservação dos opcionais e a recusa de um resultado inesperadamente vazio; a equivalência HTTP ainda exige os testes reais. [PostgreSQL 17: INSERT](https://www.postgresql.org/docs/17/sql-insert.html).

Nenhum bloqueador estático identificado nesse recorte. Tipos, seis negativas após capacidade, sete negativas contando o trigger de auditoria, controles de DTO/escopo/constraints e regressões continuam necessários. Promoção, locks concorrentes, INSERT suprimido por trigger e desempenho não estão aprovados por esta revisão.
