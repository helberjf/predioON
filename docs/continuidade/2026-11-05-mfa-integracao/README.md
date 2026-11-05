# Retomada MFA — checkpoint candidato atualizado em 05/11/2026

**A montagem e a restauração canônicas do conjunto V5 foram aprovadas.**
A base é `53c4c70dcd24f1045fad420fbce36757fd3753a2`: 1.011 arquivos compostos
e cinco suportes conferidos por hash. A prova conserva também a execução anterior
do pacote `22713a4`/SQL11 V2. Os onze testes SQL V5 e seus tipos passaram em QA
isolada. A política MFA permanece candidata, sem ativação no runtime da main.
[Prova da restauração](../../evidencias/mfa-canonical-restore-2026-11-05.json) e
[SQL11 V5, tipos e unidades](../../evidencias/mfa-complement11-v5-2026-11-05.json).

A correção da desativação concorrente está preservada em um
[checkpoint separado](../2026-11-05-mfa-disable/README.md), com comparação
anterior/corrigido. Ela não está incluída nos 47 arquivos deste conjunto.

## Conteúdo recuperável

O inventário tem 51 payloads. Dois são helper/teste de query já publicados e serão
excluídos do delta pelos hashes exatos. O pacote final continua com 47 arquivos de
implementação/testes pendentes, dois testes explícitos de renderer e cinco suportes
do renderer. O transporte publicado também é dependência da base; não reaplicá-lo.

A única mudança de payload nesta atualização é
`apps/api/test/platform-mfa-sql-envelopes.test.ts` V5, SHA
`2c8a7bc400bd7b8055922f11a06239026db9dce7e9c4195cba696c67c5cd6710`.
Inclui o escopo local legítimo do ator positivo e parâmetros ISO/JSON explícitos,
sem mudar as onze assertivas de segurança, permissões do produto ou SQL V3.
A fonte `mfa.ts` ainda é a anterior ao recorte P0 de desativação: esse novo draft
não integra estes payloads nem recebe o PASS do complemento.

`MANIFEST.json` e `PACKAGE-HASHES.json` são produzidos no pacote final; não são
arquivos ausentes de autoria. O inventário, todos os payloads e os scripts de
montagem necessários estão neste diretório. Os checkpoints anteriores e suas
provas permanecem históricos, com seus próprios hashes e limites.

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
   a executar nesse pacote. Registre uma nova restauração antes de afirmar que o
   payload V5 inteiro foi reconstruído nesse computador.
4. Prepare dependências pelo README da base e pelo lockfile. Não copie env,
   credenciais, node_modules, junctions ou IDs de containers de outra máquina.
5. Tipos e testes devem usar a composição isolada e fixture oficial UUID nova,
   com owner somente no arranjo/provas e seis conexões de runtime restritas.
   Não executar seed/reset/migration em instalação existente. SQL 068 restaurada
   é somente fonte candidata; não deve ser aplicada à instalação publicada 067.
6. Feche P0 de desativação, demais domínios, SD/SSE, mutações sem correspondência,
   expiração/locks/triggers e regressões antes de ativar a política. Depois valide
   navegador real, builds e jornadas Android/iOS em aparelhos.

Conservar 1536 MiB para montagem/restauração, 4096 MiB antes de ligar o banco e 1536 MiB
após readiness/antes de cada processo. Não reduzir guards, fechar processos
desconhecidos ou reiniciar computador, Docker ou WSL. Os comandos de restauração
não instalam dependências, executam testes, iniciam serviços ou aplicam migrations.

## O que foi observado

O builder/restorer V2 do checkpoint 227 terminou com exit 0 em duas fases seriais,
verificando 994 arquivos base canônicos, 1011 arquivos da composição e cinco suportes.
A prova diferencia essa execução da montagem/restauração V5 posterior, também aprovada.

SQL11 V5: **11/11, zero falhas/cancelamentos/skips**, 9130,9248 ms. Tipos do teste exato
e seus imports passaram em 15,80 s relatados pelo compilador. As unidades UI 143/143 e
mobile 242/242 pertencem a processos anteriores da V3; seus fontes são iguais aos
V5, que só alterou o teste SQL. Esses resultados são separados e não formam uma
integral única. Cleanup verificou zero tabelas públicas na base original, bases
temporárias/outras e clientes, com seis papéis/credenciais/configurações restaurados.

As tentativas V3/V4 anteriores cancelaram onze casos cada por erro no before hook
(encoding de Date/Object); não foram REDs de produto. A correção de fixture foi
versionada. O guard de 560 MiB antes do primeiro preparo também permanece histórico:
a execução aprovada posterior cumpriu os guards, sem reinício ou afrouxamento.

Não houve aceite global, nova integral da API, nova execução de navegador, nativo
ou produção neste complemento. O owner prepara as provas SQL sintéticas de fator;
esses onze casos não são uma cerimônia TOTP/recovery real.

## Bytes canônicos e receita renderer

A base vem dos objetos Git: árvore/OIDs/modos e blobs binários por comprimento,
sem converter payloads para UTF-8 ou normalizar CRLF/LF. A auditoria inicial de um
checkout antigo encontrou 12 diferenças EOL; a base fresca usada no builder aprovado
registrou somente duas, nos PS1 com EOL CRLF. A restauração usa Git LF nesses scripts,
aceito pelo PowerShell. `observedRawSha256` é diagnóstico, nunca requisito de bytes
locais de Windows. Payloads mantêm bytes exatos protegidos por atributos/hashes.

Os dois testes renderer ficam em `qa/render-v6/test/`, fora dos globs automáticos.
O suporte em `qaSupport/renderer/` guarda package/tsconfig, versões/import maps e
preparador explícito. **Essa receita nova não foi executada.** Os quatro PASS antigos
são do harness V6 original. Use dependências já preparadas conforme o README da base,
com lock e versões verificadas, React/renderer 19.2.3 pareados e singleton dos ícones.
Não transferir esses resultados para React web 19.3.0, DOM, acessibilidade ou aparelho.

A SQL cobre uma fatia finita. Projeções/SD/SSE restantes, defaults ACL adversariais,
fluxos completos de workers, empty/no-match e mutadores VOLATILE continuam pendentes.
O êxito de empacotar, restaurar ou testar esta fatia não a transforma em implantação.
