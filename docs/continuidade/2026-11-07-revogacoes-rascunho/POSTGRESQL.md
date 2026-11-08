# Conferência documental do coordenador

Consultado em 07/11/2026, sem executar SQL ou alterar o candidato.

A documentação de [CREATE POLICY do PostgreSQL 16](https://www.postgresql.org/docs/16/sql-createpolicy.html) confirma que SELECT FOR UPDATE aplica as políticas de SELECT e UPDATE. Isso sustenta preservar o lock original para não ampliar a visibilidade de vínculos a leitores sem gestão.

O exemplo de concorrência em [Row Security Policies](https://www.postgresql.org/docs/16/ddl-rowsecurity.html) mostra que, após esperar pelo lock, a linha alvo pode estar atualizada enquanto uma relação consultada pela política ainda usa o snapshot anterior. Esse comportamento fundamenta a nova decisão MFA depois da espera; não prova a correção da CTE candidata nem substitui os ensaios de banco.

Não foram afirmadas linearização até a resposta HTTP, aprovação dos três comandos ou conclusão dos testes a partir dessas referências.
