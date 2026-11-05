# Retomada MFA — autoria preservada em 05/11/2026

**Estado desta entrega: fontes e scripts revisados estaticamente; montagem e
restauração canônica V2 ainda não executadas.** O guard recusou a preparação com
560 MiB livres, antes de iniciar Node. Uma medição posterior encontrou374 MiB.
Não houve novo teste de banco, instalação ou reinício nesta recusa.

Este diretório contém `INVENTORY.json`,51 payloads e os scripts de montagem.
Dois payloads são o helper de query e seu teste já publicados: o empacotador os
reconhece pelos hashes exatos e os exclui do delta. O pacote final terá47 arquivos
candidatos e dois de QA, além de cinco suportes do renderer. `MANIFEST.json` e
`PACKAGE-HASHES.json` só existirão no pacote final depois da montagem bem-sucedida.
Não confundir autoria e revisão com restauração comprovada ou aceite de produção.

## Primeiros passos em outro computador

1. Clone a main atual e leia `docs/CONTINUIDADE.md`. Preserve as evidências antigas.
2. Crie um checkout separado da base exata; mantenha o clone atual para acessar
   este checkpoint. Os destinos abaixo devem estar livres. Exemplo no diretório
   pai dos projetos, após clonar como `predioON`:

```text
git -C predioON worktree add --detach ../predioON-base-mfa 53c4c70dcd24f1045fad420fbce36757fd3753a2
node --max-old-space-size=128 predioON/docs/continuidade/2026-11-05-mfa-integracao/finalize-checkpoint.mjs --base-checkout predioON-base-mfa --base-commit 53c4c70dcd24f1045fad420fbce36757fd3753a2 --output predioON-mfa-pacote
node --max-old-space-size=128 predioON-mfa-pacote/restore-checkpoint.mjs --base-checkout predioON-base-mfa --output predioON-mfa-candidato
```

3. Confira os recibos, manifesto e hashes; esses comandos apenas montam/copiam
   fontes. A montagem e a restauração precisam de nova execução observada antes
   de serem marcadas como aprovadas. Nesta máquina, conservar1536 MiB livres para
   essa preparação,4096 MiB antes de ligar o banco e1536 MiB após readiness.
4. Prepare as dependências usando o README da base e o lockfile. Não copie
   `node_modules`, junctions, credenciais ou IDs de containers de outro computador.
5. Priorize os tipos e11 casos de `platform-mfa-sql-envelopes.test.ts` V2, cujo
   SHA é `d6ad313a57a59afc226e544b908d9e097b0c35a4bc3bbab3784c7d97af672166`.
   Use banco UUID novo e o provisionamento oficial com seis conexões restritas;
   nunca seed/reset/migration em instalação existente. A V1 tinha um conflito de
   códigos de prédio detectado em revisão, não um RED funcional observado.
6. Feche os outros domínios, projeções/SSE, mutações sem correspondência, promoção
   durante desativação, expiração após lock e leitura após triggers. Depois rode
   as regressões, jornadas reais de navegador e apps antes de ativar a política.

O suporte renderer é receita nova revisada, **não executada**. Os quatro PASS
anteriores pertencem ao harness V6 original, não a esse preparador novo. Siga o
README de `qaSupport/renderer`; dependências precisam estar instaladas conforme
as versões e hashes indicados, separadas das dependências do produto.

A especificação abaixo descreve o pacote que os scripts devem gerar. Seus
resultados continuam pendentes até uma execução registrada.

---

# MFA administrativa — checkpoint canônico de 5 de novembro

Este pacote preserva uma implementação parcial candidata, não uma implantação.
Contém `MANIFEST.json`, `PACKAGE-HASHES.json`, payloads, restaurador, leitor de blobs
Git e suporte explícito de renderer. Não exige arquivos externos de autoria.

A base publicada é `53c4c70dcd24f1045fad420fbce36757fd3753a2`, depois da correção
estreita dos recovery codes e da publicação do helper de query e seus sete testes.
O manifesto contém 47 arquivos pendentes de implementação/testes, dois arquivos de
QA renderizada e cinco arquivos de suporte do renderer. O transporte já publicado
e os dois arquivos de query são dependências da base, não reaplicações do candidato.

## Restaurar em diretório novo

Use um repositório local que contenha o commit da base. Seu checkout pode estar em
outro commit: os arquivos vêm dos objetos Git da base, nunca dos arquivos atuais
do checkout. O destino deve ser inexistente, com pai existente, fora do repositório
e fora deste pacote:

```text
node --max-old-space-size=128 restore-checkpoint.mjs --base-checkout REPOSITORIO_COM_COMMIT --output NOVA_COPIA_EXTERNA
```

O restaurador verifica metadados, árvore/OIDs/modos do commit, SHA-256 dos blobs e
before/after dos candidatos. Copia os 994 arquivos versionados não pertencentes a
`docs/`, sobrepõe os candidatos e confere os hashes finais. Preserva o modo Git de
execução. Rejeita symlinks, submódulos, caminhos escapando da árvore e sobrescrita.
Não copia `.git`, `.env`, `node_modules`, junctions ou credenciais.

Os bytes da base são **canônicos do Git**, lidos por comprimento binário em
`cat-file --batch`. Não há substituição de CRLF/LF ou conversão de payload para
UTF-8. A auditoria encontrou 12 diferenças entre o checkout Windows e os blobs:
dez arquivos com EOL LF e dois scripts PowerShell com atributo EOL CRLF. Mesmo
nesses scripts, a cópia restaurada usa o blob Git LF; PowerShell aceita esse formato.
`observedRawSha256` é apenas diagnóstico e nunca condição para restaurar em Linux
ou outro checkout. Payloads candidatos mantêm seus bytes exatos, protegidos por
`.gitattributes` e hashes.

O comando restaura **somente fonte**. Não instala dependências, executa testes,
inicia aplicação/banco nem aplica migrações. A SQL 068 fica como arquivo candidato
na cópia isolada; usar o runner oficial UUID continua obrigatório para qualquer
execução futura. `MFA-RESTORE-RECEIPT.json` registra essa distinção.

## Conteúdo pendente e evidência

A composição inclui backend/contratos/contexto, consumidores V5, nove casos SQL/HTTP
dirigidos em dois arquivos, SQL V3 cumulativa, rotas HTTP V4 e complemento SQL de onze
casos com fixture V2. A SQL permanece uma fatia limitada, sem proteção global de todas
as mutações, consultas vazias e projeções de todos os domínios.

Os 19 testes puros V5 têm evidência própria. Tipos, banco, query e renderer possuem
registros separados por fonte; empacotar/restaurar não cria nem transfere PASS.
No complemento SQL V1, a revisão encontrou códigos de building duplicados. V2 altera
somente esse campo para um identificador único. O TSC PASS de V1 não valida V2, que
permanece sem prova de execução de banco até registro específico.

O painel candidato mantém o delta correto: before é a correção estreita publicada
`5baee6493cc152884fe7d9b175209833fa8ab8124b30f8b2cde9a63618513417`; after é V5,
com a cerimônia obrigatória. O êxito do browser da correção estreita não significa
conclusão de MFA administrativa obrigatória.

## Renderer recuperável, mas explícito

Os dois testes brutos ficam em `qa/render-v6/test/`, fora dos globs automáticos.
Leia `qaSupport/renderer/README.md` para reconstruir uma QA externa com versões,
imports, tsconfig, manifests de pacotes e React singleton conferidos. O preparador
reutiliza dependências instaladas, sem instalação ou execução automática. O scratch
`baseline-reproducer` de falha esperada e os launchers privados de banco não integram
o pacote.
