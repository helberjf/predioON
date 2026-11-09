# Remoção da equipe de suporte: resultado de MFA em 08/11/2026

**Aceite dirigido do candidato, sem aceite de produção.** Os 35 casos do mesmo teste V2 passaram após reproduzir 19 divergências na baseline: quinze respostas 204 e quatro 404 onde se exigia 403. Passaram também cinco arquivos de regressão, com 68 entradas TAP, 64 casos independentes e quatro grupos. A composição corrigida soma **103 TAP / 99 casos independentes / quatro grupos**, sem somar baseline ou rodadas históricas. Zero falhas, cancelamentos, skips ou TODO nos resultados corrigidos. [Prova auditada](../../evidencias/mfa-support-staff-remove-2026-11-08.json).

## Fontes e comportamento

O pai é o [candidato de cadastro de suporte/1.042 arquivos](../2026-11-08-cadastro-suporte/RESULTADO.md); o destino tem 1.043. Somente `DELETE /v1/support-access/staff/:id` mudou, e um novo arquivo de teste foi acrescentado. Outros handlers, helper compartilhado `revokeGrant`, schemas, ACL/policies e migrations permanecem iguais. O runtime da main conserva 001–067; a 068 continua candidata e não foi aplicada a uma instalação existente.

O SELECT FOR UPDATE original continua igual, preservando a serialização com novas concessões. Uma instrução seguinte verifica MFA após a eventual espera, antes de tratar vínculo ausente ou já inativo. O UPDATE consome uma decisão MFA materializada. A checagem final cobre toda a transação, incluindo auditoria da equipe e encerramento automático de concessões. Não se afirma que cada instrução interna do helper compartilhado ganhou seu próprio guard: ele não mudou. Preservam-se dados, contratos de auditoria e a ausência de exigência de senha recente para remover.

## Casos exercitados

- Administradores por flag e por vínculo global, com inscrição HTTP/TOTP real na mesma família de sessão. Papéis e histórico de concessões são fixtures SQL explícitas; nenhuma comprovação positiva dos 35 casos foi fabricada pelo owner.
- Doze retiradas de fator/prova após a autorização global real para vínculos ativos, inativos e ausentes. Os caminhos presentes conferem resultado e efeitos exatos; os ausentes conferem ausência de alteração.
- Quatro esperas reais: o owner bloqueia o registro de equipe e `pg_blocking_pids` confirma exatamente uma conexão restrita da aplicação aguardando esse owner em `role_bindings`. Só então o teste retira fator/prova e libera o bloqueio no mesmo commit. Abrange administrador por flag e vínculo ativo/inativo; não representa toda combinação de autoridade ou lock.
- Oito combinações positivas de autoridade e vínculo ativo/inativo/expirado/duplicado. Identidade e outros papéis permanecem iguais. Na remoção ativa, concessões abertas, inclusive expiradas, são encerradas e auditadas; as já revogadas não mudam. O token original da pessoa perde acesso ao condomínio.
- Vínculo já inativo mantém 204 sem auditoria e sem fechar concessões abertas históricas. A pessoa continua sem acesso à telemetria. Esse comportamento legado foi preservado; não é aceite de reconciliação de dados antigos. Repetir a remoção ativa não duplica auditorias.
- Recusas de gestor local/morador, UUID inválido/ausente, papel incompatível e ausência de login. Confirmação recente da senha expirada não passa a bloquear a remoção legítima.
- Três triggers estreitos retiram a comprovação durante UPDATE de equipe/concessão ou INSERT da auditoria da equipe. Cada um dispara uma vez; rollback restaura conta, papéis, todas as concessões, auditoria e presença/timestamp textual/geração originais da comprovação.
- Três exceções genéricas mantêm erro opaco 500 e desfazem a operação inteira. Um trigger anterior ao UPDATE impede alteração; a política de auditoria mantém 403, sem encerrar concessões. Controles positivos precedem as falhas e o catálogo de triggers é restaurado.

As regressões incluem suporte completo, leitura de concessões, ordenação temporal, diretórios administrativos e os 36 casos de cadastro de suporte. As fixtures históricas de leitura que usam comprovação via SQL conservam essa limitação; não equivalem à cerimônia HTTP/TOTP dos testes novos. A suíte completa da API não foi reexecutada neste lote.

## Tentativa V1 preservada

A [baseline V1](../../evidencias/mfa-support-staff-remove-v1-review-2026-11-08.json) teve 16 PASS/19 FAIL: 15 divergências MFA e quatro falhas do observador, que não confirmou a espera. V1 não prova os quatro bloqueios. A V2 acrescenta somente `pg_stat_clear_snapshot()` antes de cada consulta existente ao monitoramento; produto, critérios, prazos e sequência de bloqueio/retirada não mudam. O PostgreSQL conserva informações de atividade dentro da transação até sua atualização explícita, conforme a [documentação da versão16](https://www.postgresql.org/docs/16/monitoring-stats.html#MONITORING-STATS-VIEWS). A repetição V2 confirmou os quatro bloqueios e as 19 divergências corretas na baseline; os mesmos 35 casos passaram no candidato.

Os [rascunhos V1](../2026-11-08-remocao-suporte-rascunho/README.md) e [V2](../2026-11-08-remocao-suporte-rascunho-v2/README.md) permanecem como checkpoints anteriores ao aceite. Não somar V1 aos resultados corrigidos.

## Execução e recursos

Todas as três rodadas V2 observaram o HEAD `f6a61d29013773e095691a6fddaca6412e4faff3`, com igualdade das 994 fontes canônicas e 1.043 fontes compostas antes/depois. Quatro fases de resolução/tipos passaram, abrangendo 39 testes e 14 fontes obrigatórias, sem resolver código de outro checkout.

| Rodada V2 | Início UTC em 09/11 | Fim UTC em 09/11 | Resultado | Memória inicial MiB |
| --- | --- | --- | --- | --- |
| Baseline | 02:01:00.412 | 02:01:25.297 | 16 PASS / 19 FAIL previstos | 4289 |
| Candidato | 02:02:08.672 | 02:02:34.036 | 35/35 | 4318 |
| Regressões | 02:03:11.074 | 02:03:59.436 | 68/68 TAP | 4236 |

Os horários UTC acima correspondem à noite de 08/11 em São Paulo. Guard mantido em 1.536 MiB. PostgreSQL exclusivo, UUIDs temporários, aplicação restrita e migration candidata 068 na fixture. Nas três rodadas: base vazia, bancos/clients temporários zero, seis roles/credenciais/configurações restauradas, filhos registrados encerrados e contêiner conferido sem reinício/OOM. A revisão V1 também confirma sua limpeza. O computador não foi reiniciado.

## Retomar

Use o [README e aplicador portátil](README.md). A [restauração real dos 1.043 arquivos passou](../../evidencias/mfa-support-staff-remove-restore-2026-11-08.json), com pai intacto e dois payloads conferidos. Isso verifica fontes, sem instalar dependências ou executar testes.

Neste host: `work/mfa-support-staff-remove-v2-{baseline,fixed,fixed-regression}-qa-20261108`, `work/mfa-support-staff-remove-v2-harness-20261108`, `work/verify-support-staff-remove-v2-results-20261108.py` e `work/mfa-support-staff-remove-v2-root-config-20261108.json`. Os metadados em `QA` identificam a prova. Em outro computador, prepare ambiente QA e atestação novos, sem transportar credenciais.

Próximos: concessão/substituição/revogação direta de suporte; autoridade com `rbac:manage` sem `support:grant`; reconciliação de vínculos já inativos com concessões históricas; configurações, cache privado, demais domínios e concorrências; regressão integrada, matriz de navegador, Android/iOS e operação. Nenhum teste de navegador ou aparelho foi reexecutado neste lote. Sem avaliação de desempenho ou garantia universal até o instante do commit.
