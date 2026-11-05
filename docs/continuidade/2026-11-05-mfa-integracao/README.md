# Retomada MFA - checkpoint candidato atualizado em 05/11/2026

**Composição candidata com projector de alertas.** A base canônica continua
`53c4c70dcd24f1045fad420fbce36757fd3753a2`; a fonte testada possui **1.015 arquivos
e cinco suportes**. Os nove casos dirigidos de alertas passaram, assim como os
cinco processos de regressão: telemetria 9, funcionalidades 7, desativação 5, SQL 11
e os 13 originais de telemetria. São 54 casos aprovados em seis processos
separados, não uma integral. Resolução e tipos dos seis testes e imports passaram
nas duas variantes. [Prova e limites](../../evidencias/mfa-alert-events-2026-11-05.json).

A montagem/restauração deste conjunto **passou**, com todos os 1.015 arquivos
idênticos à composição testada. [Prova de restauração](../../evidencias/mfa-alert-restore-2026-11-05.json).
A política obrigatória
permanece candidata, sem ativação no runtime da main.

## Conteúdo recuperável

O inventário tem **59 payloads**. Dois são helper/teste de
query já publicados e serão excluídos do delta pelos hashes exatos. O pacote
contém **55 arquivos de implementação/testes candidatos**, dois testes explícitos
de renderer e cinco suportes do renderer. O transporte publicado também é
dependência da base; não reaplicá-lo.

Esta etapa substitui a SQL candidata pelo envelope adicional
`app_mfa_alert_event_context(text,uuid)`, inclui o projector de alertas atualizado
e seus nove casos dirigidos. Preserva os payloads de P0, funcionalidades,
telemetria e a fixture original 13 `e7431620…`. A fixture separada dos 17 testes
originais de alertas **não integra este conjunto** nem os nove casos novos.

O [checkpoint separado de desativação](../2026-11-05-mfa-disable/README.md)
conserva seu antes/depois histórico; não reaplicar esse patch. O complemento SQL
V5 conserva o teste `2c8a7bc4…`. Os consumidores permanecem com os mesmos bytes.

`MANIFEST.json` e `PACKAGE-HASHES.json` são produzidos no pacote final; não são
arquivos ausentes de autoria. O inventário, payloads e scripts estão neste
diretório. As provas e composições anteriores conservam seus próprios hashes.

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

## Resultados observados deste recorte

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
exaustiva de gate/parking/equipe/janelas nem execução dos 17 originais de alertas.
A fixture separada desses 17 permanece fora deste pacote.

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
históricas. As cinco regressões novas desta rodada estão registradas acima, sobre a fonte
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
snapshot ou escrita na rede. Equipamentos, heartbeat/headers iniciais, outros
callers HTTP/SD, mutações sem correspondência, funções VOLATILE e expiração
após locks continuam pendentes, assim como os17 originais de alertas e a
regressão integrada. Não houve novo aceite de navegador, aparelhos ou produção.

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
