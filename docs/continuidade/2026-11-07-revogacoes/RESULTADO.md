# Resultado: MFA nos três comandos de revogação

Registro local de 07/11/2026, em America/Sao_Paulo. Os horários nativos dos dirigidos e da regressão são de **08/11/2026 em UTC**, entre 01:14 e 01:16; isso corresponde à noite de 07/11 em São Paulo. Os arquivos nativos preservam esses horários sem alteração.

**Os 21 casos dirigidos e os 92 testes TAP de regressão passaram na fonte corrigida; a verificação consolidada e a restauração dos 1.034 arquivos também foram concluídas.** O root executou e revisou as três rodadas, conferiu a configuração e executou o verificador. Este documento foi autorado em scratch a partir desses resultados, sem nova execução ou publicação pelo autor.

Consulte a [prova dos testes e da verificação consolidada](../../evidencias/mfa-tenancy-revocations-2026-11-07.json), a [prova de restauração](../../evidencias/mfa-tenancy-revocations-restore-2026-11-07.json) e as [instruções do pacote portátil](README.md).

## O que mudou

O lote cobre somente três rotas:

- `DELETE /v1/tenancy/unit-memberships/:id`;
- `DELETE /v1/tenancy/team-members/:id`;
- `DELETE /v1/tenancy/role-bindings/:id`.

As rotas revogam logicamente o vínculo, preservando seu histórico. A candidata acrescenta decisão MFA ao statement do lock, ao retorno sem correspondência, ao caminho idempotente e ao UPDATE. Uma decisão nova segue a espera possível pelo lock; outra segue a escrita e seus triggers. O resultado interno da operação não acrescenta campos ao HTTP: sucesso continua 204 vazio.

As policies de leitura e escrita continuam em vigor. O uso de `FOR UPDATE OF target` preserva a visibilidade da policy de UPDATE, em vez de transformar a revogação em uma consulta comum. A auditoria permanece antes de remover a concessão, permitindo revogar a própria gestão. Não há uma nova exigência de capacidade depois da autorrevogação legítima.

Não foram alterados os seis PATCHs de estrutura, GETs, POSTs, convites, migration 068, ACL ou helpers MFA compartilhados. O único arquivo de produto diferente entre baseline e fixed é `apps/api/src/modules/tenancy/routes.ts`; o teste novo é idêntico nos dois lados.

## Resultados reais disponíveis

| Etapa | Resultado | Escopo |
| --- | --- | --- |
| Resolução e tipos | Quatro fases aprovadas: resolve + tipos, em baseline e fixed | Configuração exata de 30 testes; 13 fontes exigidas resolvidas no candidato; nenhuma fonte original indevida fora de node_modules. Não são quatro suítes funcionais. |
| Baseline dirigido | **9 aprovados e 12 falhas esperadas**, 21 testes independentes, uma suite | Nove respostas 204 e três 404 onde a política nova exige 403. |
| Candidato dirigido | **21 aprovados**, zero falhas, cancelamentos, skips ou todo | Mesma fonte de teste, com operação real pela API e conexões restritas. |
| Regressão serial | **92 aprovados**, zero falhas, cancelamentos, skips ou todo | Sete arquivos; 82 casos independentes e 10 grupos agregadores. |
| Verificação consolidada | **Aprovada** | Pins, logs, casos nomeados, configuração, origem dos tipos, encerramento e restauração conferidos. |
| Restauração portátil | **Aprovada**, 1.034 arquivos | Composição restaurada em diretório novo, com o delta de rota e o teste comum preservados. |

O root leu as 12 falhas nativas do baseline. Houve seis diagnósticos `Baseline204` com revogação persistida e auditoria exata, três `Baseline204Noop` com linha completa intacta e nenhuma auditoria e três `Baseline404` com corpo de ausência idêntico ao controle, nenhuma linha e nenhuma auditoria. As falhas aconteceram na comparação estrita de status esperado 403, depois das barreiras e verificações de estado. Não foram classificadas como RED falhas de preparação, HTTP 500, timeout ou erros genéricos.

Cada ator administrativo dos negativos recebeu uma sessão real por login, enrollment e confirmação TOTP HTTP. A confirmação comprovou o fator na mesma família/SID do bearer utilizado. A fixture somente removeu fator ou prova depois da autorização observada; não inseriu nem restaurou aprovação MFA artificial. Os casos de perda do fator retornam `MFA_ENROLLMENT_REQUIRED`; os de perda da prova retornam `MFA_VERIFICATION_REQUIRED` na fonte corrigida.

Os controles preservaram sucesso e idempotência para gestor local com MFA opcional e administrador satisfeito, auditoria única, campos não alterados e autorrevogação direta e por equipe. Após perder a própria concessão, a operação seguinte deixa de ser permitida. O controle de leitor que consegue SELECT mas recebe 404 no DELETE cobre **apenas unit-memberships**. Escopo estrangeiro e UUID malformado cobrem as três rotas; binding global com prédio nulo permanece 404 no endpoint local de role-bindings.

Nos três processos coordenados — baseline, fixed e regressão — os resultados nativos registraram encerramento dos filhos diretos acompanhados, cleanup concluído e fonte idêntica após a execução. Os pós-checks confirmaram zero tabelas públicas na base, bancos temporários, outros bancos e clientes; seis roles, credenciais privadas e configurações foram restauradas. Não houve reinicialização do computador. O verificador confirmou esses registros e os hashes dos logs.

## Regressão executada

| Arquivo | TAP aprovados |
| --- | ---: |
| platform-mfa-tenancy-links | 12 |
| platform-mfa-tenancy-structure | 12 |
| tenancy-people | 9 |
| tenancy-http | 9 |
| tenancy-edit | 11 |
| membership-lifecycle | 4 |
| platform-mfa-tenancy-commands | 35 |
| **Total aprovado** | **92** |

O aceite conjunto desta rodada é de **113 testes TAP: 103 casos independentes e 10 grupos**. A contagem não inclui as falhas baseline nem resultados históricos de navegador. Os sete arquivos de regressão foram executados na mesma composição fixed; a sua tipagem reutiliza a prova dessa fonte, sem alegar uma terceira execução de tipos.

## Limites que permanecem

Os 21 casos deste dirigido **não induzem** espera real por row lock, promoção administrativa após o gate, perda de capacidade durante espera, triggers de auditoria/UPDATE ou UPDATE sem correspondência após a auditoria. Esses caminhos receberam desenho e revisão estática, mas continuam precisando de ensaio específico nos DELETEs. A barreira posterior à autorização não equivale a observação de bloqueio por `pg_blocking_pids`.

A candidata passa a recusar um UPDATE sem linha com 404 e rollback da auditoria, para evitar confirmação de um log sem revogação; este interleaving ainda não foi reproduzido neste lote. Os testes de lock/trigger dos PATCHs, incluídos na regressão, não transferem cobertura automaticamente aos DELETEs.

As decisões são por statement. Não há promessa de serialização universal de usuário, fator ou família até o commit, nem censo de todos os processos descendentes ou de outros projetos. Não houve avaliação de desempenho. Este lote não aprova todos os domínios MFA, a API inteira, browser, Android, iOS, implantação ou produção. A obrigatoriedade MFA permanece parte da integração em andamento.

## Fontes e preservação

- Parent preparado, 1.033 arquivos: `36e5b4a28d0c9b24d2b7420b9401366dad4d1842c7597238a84e283c958c902e`.
- Baseline preparado, 1.034 arquivos: `2457485be50acdc4fe2a13e6f42a0a0b03171da5839b31cc80804abd6af1b1a2`.
- Fixed preparado, 1.034 arquivos: `c2bb641f60ff44d847f4b34cf472cddcf235e0897c93659767eab514816a3c25`.
- Rota before/after: `4089f119bb6e38367a09c7b17abeb950120e4524d9c379c49ea689ea870ef7f4` → `37754d794909989eff26550ebe1a7fc549c939795961fe44fea2cc005f75967e`.
- Teste comum: `62f4d7b81bf9c97f78a08fe1694f0d5c47c8f243d98d411212713f465551bfed`.
- HEAD observado nos dois dirigidos e na regressão: `0a85a25a6d8a792509ea4bc1f6c11b88f4706e0b`.
- Log baseline: `e1df90ee8865b36b2844b17f0dcfe4625e90267525aa3d756e4d258b3f7fb4c7`; log fixed: `b5e8fa781f3dbd265b92a82839c6563d79dc3fc914288c05be33d1fa4b572ba0`.

Os artefatos nativos estão em `work/mfa-tenancy-revocation-{baseline,fixed,fixed-regression}-qa-20261107`. A verificação consolidada vigente é `work/mfa-tenancy-revocation-root-verification-v2-20261107.json`, SHA256 `bf2de3983d3cf5544d1cdf12ee515a46de539bb13a7c87a49f32b02244178503`. A V1 permanece preservada, SHA256 `6e5b7b110d291642656d78d2a946b871a68ff8404a3b86361d46a58fbc3b23e4`: a V2 corrigiu somente a descrição dos atores, deixando explícito que a cerimônia MFA se aplica aos atores com obrigação; os opcionais fizeram login comum. Não houve repetição de teste por essa correção editorial.

A composição foi restaurada em `work/mfa-revocation-portable-restored-20261107`, com recibo `API-REVOCATION-RESTORE-RECEIPT.json`, SHA256 `bbfd1336f7c445572d2e02ccce5af116fa8f760b8aec0ba8e2da505011f8871e`. Essa restauração conferiu os bytes dos 1.034 arquivos, sem instalar dependências, aplicar migrations, iniciar serviços ou repetir testes na cópia restaurada. Este MD resume os resultados e não substitui os arquivos de prova.

Corrigenda da contagem de navegador no README portátil preservado: são **cinco casos em quatro specs**, não quatro casos. São os três casos do V4, um de ADMIN por flag e um de ADMIN por binding global. As evidências anteriores permanecem separadas e preservadas; esses cinco casos não foram reexecutados neste lote da API nem somados aos 113 testes TAP acima. O payload e os checksums históricos continuam intactos.

A preparação também preservou `work/revocation-preparation-root-observation-20261107.json`: o wrapper PowerShell acusou um falso erro ao consultar LASTEXITCODE após Start-Process, embora o processo de preparação baseline tivesse exit 0. O root conferiu seu resultado nativo e preparou fixed separadamente. Nenhuma preparação foi repetida; esse alerta não foi falha de produto, RED de teste ou razão para reiniciar qualquer serviço.
