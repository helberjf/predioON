# Organizações: suíte legada com MFA real

**19/19 casos existentes passaram**, uma suíte, sem falhas/cancelamentos/skips/TODO. [Prova completa](../../evidencias/mfa-organization-legacy-2026-11-09.json). Produto e todas as demais fontes permanecem iguais; mudou somente a preparação de `organizations-capabilities.test.ts`.

## Preparação e preservação das verificações

Cada usuário fictício usa login real. Quando MFA é obrigatória, faz inscrição e confirma TOTP por HTTP. A fixture confere dez códigos distintos, fator confirmado, prova da família e a mesma geração, sem gravar prova positiva por SQL. O mesmo bearer/SID serve às chamadas HTTP e ao contexto SQL restrito de cada ator. Usuários comuns permanecem com MFA opcional; o contexto continua usando a role declarada original para testar que ela não concede autoridade indevida.

O conteúdo completo a partir do primeiro teste é idêntico ao original. Permanecem todas as asserções de permissões, isolamento, campos, auditoria, metadados comerciais, unicidade, erros, revogação/expiração, bloqueios, triggers, prazos, restauração do catálogo e reaplicação de migração. Não foram filtradas auditorias, reduzidos casos ou trocadas respostas esperadas.

Passaram acesso global por vínculo, flag sem contornar catálogo desativado, recusa de autoridade local, revogação de permissões/grants/vínculos, privilégios de colunas, prova da auditoria, contratos HTTP, duas esperas reais em linha, duas esperas de auditoria, rollback por exceção, revogação após leitura e preservação de políticas/papéis/helpers na reaplicação da migração 039.

## Execução e restauração

- Commit observado: `70fcba0f932ad2b9ef085a59a142bb9fa413fc0d`.
- Início UTC: `2026-11-09T13:03:55.869Z`; término UTC: `2026-11-09T13:04:28.265Z`.
- Resolução e tipos aprovados: 48 testes/15 fontes obrigatórias.
- Memória inicial: 3195 MiB; limite mínimo de 1.536 MiB mantido.
- Composição permanece com 1.049 arquivos; um payload de fixture, zero de produto.

Banco UUID removido, seis papéis/credenciais/configurações restaurados, filhos encerrados, fontes e contêiner conferidos. Solicitação temporária de atividade retirada; **computador não reiniciado**. [Pacote](README.md) e [recibo](../../evidencias/mfa-organization-legacy-restore-2026-11-09.json) verificam restauração das fontes, sem executar testes novamente.

## Limites

Os 30 dirigidos e 17 regressões da etapa anterior não foram repetidos nem somados a estes 19. As esperas existentes verificam perda de autoridade; retirada de prova/fator MFA durante espera externa, promoção, novos triggers e conflito de unicidade após bloqueio seguem pendentes. Sem navegador, hardware, build Android/iOS ou medição de desempenho neste lote. MFA obrigatória 068 continua candidata; runtime main 001–067. Retomar por [CONTINUIDADE](../../CONTINUIDADE.md).
