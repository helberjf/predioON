# Resultado: MFA nas três criações de estrutura

**Os 17 casos dirigidos e os 113 testes TAP de regressão passaram na fonte corrigida.** A verificação consolidada confirmou os resultados, a origem da fonte e a limpeza das três rodadas. A restauração portátil também conferiu os 1.035 arquivos. O total aceito nesta rodada é de **130 testes TAP: 120 casos independentes e 10 grupos agregadores**; não inclui as falhas esperadas do baseline nem resultados históricos de navegador.

As execuções funcionais ocorreram em **08/11/2026, entre 02:49 e 02:52 UTC**, correspondentes a **07/11/2026, entre 23:49 e 23:52 em America/Sao_Paulo**. A configuração de revisão registra a data local de 07/11; esta redação e a revisão final acontecem em 08/11 local. Os horários nativos e a configuração histórica foram preservados. O sufixo 20261107 identifica o lote, não muda o calendário dos registros nativos.

O root executou os tipos, os testes, a restauração e o verificador. Este documento foi revisado após leitura dos resultados, sem repetir testes ou alterar logs. Consulte a [prova consolidada](../../evidencias/mfa-tenancy-create-2026-11-07.json), o [recibo de restauração](../../evidencias/mfa-tenancy-create-restore-2026-11-07.json) e o [pacote portátil](README.md). O README congelado registra as expectativas anteriores à execução; este resultado o sucede quanto ao aceite funcional, sem alterar seus payloads ou hashes.

## Alteração e contrato preservado

O lote altera somente as três criações de estrutura:

- `POST /v1/tenancy/blocks`;
- `POST /v1/tenancy/units`;
- `POST /v1/tenancy/teams`.

A capacidade local original continua sendo exigida antes da escrita: `units:manage` para blocos/unidades e `teams:manage` para equipes. O novo INSERT depende da decisão MFA no mesmo statement, por uma CTE materializada. Um envelope escalar mantém a decisão observável mesmo quando o resultado da escrita é vazio; exige exatamente uma linha retornada. Um resultado inesperadamente vazio é erro interno com rollback, não um sucesso 201.

A auditoria continua depois da criação, com a mesma ação, ator, recurso e dados. A decisão MFA posterior à auditoria recusa alterações de fator/prova visíveis naquele momento e faz rollback da operação. Não foi acrescentada uma exigência tardia de capacidade local, nem mudado o conjunto de ações permitido ao usuário.

O HTTP preserva o DTO integral de criação: sete campos para blocks, nove para units e oito para teams. UUID, datas, trims, active e defaults continuam presentes. `metadata={}` pertence a units/teams, não a blocks. Units preserva omissão e null explícito em blockId e floor; `floor:null` já era aceito pelo schema original. O teste valida esse contrato, sem alterar o schema para acomodá-lo.

Nenhum outro handler, schema, migration, policy, ACL ou helper MFA compartilhado foi alterado neste lote. O único arquivo de produto diferente entre baseline e fixed é `apps/api/src/modules/tenancy/routes.ts`. O novo teste é byte a byte idêntico nos dois candidatos.

## Resultados observados

| Etapa | Resultado real | Escopo |
| --- | --- | --- |
| Preparação | Baseline e fixed concluídos | 1.035 arquivos por composição; somente o delta de rota distingue os candidatos; sem teste funcional nessa fase. |
| Resolução e tipos | Quatro fases aprovadas | Resolve + tipos em baseline e fixed, configuração exata de 31 testes e 13 fontes obrigatórias; nenhuma resolução indevida de fonte original fora de node_modules. Não são quatro suítes funcionais. |
| Baseline dirigido | **10 PASS / 7 FAIL esperados** | 17 casos independentes, uma suite, zero grupos agregadores. Sete respostas 201 onde o teste exige 403, com criação e auditoria verificadas antes da falha. |
| Candidato dirigido | **17 PASS** | Zero falhas, cancelamentos, skips ou todo; as mesmas assertivas e a mesma fixture do baseline. |
| Regressão serial | **113 PASS** | Oito arquivos, 103 casos independentes e 10 grupos agregadores, oito suites; zero falhas, cancelamentos, skips ou todo. |
| Verificação consolidada | **VERIFIED** | Pins, configuração, fonte, tipos, casos nomeados, diagnósticos RED, logs, filhos acompanhados e pós-checks conferidos. |
| Restauração portátil | **1.035 arquivos conferidos** | Composição restaurada em diretório novo; parent preservado e dois overlays verificados. Sem dependências, migrations, serviços ou testes na cópia restaurada. |

Os sete resultados negativos do baseline foram lidos integralmente pelo root e conferidos pelo verificador. Todos falham na comparação estrita `201 !== 403`, com `ERR_ASSERTION`, depois de oráculos positivos. Seis têm o diagnóstico exato de DTO integral, criação persistida e auditoria de ator/recurso/ação após a autorização real. O sétimo também comprova que o trigger estreito executou uma vez e removeu a prova da mesma família. Não foram aceitas como RED falhas de fixture, tipos, timeout, SQL, HTTP 500 ou somente contagens finais.

No candidato, os três casos de remoção de fator devolvem `MFA_ENROLLMENT_REQUIRED`. Os três de remoção da prova e o caso do trigger devolvem `MFA_VERIFICATION_REQUIRED`. A recusa exige ausência das novas linhas e auditorias, mantendo o snapshot de referência. O controle de criação permitido que antecede cada negativo permanece no banco e integra esse snapshot.

## MFA real e cobertura dirigida

Cada ator administrativo obrigado a MFA recebe login, enrollment e confirmação TOTP reais pela API, na mesma família/SID do bearer usado na operação. O teste confere dez códigos únicos, fator confirmado, geração correspondente e perfil satisfeito. Os gestores opcionais fazem login comum. A fixture negativa só remove fator ou prova: não insere nem restaura uma aprovação MFA por SQL.

A barreira delegada observa o resultado verdadeiro e autorizado do SELECT separado de `assertCapability`, com capacidade e prédio exatos. Ela executa a transação real com conexões restritas e não substitui a autorização por um mock. O matcher não trata uma CTE que contenha a função de capacidade como se fosse aquela autorização inicial.

A matriz dirigida tem 17 casos independentes:

| Grupo | Casos | O que foi observado |
| --- | ---: | --- |
| Perda de fator/prova após capacidade real | 6 | Três rotas vezes dois tipos de perda; recusa403 sem nova criação/auditoria no candidato. |
| Sucesso autorizado | 6 | Três rotas vezes gestor opcional e administrador satisfeito; DTO completo, defaults, datas, linha persistida e auditoria exata. |
| Contratos de escopo e entrada | 4 | Gestão local explícita, prédio estrangeiro, FK composta de units, nulls permitidos, duplicate409 de blocks/units, campos extras e tipos/limites inválidos. |
| Trigger estreito após auditoria de teams | 1 | Execução testemunhada e rollback da criação, auditoria e alteração da prova da própria família. |

O controle de permissões cobre gestor em prédio estrangeiro, usuário sem gestão e administrador global satisfeito sem vínculo local, nas três rotas. A condição global não fabrica gestão local. A FK de units rejeita bloco inexistente ou de outro prédio. Os conflitos de código de blocks/units conservam409 sem linha ou auditoria adicional. As datas do banco são normalizadas com Date→ISO, como o ORM, preservando o valor HTTP esperado.

O trigger pertence exclusivamente à fixture, com nome único, contexto restrito e EXECUTE público revogado. Seu predicado exige ator, prédio, ação TEAM_CREATED, tipo de recurso, SID e correspondência com a equipe criada. Uma sequence não transacional prova uma única execução, mesmo com rollback. Na fonte corrigida, a prova final deve ser exatamente igual à original: presença, geração e `mfa_verified_at::text`, incluindo os microssegundos. A limpeza remove trigger, função e sequence e compara o catálogo; não restaura a prova artificialmente.

## Regressão executada nesta composição

| Arquivo | TAP aprovados | Casos independentes | Grupos agregadores |
| --- | ---: | ---: | ---: |
| platform-mfa-tenancy-links | 12 | 10 | 2 |
| platform-mfa-tenancy-structure | 12 | 10 | 2 |
| tenancy-people | 9 | 9 | 0 |
| tenancy-http | 9 | 9 | 0 |
| tenancy-edit | 11 | 11 | 0 |
| membership-lifecycle | 4 | 4 | 0 |
| platform-mfa-tenancy-commands | 35 | 29 | 6 |
| platform-mfa-tenancy-revocations | 21 | 21 | 0 |
| **Regressão** | **113** | **103** | **10** |
| **Dirigido + regressão** | **130** | **120** | **10** |

Os oito arquivos foram executados serialmente na mesma composição fixed. A prova de tipos dessa fonte atende à regressão; não se alega uma terceira execução de tipos. Os grupos agregadores já estão incluídos na contagem TAP e não representam dez cenários independentes adicionais. As suites describe também não são somadas como testes.

## Horários, inicialização e limpeza

| Rodada | Início UTC do controller | Fim UTC do controller | Data/hora local aproximada |
| --- | --- | --- | --- |
| Baseline | 2026-11-08T02:49:14.844Z | 2026-11-08T02:49:39.168Z | 07/11, 23:49 |
| Fixed | 2026-11-08T02:49:54.987Z | 2026-11-08T02:50:17.517Z | 07/11, 23:49–23:50 |
| Regressão | 2026-11-08T02:50:38.206Z | 2026-11-08T02:52:19.172Z | 07/11, 23:50–23:52 |

O root relatou uma demora externa de aproximadamente 51 minutos antes da inicialização registrada do baseline; a causa não foi estabelecida. O launcher registra 02:49:10.3266518Z e o controller registra 02:49:14.844Z. Essa espera anterior não é o tempo TAP, não foi classificada como falha do produto e não motivou alteração dos logs ou repetição do ensaio. O TAP baseline registra 11.940,0443ms e o fixed 13.107,9637ms. Esses números descrevem esta execução e não constituem avaliação de desempenho. A finalização documental/verificação ocorreu mais tarde e não altera os timestamps dos testes.

Os três resultados nativos registram cleanup concluído, fonte inalterada e saída observada de todos os filhos diretos acompanhados pelo controller. Os pós-checks confirmam o identificador do cluster e a atestação do contêiner, zero tabelas públicas na base de referência, zero bancos temporários, outros bancos e clientes, seis roles restauradas com suas credenciais privadas e configurações restauradas. A memória livre inicial registrada foi 2850 MiB no baseline, 2932 MiB no fixed e 2960 MiB na regressão. Nenhuma credencial foi publicada e o computador não foi reiniciado.

A proteção de limpeza se refere aos processos registrados por esse controller e aos recursos da fixture; não é um censo universal de descendentes ou de outros projetos. Os logs nativos, inclusive as falhas esperadas do baseline, permanecem preservados.

## Limites e próximos trabalhos

Os 17 casos de criação não induzem espera real por row lock, promoção administrativa concorrente, perda de capacidade durante espera, corrida de constraints, INSERT sem linha retornada nem exceção genérica de trigger. O trigger pós-auditoria executado cobre somente teams; a mesma corrida não foi reproduzida em blocks/units. A revisão estática do envelope vazio não substitui um ensaio que force esse retorno.

Os testes de PATCHs e revogações incluídos na regressão conservam seus próprios limites. Eles não transferem automaticamente cobertura de lock, trigger ou autorrevogação aos POSTs. As decisões MFA são feitas por statement; não há promessa de serialização universal de usuário, fator e família até o commit.

Concessões de vínculos, membros de equipe, role bindings, convites e outros domínios permanecem para lotes próprios. Os cinco casos históricos de navegador em quatro specs continuam preservados, sem reexecução ou soma neste aceite. Não houve Playwright, Android/iOS, avaliação de desempenho, teste da API inteira ou validação de implantação neste lote. O resultado não declara o projeto inteiro pronto para produção.

## Pins e continuidade

- Parent preparado, 1.034 arquivos: `c2bb641f60ff44d847f4b34cf472cddcf235e0897c93659767eab514816a3c25`.
- Baseline preparado, 1.035 arquivos: `5c1cc7d59af253524f27b285d66f0b9b6d4059470035bb260573d333851e9b84`.
- Fixed preparado, 1.035 arquivos: `ce90003f2777c890195c814b6560f0ca26edb2989f1770a2c4aabea8939d54ff`.
- Rota before/after: `37754d794909989eff26550ebe1a7fc549c939795961fe44fea2cc005f75967e` → `3f0f4db1d92fdb8ed991d0e173d9aa82123f17b6376f137d7d543c60797b790b`.
- Teste comum: `d36843c3459083a096ffffe1d9ac323b9e13efe3151ec2bdb36d4709d03d29ab`.
- Inventário: `b0460d7681bced7618280fc3cda36b2b0df1837e74c3fdcf7b3cdea1fd41a898`.
- HEAD observado antes/depois nas três rodadas: `0f80326f47bf5da15d6a204da043bea018e6b815`.
- Log baseline: `af209f64133b678788ae52d94b7e34d41bf706f93a7bf0ad1d3c1931a2c7acdc`.
- Log fixed: `4788814719e6ee3ec84b7af72937643ce2dc9d7352f09215d3705f1a6c1c7b4c`.

A prova consolidada é `work/mfa-tenancy-create-root-verification-20261107.json`, SHA256 `6e5fe1f5e876ea07b60010ae0711873c986abe8cdd40a83466d792981ca69188`. O verificador congelado é `work/verify-tenancy-create-results-20261107.py`, SHA256 `dcaa7113a9347f32e890c2797ffeb249d731bb1faa5393841a39428aa8d2e6d2`; o root o executou com sua configuração revisada e obteve exit 0. A prova conserva os horários reais UTC, os sete motivos nomeados do RED, os hashes de entradas e o aceite 130/120/10.

Os artefatos de execução ficam em `work/mfa-tenancy-create-{baseline,fixed,fixed-regression}-qa-20261107`. A restauração está em `work/mfa-create-portable-restored-20261107`, com recibo `API-CREATE-RESTORE-RECEIPT.json`, SHA256 `243a44b8d87a3cb341f1ceb240885a479b8efaab049765d75d356117e0b8d3e7`. Ela conferiu os bytes dos 1.035 arquivos sem aplicar o pacote ao runtime principal. O status nativo do recibo continua `SOURCE_ONLY_NOT_TESTED_NOT_APPLIED` e não deve ser promovido a teste funcional da cópia.

Este documento e os artefatos associados preservam as evidências para continuidade. Para retomar, siga a cadeia de restauração no [README](README.md), em diretórios novos: checkpoint de 1.028 arquivos, V4, obrigatório por flag, vínculo global, revogações e este lote de criação. O runtime da main continua com migrations 001–067; a política obrigatória e a migration 068 permanecem candidatas, sem ativação parcial. A integração final é uma etapa pendente. Não foi herdado o alerta de wrapper do lote anterior: as preparações desta rodada terminaram uma vez, com seus resultados nativos aprovados.
