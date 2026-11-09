# Revogação externa durante transições: resultado de 09/11/2026

**24/24 casos independentes passaram**, uma suíte, zero falhas/cancelamentos/skips/TODO. [Prova completa](../../evidencias/mfa-feature-transition-waits-2026-11-09.json). Produto e todas as 1.046 fontes anteriores preservados. Só foi acrescentado `apps/api/test/platform-mfa-feature-transition-waits.test.ts`.

## Concorrência verificada

Dois escopos (global e condomínio) × quatro efeitos (cursor de consumo, total diário na retomada, comando de portão, entrega durável) × três retiradas externas (prova MFA, fator, vínculo global) = 24 casos.

Uma conexão proprietária exclusiva bloqueia exatamente uma linha do efeito. A requisição HTTP usa autenticação real, inscrição/TOTP e o mesmo bearer/SID, com a conexão restrita da API. O teste limpa o snapshot de estatísticas e verifica `pg_blocking_pids`, banco, papel, consulta do helper e espera por lock. Só após comprovar que o processo correto está bloqueado, a outra conexão retira a identidade e confirma a transação, liberando a linha.

Cada resposta é 403, sem resultado de sucesso. Prova/fator retornam o motivo MFA esperado; revogação usa vínculo global sem flag administrativa. Todas as linhas de 14 tabelas de negócio/auditoria/fila, incluindo outros condomínios e efeitos anteriores dentro do helper, são comparadas antes/depois. A retirada externa persiste; os demais campos de identidade permanecem iguais. NOTIFY ausente é conferido por listener com barreira confirmada. Nenhum trigger foi instalado nesta suíte.

## Fontes e execução

- Commit observado antes/depois: `2606d75ab1d4ba10c6a8ba6266d0a4106ecec204`.
- Início UTC: `2026-11-09T10:32:31.078Z`; término UTC: `2026-11-09T10:33:17.615Z`.
- Memória inicial: 2413 MiB; guard de 1.536 MiB preservado.
- Resolução/importações e tipos completos aprovados: 44 testes, 14 fontes obrigatórias.
- Composição de 1.046 → 1.047 fontes; aplicação portátil confere um único payload.

Banco UUID removido após encerramento dos filhos; seis papéis/credenciais/configurações restaurados, fontes e identidade do contêiner conferidas. Solicitação temporária para manter o Windows ativo retirada. **Computador não reiniciado.**

## Limites e retomada

Não houve equipamento físico, dispatcher externo, webhook de terceiros, navegador, build Android/iOS ou medição de desempenho. O teste cobre espera por uma linha já existente nos quatro pontos descritos; alvo ausente/promoção e demais domínios seguem pendentes. Não houve novo ajuste de produto nem nova comparação RED/GREEN.

Os 32 casos de rollback dentro da transação, oito positivos de ciclo de vida e 117 independentes de configurações têm suas próprias evidências e não foram reexecutados nem somados a estes 24. [Pacote](README.md) e [restauração](../../evidencias/mfa-feature-transition-waits-restore-2026-11-09.json) conferem fontes, sem executar testes novamente. MFA obrigatória 068 continua candidata; runtime main 001–067. Continuar por [CONTINUIDADE](../../CONTINUIDADE.md).
