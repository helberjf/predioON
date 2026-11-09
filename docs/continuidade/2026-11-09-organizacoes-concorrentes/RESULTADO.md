# Organizações: autorização após esperas concorrentes

**81/81 casos independentes passaram na versão corrigida**, em cinco suítes, sem falhas, cancelamentos, skips ou TODO. [Prova](../../evidencias/mfa-organization-waits-2026-11-09.json): 15 dirigidos e 66 regressões. Estes 66 foram reexecutados porque o produto mudou; não somar aos resultados históricos.

## Falha e correção

A referência passou em 11 dos 15 casos. Quatro falharam somente na resposta HTTP: POST e PATCH esperavam a liberação de uma organização concorrente com o mesmo slug; a conexão externa retirou prova ou fator e confirmou a transação. A API respondeu 409, embora a sessão devesse receber 403. As verificações de bloqueio pelo PID exato e da alteração real de identidade passaram antes dessa divergência. As comparações posteriores de dados nesses quatro casos não foram alcançadas; não são evidência independente sobre os efeitos da referência.

Um erro de unicidade aborta a transação de escrita e impede as verificações posteriores dentro dela. A correção revalida MFA e as duas capacidades comerciais em uma nova transação antes de traduzir o erro para conflito. O caminho usa o mesmo tratamento de erros sanitizados. Quando a autorização continua válida, preserva a mensagem e o status 409. SQL de escrita, lock NO KEY UPDATE, GET, contratos, esquemas, políticas e migrações permanecem iguais.

## Cobertura executada

- Cinco pontos: PATCH bloqueado na linha; POST e PATCH bloqueados na auditoria; POST e PATCH bloqueados no índice único.
- Cada ponto: retirada de prova, remoção do fator e controle sem retirada. Login, inscrição e TOTP reais; mesmo bearer/SID. Nenhuma prova positiva fabricada por SQL.
- Consulta da API com papel restrito, banco correto, espera ativa e conexão bloqueadora exata comprovados em pg_blocking_pids. Revogação externa e liberação do bloqueio confirmadas atomicamente.
- Nos casos recusados, todas as organizações e auditorias do domínio ficam inalteradas. No conflito, somente o cadastro externo concorrente permanece. Controles positivos verificam sete campos do DTO, datas, metadados, armazenamento, histórico e organizações não relacionadas.
- Triggers temporários apenas aguardam um bloqueio, sem escrever dados nem elevar privilégios; catálogo original restaurado e conferido em cada caso.
- Regressões inalteradas: organizações dirigidas 30, organizações legadas com MFA real 19, envelopes SQL 11 e obrigatoriedade de MFA 6. As duas últimas mantêm suas fixtures SQL históricas; não são apresentadas como 17 novas cerimônias reais.

## Evidências e retomada

Commit observado nos três lotes: `e47761605fbaa085196111b7b483720cb20a383a`. Resolução/tipos passaram em quatro fases, com 49 testes/15 fontes obrigatórias. Composição 1.049 → 1.050; um payload de produto e um teste novo. [Pacote](README.md) e [recibo de restauração](../../evidencias/mfa-organization-waits-restore-2026-11-09.json). Os logs TAP dos três lotes ficam em QA para conferência.

Memória inicial dos lotes: 2514 MiB, 2439 MiB, 2529 MiB; mínimo 1.536 MiB mantido. Bancos UUID exclusivos removidos, seis papéis/credenciais/configurações restaurados, filhos encerrados, fontes/contêiner conferidos. Solicitações temporárias de atividade retiradas. **Computador não reiniciado**.

## Limites

Promoção, retirada de capacidade durante conflito, falhas de triggers adicionais e demais domínios ainda exigem trabalho. Não houve navegador, hardware, build Android/iOS ou medição de desempenho neste lote. MFA 068 permanece candidata; runtime main 001–067. Não há aceite global de produção. Retomar por [CONTINUIDADE](../../CONTINUIDADE.md).
