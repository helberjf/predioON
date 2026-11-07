# Retomada MFA — diretório administrativo

**Revisão e registro em 07/11/2026; execuções realizadas em 05/11/2026.**
Doze entradas TAP dirigidas passaram; 214 entradas TAP de regressão passaram em
22 processos separados. O dirigido contém dez cenários independentes e dois
grupos; as regressões incluem seis grupos. São 226 TAP em 23 processos e 218 cenários
independentes, sem representar a API inteira ou aceite global de MFA.

O conjunto contém 78 payloads: 74 candidatos de runtime/testes, dois testes renderer
explícitos e dois arquivos query já publicados. A composição tem 1.024 arquivos e
cinco suportes separados. A [montagem/restauração passou](../../evidencias/mfa-admin-directory-read-restore-2026-11-07.json),
com os 1.024 arquivos e cinco suportes idênticos à composição testada. A
restauração anterior 73 permanece histórica e não substitui esta etapa.

Somente três GETs e quatro projeções foram alterados: detalhe de prédio, usuários
globais/locais e equipe de suporte. Mantêm DTO10/7/6, datas e campos nulos,
DISTINCT/join legado, ordenação existente, limite 200 e filtro active sem adicionar
filtro temporal. Helper, SQL068, demais rotas e mutações permanecem intactos.
Buildings substitui um payload existente; users/support routes, teste dirigido e
duas fixtures originais são cinco entradas novas no inventário.

A baseline teve quatro PASS e oito FAIL TAP: seis falhas independentes e dois
grupos agregados. Quatro respostas completas foram decodificadas e comparadas ao
controle positivo; a lista local vazia foi comparada a items=[]; o prédio ausente
retornou 404, sem inspeção do corpo. Cinco casos retornaram 200 em vez de 403, um
retornou 404 em vez de 403. Motivo MFA e ausência de items não foram alcançados
nessas falhas; não são oito vazamentos independentes.

A versão corrigida passou 12/12 e as 22 regressões passaram 214/214. As quatro fases
de resolução/tipagem passaram. Cada rodada de banco limpou a fixture UUID,
restaurou seis roles e configurações privadas e deixou zero bancos temporários
ou clientes residuais, com fontes preservadas. Os horários reais permanecem na
prova; não houve nova execução de testes nesta revisão de 07/11.

Nos originais, users caso 4 e quatro fixtures de suporte completam cerimônia real
HTTP/password/TOTP, recebem dez códigos e confirmam /me satisfied mantendo o
mesmo bearer/SID; os corpos e asserções existentes foram preservados. O dirigido
usa prova sintética. Dois casos administrativos de users-runtime-acl continuam
pendentes, sem novo skip ou aceite transferido.

A configuração esperada V1 omitia prefixos './' e foi preservada; TSC executou
somente com a configuração real V2. Fontes e preparo não mudaram. Montagem de
fontes não instala dependências nem aceita produção, demais domínios, comandos,
Playwright ou nativos. O runtime principal permanece nas migrações 001–067.

[Prova do diretório administrativo](../../evidencias/mfa-admin-directory-read-2026-11-05.json).

## Rodada anterior: convites

**Dez entradas TAP dirigidas e 195 entradas TAP de regressão passaram na composição isolada, em vinte processos separados.**
O dirigido tem oito cenários independentes e dois grupos; as regressões incluem
quatro grupos dos lotes A/B. São 205 entradas TAP e 199 cenários independentes,
sem representar a API inteira ou aceite global de MFA.

Este conjunto contém 73 payloads: 69 candidatos de runtime/testes, dois testes
renderer explícitos e dois arquivos query já publicados. A composição tem
1.023 arquivos e cinco suportes renderer separados. A [montagem/restauração passou](../../evidencias/mfa-invitations-read-restore-2026-11-05.json),
com os 1.023 arquivos e cinco suportes idênticos à composição testada. A
restauração anterior do lote B72 permanece histórica e não substitui esta etapa.

A alteração protege somente GET de convites; substitui tenancy/routes.ts e o
comentário de auth/mfa-read.ts, acrescentando um teste dirigido. A assinatura e
o corpo do helper, SQL068, shared invitationView, nove campos DTO, isoTime,
precedência ACCEPTED→REVOKED→EXPIRED→PENDING, paginação e mutações permanecem
preservados. A exceção documentada é apenas o clock_timestamp nativo escalar;
não permite leitor SQL/SD VOLATILE nem troca o relógio por tempo de transação.

Na baseline, quatro cenários falharam com HTTP200 em vez de403: duas páginas
exatas com quatro convites e duas páginas vazias com items=[]/nextCursor=null,
comparadas antes da primeira falha. As outras duas falhas TAP são agregações dos
grupos. A baseline não alcançou as asserções de motivo MFA e ausência de items.
Na versão corrigida, os dez TAP passaram; os dezenove arquivos de regressão
passaram separadamente, incluindo os nove casos originais de convites intactos.

As quatro fases de resolução/tipagem passaram. Cada rodada de banco teve limpeza da
fixture UUID, restauração das seis roles e configurações privadas, zero bancos
temporários/clientes residuais e fontes preservadas. O erro do wrapper externo
após o preparo baseline ocorreu depois de child exit0, sem timeout; não foi
falha de produto nem repetição do preparo bem-sucedido.

Catálogo do relógio nativo e quatro status afastados da borda não comprovam uma
transição exata de expiração. Os casos dirigidos usam prova MFA sintética;
não equivalem a nova cerimônia TOTP, navegador ou aplicativo nativo. A montagem
portável também não aceita produção, demais domínios ou comandos. O runtime
principal continua com as migrações001–067.

[Prova de convites](../../evidencias/mfa-invitations-read-2026-11-05.json).

### Rodada anterior: lote B de vínculos

**Lote B: 12 entradas TAP aprovadas; regressões: 174 entradas TAP em 17 processos.**
O dirigido corresponde a dez cenários independentes e dois grupos. As regressões
incluem dois grupos agregados do lote A; 174 TAP não equivale a 174 cenários independentes.
São 18 processos aprovados nesta composição, sem somar a baseline de falhas.
Base canônica `53c4c70dcd24f1045fad420fbce36757fd3753a2`; fonte corrigida `8def4d4d…`,
**1.022 arquivos e cinco suportes**. [Prova específica](../../evidencias/mfa-tenancy-binding-2026-11-05.json).
A [montagem/restauração passou](../../evidencias/mfa-tenancy-binding-restore-2026-11-05.json),
com os 1.022 arquivos e cinco suportes idênticos à composição testada. A
[restauração anterior do lote A](../../evidencias/mfa-tenancy-structure-restore-2026-11-05.json)
permanece histórica. Runtime principal continua 001–067; a política completa permanece candidata.

#### Conteúdo recuperável

72 payloads: 68 arquivos candidatos, dois testes renderer explícitos e dois arquivos
query já publicados, excluídos do delta por hashes. Cinco suportes renderer são separados.
A atualização substitui somente tenancy/routes.ts no inventário, preservando o before
Git canônico, e acrescenta platform-mfa-tenancy-links.test.ts. O lote A e a fixture
people com cerimônia do administrador global do caso 2 permanecem intactos.

No produto, somente GET unit-memberships, team-members e role-bindings passam pelo
adaptador existente. DTOs completos de 10/9/14 campos preservam camelCase, IDs nullable,
reason, datas createdAt/updatedAt obrigatórias e startsAt/endsAt nullable. Nenhum filtro
por vigência foi introduzido: vínculos ativos vencidos continuam listados conforme o
contrato existente, enquanto inativos permanecem excluídos. Predicados de prédio,
capacidade, cursor UUID, ordenação, limit+1 e paginação não mudam. Os outros 19 blocos
de rotas, mutações, views compartilhadas, helper e SQL068 permanecem idênticos.

#### Rodada atual e limites

Baseline: **4 PASS/8 FAIL**, TAP 4904.5992 ms,
sem cancelamento, skip ou todo. Há seis asserções HTTP 200 versus 403 e duas agregações
de grupos, não oito vulnerabilidades. Nos três caminhos não vazios, a resposta real
após promoção administrativa foi decodificada e comparada com a página positiva de
dois vínculos ativos antes da negativa. Nos três cursores vazios após remoção da prova,
a resposta foi comparada com items=[] e nextCursor=null, sem dados privados.
Motivos MFA e assertivas posteriores ao status 403 não foram alcançados na baseline.

A corrigida passou **12/12**, TAP 4484.0099 ms. As 17 regressões somam 174
entradas TAP: as 162 anteriores mais o lote A 12, que inclui dois grupos agregados.
Não é API integral nem total de vulnerabilidades. Os quatro controles do dirigido
cobrem DTO/data/null, paginação UUID, ativo vencido versus inativo, escopo estrangeiro,
capacidade de gerenciamento de vínculos e administrador satisfeito com grant local.
Tipos dos 18 arquivos e imports passaram: resolução/tipos 1174/11311 ms na baseline,
1250/10751 ms na corrigida. Fontes e limpeza foram conferidas; seis roles, credenciais
privadas e settings restaurados, zero bancos temporários e outros clientes.

O processo conhece owner para arranjo/instrumentação e usa conexões runtime restritas.
Provas dirigidas sintéticas não estabelecem nova cerimônia TOTP ou aceite web/nativo;
as fixtures originais conservam suas cerimônias. STABLE não lineariza revogação após
snapshot, commit ou rede. Outros leitores, comandos, integração e produção continuam
pendentes. A receita de staging renderer não foi executada.

#### Rodada anterior: lote A de estrutura

**O lote A passou nas 12 entradas TAP e em 162 regressões, em 17 processos separados.**
O ensaio dirigido contém seis testes de topo, sendo dois grupos, mais seis subtestes.
Base canônica `53c4c70dcd24f1045fad420fbce36757fd3753a2`; fonte corrigida `74f0199c…`,
**1.021 arquivos e cinco suportes**. [Prova específica](../../evidencias/mfa-tenancy-structure-2026-11-05.json).
A [montagem/restauração passou](../../evidencias/mfa-tenancy-structure-restore-2026-11-05.json),
com os 1.021 arquivos e cinco suportes idênticos à composição testada. A
[restauração anterior das leituras guardadas](../../evidencias/mfa-guarded-read-restore-2026-11-05.json)
permanece histórica. Runtime principal continua 001–067; a política completa permanece candidata.

##### Conteúdo recuperável

71 payloads: 67 arquivos candidatos de implementação/testes, dois testes renderer
explícitos e dois arquivos query já publicados, excluídos do delta por hashes.
Cinco suportes renderer permanecem separados. Não aplicar patches históricos sobre a main.

A atualização substitui tenancy/routes.ts no inventário, preservando seus hashes
canônicos de origem, e acrescenta o teste dirigido e tenancy-people.test.ts adaptado.
Somente o ator administrador global do caso 2 desse teste original executa a
cerimônia MFA, mantendo bearer e família; os outros oito corpos permanecem intactos.

No produto, só GET blocks, units e teams passam pelo adaptador já validado. Os 19
outros blocos de rotas e as views compartilhadas usadas nas mutações são idênticos.
DTOs de 5/6/5 campos preservam UUIDs, booleanos, blockId e floor nullable, inclusive
unidade com pai não-null e andar negativo. Nenhum campo de data foi acrescentado.
Filtros, cursores UUID, ordenação, limit+1, page() e listScope permanecem iguais.
Helper mfa-read e SQL068 não mudam.

##### Rodada atual e limites

Baseline: **4 PASS/8 FAIL**, sem cancelamento, skip ou todo, em 4,400 s de TAP.
São seis asserções independentes HTTP 200 versus 403 e duas falhas agregadas dos grupos,
não oito vulnerabilidades. Após promoção administrativa depois da capacidade manage,
blocks, units e teams entregaram a página completa de três registros, comparada com
a resposta positiva antes da negativa. Após remoção da prova da família depois da
capacidade read, os três cursores vazios retornaram items=[] e nextCursor=null;
esses casos não expuseram dados. Motivo MFA e assertivas posteriores ao status 403
não foram alcançados na baseline. Os quatro controles de contrato passaram.

A corrigida passou **12/12 em 3,983 s de TAP**. As 16 regressões separadas somam 162:
129 dos ensaios anteriores, mais tenancy-people 9, tenancy-http 9, tenancy-edit 11 e
membership-lifecycle 4. Não é execução da API integral. Tipos dos 17 arquivos e imports
passaram: resolução/tipos 1134/10736 ms na baseline e 1238/10591 ms na corrigida.
As duas fontes têm 1.021 arquivos; fonte, limpeza e restauração das seis roles,
credenciais e settings foram conferidas, com zero bancos temporários e outros clientes.

O processo conhece owner para arranjo/instrumentação; runtime usa conexões restritas.
Provas dirigidas sintéticas não estabelecem aceitação TOTP, navegador ou nativo;
as fixtures originais preservam suas cerimônias. STABLE compartilha o snapshot
sem linearizar revogação posterior ao statement ou rede. Outros leitores, mutações,
integração e produção seguem pendentes. Receita de staging renderer não executada.

##### Rodada anterior: protótipo de leitura

**Oito casos dirigidos e 121 regressões passaram na composição isolada, em doze processos separados.**
Base canônica `53c4c70dcd24f1045fad420fbce36757fd3753a2`; fonte corrigida `45449b1b…`,
**1.020 arquivos e cinco suportes**. [Prova específica](../../evidencias/mfa-guarded-read-2026-11-05.json).
A [montagem/restauração passou](../../evidencias/mfa-guarded-read-restore-2026-11-05.json),
com os 1.020 arquivos e cinco suportes idênticos à composição testada. A
[restauração anterior dos gateways](../../evidencias/mfa-gateway-restore-2026-11-05.json)
permanece histórica. Runtime principal continua 001–067; migração 068 e política completa permanecem candidatas.

###### Conteúdo recuperável

Inventário de **69 payloads**: 65 arquivos candidatos de implementação/testes,
dois testes renderer explícitos e dois arquivos query já publicados e excluídos
do delta por seus hashes. Cinco suportes renderer são separados. Não reaplicar
transporte publicado ou patches históricos sobre a main.

Este recorte acrescenta ao inventário o adaptador `auth/mfa-read.ts`, duas rotas
(`modules/buildings/routes.ts` e `modules/tenancy/routes.ts`) e o teste dirigido.
Somente GET `/buildings` e GET `/tenancy/people` usam o adaptador. O guard e a
subconsulta pertencem ao mesmo statement; CASE preserva a decisão para resultado
vazio. As consultas são escritas pelo servidor, com dependências STABLE revisadas.
Não é um executor genérico de SQL do cliente ou de comandos de alteração.

Aliases explícitos conservam o DTO de buildings, inclusive JSON com nulls e datas
UTC. People conserva cursor TEXT parametrizado, filtro de residentes antes de
limit+1, ordenação e paginação. Empates de nomes em buildings continuam sem ordem
definida. Nenhuma alteração de SQL068, ACL, heartbeat ou projectors foi incluída.

###### Rodada atual e limites

A baseline terminou **5 PASS/3 FAIL**, sem cancelamento, skip ou todo, em 3,869 s
de TAP. Caso 1: HTTP 200 com lista comprovadamente vazia, quando era esperado 403;
sem exposição de dados. Caso 2: página mínima real de pessoas entregue após
promoção administrativa, decodificada e comparada antes da assertiva negativa.
Caso 3: HTTP 200 no primeiro caminho, buildings, após remoção da prova da família;
o corpo não foi comparado em profundidade e o segundo caminho SD não foi alcançado.
Não transferir cobertura às etapas posteriores à primeira falha.

A corrigida passou **8/8 em 3,857 s de TAP**. As onze regressões separadas somam
121: gateway 7, heartbeat 9, dispositivos 9, telemetria 9, funcionalidades 7,
desativação 5, SQL 11, telemetria original 13, alertas originais 17, alertas dirigidos
9 e equipamentos originais 25. São 129 casos em doze processos, não API integral.
Resolução/tipos passaram em 1,226/10,292 s na baseline e 1,105/10,422 s na corrigida;
12 arquivos de testes e imports, com nove fontes exigidas na baseline e dez na
corrigida devido ao adaptador novo. Baseline tem 1.019 arquivos, corrigida 1.020.

As execuções usam fixture UUID oficial, owner para arranjo/instrumentação e seis
conexões runtime restritas. As seis roles, credenciais e settings foram restauradas;
fontes permaneceram iguais e a limpeza terminou com zero bancos temporários e
outros clientes. Provas MFA deste teste são sintéticas; não é nova aceitação TOTP,
Playwright ou nativa. As regressões originais preservam suas próprias cerimônias.

STABLE não lineariza revogação posterior ao snapshot, commit ou envio de bytes.
Demais domínios, mutações, integração e produção permanecem pendentes. A
[rodada anterior de gateways](../../evidencias/mfa-gateway-events-2026-11-05.json)
permanece documentada; seus sete casos foram novamente executados nesta composição.
O heartbeat conserva seus limites: expiração JWT não exercitada nessa prova histórica,
e ausência de assertiva de res.end exatamente uma vez. A receita de staging do
renderer não foi executada; não transferir aceitação de ensaios anteriores.

###### Retomar em outro computador

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

###### Histórico anterior: 25 originais de equipamentos

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

###### Rodada anterior: dispositivos e regressões

O comparador anterior teve **2 PASS e 7 FAIL** em 4,685 s de TAP. Um caso mostrou
o frame real com DTO persistido de quatro campos depois da promoção: a conexão
recebeu um evento positivo, a barreira pausou após o contexto/classificação real
e a promoção foi confirmada antes da autoridade final. O frame foi decodificado
e comparado antes da assertiva negativa. As outras seis falhas são contratos
SQL novos ausentes. Os controles de ANY e expiração/revogação de suporte passaram.

A versão corrigida passou **9/9** em 4,333 s. Depois, sete processos separados
passaram na mesma fonte: telemetria 9, funcionalidades 7, desativação 5, SQL 11,
telemetria original 13, alertas originais 17 e alertas dirigidos 9. São **80 casos
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

###### Rodada anterior: 17 originais de alertas

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

###### Rodada dirigida anterior: alertas e regressões

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

###### Históricos preservados

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

###### Contratos e pendências

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
a identidade inicial passaram nos nove casos de heartbeat, reexecutados aqui.
O novo guard gateway passou nos sete casos desta rodada. Outros callers HTTP/SD, mutações sem correspondência, funções VOLATILE e expiração
após locks continuam pendentes, assim como a regressão integrada. A expiração
JWT automática não foi acionada no teste. Não houve novo aceite de navegador,
aparelhos ou produção.

O [plano de equipamentos e coordenação do SSE](../../superpowers/plans/2026-11-05-mfa-equipment-events.md)
conserva o desenho inicial. O
[guard de gateways](../../superpowers/plans/2026-11-05-mfa-gateway-events.md)
agora está incluído nesta composição candidata e validado no escopo descrito acima.
Device-status já está nesta fonte candidata, com o recheck final de autoridade
após expirar suporte e o ANY de funcionalidades sem freshness preservados.
Os demais domínios e a integração completa continuam abertos.

###### Bytes canônicos e receita renderer

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
