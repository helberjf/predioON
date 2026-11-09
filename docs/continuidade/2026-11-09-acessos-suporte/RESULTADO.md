# Concessão, substituição e revogação de suporte: resultado do candidato

Revisão de **09/11/2026**, horário de São Paulo. [Prova verificada](../../evidencias/mfa-support-grant-commands-2026-11-09.json). **99 casos dirigidos passaram**, depois de reproduzir68 divergências MFA na baseline V2. Seis arquivos de regressão passaram com103 TAP, sendo99 casos independentes e quatro grupos. A composição corrigida soma **202 TAP:198 casos independentes e quatro grupos**, com zero falhas, cancelamentos, skips ou TODO. Baseline e tentativas anteriores não entram nessa soma.

O aceite é deste lote API na composição candidata de1.044 fontes. A instalação principal continua com migrations001–067. A política068 ainda não foi ativada parcialmente; não há aceite de produção, desempenho, API inteira ou matriz web/Android/iOS.

## Alteração

O router de suporte muda em `POST /v1/support-access/grants`, `DELETE /v1/support-access/grants/:id` e no helper privado `revokeGrant`. O helper também atende à remoção da equipe, cuja suíte foi reexecutada. O restante do router foi reconstruído byte a byte contra o pai; schemas, políticas, migrations e auxiliares externos permanecem iguais.

As verificações MFA agora acompanham a decisão efetiva: leituras guardadas inclusive sem linhas, INSERT/UPDATE com decisão materializada e nova instrução após esperas por registros, alterações e auditorias. A criação também verifica novamente antes de concluir sua transação. Uma perda de prova desfaz concessões, substituições e auditorias da operação inteira.

Preservados: lock determinístico no vínculo de suporte, locks nas concessões abertas, intervalo de1–168 horas, `statement_timestamp()` para expiração, `clock_timestamp()` para status/revogação, projeção pública de13 campos, ordem das capacidades, histórico sem exclusão, auditoria com causas originais, confirmação recente de senha somente na concessão e204 idempotente para revogação repetida. DELETE continua lendo sem FOR UPDATE para enxergar concessões já revogadas; o UPDATE condicional resolve a concorrência.

## Evidência funcional

| Bloco dirigido | Casos | O que foi conferido |
| --- | ---: | --- |
| Perda de fator/prova depois da autorização real |44| Administradores por flag e vínculo global; concessão inicial/substituição, ausência/inatividade, autoatribuição; revogação aberta/expirada/já revogada/ausente |
| Esperas reais por registro |16| Concessão aguardando vínculo ou concessão anterior; DELETE aguardando concessão; dois casos de revogação concorrente causando UPDATE sem linha |
| Caminhos positivos |14| Prazo mínimo/máximo, cinco capacidades permitidas, substituição múltipla, vínculos duplicados, revogação e repetição idempotente |
| Validação e autorização |6| Schemas, elegibilidade/janelas, escopo local, autenticação, senha recente e autoridade parcial; cada caso contém verificações relacionadas |
| Retirada de prova durante gravação/auditoria |8| INSERT/UPDATE e auditorias de criação/revogação; reversão integral, inclusive primeira capacidade antes da falha na segunda |
| Exceções genéricas nos mesmos pontos |8|500 sem detalhes privados; dados e prova preservados |
| INSERT/UPDATE sem linha |3| INSERT500 reverte tudo; DELETE204 não muda dados nem gera auditoria |
| **Total** |**99**| Casos independentes, uma suíte, nenhum grupo adicional |

Todos os99 casos novos entram por HTTP, inscrevem o fator e confirmam TOTP reais quando exigidos. O mesmo bearer e a mesma família de sessão são usados antes/depois. Fixtures históricas e retiradas negativas são SQL explícito; nenhuma prova MFA positiva é fabricada. Nas esperas, uma transação proprietária segura o registro e `pg_blocking_pids` identifica a conexão restrita efetivamente bloqueada; cada consulta descarta somente seu snapshot de estatísticas. A retirada de fator/prova é confirmada no mesmo commit que libera o bloqueio. Não é simulação de espera.

As respostas positivas conferem os13 campos, datas, status, capacidades, pessoa/condomínio, concessões novas e antigas e auditorias exatas. A pessoa de suporte ganha/perde leitura de telemetria com o mesmo token; outro condomínio continua negado. Os triggers são limitados a ator, sessão e alvo, com função de proprietário, busca de schemas restrita e execução pública revogada. Uma sequência prova disparo único inclusive em rollback. A restauração da prova compara presença, timestamp textual e geração exatos. A configuração dos triggers volta ao catálogo anterior.

A autoridade parcial é testada pela retirada temporária da permissão `support:grant` de PLATFORM_ADMIN no catálogo do banco exclusivo. `rbac:manage` permanece: os comandos diretos são recusados, a remoção da equipe funciona, não altera concessões históricas e nega telemetria ao suporte. A entrada do catálogo é restaurada exatamente. Isso não cria suporte a papéis globais personalizados.

## Baseline e tentativa preservada

V2: **31 PASS/68 FAIL esperados**, distribuídos em24 respostas201,20 respostas204,16 respostas400 e8 respostas404 onde a nova exigência é403. Cada falha tem nome, status e diagnóstico de verificações anteriores examinados; não basta coincidir a contagem. O candidato usa o mesmo teste V2, sem relaxar asserções ou prazos.

[V1 preservada](../../evidencias/mfa-support-grant-commands-v1-review-2026-11-09.json):30 PASS/69 FAIL. Foram68 divergências MFA e um erro do teste de confirmação recente da senha, que enviava `password` onde o schema estrito requer `currentPassword`. V2 muda somente esse nome; mantém o código real de recuperação, produto, critérios e limites. As16 esperas reais já foram comprovadas em V1 e foram repetidas em V2. O candidato V1 não foi executado funcionalmente. [Checkpoint V1](../2026-11-09-acessos-suporte-rascunho/README.md), [checkpoint V2](../2026-11-09-acessos-suporte-rascunho-v2/README.md).

## Regressões e tipos

| Arquivo | TAP | Casos independentes | Grupos |
| --- | ---: | ---: | ---: |
| support-access |4|4|0|
| platform-mfa-support-read |14|12|2|
| platform-mfa-support-timestamp-order |2|2|0|
| platform-mfa-admin-directory-read |12|10|2|
| platform-mfa-support-staff-create |36|36|0|
| platform-mfa-support-staff-remove |35|35|0|
| **Total** |**103**|**99**|**4**|

Os seis arquivos permanecem iguais aos do pai. Incluem a concorrência real da primeira concessão e todas as verificações de cadastro/remoção da equipe, além de leitura/ordem temporal. Casos históricos de leitura conservam suas fixtures SQL de prova; não recebem retroativamente a garantia de inscrição HTTP dos casos novos. Rodadas de outras composições não são somadas.

[Quatro fases de resolução/tipos V2 aprovadas](../../evidencias/mfa-support-grant-commands-v2-types-2026-11-09.json): baseline/candidato,40 arquivos de teste e14 fontes obrigatórias, resolução para as fontes isoladas. Pai com1.043 arquivos preservado; cada composição tem1.044 fontes,994 canônicas,23 vínculos de workspace e134 dependências externas. Builds, caches e arquivos de ambiente não foram copiados.

## Execução e limpeza

As três rodadas aceitas (baseline/candidato V2 e repetição integral da regressão) observaram o commit `01f82211dd33066fb6cd8b729f8b34a9fdf83e30`; o pin de fonte não documental segue `53c4c70dcd24f1045fad420fbce36757fd3753a2`. Timestamps nativos UTC foram preservados:

| Rodada V2 | Início UTC em 09/11 | Fim UTC em 09/11 | Resultado | Memória inicial MiB |
| --- | --- | --- | --- | --- |
| Baseline | 03:20:29.918 | 03:22:01.184 | 31 PASS / 68 FAIL previstos | 4451 |
| Candidato | 03:22:39.385 | 03:24:17.995 | 99/99 | 4411 |
| Regressões | 03:44:25.546 | 03:47:35.936 | 103/103 TAP | 3977 |

A [primeira tentativa de regressão](../../evidencias/mfa-support-grant-regression-interruption-2026-11-09.json) foi interrompida por suspensão automática do Windows (Kernel-Power506, Idle Timeout,03:26:37UTC; retorno507 por touchpad,03:37:11UTC; mesmo BootId51). As quatro primeiras suítes tinham32 TAP aprovados; a criação da equipe excedeu o prazo e a remoção não iniciou. O intervalo observado entre heartbeats superou627 segundos. Essa tentativa é falha de infraestrutura e não entra na contagem aceita.

O processo de teste encerrou posteriormente. Somente seu controlador de QA, identificado por PID, pai e horário de criação, foi encerrado para liberar as conexões. O banco temporário exato foi removido. A restauração de papéis teve uma primeira instrução rejeitada por conflito de alias, antes de alterar papéis; a segunda corrigiu o alias e restaurou os seis papéis NOLOGIN/sem senha conforme o bootstrap documentado, preservando OIDs e configurações. O recibo de recuperação registra zero bancos temporários/clientes e não é aprovação de testes. A repetição usou banco/pasta novos, os mesmos seis arquivos e os mesmos bytes de executores, fontes, prazos e limites de memória.

Durante a repetição, foi feito somente um pedido de atividade do sistema com `ES_CONTINUOUS|ES_SYSTEM_REQUIRED`, removido em `finally` ao concluir. Não houve alteração permanente de energia, exigência de tela ligada ou modo away. O uso temporário segue a [documentação da Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate). A prova final confere ativação e remoção do pedido.

Contêiner exclusivo já em execução, porta local5468,384 MiB,1 CPU, reinício automático desabilitado. Os executores rejeitam inicialização/reinício do cluster e exigem pelo menos1.536 MiB livres. Atestação e identidade do banco conferidas, sem OOM/reinício. Após cada rodada aceita: zero bancos temporários, tabelas no banco base ou clientes residuais; seis papéis, credenciais privadas e configurações restaurados; processos filhos registrados encerrados; fontes preservadas. Segredos não publicados. **Computador não reiniciado.**

## Retomar e limites

[Restauração executada e conferida](../../evidencias/mfa-support-grant-commands-restore-2026-11-09.json):1.043 arquivos do pai e1.044 do destino, dois payloads, comparação completa e pai intacto. Isso verifica fontes, sem executar testes/serviços. Siga o [README portátil](README.md) e o [MD de continuidade](../../CONTINUIDADE.md), usando pastas novas e ambiente próprio em outro computador.

Retificação de metadado histórico: o campo auxiliar `runtimeProductModifiedPaths` do pacote anterior de remoção de suporte ainda nomeava o router de tenancy por herança do gerador; os payloads, deltas e inventários desse pacote nomeiam corretamente suporte. O pacote novo registra `apps/api/src/modules/support-access/routes.ts` no campo auxiliar. O pacote anterior congelado permanece intacto.

Próximos: configuração e outros domínios protegidos, revisão de cache privado, demais promoções/esperas e falhas concorrentes, regressão integrada de API/ingest, jornadas Playwright nos portais e três engines, sessões completas Android/iOS, operação, documentação final e gravações de apresentação. A reconciliação das concessões históricas de vínculos já inativos/autoridade parcial segue separada: os testes preservam o contrato atual e comprovam a recusa de acesso. As esperas observadas não provam ausência de toda condição de corrida possível. Nenhum navegador ou aparelho foi reexecutado neste lote API.
