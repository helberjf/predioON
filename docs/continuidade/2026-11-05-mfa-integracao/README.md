# Retomada MFA — heartbeat candidato atualizado em 05/11/2026

**Heartbeat 9 e nove regressões separadas 105 passaram na composição isolada.**
A base canônica continua `53c4c70dcd24f1045fad420fbce36757fd3753a2`.
A fonte testada é `72119c30…`: **1.017 arquivos e cinco suportes**.
[Prova específica](../../evidencias/mfa-heartbeat-2026-11-05.json).
A [montagem/restauração passou](../../evidencias/mfa-heartbeat-restore-2026-11-05.json),
com os 1.017 arquivos e cinco suportes idênticos à composição testada. A restauração anterior de
[equipamentos](../../evidencias/mfa-equipment-original25-restore-2026-11-05.json)
não atesta automaticamente estes bytes novos. Nenhuma política foi ativada na main.

## Conteúdo recuperável

São **64 payloads**: 60 arquivos de implementação/testes candidatos, dois testes
renderer explícitos e dois arquivos helper/teste de query já publicados, que o
builder exclui por hashes exatos. Há cinco suportes renderer separados.
O transporte publicado é dependência da base, não patch para reaplicar.
Nesta rodada muda somente `apps/api/src/modules/events/routes.ts` no produto e
entra `apps/api/test/platform-mfa-heartbeat.test.ts`. SQL068, projectors e os
originais de equipamentos/alertas/telemetria conservam seus bytes anteriores.

A fila por conexão agora inclui heartbeat. No máximo um heartbeat fica pendente
ou em execução; não consome o orçamento de 100 eventos. Identidade local no ping
não altera req.auth durante um evento. Close é idempotente e imediato, inclusive
expiry/overflow, sem aguardar query lenta. Depois de await e antes de escrever,
a conexão precisa continuar aberta. Há proteção adicional para desconexão durante
a identidade inicial, antes de instalar headers/timers/subscription.

Token por header/query, retry5000, intervalo25_000 e expiração JWT permanecem.
Close não cancela SQL já em execução. Heartbeat pode atrasar atrás de evento
lento; os guards SQL de cada evento continuam necessários. Não se promete
linearização entre a última leitura autorizada e uma revogação posterior.

`MANIFEST.json` e `PACKAGE-HASHES.json` surgem no pacote final. Cada montagem
nova exige verificação própria antes de declarar a composição restaurada.

## Rodada atual: heartbeat e regressões

Baseline: **1 PASS/8 FAIL**, sem cancelamento/skip/todo, em 4,478 s TAP.
As falhas observadas foram início concorrente de SELECTs (casos 1/2/6/8), consulta
por callback manual tardio após close (4/7), comentário `: ping` recebido quando
se esperava fechamento (3) e writeHead após desconexão inicial (9).
O tick do caso 3 ocorreu ANTES da promoção: não foi provada emissão após commit,
nem houve DTO privado exposto. O caso 8 falhou antes de publicar a 101ª notificação;
não demonstrou que o teto original 100 estivesse quebrado. Caso 5 já passou.
As assertivas posteriores à primeira falha de cada caso não são resultados baseline.

Corrigida: **9/9 PASS em 3,595 s TAP**. Timer25k capturado/acionado manualmente,
observadores delegados e barreiras sobre consultas reais evitam sleeps25s; HTTP,
LISTEN/NOTIFY, identidade e queries continuam reais. Fatores/provas dos controles
novos são sintéticos; não são teste de cerimônia TOTP.

Depois passaram nove processos separados: dispositivos 9, telemetria 9, funcionalidades 7,
desativação 5, SQL 11, telemetria original 13, alertas originais 17, alertas dirigidos 9 e
equipamentos originais 25, total 105. Não é uma API integral. Os originais com
administradores mantêm suas cerimônias TOTP HTTP explícitas. Tipos dos 10 arquivos
e imports passaram nas duas variantes: resolução/tipos 1,257/9,770 s e 2,141/10,327 s.
Fontes antes/depois e cleanup passaram: seis roles/credenciais/settings restaurados,
zero bases temporárias e outros clientes. Valores privados não integram a prova.

O callback de expiração JWT não foi exercitado; sua captura no caso 9 só limpa
a baseline. O contador res.end não possui assertiva exatamente uma vez:
idempotência é revisão da implementação, não medida desse contador.

As seções abaixo conservam as rodadas anteriores com seus escopos próprios.
Gateway, demais superfícies SQL/SD/mutações e aceites integrados continuam pendentes.

## Retomar em outro computador

1. Clone a main atual, compare suas mudanças e leia `docs/CONTINUIDADE.md`.
2. Para montar a composição exata, crie uma base isolada no commit indicado.
   Exemplo no diretório pai dos projetos, com o clone chamado `predioON`:

```text
git -C predioON worktree add --detach ../predioON-base-mfa 53c4c70dcd24f1045fad420fbce36757fd3753a2
node --max-old-space-size=128 predioON/docs/continuidade/2026-11-05-mfa-integracao/finalize-checkpoint.mjs --base-checkout predioON-base-mfa --base-commit 53c4c70dcd24f1045fad420fbce36757fd3753a2 --output predioON-mfa-pacote
node --max-old-space-size=128 predioON-mfa-pacote/restore-checkpoint.mjs --base-checkout predioON-base-mfa --output predioON-mfa-candidato
```

3. Os destinos devem ser inexistentes, com pai existente, fora da base e do pacote.
   Confira o manifesto, hashes e `MFA-RESTORE-RECEIPT.json`. Se já recebeu um pacote
   final com manifesto, basta seu `restore-checkpoint.mjs`; não há gerador ausente
   a executar nesse pacote. Registre uma nova restauração antes de afirmar que
   o conjunto composto inteiro foi reconstruído nesse computador.
4. Prepare dependências pelo README da base e pelo lockfile. Não copie env,
   credenciais, node_modules, junctions ou IDs de containers de outra máquina.
5. Tipos e testes devem usar a composição isolada e fixture oficial UUID nova,
   com owner somente no arranjo/provas e seis conexões de runtime restritas.
   Não executar seed/reset/migration em instalação existente. SQL 068 restaurada
   é somente fonte candidata; não deve ser aplicada à instalação publicada 067.
6. Conclua os demais projectors, domínios, SD/SSE, mutações sem correspondência,
   expiração/locks/triggers e regressões antes de ativar a política. Depois valide
   navegador real, builds e jornadas Android/iOS em aparelhos.

Conservar 1536 MiB para montagem/restauração, 4096 MiB antes de ligar o banco e
1536 MiB após readiness/antes de cada processo. Não reduzir guards, fechar
processos desconhecidos ou reiniciar computador, Docker ou WSL. Os comandos de
restauração não instalam dependências, executam testes, iniciam serviços ou
aplicam migrations.

## Histórico anterior: 25 originais de equipamentos

A fixture anterior teve **23 PASS e 2 FAIL**, em **76,947 s de TAP**. Nos casos
5 e 18, o helper de stream recebeu HTTP 403 onde esperava 200. O log não
registrou o corpo ou `reason` dessas respostas: não se afirma que um código
MFA específico tenha sido observado. A preparação MFA incompleta é a
interpretação do código e do delta exclusivo de fixture, não uma evidência
de vazamento ou de regressão da política.

A fixture corrigida completa cadastro do fator, confirmação TOTP, recebimento
de dez códigos de recuperação e `/auth/me` como `satisfied`, somente para
`f.platform` e `f.flag` nos casos 5 e 18. Preserva bearer e família originais.
Os outros 23 corpos de teste, as assertivas e os prazos permanecem idênticos.
O caso original de expiração conserva 50 ms, `pg_sleep(0.1)` e duas consultas;
os streams conservam 20 s.

A versão corrigida passou **25/25 em 80,786 s de TAP**, sem falhas,
cancelamentos, skips ou todo. Resolução/tipos do único arquivo e seus imports
passaram nas duas variantes: **1,645/8,134 s** na anterior e **1,122/7,755 s**
na corrigida. Isso não constitui novo typecheck de todos os workspaces.
Fontes antes/depois e cleanup passaram, com seis roles, credenciais privadas e
configurações restauradas, zero bases temporárias e zero outros clientes.
Não se publicam valores privados.

Os 1.016 caminhos das duas composições diferem somente na fixture. O código do
produto é idêntico ao da rodada anterior de dispositivos. Seus 80 casos são
históricos na fonte `7b53…`; não foram reexecutados ou somados a esta rodada
como se fossem uma integral. A execução corrigida original25 usa `f2d3055b…`.

O caso 25 preservou os planos naturais de classificação e RLS das tabelas de
funcionalidades: cinco entradas, uma classificação, duas consultas de estados
e duas verificações internas de escopo, sem varredura de históricos de
telemetria/alertas. Os dois artefatos têm 1.739 bytes e SHA-256
`3a44d63fa5a8f0d84b6ac976195a143df0649620ee12f28b2c426f2faedb4f0a`.
A instrumentação autentica como owner para carregar `auto_explain` e usa
`SET LOCAL ROLE predioon_app` e `app.user_id` nas consultas medidas sob RLS.
O teste conhece owner para arranjo/instrumentação; os pools de runtime usam
roles restritas. Os planos são do caminho legado de classificação/features,
não do novo envelope, e não demonstram um benchmark do novo wrapper.

A prova cobre este arquivo com fixture oficial isolada e cerimônias TOTP das
contas indicadas. Não constitui aceite de navegador, aparelho, produção ou
obrigação MFA completa de todos os domínios.

## Rodada anterior: dispositivos e regressões

O comparador anterior teve **2 PASS e 7 FAIL** em 4,685 s de TAP. Um caso mostrou
o frame real com DTO persistido de quatro campos depois da promoção: a conexão
recebeu um evento positivo, a barreira pausou após o contexto/classificação real
e a promoção foi confirmada antes da autoridade final. O frame foi decodificado
e comparado antes da assertiva negativa. As outras seis falhas são contratos
SQL novos ausentes. Os controles de ANY e expiração/revogação de suporte passaram.

A versão corrigida passou **9/9** em 4,333 s. Depois, sete processos separados
passaram na mesma fonte: telemetria9, funcionalidades7, desativação5, SQL11,
telemetria original13, alertas originais17 e alertas dirigidos9. São **80 casos
em oito processos**, sem falhas, cancelamentos, skips ou todo; não uma integral.

A primeira resolução foi recusada com 780 MiB antes de iniciar o compilador.
Após recuperar memória, resolução/tipos passaram: 1,695/8,894 s na anterior,
1,082/9,072 s na corrigida. O escopo é oito arquivos e imports, não todos os
workspaces. Fontes e limpeza passaram; seis roles, credenciais privadas e
configurações foram restauradas, com zero bases temporárias e outros clientes.

Somente a corrida dirigida usa SSE real. Os outros controles novos usam SQL e
projector, com fatores/provas sintéticos; não estabelecem cerimônia TOTP, web,
Android/iOS ou produção. As fixtures originais de alertas/telemetria têm suas
cerimônias administrativas próprias. Nenhuma dessas provas fecha outros callers
SQL, gateway, heartbeat, mutações ou todos os domínios.

## Rodada anterior: 17 originais de alertas

A fixture anterior teve **16 PASS e 1 FAIL**, em 28,975 s de TAP. O primeiro
administrador do caso 6 recebeu 403 `MFA_ENROLLMENT_REQUIRED` onde a fixture
esperava 200. Foi uma negativa correta do guard, com preparação administrativa
incompleta, não um vazamento ou nova falha de segurança do produto.

A fixture atual executa cadastro do fator, confirmação TOTP, recebe dez códigos
de recuperação e verifica `/auth/me` como `satisfied`. Isso ocorre somente para
os dois administradores do caso 6, com o bearer e a família originais. Usuários
locais, residentes e suporte não recebem autoridade ou prova artificiais.
As negativas sem grant local e positivas com grant de alerta permanecem.
Os outros 16 corpos de teste e o prazo 20s dos streams sao idênticos.

Os **17 casos passaram em 25,344 s**, sem falhas, cancelamentos, skips ou todo.
Resolução/tipos do arquivo e seus imports passaram nas duas variantes:
1,734/9,200 s na anterior e 1,608/9,190 s na atual. Isso não é um novo typecheck
de todos os workspaces. Fontes antes/depois, cleanup e restauração das seis
roles/credenciais/configurações passaram, com zero bases temporárias ou outros
clientes. Valores privados não sao publicados.

A comparação completa de 1.015 caminhos entre 77b1 e 52b2 difere somente na
fixture de alertas. Não se somam os 17 casos desta rodada aos 54 anteriores como
se fossem uma integral; os testes possuem fontes, bancos UUID e processos
próprios. O HTTP/TOTP desta fixture não demonstra novo replay/recovery, jornada
web/nativa, aparelho ou implantação. As provas dirigidas sintéticas anteriores
continuam com seu escopo; não passam a ser cerimônias TOTP por associação.

## Rodada dirigida anterior: alertas e regressões

A versão corrigida passou nos nove casos de alertas em **5,518 s de TAP**.
Depois, na mesma fonte 77b1, cinco processos separados passaram: telemetria 9 em
6,255 s, funcionalidades 7 em 4,798 s, desativação 5 em 5,060 s, SQL 11 em 4,737 s
e telemetria original 13 em 19,970 s. Todos terminaram sem falhas, cancelamentos,
skips ou todo. Esses 45 casos de regressão são execuções novas e separadas dos
registros históricos. Com os nove dirigidos, somam 54; não uma integral.

O comparador anterior teve **2 PASS e 7 FAIL**, sem cancelamentos/skips/todo,
em 5,060 s. Um caso demonstrou o DTO persistido de nove campos após a promoção:
a mesma conexão recebeu o frame positivo, pausou depois da identidade/contexto,
confirmou a ativação ADMIN antes da projeção e recebeu outro frame. O teste
**decodificou e comparou esse DTO exato** antes de falhar na assertiva que
esperava ausência de frame. As outras seis falhas são o contrato SQL novo
ausente; não seis vazamentos demonstrados. Os dois controles do projector
anterior passaram. A composição corrigida fechou a conexão sem esse frame.

Tipos dos seis arquivos e imports: 9,347 s na variante anterior e 9,234 s na
corrigida; resolução também aprovada nas duas. Isso não equivale a novo
typecheck de todos os workspaces. Fontes antes/depois e cleanup passaram,
com as seis roles/credenciais/configurações restauradas e sem bases temporárias
ou outros clientes. As provas públicas não contêm os valores privados.

Somente uma corrida usa SSE real. Os controles de escopo, família, funcionalidades
e ACL usam SQL/projector; fatores/provas sintéticos não são cerimônia TOTP.
A estrutura de uma consulta foi revisada na fonte, sem contador runtime.
O caso PUMP bloqueado junto com WATER_TANK não isola sua precedência entre essas
duas funcionalidades; DAILY_ENERGY com WATER_TANK desativado verifica uma precedência
específica. As regras compartilhadas permanecem intactas. Não alegar cobertura
exaustiva de gate/parking/equipe/janelas. Naquela prova os 17 originais de alertas ainda não haviam sido executados;
a rodada específica atual está documentada acima.

## Históricos preservados

Os [13 originais de telemetria](../../evidencias/mfa-telemetry-original13-2026-11-05.json)
passaram na composição anterior, com cadastro/confirmação MFA por HTTP/TOTP dos
dois administradores do caso local. Bearer e família foram mantidos; os outros
12 corpos de teste permaneceram iguais. O comparador antigo teve 12 PASS e um
403 `MFA_ENROLLMENT_REQUIRED` contra um esperado 200: guard correto e fixture
incompleta, não vulnerabilidade. A [restauração correspondente](../../evidencias/mfa-telemetry-original13-restore-2026-11-05.json)
conserva sua fonte f452 e 1.014 arquivos.

Antes, [telemetria 9, funcionalidades 7, desativação 5 e SQL 11](../../evidencias/mfa-telemetry-events-2026-11-05.json)
passaram em processos separados sobre a fonte ab71. São 32 casos históricos;
não transferir seus resultados automaticamente para uma composição modificada.
As [restaurações de telemetria](../../evidencias/mfa-telemetry-restore-2026-11-05.json),
[funcionalidades](../../evidencias/mfa-merged-restore-2026-11-05.json) e
[complemento SQL](../../evidencias/mfa-canonical-restore-2026-11-05.json) permanecem
históricas. As cinco regressões daquela rodada estão registradas acima, sobre a fonte
77b1, separadamente desses históricos.

UI 143/143, mobile 242/242 e o renderer V6 de quatro casos conservam as provas e
limites de suas rodadas anteriores. Esta proposta não lhes atribui execução nova.

## Contratos e pendências

Alertas relêem o registro persistido: mensagem, status, gateway e instante da
observação vêm do banco; a notificação fornece identificadores. O envelope
proposto captura obrigação MFA, autorização exata, registro e estados de
funcionalidades no mesmo snapshot, sob RLS do chamador, sem novo SELECT de
tabela. O projector conserva os nove campos, gateway nulo e regras puras.

Telemetria continua com seu contrato distinto: os valores vêm de NOTIFY, sem
releitura de amostra nem ID único da observação persistida. Não atribuir ao novo
envelope de alertas uma mudança desse protocolo de telemetria.

A observação SQL não estabelece linearização com promoções posteriores ao
snapshot ou escrita na rede. A coordenação do heartbeat e a desconexão durante
a identidade inicial passaram nos nove casos desta rodada. Gateway, outros
callers HTTP/SD, mutações sem correspondência, funções VOLATILE e expiração
após locks continuam pendentes, assim como a regressão integrada. A expiração
JWT automática não foi acionada no teste. Não houve novo aceite de navegador,
aparelhos ou produção.

O [plano de equipamentos e coordenação do SSE](../../superpowers/plans/2026-11-05-mfa-equipment-events.md)
conserva o desenho inicial. O próximo recorte é o
[guard de gateways](../../superpowers/plans/2026-11-05-mfa-gateway-events.md).
Device-status já está nesta fonte candidata, com o recheck final de autoridade
após expirar suporte e o ANY de funcionalidades sem freshness preservados.
Os demais domínios e a integração completa continuam abertos.

## Bytes canônicos e receita renderer

A base vem dos objetos Git: árvore/OIDs/modos e blobs binários por comprimento,
sem converter payloads para UTF-8 ou normalizar CRLF/LF. A auditoria inicial de
um checkout antigo encontrou 12 diferenças EOL; a base fresca usada no builder
aprovado registrou somente duas, nos PS1 com EOL CRLF. A restauração usa Git LF
nesses scripts, aceito pelo PowerShell. `observedRawSha256` é diagnóstico, nunca
requisito de bytes locais do Windows. Payloads mantêm bytes exatos protegidos
por atributos/hashes.

Os dois testes renderer ficam em `qa/render-v6/test/`, fora dos globs automáticos.
O suporte em `qaSupport/renderer/` guarda package/tsconfig, versões/import maps e
preparador explícito. **Essa receita nova não foi executada.** Os quatro PASS
antigos são do harness V6 original. Use dependências já preparadas conforme o
README da base, com lock e versões verificadas, React/renderer 19.2.3 pareados
e singleton dos ícones. Não transferir esses resultados para React web 19.3.0,
DOM, acessibilidade ou aparelho.

A SQL cobre uma fatia finita. Defaults ACL adversariais, fluxos completos de
workers, empty/no-match e os demais projectors/mutadores continuam pendentes.
Empacotar, restaurar ou testar essa fatia não a transforma em implantação.

O [roteiro de fechamento em quatro lotes](../../superpowers/plans/2026-11-05-mfa-fechamento-e-demonstracao.md)
também inventaria os scripts existentes de abertura e Codegen. O encerramento
inclui validação dos fluxos, instruções para abrir os sistemas e documentação
para entrevistas/apresentações, conforme o objetivo confirmado pelo proprietário.
