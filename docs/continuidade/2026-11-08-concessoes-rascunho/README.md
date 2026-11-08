# Concessões de vínculos e papéis: candidato em validação

Publicado em 08/11/2026. A fonte candidata altera somente POST `/v1/tenancy/unit-memberships` e POST `/v1/tenancy/role-bindings`, sobre a [criação aceita de 1.035 arquivos](../2026-11-07-criacao/RESULTADO.md). Esta pasta preserva dois payloads e seus hashes; não os aplica parcialmente à main.

As duas preparações concluíram e as quatro fases de resolução/tipos passaram: 32 arquivos de testes e 14 fontes obrigatórias, incluindo a verificação recente de senha. [Prova de tipos](../../evidencias/mfa-tenancy-grants-types-2026-11-08.json). Ainda não há resultado funcional deste lote neste checkpoint.

O INSERT depende da decisão MFA; outra decisão após auditoria permite rollback se a prova mudar nesse limite. Os DTOs integrais, defaults, nulls, schemas, capacidades, delegação RLS, ator real e requisito de senha recente dos papéis são preservados. Retorno de INSERT vazio inesperado é erro interno com rollback; não há deduplicação nova.

O [plano](PLAN.md) descreve contratos e limites. A suíte comum tem 17 casos: quatro perdas de fator/prova após capacidade real, quatro controles de sucesso, escopo, FKs, validação, datas nulas/equipe destinatária, repetição legítima, recência por sessão, delegação restrita e dois triggers estreitos de auditoria. A expectativa ainda não observada é baseline 11 PASS/6 FAIL específicas 201 versus 403 e candidato 17 PASS. Depois, nove arquivos de regressão têm 130 entradas TAP planejadas. Não tratar contagem planejada como aceite.

Retomada local: `work/mfa-tenancy-grants-{baseline,fixed,fixed-regression}-qa-20261108`. Preparações baseline `ac768976c2a464a63fc05902ec7271ff82b09c955a238efd58880daa98418265` e fixed `f701467e1feeb849cd2eaf83aee4d4d91a15574a834bc019c6d26234d30730f9`. Scripts de execução exigem cluster atestado já ativo e memória disponível; não reiniciam computador/WSL/Docker. Registrar tentativas em diretórios novos e preservar logs.

Ainda faltam aceites específicos de locks, promoção, perda de capacidade durante espera, constraints concorrentes, INSERT vazio induzido e exceção genérica de trigger. Equipes com renovação e convites têm contratos separados. Não há novo aceite de Playwright, Android, iOS, desempenho ou produção. O runtime principal continua em 001–067; a política obrigatória permanece candidata.
