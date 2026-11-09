# Reversão de transições com MFA: resultado de 09/11/2026

**32/32 casos independentes passaram**, em uma suíte, sem falhas/cancelamentos/skips/TODO. [Prova completa](../../evidencias/mfa-feature-transition-2026-11-09.json). API/PostgreSQL reais, autenticação com inscrição/TOTP pelo HTTP e o mesmo bearer/SID. Esta rodada adiciona somente um arquivo de teste à composição; preserva os 1.045 arquivos do pai, incluindo produto e testes existentes.

## Matriz exercitada

Dois escopos (global e condomínio) × quatro efeitos × quatro condições = 32 casos. Efeitos: DELETE de cursor de consumo, UPDATE do total diário durante retomada, cancelamento de comando de portão e cancelamento da entrega durável. Condições: prova MFA retirada, fator removido, vínculo global revogado e exceção de banco. A revogação usa vínculo global sem flag administrativa, para não conservar outra forma de autoridade.

Os triggers AFTER são restritos a ator/SID/registro, com função privada e busca de nomes fixada. Uma sequência testemunha que cada efeito alvo realmente aconteceu uma vez, mesmo após rollback. A fixture da entrega usa a função real de enfileiramento e comprova elegibilidade antes do comando. Catálogo e objetos de trigger são conferidos/restaurados.

São comparadas todas as linhas de 14 tabelas, abrangendo outros condomínios, configurações, versões, relógios, consumo, comandos, vagas, alertas, fila durável e auditoria. Também são conferidos prova/fator/códigos de recuperação/vínculo do ator. A ausência de NOTIFY é verificada por uma barreira confirmada no listener, sem usar uma espera arbitrária como prova.

## Execução e evidências

- Commit observado antes/depois: `6f68a550037dc27b7a9d94a785bd075efa4b7d0b`.
- Início UTC: `2026-11-09T05:21:23.341Z`; término UTC: `2026-11-09T05:22:49.068Z`.
- Memória inicial: 4052 MiB; mínimo de 1.536 MiB preservado.
- Resolução/importações e checagem completa de tipos passaram: 43 testes, 14 fontes obrigatórias.
- 1.045 fontes do pai → 1.046 no candidato; único acréscimo: `apps/api/test/platform-mfa-feature-transition-rollback.test.ts`.

O [rascunho original](../2026-11-09-transicoes-rascunho/README.md) foi salvo antes de a bateria acabar. V1 do executor alterou por engano o hash do commit ao substituir uma contagem; parou antes do compilador. V2 corrigiu isso, passou nos tipos e executou 32 casos, mas todos falharam na criação da fixture de portão: criação usava início da transação e expiração usava um relógio posterior mais 15 segundos, violando o limite. [Histórico V2](../../evidencias/mfa-feature-transition-v2-review-2026-11-09.json). V3 usa `statement_timestamp()` explicitamente nos dois campos, mantendo o limite e todas as asserções/prazos. Produto inalterado. Nenhuma dessas tentativas recusadas é contada como aprovação.

## Limites e continuidade

Retirada de autoridade dentro da mesma transação por trigger; este lote não demonstra corrida de outro cliente. Não houve dispatcher físico, webhook externo, equipamento, navegador, build mobile ou medição de desempenho. Os oito cenários positivos de ciclo de vida e os 117 casos independentes de configurações mantêm suas próprias evidências e não formam uma única execução com estes 32.

Banco temporário removido após todos os filhos encerrarem; seis papéis/credenciais/configurações, identidade do contêiner e fontes conferidos. Registros imutáveis da fila foram removidos com o banco inteiro, sem desativar os triggers de imutabilidade. Solicitação temporária para manter o sistema ativo retirada. **Computador não reiniciado.**

[Pacote de fontes](README.md) e [restauração](../../evidencias/mfa-feature-transition-restore-2026-11-09.json) conferem um payload e 1.046 arquivos, sem repetir testes ou iniciar serviços. MFA obrigatória 068 continua candidata; runtime main 001–067. Seguem alvo ausente/promoção, corridas externas, demais domínios, regressão integrada, portais/apps, operação, documentação e apresentação finais.
