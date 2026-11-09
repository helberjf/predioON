# Criação e edição de organizações: resultado de 09/11/2026

**30/30 casos dirigidos e 17/17 regressões passaram**, 47 casos independentes/três suítes na versão corrigida; zero falhas/cancelamentos/skips/TODO. [Prova completa](../../evidencias/mfa-organization-commands-2026-11-09.json).

## Problema reproduzido e correção

A baseline passou em 24 casos e falhou em seis: quatro PATCH retornaram 200 após retirar prova MFA/fator depois da gravação ou da auditoria; dois PATCH para organização ausente retornaram 404 antes de exigir MFA. Os seis erros são asserções de status HTTP (200/404 versus 403). As asserções pararam nesse ponto na baseline; não se afirma comparação independente dos efeitos persistidos dessas seis respostas.

O banco já possuía políticas restritivas de MFA para linhas de organizações. O router agora confere explicitamente MFA e ambas as capacidades comerciais nos limites da operação, após gravação/espera/auditoria e antes de interpretar resultados vazios ou entregar dados já lidos. Essas conferências usam uma mesma consulta para MFA/capacidades. SQL de INSERT/UPDATE, lock NO KEY UPDATE, GET, validação, esquemas, políticas e migrações permanecem iguais. Somente `apps/api/src/modules/organizations/routes.ts` mudou no produto candidato.

## Cobertura efetiva

Os mesmos bytes de teste foram usados antes/depois. Trinta casos: 12 retiradas de prova/fator após capacidade, gravação ou auditoria nos dois métodos; duas após a leitura com lock; duas para alvo ausente; quatro sucessos com administrador por flag/vínculo; quatro recusas de gestor/morador local; dois conflitos legítimos de slug; duas perdas de prova antes do conflito; dois controles 404.

Os observadores aguardam o resultado SQL original, sem falsificar linhas. Login, inscrição e TOTP são HTTP reais, mantendo o bearer/SID. Nas recusas da versão corrigida, todas as linhas de organizações e de auditoria comercial são comparadas antes/depois. Os sucessos conferem sete campos, datas UTC, metadata aninhada, persistência, organizações alheias intactas e exatamente a auditoria prevista. Não se trata de teste de bloqueio externo real.

As regressões existentes e inalteradas são `platform-mfa-sql-envelopes.test.ts` (11 casos) e `platform-mfa-required.test.ts` (seis). Elas contêm fixtures SQL históricas; o aceite de cerimônia real vem da nova suíte dirigida. A suíte legada `organizations-capabilities.test.ts` e a regressão geral API/ingest ainda dependem da integração das fixtures com MFA obrigatória.

## Execução, histórico e restauração

- Commit observado nas três execuções: `797ebb15ee3b54f226aedc61448e4ea72756533f`.
- Resolução e tipos: quatro fases aprovadas, 47 testes e 15 fontes obrigatórias.
- baseline: `2026-11-09T12:46:06.624Z` → `2026-11-09T12:46:28.141Z`, 2530 MiB livres no início.
- fixed: `2026-11-09T12:47:30.040Z` → `2026-11-09T12:47:51.794Z`, 2564 MiB livres no início.
- fixed-regression: `2026-11-09T12:48:39.244Z` → `2026-11-09T12:49:12.292Z`, 2265 MiB livres no início.
- Proteção mínima de memória: 1.536 MiB, preservada.

Cada banco UUID foi removido depois do encerramento dos filhos. Seis papéis/credenciais/configurações foram restaurados; fontes e identidade do contêiner conferidas. Solicitações temporárias para manter o Windows ativo retiradas. **Computador não reiniciado.**

Antes das execuções funcionais, [V1 passou em tipos e teve corrigido o encaminhamento de erro do observador](../../evidencias/mfa-organization-commands-v1-review-2026-11-09.json), sem mudar asserções, prazos ou produto. A [tentativa do executor V2](../../evidencias/mfa-organization-commands-v2-executor-review-2026-11-09.json) saiu antes do provisionamento; havia uma conferência desatualizada de 14 fontes contra as 15 resolvidas. O stderr original não foi capturado; o diagnóstico registra esse limite. V3 corrige apenas o contador e usa pastas novas de evidência, preservando tipos/fontes e a tentativa anterior. Nenhuma dessas tentativas é somada aos 47 aprovados.

[Pacote](README.md) e [recibo de restauração](../../evidencias/mfa-organization-commands-restore-2026-11-09.json): 1.048 → 1.049 fontes, dois payloads, pai preservado. Conferência de fontes, sem reexecutar testes. MFA obrigatória 068 continua candidata; runtime da main 001–067. Próximos: integração dos testes legados, espera MFA externa, promoção/triggers, demais comandos e aceites web/nativos/operacionais. Sem aceite de produção, hardware ou desempenho. Continuar por [CONTINUIDADE](../../CONTINUIDADE.md).
