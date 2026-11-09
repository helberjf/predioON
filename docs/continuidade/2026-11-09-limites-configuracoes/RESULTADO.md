# Promoção de acesso e condomínio ausente: resultado de 09/11/2026

**26/26 casos independentes passaram**, uma suíte, zero falhas/cancelamentos/skips/TODO. [Prova completa](../../evidencias/mfa-feature-command-boundaries-2026-11-09.json). Produto e todas as 1.047 fontes anteriores preservados. Só foi acrescentado `apps/api/test/platform-mfa-feature-command-boundaries.test.ts`.

## Promoção durante a requisição: 16 casos

Dois escopos (global/condomínio) × duas promoções (flag legado/vínculo global PLATFORM_ADMIN) × dois estados (sem fator/fator confirmado sem prova) × duas versões (atual/desatualizada).

Cada ator começa como gestor local comum, com login real e MFA não obrigatória. Um observador pausa a requisição depois da execução real do contexto SQL; outra conexão concede autoridade administrativa. A consulta real de capacidade global precisa retornar verdadeiro. O código original executa exatamente uma vez; nenhum resultado SQL é fabricado.

O comando retorna 403 com motivo de inscrição ou verificação MFA, antes de gravação ou conflito de versão. Configurações globais/locais, estado de execução e vagas de todos os condomínios monitorados permanecem iguais; nenhuma auditoria de alteração ou notificação de sucesso é produzida. Depois, o mesmo bearer/SID conclui inscrição/TOTP ou usa código de recuperação por HTTP real. Versão desatualizada então retorna 409 sem efeitos; tentativa correta retorna 200.

O sucesso verifica a projeção de 24 itens/oito campos, versões, intenção global/local, cada condomínio/dependência afetado, gerações, auditoria e uma notificação. Não é uma autorização obtida por SQL direto na prova MFA.

## Condomínio inexistente: dez casos

Oito negativos: dois tipos de administrador × dois limites reais (capacidade global/descoberta) × retirada externa de prova ou fator. A perda de MFA resulta em 403 antes da resposta de alvo ausente; não cria condomínio, não modifica dados e não emite auditoria/notificação de sucesso.

Dois controles com administrador autenticado preservam status 404, `Cache-Control: no-store` e corpo `{"error":"Condomínio não encontrado"}`. A ausência de notificações é conferida por listener com barreira confirmada, sem espera arbitrária.

## Fontes e execução

- Commit observado antes/depois: `9657db5626ad64198498503232ad942cb42c6864`.
- Início UTC: `2026-11-09T12:21:45.611Z`; término UTC: `2026-11-09T12:23:06.966Z`.
- Memória inicial: 1920 MiB; proteção de 1.536 MiB preservada.
- Resolução/importações e tipos completos aprovados: 45 testes, 14 fontes obrigatórias.
- Composição de 1.047 → 1.048 fontes; restauração confere um payload novo e os arquivos anteriores.

Banco UUID removido após encerramento dos filhos; seis papéis/credenciais/configurações restaurados, fontes e identidade do contêiner conferidas. Solicitação temporária para manter o Windows ativo retirada. **Computador não reiniciado.**

## Limites e retomada

Não houve equipamento físico, navegador, build Android/iOS ou medição de desempenho. São observadores de execução SQL real, e não testes de espera por bloqueio; os 24 casos de espera real pertencem à rodada anterior. Não houve alteração de produto nem nova comparação RED/GREEN. As provas históricas de 24 esperas, 32 rollback, oito ciclo de vida e 117 configurações não foram somadas nem reexecutadas.

[Pacote](README.md) e [restauração](../../evidencias/mfa-feature-command-boundaries-restore-2026-11-09.json) conferem fontes, sem executar testes novamente. MFA obrigatória 068 continua candidata; runtime main 001–067. Prosseguir por demais comandos/domínios, cache privado, regressão integrada e aceites de web/apps/operação conforme [CONTINUIDADE](../../CONTINUIDADE.md).
