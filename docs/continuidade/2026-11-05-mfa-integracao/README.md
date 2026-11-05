# Retomada MFA — checkpoint candidato atualizado em 05/11/2026

**Checkpoint composto: desativação de MFA e eventos de funcionalidades.**
A base continua `53c4c70dcd24f1045fad420fbce36757fd3753a2`. O conjunto contém
1.013 arquivos compostos e cinco suportes; montagem/restauração aprovadas, com todos os hashes iguais aos da QA.
[Prova da composição restaurada](../../evidencias/mfa-merged-restore-2026-11-05.json).
A política obrigatória permanece candidata, sem ativação no runtime da main.

Na mesma composição passaram três processos separados: **SSE 7/7**, **desativação
5/5** e **complemento SQL 11/11**. Tipos dos três testes e imports também passaram.
[Prova, fontes, comparadores e limites](../../evidencias/mfa-feature-events-2026-11-05.json).
As restaurações anteriores permanecem [documentadas](../../evidencias/mfa-canonical-restore-2026-11-05.json).

## Conteúdo recuperável

O inventário tem 54 payloads. Dois são helper/teste de query já publicados e serão
excluídos do delta pelos hashes exatos. O pacote contém **50 arquivos de implementação
e testes candidatos**, dois testes explícitos de renderer e cinco suportes do renderer.
O transporte publicado também é dependência da base; não reaplicá-lo.

Esta composição integra a correção da desativação concorrente, seu teste de cinco
casos, o envelope SQL e o projector de `features-changed`, além dos sete novos casos.
O [checkpoint separado de desativação](../2026-11-05-mfa-disable/README.md) preserva
o antes/depois histórico; não reaplicar seu patch sobre esta composição.
O complemento SQL V5 conserva exatamente seu teste `2c8a7bc4…` e foi repetido
contra a SQL e a API compostas. Os demais consumidores mantêm seus bytes anteriores.

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
   conjunto composto inteiro foi reconstruído nesse computador.
4. Prepare dependências pelo README da base e pelo lockfile. Não copie env,
   credenciais, node_modules, junctions ou IDs de containers de outra máquina.
5. Tipos e testes devem usar a composição isolada e fixture oficial UUID nova,
   com owner somente no arranjo/provas e seis conexões de runtime restritas.
   Não executar seed/reset/migration em instalação existente. SQL 068 restaurada
   é somente fonte candidata; não deve ser aplicada à instalação publicada 067.
6. Conclua os demais domínios, SD/SSE, mutações sem correspondência,
   expiração/locks/triggers e regressões antes de ativar a política. Depois valide
   navegador real, builds e jornadas Android/iOS em aparelhos.

Conservar 1536 MiB para montagem/restauração, 4096 MiB antes de ligar o banco e 1536 MiB
após readiness/antes de cada processo. Não reduzir guards, fechar processos
desconhecidos ou reiniciar computador, Docker ou WSL. Os comandos de restauração
não instalam dependências, executam testes, iniciam serviços ou aplicam migrations.

## O que foi observado

O SSE real entregou um marcador global válido para a conta comum. Na mesma
conexão, o teste promoveu a conta a ADMIN depois da resolução de identidade e
antes do projector. A versão anterior retornou dados onde se esperava EOF;
a versão corrigida fechou sem emitir o evento. As seis outras falhas do comparador
eram o contrato SQL novo ausente, não seis falhas independentes de segurança.

Os sete casos corrigidos passaram em 4,742 s. Na composição final, os cinco casos
de desativação passaram em 5,378 s e os onze SQL em 4,819 s, em processos separados.
As duas versões passaram nos tipos: 10,160 s na anterior e 11,921 s na corrigida.
Cleanup conferiu seis roles/configurações/credenciais restauradas e zero bases ou
clientes temporários. O teste SSE global é real; os controles locais são SQL/projector.
Fatores e provas dos controles SQL são sintéticos, não cerimônias TOTP.

As unidades UI 143/143 e mobile 242/242 pertencem à rodada anterior, com os mesmos
bytes desses consumidores. As provas históricas mantêm suas fontes e não se somam
como uma suíte integral. O primeiro teste SSE tinha dois erros de tipagem TS7022;
foram corrigidas somente duas anotações, preservando expressões e assertivas.
A tentativa seguinte de preparação teve uma incompatibilidade no formato de
manifesto, corrigida no preparador antes de executar os testes. Ambos os registros
permanecem separados e não são falhas de produto.

Não houve nova integral da API, execução de navegador, build nativo ou aceite de
produção nesta fatia. Telemetria, alertas, equipamentos e heartbeat do SSE ainda
precisam de análise/integração própria, assim como os demais domínios e mutações.

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
