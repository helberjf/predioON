# Overlay portátil dos três DELETEs de vínculos

Pacote de fontes **ainda sem aceite de execução nesta autoria**. Contém somente
dois payloads: o candidato de `apps/api/src/modules/tenancy/routes.ts` e o teste
novo `apps/api/test/platform-mfa-tenancy-revocations.test.ts`. O alvo tem 1.034
arquivos. Root precisa confirmar os logs dirigidos, regressões e limpeza antes
de afirmar GREEN; uma restauração bem-sucedida não substitui esses resultados.

## Cadeia de restauração preservada

Restaure o checkpoint de 85 payloads/1.028 arquivos, aplique diretamente V4 para
1.031, o pacote obrigatório por flag para 1.032 e o pacote de vínculo global
para 1.033. Não aplicar V3 antes da V4. Só então aplique este overlay em pasta
**nova**, cujo pai já exista:

```text
node apply-revocations.mjs --candidate ../qa-global-binding-1033 --output ../api-revogacoes-1034
```

Parent: `36e5b4a28d0c9b24d2b7420b9401366dad4d1842c7597238a84e283c958c902e`.
Fixed alvo: `c2bb641f60ff44d847f4b34cf472cddcf235e0897c93659767eab514816a3c25`.
Os hashes identificam inventários de fonte, não caminhos de máquina. O core85,
os quatro casos de browser anteriores, seus configs e todos os pacotes já
publicados ficam intactos. Nunca sobrescrever o core antigo: os overlays
intermediários dependem exatamente do seu inventário.

O aplicador verifica o pacote, todos os 1.033 arquivos do parent e os dois
payloads antes de escrever. Copia somente o inventário, aplica routes e o teste,
compara os 1.034 arquivos finais e confere novamente o parent. Emite
`API-REVOCATION-RESTORE-RECEIPT.json`. O teste novo usa beforeSha256/beforeBytes
null no esquema portátil; sua origem new-test-v1 não possuía arquivo anterior.

Não há sobrescrita, instalação, execução de testes, migrations ou serviços.
Não são copiados dotenv, node_modules, dist, caches, mídia, receipts anteriores
ou os cinco suportes separados do checkpoint inicial. MANIFEST.json contém
somente caminhos relativos, hashes e tamanhos. Dependências, configuração de
tipos e executors de banco são etapas separadas, não estão incluídos no pacote.

## Mudança candidata e contrato

O escopo é exclusivamente DELETE `/v1/tenancy/unit-memberships/:id`,
`/v1/tenancy/team-members/:id` e `/v1/tenancy/role-bindings/:id`.
O arquivo antes4089 é o mesmo na fonte mandatory em que o produto foi autorado
e no parent global-binding. O alvo37754 acrescenta decisões MFA ligadas à
busca com lock e à escrita/resposta, incluindo UUID válido ausente e alvo já
inativo. Preserva RLS de UPDATE/delegação, sucesso204 vazio, ordem da auditoria
e autorrevogação legítima sem exigir gestão depois do próprio efeito.

Os seis PATCHs anteriores, outros handlers, helpers compartilhados e SQL068
permanecem iguais. UUID malformado conserva seu404 anterior à transação.
As decisões são por statement; não se afirma serialização universal de fator,
família ou mudanças externas até o commit. A validade dos caminhos concorrentes
nunca deve ser deduzida apenas de tipos ou revisão estática.

## Teste comum e próximos resultados

O mesmo novo teste está nas árvores baseline e fixed. Plano finito: **21 casos
independentes**, uma suite describe, zero grupos pais. Expectativa estática de
baseline9PASS/12FAIL e fixed21PASS; esses números não são resultados do pacote.
Os REDs exigem6 diagnósticos Baseline204 com efeitos/auditoria comprovados,
3 Baseline204Noop sem efeitos e3 Baseline404 com corpo missing conferido.
HTTP500, timeout, falha de fixture ou antes da barreira não contam como RED.

Cada ator administrativo estabelece MFA real via login, enrollment e TOTP no
mesmo bearer/SID. A fixture owner remove fator/prova somente depois da barreira
para simular a mudança; não fabrica aprovação. Cobrem-se os três endpoints,
ausência/no-op, gestor opcional, administrador satisfeito, autorrevogação direta
e por equipe e escopo estrangeiro. O controle de SELECT permitido versus DELETE
oculto por RLS cobre somente unit-memberships.

Não são ensaiados por esse dirigido espera real de row lock, promoção pós-gate,
perda de capacidade durante espera, triggers de auditoria/UPDATE ou corrida de
UPDATEzero. Não atribuir esses aceites ao teste ou ao desenho candidato.

A regressão aprovada para execução separada tem sete arquivos seriais: os seis
tenancy anteriores57TAP e o teste dos seis PATCHs35TAP. Previsão92TAP,82 casos
independentes e10 grupos. Tipos selecionam30 testes e13 fontes. Root deve citar
as execuções e classificações reais, sem somar provas históricas indevidamente.

## Operação de QA

Instale/resolva dependências conforme o lockfile em etapa própria; os pacotes
de workspace precisam apontar ao src desta nova árvore, sem dist ou links
de checkout antigo. Tipos e testes API usam seu config/runner próprio, sem
executar os configs de navegador herdados no inventário.

Os ensaios usam a fixture oficial runtime-services, banco UUID descartável,
roles restritas, cluster owned já ligado e guard de 1.536 MiB livres. Owner
pertence ao setup/interleaving/inspeção, não às operações HTTP. Manter e-mail
desligado e segredos fora de logs. Não iniciar ou reiniciar computador, Docker
ou WSL durante a sessão. Preservar tentativas anteriores.

Se algum filho direto registrado não tiver saída observada, segurar cleanup
do banco/roles e registrar os IDs próprios para inspeção; não forçar DROP ou
terminar processos desconhecidos. Após encerramento confirmado, conferir
base removida, seis roles/settings restaurados e fontes preservadas.

Este pacote não revalida Playwright, Android/iOS, desempenho ou operação.
Nenhuma mídia é incluída. Runtime main001–067 e política068 ainda candidata;
integração final e produção continuam pendentes. O autor não executou este
aplicador, restauração, Node, tipos, testes, banco ou serviços.
