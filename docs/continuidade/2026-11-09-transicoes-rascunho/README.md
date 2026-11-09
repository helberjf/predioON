# Checkpoint antes da pausa: transições de funcionalidades

Salvo em 09/11/2026 a pedido do usuário, antes de a bateria acabar. **32 cenários escritos; zero cenários funcionais executados neste lote.** Resolução/importação passou; verificação completa de tipos e execução com banco continuam pendentes. Nenhum produto ou teste anterior foi alterado.

## O que retomar

1. Restaurar a cadeia aceita até [pausa/retomada de 1.045 fontes](../2026-11-09-ciclo-funcionalidades/README.md), cujo resultado está no commit `2bd4670758c14655ea05d64c4d4ae764f5652a58`. Não aplicar o rascunho diretamente ao runtime da main.
2. Preservar essa pasta. Em uma nova cópia das fontes, acrescentar somente `apps/api/test/platform-mfa-feature-transition-rollback.test.ts`, usando os bytes do [payload](payload/apps/api/test/platform-mfa-feature-transition-rollback.test.ts.txt). Conferir SHA-256 `3111360cb0499fc03c2e93e8ccc5fd888df0184e318aa2857554a6b707d5c66b`. Composição: 1.046 fontes. Não copiar caches, credenciais ou dependências da outra máquina.
3. Usar os 43 arquivos de teste e as 14 fontes exigidas no [plano](QA-PLAN.json). Resolver dependências localmente e executar a checagem de tipos antes dos testes. A resolução observada neste computador não prova a instalação em outro.
4. Revisar os executores, seus hashes e a identidade do banco fictício; manter o limite mínimo de 1.536 MiB livres. Executar os 32 casos em banco temporário exclusivo e conferir a remoção do banco, restauração dos papéis/credenciais/configurações e encerramento dos processos. Os registros imutáveis da fila de alertas são descartados com o banco completo, sem desabilitar seus triggers.
5. Conferir cada nome/caso, prova de que o efeito real ocorreu, ausência de notificação, reversão completa dos dados e da identidade. Só então publicar o resultado e um pacote aceito. Não chamar este rascunho de aprovado.

## Cobertura preparada

Dois escopos (global e condomínio), quatro pontos (DELETE do cursor, UPDATE do total diário na retomada, cancelamento do comando de portão, cancelamento da entrega durável) e quatro condições (prova MFA retirada, fator removido, vínculo global revogado, exceção de banco): 32 casos independentes.

Inscrição/TOTP HTTP reais; vínculo global sem flag para a revogação de autoridade. Triggers AFTER restritos ao ator/SID/registro e sequência testemunham o efeito mesmo após rollback. São conferidas 14 tabelas com todos os condomínios, auditoria, estado da fila e prova/fator/vínculo. Sem equipamento físico, navegador ou envio externo; não cobre concorrência de outro cliente neste lote.

## Situação local recuperável

Pasta preparada: `work/mfa-feature-transition-v2-fixed-qa-20261109`; SHA do `prepared.json`: `3837cc9b4732a4604a1db4e970d0c002bb18178edfc8daa69873c6a75a78df9a`. Harness: `work/mfa-feature-transition-v2-harness-20261109`. O primeiro executor de resolução parou antes do compilador porque uma substituição de contagem alterou a referência ao commit-base. V2 corrige a referência em pasta nova; teste/produto e plano preservados. [Histórico](../../evidencias/mfa-feature-transition-v1-review-2026-11-09.json).

[Evidência do checkpoint](../../evidencias/mfa-feature-transition-checkpoint-2026-11-09.json). Os oito casos de ciclo de vida e os 117 casos independentes de configurações pertencem a rodadas anteriores, com suas próprias evidências. MFA obrigatória 068 continua candidata; runtime main 001–067. **Computador não reiniciado.**
