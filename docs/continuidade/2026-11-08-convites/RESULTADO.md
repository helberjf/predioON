# Convites: resultado de criação, substituição e revogação

Registro de **08/11/2026 em São Paulo**. O candidato passou nos **31 casos dirigidos** e nos **doze arquivos de regressão**, depois de reproduzir 19 divergências de MFA na baseline. A [prova verificada](../../evidencias/mfa-invitation-commands-2026-11-08.json) vincula fontes, comandos, resultados e limpeza. Este aceite cobre o lote candidato de API, sem encerrar apps, web ou produção.

## Comportamento validado

Os comandos de criação, substituição e revogação exigem a decisão MFA junto à alteração e ao envelope que recebe o resultado, inclusive quando nenhuma linha é alterada. A substituição preserva a ordem: revogar o convite aberto anterior, registrar sua auditoria, criar o novo e registrar a criação. Uma checagem após a auditoria permite desfazer a transação quando a comprovação da sessão foi removida nesse ponto.

O DELETE preserva a visibilidade original: 404 para convite ausente/oculto e 204 para convite já aceito ou revogado quando a sessão permanece válida. Se outro writer aceita o convite entre leitura/autorização e UPDATE, não há revogação nem auditoria duplicada. Não foi acrescentado FOR UPDATE, que poderia ocultar registros fechados pela policy de atualização.

O e-mail continua depois do commit. Nos testes, um transporte estritamente local conferiu a linha já confirmada por outra conexão. As recusas preservaram convites, auditoria e caixa de saída. Nenhuma mensagem foi enviada externamente. O token continua sendo retornado apenas na criação, com armazenamento somente do hash.

Mudaram somente POST/DELETE de convites, decoders privados e um helper privado de revogação no router tenancy. Schemas, outros handlers, helpers compartilhados, policies/ACL e migrations permaneceram idênticos. A aceitação pública do convite não foi modificada.

## Resultados observados

| Execução | Resultado | Escopo |
| --- | --- | --- |
| Baseline V3, mesmo teste | 12 PASS / 19 FAIL | Sete respostas 201, oito 204 e quatro 404 onde os casos exigiam 403 |
| Candidato V3 | 31/31 | Zero falhas/skips/cancelamentos/TODO |
| Doze regressões | 177/177 TAP | 167 casos independentes e dez grupos; zero falhas/skips/cancelamentos/TODO |
| Resolução/tipos V3 | Quatro fases PASS | Baseline/fixed, 34 arquivos de testes e 14 fontes obrigatórias |
| Restauração | 1.038 arquivos conferidos | SHA-256/tamanho, pai preservado; sem nova execução funcional |

A rodada corrigida soma **208 entradas TAP: 198 casos independentes e dez grupos**. Não somar baseline ou tentativas históricas. Regressões: links12, estrutura12, pessoas9, tenancy HTTP9, edição11, ciclo de vínculos4, comandos35, revogações21, criação17, concessões17, equipes21 e convites originais9. Os nove casos originais incluem aceite público, uso único, conta existente, expiração/autoridade e fronteiras de acesso ao banco, com seus próprios limites.

Antes da regressão, a revisão da fonte corrigiu a contagem planejada do arquivo original de convites: são nove `it`; o `describe` é uma suíte separada, não um décimo teste. O [plano congelado](QA/PLAN.json) conserva a expectativa antiga178/11 grupos, e a [retificação anterior à execução](QA/REGRESSION-REVIEW.json) registra177/10 grupos. Nenhum caso ou expectativa foi removido.

As 19 divergências verificadas foram quatro perdas de fator/comprovação após autorização real de criar/substituir; seis após autorização real de revogar convite aberto/fechado; quatro após contexto real antes de leitura ausente/oculta; uma após aceite concorrente com perda da comprovação; quatro após triggers estreitos de auditoria. As respostas de convites fechados ou ausentes não demonstram gravação indevida: nesses casos foi conferida a preservação dos dados.

Nos casos de sucesso indevido da baseline, os testes conferiram o DTO completo, as linhas persistidas, auditorias exatas e, quando aplicável, e-mail local depois do commit. Cada trigger teve uma testemunha não transacional de exatamente uma execução. No candidato, o rollback restaurou também o timestamp textual, geração e presença da comprovação original da mesma família. Administradores fizeram login, inscrição e confirmação TOTP por HTTP real, sem fabricar comprovação positiva por SQL.

Controles positivos preservaram gestores opcionais, administradores satisfeitos, DTO de nove campos, normalização de nome/e-mail, hash do token, validade de sete dias, substituição de expirado aberto, histórico aceito/revogado, idempotência, escopo, input estrito, rollback por FK e ausência de envio quando não há portal configurado. O teste dirigido de aceite concorrente usa writer proprietário da fixture; não equivale ao endpoint público nem demonstra uma espera específica por row lock.

## Histórico e fonte

A [primeira tentativa](../../evidencias/mfa-invitation-commands-attempts-2026-11-08.json) preservou 11 PASS/20 FAIL: os 19 mismatches previstos e um erro23505 na fixture, que inseria históricos fechados temporariamente como abertos. A V2 foi apenas preparada, e uma diferença de codificação foi detectada antes de tipos/testes. A V3 corrige somente o INSERT da fixture, com UTF-8 explícito e os mesmos31 casos/expectativas. **O produto é idêntico nas três versões.** Os rascunhos [V1](../2026-11-08-convites-rascunho/README.md) e [V3 tipado](../2026-11-08-convites-v3-rascunho/README.md) continuam congelados como histórico.

As três rodadas V3 registraram HEAD `cb88fd9d293a6ddb18078cce62ea1523539931e6` antes/depois. A fonte canônica permanece `53c4c70dcd24f1045fad420fbce36757fd3753a2`, com 994 arquivos não documentais inalterados. O pai é equipes/1.037; o destino altera somente o router e acrescenta o teste, totalizando1.038 fontes. Baseline/fixed diferem somente no router.

- Prepared baseline: `3b3d9e3892c6cb940665810800ec642da55978acbbec52fef212575abcda3485`.
- Prepared fixed: `01551b135260dc4b7adfdda4f20ace7b9dd5e1cc468a2086c0fb773a0bb83172`.
- Router corrigido: `e9c9909630cee7a9fcfe5c46a9f1a805529cbfc107b7beadbfcfeaf8ba057963`.
- Teste V3 comum: `ad15fb185ec267cf557299186821ae314ba2ed8e1eabfb47f2ea27753b878827`.

UTC nativo: baseline08/11 23:55:55–23:56:16; candidato08/11 23:57:41–23:58:02; regressão08/11 23:59:08–09/11 00:00:59. Em São Paulo, as três ocorreram em08/11 entre20:55 e21:00. A restauração terminou em09/11 00:01:14 UTC, ainda08/11 local. Timestamps completos/durações preservados; sem avaliação de desempenho.

O cluster QA exclusivo já estava ligado; guard de1.536 MiB respeitado. As três limpezas passaram: banco temporário removido, base de referência vazia, nenhum outro banco/cliente, seis roles/credenciais/configurações restauradas, filhos diretos registrados encerrados, contêiner atestado e fontes inalteradas. Não houve reinício do computador nem publicação de credenciais.

## Retomada

O [pacote portátil](README.md) e a [prova de restauração](../../evidencias/mfa-invitation-commands-restore-2026-11-08.json) permitem continuar checkpoint85 → V4 sem V3 → obrigatório por flag → vínculo global → revogações → criação → concessões → equipes → convites. Usar destinos novos; manifestos e payloads anteriores intactos.

Fontes locais em `work/mfa-invitation-commands-v3-{baseline,fixed}-qa-20261108`; regressão em `work/mfa-invitation-commands-v3-fixed-regression-reviewed-qa-20261108`. O [verificador](QA/verify-invitation-commands-results-20261108.py), [configuração](QA/root-config.json), plano e retificação acompanham este resultado. Não reutilizar credenciais ou atestação em outra máquina.

Próximo: auditar os comandos restantes de usuários, suporte e configurações; ampliar a regressão integrada e a matriz de jornadas dos portais. Continuam pendentes concorrência com promoção/perda de capacidade e esperas reais, alterações concorrentes de elegibilidade, exceções genéricas de trigger, demais domínios, Android/iOS, operação, documentação final e demonstrações completas. As decisões por statement e a checagem final não provam garantia universal até commit. O runtime da main mantém migrations001–067; MFA obrigatória continua candidata. Nenhum aceite de produção.
