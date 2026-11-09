# Condomínios: criação e edição com MFA vigente

**62/62 casos independentes passaram na versão corrigida**, quatro suítes, sem falhas/cancelamentos/skips/TODO. [Prova completa](../../evidencias/mfa-building-commands-2026-11-09.json). São 32 dirigidos e 30 regressões atuais; não somar rodadas históricas.

## Falha reproduzida e correção

A referência V3 reproduziu 16 divergências HTTP após retirada externa da prova ou do fator: seis criações retornaram 201, oito edições 200 e dois alvos ausentes 404, onde se exigia 403. Os 16 controles passaram. As asserções recusaram o status antes das comparações posteriores de dados; não há alegação independente sobre os efeitos persistidos desses casos na referência.

O router ganhou uma função que exige o resultado positivo do helper MFA vigente e sete chamadas nos limites de POST/PATCH. Confere a prova após a capacidade, depois da leitura com bloqueio e antes de interpretar alvo vazio, após escrita e auditoria, conforme a ordem original de cada comando. Mantém SQL, FOR UPDATE, regras de capacidade global/local, auditoria antes da desativação, GET, contratos, esquemas, políticas e migrações. MFA continua opcional para os usuários comuns.

## Casos executados

- Dezesseis recusas: POST/PATCH após consulta de capacidade, gravação e auditoria; PATCH após consulta com bloqueio e com alvo ausente; cada ponto com retirada de prova/fator. SQL original executado uma vez, sem resultados falsificados. Após a recusa, todas as linhas de condomínios, organizações e auditorias do domínio ficam iguais à fotografia anterior.
- Dezesseis controles: administração por flag/vínculo global, desativação, gestor local sem MFA obrigatório com edição completa/parcial/desativação, recusa a papéis locais indevidos, isolamento entre organizações, 404 válido e valores padrão de imóvel/fuso/endereço.
- Sucessos conferem os dez campos do DTO, datas UTC, JSON/endereço com null aninhado, armazenamento, ausência de alteração dos outros condomínios e registro exato de auditoria. Criação usa escopo PLATFORM e edição BUILDING, conforme a migração036.
- Três regressões inalteradas: capacidades de condomínios/funcionalidades 13, envelopes SQL 11 e obrigatoriedade MFA 6. As fixtures históricas de contexto SQL continuam identificadas; cerimônia real é demonstrada pelos novos casos e pelos administradores HTTP da suíte existente.

## Histórico da preparação

V1 não executou testes funcionais: a conferência detectou um colchete ausente na matriz do teste. [Registro](../../evidencias/mfa-building-commands-v1-review-2026-11-09.json). A correção adicionou um caractere, sem mudar cenários ou asserções.

V2 passou nos tipos e executou somente a referência: 13 passaram e 19 falharam. Dezesseis eram as divergências de MFA; três eram a expectativa incorreta de escopo BUILDING para auditoria de criação. A regra SQL existente usa PLATFORM. [Registro](../../evidencias/mfa-building-commands-v2-review-2026-11-09.json). V3 ajusta somente essa expectativa para POST, mantendo BUILDING para PATCH, demais asserções, matriz, prazos e produto. Os logs anteriores foram preservados separadamente.

## Execução e retomada

Commit observado: `d4e309ad67a19e0b71610cde6eec361ae031b35e`. Quatro fases de resolução/tipos aprovadas para 51 testes/15 fontes obrigatórias. Memória inicial dos três lotes V3: 2735 MiB, 2741 MiB, 2750 MiB; mínimo 1.536 MiB mantido. Bancos UUID removidos, seis papéis/credenciais/configurações restaurados, filhos encerrados e fontes/contêiner conferidos. Solicitações temporárias de atividade retiradas. **Sem reiniciar o computador**.

[Pacote](README.md): 1.051 → 1.052 fontes, um router e um teste. [Recibo de restauração](../../evidencias/mfa-building-commands-restore-2026-11-09.json). QA contém o verificador e logs TAP originais com extensão .txt.

## Limites

As pausas dos testes ocorrem após consultas reais; este lote não prova esperas externas em linha/índice, promoção ou falhas de triggers em condomínios. Cache privado, revogação de autoridade em novos limites, demais equipamentos/domínios, integração API/ingest e aceites de portais, Android/iOS, hardware e operação continuam pendentes. Sem avaliação de desempenho. MFA068 candidata; main001–067, sem aceite global de produção. Retomar por [CONTINUIDADE](../../CONTINUIDADE.md).
