# Pausa e retomada com MFA: resultado de 09/11/2026

**8/8 casos independentes passaram**, em uma suíte, sem falhas, cancelamentos, skips ou TODO. [Prova completa](../../evidencias/mfa-feature-lifecycle-2026-11-09.json). API, PostgreSQL e handlers de ingestão/despacho/entrega reais; publicador do equipamento simulado e webhook HTTP local. Nenhum browser, aparelho, broker externo ou desempenho foi homologado.

## Fontes e execução

Pai: candidato de configurações, 1.045 fontes. Destino: 1.045 fontes, alterando somente `apps/api/test/features-lifecycle.test.ts`. O produto preserva seus bytes, incluindo o comando MFA validado anteriormente. As oito asserções de negócio e prazos não mudam; o requestedBy da fila fictícia passa a usar o novo ator. Não há novo RED/GREEN de produto nesta rodada de adaptação da fixture.

O teste cria administrador de plataforma e vínculo local próprios, faz login, inscrição e confirmação TOTP HTTP reais e confirma o mesmo bearer/SID. A conta de demonstração não tem fator, sessão ou credencial alterados. O cleanup remove vínculos, auditoria, sessões/fator por cascade e usuário próprios. [Checkpoint anterior à execução](../2026-11-09-ciclo-funcionalidades-rascunho/README.md).

- Commit observado antes/depois: `6dd1b898d9e03733c7fa59078fea95443f676332`.
- Início UTC: `2026-11-09T04:51:43.807Z`; término UTC: `2026-11-09T04:52:26.891Z`.
- Memória inicial: 4171 MiB; guard mantido em 1.536 MiB.
- Resolução/importações e tipos: duas fases aprovadas, 42 testes e 14 fontes obrigatórias. [Evidência](../../evidencias/mfa-feature-lifecycle-types-2026-11-09.json).

## Cenários aprovados

1. Métrica pausada é descartada, outra métrica continua e dispositivo/gateway mantêm seu estado de atividade; amostra anterior à retomada é recusada.
2. Pausa remove o cursor de consumo; retomada preserva totais anteriores, reinicia a base do medidor e marca o dia incompleto.
3. Pausar a análise permite alterar tarifa e preserva a preferência configurada ao reativar.
4. Pausa invalida ocupação das vagas; reativação exige amostra nova, com limite explícito de sincronismo dos relógios.
5. Pausa cancela comando de portão pendente; reativação não o reenvia.
6. Pausa espera a publicação em andamento; o comando enviado continua aceitando sua confirmação.
7. Entrega de alerta em andamento termina antes da pausa; outra entrega pendente é cancelada e não reaparece após reativação. Houve uma única recepção no webhook local.
8. Suporte remoto desativado recusa nova solicitação e permite registrar o resultado de uma solicitação já existente, sem abrir AnyDesk ou conexão externa.

Os 72 dirigidos e 48 TAP de regressão do lote de configurações conservam sua [própria evidência](../2026-11-09-configuracoes/RESULTADO.md). Não foram reexecutados nem somados a esta rodada de oito casos.

## Isolamento e restauração

Banco temporário UUID removido; seis papéis, credenciais privadas e configurações restaurados; identidade do contêiner, fontes e resolução de dependências conferidas; todos os filhos registrados encerrados. Nenhuma credencial publicada. Solicitação temporária para manter o Windows ativo retirada; configurações permanentes intactas. **Computador não reiniciado.**

[Aplicador portátil](README.md) e [recibo V2](../../evidencias/mfa-feature-lifecycle-restore-2026-11-09.json) conferem um payload e todos os 1.045 arquivos de pai/destino. A primeira restauração conferiu as fontes, mas seu contador de payloads estava fixo em 2; V2 muda somente esse contador para 1 em pasta nova. [Tentativa preservada](../../evidencias/mfa-feature-lifecycle-restore-v1-review-2026-11-09.json). Manifesto e payload não mudam, e não houve repetição funcional por causa dessa correção de metadado.

## Retomada

Ampliar testes negativos de autoridade/MFA durante efeitos de consumo, portão e entrega, alvo ausente/promoção e ambos os escopos. Continuar outros comandos/domínios, cache e regressões completas API/ingest. Depois, jornadas Playwright e portais, Android/iOS, hardware, operação, documentação consolidada, abertura dos sistemas e gravações finais. A política obrigatória 068 permanece candidata, runtime 001–067 intacto; nenhum aceite global de produção.
