# Concessões protegidas por MFA: resultado de 08/11/2026

Os dois POSTs de concessão passaram nos **17 casos dirigidos** e em nove arquivos de regressão, após reproduzir seis falhas específicas na versão anterior. A [prova verificada](../../evidencias/mfa-tenancy-grants-2026-11-08.json) vincula os resultados às fontes e aos logs. O aceite cobre este candidato de API; não encerra o plano dos apps, web ou produção.

## O que mudou

POST `/v1/tenancy/unit-memberships` e POST `/v1/tenancy/role-bindings` passam a consumir a decisão MFA no INSERT e no envelope escalar. Depois da auditoria, uma nova decisão permite desfazer a transação se a comprovação tiver sido removida. Os decoders exigem exatamente uma linha e UUID válido; um INSERT vazio inesperado continua sendo erro, sem criar um contrato novo de 404/409.

A autorização `memberships:manage` continua primeiro. A confirmação recente de senha permanece exigida somente para concessões de papéis. Esquemas, DTOs completos, valores padrão, datas opcionais e nulls, delegação, escopo e auditoria foram preservados. Não foram alterados upsert de equipe, convites, outras rotas, helpers compartilhados, policies, ACL ou migrations.

## Execuções observadas

| Rodada | Resultado | Interpretação |
| --- | --- | --- |
| Código anterior, mesmos testes | 11 PASS / 6 FAIL | Seis respostas 201 onde se exigia 403; todas conferiram dados e auditoria antes da divergência |
| Candidato corrigido | 17/17 | Zero falhas, skips, cancelamentos ou TODO |
| Nove regressões no candidato | 130/130 entradas TAP | 120 casos independentes e dez grupos, sem falhas/skips/cancelamentos/TODO |
| Resolução e tipos | Quatro fases PASS | Baseline e fixed, 32 arquivos de testes, 14 fontes obrigatórias |
| Restauração portátil | 1.036 arquivos conferidos | Prova de igualdade das fontes e preservação do pai; não é nova execução funcional |

A rodada corrigida soma **147 entradas TAP: 137 casos independentes e dez grupos**. A baseline e provas históricas não entram nessa soma. As regressões foram: links 12, estrutura 12, pessoas 9, tenancy HTTP 9, edição 11, ciclo de vínculos 4, comandos 35, revogações 21 e criação 17.

Quatro falhas da baseline ocorreram depois de `memberships:manage` autorizar de verdade: remoção do fator e da comprovação da família, em cada rota. Outras duas ocorreram após um trigger de auditoria estreito, um por rota. A sequência de controle confirmou uma execução de cada trigger. No candidato, o teste conferiu rollback da concessão, da auditoria e restauração exata do timestamp textual, geração e presença da comprovação original da família.

Os casos positivos verificaram gestores opcionais e administradores com MFA, DTOs completos e defaults, datas futuras/null, destinatários usuário/equipe, chaves estrangeiras e escopo, rejeição de campos indevidos, concessões repetidas com UUIDs distintos, delegação RLS e confirmação recente de senha específica da sessão. Login, inscrição TOTP, sessão adicional e verificação HTTP foram reais. Códigos de recuperação foram usados somente no ambiente descartável e não foram publicados. A fixture não fabricou uma prova MFA bem-sucedida.

## Fonte e ambiente

As três rodadas registraram HEAD `a42aff7422409960ecc8e0def629dc0f3769129b` antes/depois. A fonte canônica segue `53c4c70dcd24f1045fad420fbce36757fd3753a2`, com 994 arquivos não documentais inalterados. O pai é a composição de criação com 1.035 fontes. O candidato acrescenta um teste e altera somente o router tenancy; baseline e fixed têm 1.036 arquivos e diferem somente nesse router.

- Prepared baseline: `ac768976c2a464a63fc05902ec7271ff82b09c955a238efd58880daa98418265`.
- Prepared fixed: `f701467e1feeb849cd2eaf83aee4d4d91a15574a834bc019c6d26234d30730f9`.
- Produto corrigido: `d660a272e2201bd8a8f68096457508ba1b5aca4d3d824e045b75724bf277ca00`.
- Teste comum: `137788364b48047a2ddcb46747e06564ba05873df14e97b00435b4936326c543`.

Execução nativa em UTC: baseline 23:08:47–23:09:08, candidato 23:09:43–23:10:03 e regressão 23:10:24–23:11:46 de 08/11. Em São Paulo, 20:08–20:11 do mesmo dia. Os timestamps originais permanecem na prova. Não foi realizada avaliação de desempenho.

As [duas recusas anteriores do ambiente](../../evidencias/mfa-tenancy-grants-environment-2026-11-08.json) aconteceram antes dos testes: Docker indisponível e memória insuficiente. Não são reproduções de falha de produto. Depois da liberação de memória, foram usados os controles do novo cluster exclusivo, com nova identidade, 384 MiB, uma CPU e porta apenas local. A baseline usou um diretório novo para preservar as recusas anteriores.

As três limpezas passaram: bancos temporários removidos, base de referência vazia, nenhum outro banco/cliente, seis roles e suas credenciais/configurações restauradas, filhos diretos registrados encerrados, fontes intactas e identidade do contêiner preservada. Não houve reinício do computador. Credenciais privadas não acompanham o Git.

## Retomar

O [pacote portátil](README.md) e a [prova de restauração](../../evidencias/mfa-tenancy-grants-restore-2026-11-08.json) já estão publicados. Restaurar checkpoint85 → V4 diretamente, sem V3 → obrigatório por flag → vínculo global → revogações → criação → concessões. Usar uma pasta nova em cada etapa. As instruções e arquivos congelados conservam seu estado de autoria; este resultado sucede a antiga pendência funcional sem alterar seus hashes.

Os caminhos locais das provas são `work/mfa-tenancy-grants-baseline-db2-attempt2-qa-20261108`, `work/mfa-tenancy-grants-fixed-db2-qa-20261108` e `work/mfa-tenancy-grants-fixed-regression-db2-qa-20261108`. As fontes preparadas permanecem nas pastas `work/mfa-tenancy-grants-{baseline,fixed}-qa-20261108`. O [verificador](QA/verify-tenancy-grants-results-20261108.py), a [configuração revisada](QA/root-config.json) e o [plano executado](QA/PLAN.json) acompanham este resultado. São registros vinculados a este ambiente; em outro computador, preparar dependências, banco descartável e identificação próprios, sem copiar credenciais ou reutilizar atestações.

## Limites e próxima etapa

Faltam criação/renovação de vínculos de equipe e convites, outros domínios, cenários de concorrência, regressão integrada, matriz dos portais/navegadores, Android/iOS, documentação final, vídeos completos e operação. Nos POSTs de concessão, ainda não foram induzidos espera real de locks, promoção, perda de capacidade durante espera, concorrência de constraints, INSERT vazio ou exceção genérica de trigger. Os dois pontos de decisão testados não provam uma garantia universal até o commit.

Os cinco casos históricos de navegador, em quatro specs, conservam suas próprias fontes e datas; não foram reexecutados neste lote. O runtime da main mantém migrations 001–067. A política obrigatória continua candidata, sem ativação parcial e sem aceite de produção.
