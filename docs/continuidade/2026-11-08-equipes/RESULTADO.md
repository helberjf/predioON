# Criação e renovação de integrantes: resultado de 08/11/2026

O candidato do POST `/v1/tenancy/team-members` passou nos **21 casos dirigidos** e em **dez arquivos de regressão**, depois de reproduzir oito divergências na versão anterior. A [prova verificada](../../evidencias/mfa-team-renewal-2026-11-08.json) identifica fontes, logs, comandos e limpeza. Este aceite é do lote candidato de API, sem encerrar apps, web ou produção.

## Comportamento

O upsert exige MFA tanto no INSERT quanto no envelope que recebe o RETURNING. A ausência de linha por vínculo já ativo também passa pela decisão MFA. Com MFA válida ou opcional, esse conflito mantém o 409 original. Vínculos inativos ou expirados podem ser renovados, preservando ID e criação, atualizando a alteração e substituindo ou limpando as datas de vigência.

A elegibilidade para integrar a equipe continua sendo consultada em um statement separado, depois do upsert. Assim, o teste detecta quando o próprio vínculo novo faz o destinatário receber o papel de morador da equipe e desfaz a operação. Depois da auditoria, uma nova decisão MFA permite rollback quando a comprovação foi removida nesse ponto.

Mudaram somente esse handler, um decoder privado de retorno e a remoção do import `or`, que ficou sem uso. O DTO completo de nove campos, os schemas, as demais rotas, helpers compartilhados, policies/ACL e migrations não foram alterados.

## Resultados observados

| Execução | Resultado | Escopo |
| --- | --- | --- |
| Baseline, mesmo teste | 13 PASS / 8 FAIL | Seis respostas 201 e duas 409 onde os testes exigiam 403 |
| Candidato | 21/21 | Todos os casos dirigidos, sem falhas/skips/cancelamentos/TODO |
| Dez regressões | 147/147 TAP | 137 casos independentes e dez grupos, sem falhas/skips/cancelamentos/TODO |
| Resolução/tipos | Quatro fases PASS | Baseline e fixed, 33 arquivos de testes e 14 fontes obrigatórias |
| Restauração | 1.037 arquivos conferidos | Igualdade por SHA-256/tamanho e pai preservado, sem nova execução funcional |

A rodada corrigida soma **168 entradas TAP: 158 casos independentes e dez grupos**. Não somar baseline ou execuções históricas. As regressões foram links 12, estrutura 12, pessoas 9, tenancy HTTP 9, edição 11, ciclo de vínculos 4, comandos 35, revogações 21, criação 17 e concessões 17.

Quatro falhas da baseline ocorreram depois da autorização real `teams:manage`, na criação e renovação, com remoção de fator ou comprovação da família. Duas falhas ocorreram no caminho de conflito ativo: a versão anterior preservou os dados, mas respondeu 409 quando deveria negar por MFA. Esses dois casos não demonstram gravação indevida. Outras duas falhas ocorreram após triggers estreitos de auditoria, um para criação e outro para renovação.

Antes de cada mismatch 201, os testes conferiram o DTO completo, a alteração persistida e a auditoria exata. Nos triggers, uma sequência confirmou uma execução; no candidato, o rollback restaurou vínculo, auditoria e o timestamp textual, geração e presença da comprovação original da mesma família. Administradores fizeram login, inscrição e confirmação TOTP HTTP reais. Não foi fabricada comprovação positiva de MFA por SQL.

Os controles preservaram gestores opcionais, administrador satisfeito, conflito ativo normal, morador por vínculo de unidade, morador resultante do papel da equipe após criação/renovação, ator com somente `teams:manage`, escopo, FKs, input estrito, datas/nulls e renovação de expirado ativo/inativo. Duas requisições HTTP enviadas juntas produziram um 201 e um 409, com uma linha e uma auditoria. Esse controle não demonstra uma espera específica de row lock.

## Fonte e execução

As três rodadas registraram HEAD `55a3665e6a8bf55f3d08df21adf8b25b1b6b6dc4` antes/depois. A fonte canônica continua `53c4c70dcd24f1045fad420fbce36757fd3753a2`, com 994 arquivos não documentais inalterados. O pai é concessões/1.036; o destino acrescenta o teste e altera somente o router, totalizando 1.037 fontes. Baseline/fixed diferem somente nesse router.

- Prepared baseline: `7257c84e1a4bc14c0eb9ee5cfe2cfb8291847067fa413aa5676140677df7952b`.
- Prepared fixed: `4dadcdc045378366e0fdec233e698f6f8fe8cae78bf0920c0899638829194e7b`.
- Router corrigido: `172183eea44ba093e88b1d68553a634c2cc1ed09f1f18966db6bea42d9a4fff6`.
- Teste comum: `24d79a0b20be994ffabc5f95c1aac013e626582585eb54364c49c4f04f4f4f4d`.

UTC nativo de 08/11: baseline 23:31:19–23:31:35, candidato 23:31:56–23:32:11 e regressão 23:33:50–23:35:22. Em São Paulo, 20:31–20:35 do mesmo dia. Timestamps completos e durações observadas foram preservados, sem avaliação de desempenho.

O cluster QA exclusivo já estava ligado; o guard de 1.536 MiB foi respeitado. As três limpezas passaram: banco temporário removido, base de referência vazia, nenhum outro banco/cliente, seis roles e suas credenciais/configurações restauradas, filhos diretos registrados encerrados, contêiner atestado e fontes inalteradas. O computador não foi reiniciado e credenciais não foram publicadas.

## Continuação

O [pacote portátil](README.md) e a [prova de restauração](../../evidencias/mfa-team-renewal-restore-2026-11-08.json) permitem restaurar checkpoint85 → V4 sem V3 → obrigatório por flag → vínculo global → revogações → criação → concessões → equipes, sempre em destino novo. Os manifestos e payloads anteriores foram preservados. O [rascunho tipado](../2026-11-08-equipes-rascunho/README.md) registra o estado antes dos ensaios; este resultado o sucede sem alterar seus hashes.

Os registros locais estão em `work/mfa-team-renewal-{baseline,fixed,fixed-regression}-qa-20261108`, com fontes nas duas primeiras pastas. [Verificador](QA/verify-team-renewal-results-20261108.py), [configuração revisada](QA/root-config.json) e [plano](QA/PLAN.json) acompanham o resultado. A configuração identifica esta execução; não reutilizar credenciais ou atestação em outro computador.

O próximo lote é criação/substituição e revogação de convites. Continuam abertos os demais domínios, concorrência com perda de capacidade/promoção, alterações concorrentes de papéis/elegibilidade, exceções genéricas de trigger, regressão integrada, portais/motores, Android/iOS, operação e apresentação. A decisão por statement e a checagem final não provam garantia universal até commit. O runtime da main mantém migrations 001–067; MFA obrigatória permanece candidata. Nenhum aceite de produção ou desempenho.
