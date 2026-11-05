# Retomada MFA — checkpoint candidato atualizado em 05/11/2026

**Composição candidata: desativação concorrente, eventos de funcionalidades e
projector de telemetria.** A base canônica continua
`53c4c70dcd24f1045fad420fbce36757fd3753a2`. A composição usada na QA contém
**1.014 arquivos e cinco suportes**. A montagem/restauração do conjunto atualizado
**passou**, com todos os arquivos idênticos à composição testada.
[Prova dessa restauração](../../evidencias/mfa-telemetry-restore-2026-11-05.json).
A política obrigatória permanece candidata, sem ativação no runtime da main.

Na composição corrigida passaram **telemetria 9/9**, **eventos de funcionalidades
7/7**, **desativação 5/5** e **complemento SQL 11/11**, em processos separados,
sem falhas, cancelamentos, skips ou todo. São 32 casos dirigidos; não são uma
integral da aplicação. Os quatro arquivos de teste e seus imports passaram na
resolução e no TypeScript das composições anterior e corrigida.
[Prova, fontes, comparadores e limites](../../evidencias/mfa-telemetry-events-2026-11-05.json).

A [restauração anterior de 1.013 arquivos](../../evidencias/mfa-merged-restore-2026-11-05.json)
e as [restaurações anteriores do complemento SQL](../../evidencias/mfa-canonical-restore-2026-11-05.json)
continuam históricas. Seus resultados não aprovam automaticamente este conjunto
de 1.014 arquivos.

## Conteúdo recuperável

O inventário tem **56 payloads**. Dois são helper/teste de query já publicados e
serão excluídos do delta pelos hashes exatos. O pacote contém **52 arquivos de
implementação e testes candidatos**, dois testes explícitos de renderer e cinco
suportes do renderer. O transporte publicado também é dependência da base;
não reaplicá-lo.

Esta composição conserva a correção da desativação concorrente, seus cinco
casos, o envelope/projector de `features-changed` e seus sete casos. Acrescenta
o envelope `app_mfa_telemetry_event_context(text,text)`, o projector de telemetria
e nove casos dirigidos. O complemento SQL V5 mantém o teste `2c8a7bc4…` e foi
repetido contra a SQL e a API compostas. Os consumidores preservam seus bytes
anteriores. O [checkpoint separado de desativação](../2026-11-05-mfa-disable/README.md)
guarda o antes/depois histórico; não reaplicar seu patch sobre esta composição.

`MANIFEST.json` e `PACKAGE-HASHES.json` são produzidos no pacote final; não são
arquivos ausentes de autoria. O inventário, todos os payloads e os scripts de
montagem necessários estão neste diretório. Os checkpoints e provas anteriores
permanecem históricos, com seus próprios hashes e limites.

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

## O que foi observado nesta rodada

O SSE real entregou um frame bruto de telemetria exatamente esperado para um
leitor local comum. Na mesma conexão, uma barreira pausou o contexto depois da
resolução de identidade e antes da projeção. Outro comando ativou o binding
ADMIN preexistente antes de liberar o SQL real.

A composição anterior terminou com **3 PASS e 6 FAIL**, sem cancelamentos,
skips ou todo, em 5,051 s de TAP. Uma falha foi a assertiva de fechamento: a
leitura retornou `done:false` onde se esperava EOF. **O conteúdo desse chunk
pós-promoção não foi decodificado.** Não afirmar que ele contém um payload
privado demonstrado nem que houve seis vazamentos. As outras cinco falhas são
contratos do novo helper SQL ausente; os três controles do projector anterior
passaram. O frame positivo decodificado ocorreu antes da promoção.

Na composição corrigida, os nove casos passaram em 5,978 s de TAP. Depois,
três processos de regressão na mesma fonte passaram: funcionalidades 7/7 em
4,241 s, desativação 5/5 em 5,084 s e SQL 11/11 em 5,163 s. A soma de 32 casos
é somente dessas quatro execuções aprovadas; os seis controles negativos do
comparador ficam separados. A compilação dos quatro testes e imports passou
nas duas variantes, com TypeScript em 9,385 s e 10,377 s; as fases de resolução
também passaram. Isso não é um typecheck novo de todos os workspaces.

Cleanup e pós-verificações conferiram seis papéis, credenciais e configurações
restaurados, zero tabelas públicas na base original, zero bases temporárias ou
outras bases, zero outros clientes e fontes inalteradas. Valores privados de
credenciais não fazem parte das provas publicadas.

Somente o caso de promoção durante telemetria bruta usa SSE real nesta rodada.
Os controles de publicação, escopo, funcionalidades e sessão satisfeita chamam
SQL/projector. Fatores e provas desses controles são sintéticos, não cerimônias
TOTP/recovery. Uma chamada SQL no projector foi conferida na fonte, sem assertiva
de contagem de queries em runtime. Os 13 testes originais de telemetria não foram
adaptados ou reexecutados por esta evidência, nem surgiram novos controles de
team/support/gate/parking.

## Contrato da telemetria e limites

Os valores continuam vindo do evento validado de NOTIFY; não há releitura de
amostra persistida ou identificador único da amostra nesse contrato. O envelope
captura no mesmo snapshot a obrigação MFA, a autoridade raw/publicada, a
classificação mínima e os estados de funcionalidades. O projector conserva
as regras compartilhadas, a prioridade raw e o DTO sanitizado de água.
Autenticidade do valor persistido exige outro recorte de protocolo.

A garantia examinada é a observação da operação SQL. Não cobre promoções que
confirmem depois daquele snapshot nem linearização com a escrita na rede.
Alertas, equipamentos, heartbeat, demais projeções HTTP/SD, mutações sem
correspondência, funções VOLATILE e expiração após locks ainda precisam de
integração e provas próprias. O próximo recorte proposto é o projector de alertas.

Não houve nova integral da API, execução de navegador, build nativo ou aceite
de produção nesta fatia. As unidades UI 143/143 e mobile 242/242 pertencem à
rodada anterior, com os mesmos bytes desses consumidores, e não se somam como
uma suíte integral nova. O histórico do SSE de funcionalidades conserva os
dois TS7022 corrigidos por anotações e a incompatibilidade anterior do formato
do manifesto no preparador; esses registros não são falhas do produto.

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
