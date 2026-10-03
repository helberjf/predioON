# Continuidade do Prédio ON

Atualizado em **03/10/2026**, horário de São Paulo. Este é o ponto de retomada em outro computador ou outra sessão. **O plano completo ainda não terminou.** Resultados de uma versão não aprovam automaticamente mudanças posteriores.

Repositório: <https://github.com/helberjf/predioON>. Linha autorizada: `main`. As migrations publicadas terminam em **035**; o CI de plataforma e navegador de `ccda38c` foi aprovado. A **036** tem API/SQL/consumidor implementados localmente: **36/36 dirigidos, banco/restauração26/26, UI83/83, Playwright15/15 dirigidos e 189/189 na integral**. A publicação ainda aguarda a regressão completa da API com dependências completas. A rodada anterior terminou642/645: dois imports sem dependências e um stream além do prazo, sem aprovação integral. O snapshot Android foi publicado em `4bbe231`, com37 testes Windows/Linux; [ensaio nativo em andamento](https://github.com/helberjf/predioON/actions/runs/37097071872). iOS abriu/reabriu ambos os apps em `b4726b9`; jornadas autenticadas continuam pendentes. A **037** tem somente plano.

## 1. Instruções permanentes do proprietário

- Continuar até concluir as implementações dos apps e websites, testes e evolução descritos na arquitetura aprovada.
- Fazer commits pequenos no padrão Conventional Commits, por exemplo `fix:`, `feat:`, `test:` e `docs:`, com push frequente na `main` depois de cada incremento verificado.
- Executar testes de API/banco/ingestão/clientes, Playwright e testes nativos apropriados. Não desativar proteções nem enfraquecer asserções para conseguir aprovação.
- Reescrever a documentação completa ao concluir o produto; manter desde já este documento e o tracker atualizados.
- Manter sugestões em [MELHORIAS_E_EVOLUCOES.md](MELHORIAS_E_EVOLUCOES.md).
- **Não reiniciar o computador nesta sessão.** Nenhum reboot foi executado pelo agente. Reiniciar um processo de teste não é reiniciar o computador.
- Ao terminar, abrir os três portais e os apps Morador/Operação neste computador e entregar cinco gravações completas, separadas, com dados fictícios. Também foram solicitadas imagens de Android, iOS e web durante o andamento.
- **Incluir as imagens conferidas nos commits**, com origem e limites identificados. Desde03/10, as oito capturas e a galeria estão em [IMAGENS_DOS_SISTEMAS.md](IMAGENS_DOS_SISTEMAS.md), dentro do clone.

## 2. Estado das etapas

| Etapa da arquitetura | Estado | O que falta para encerrá-la |
| --- | --- | --- |
| 1. Contratos e cliente HTTP | Concluída no escopo original | Preservar regressões durante novas integrações. |
| 2. Identidade e RBAC | Parcial, com muitos domínios migrados | Concluir auditoria/administrativos legados e consumidores; MFA, convites, recuperação e demais fluxos de identidade. |
| 3. Processamento durável | Pendente | Inbox/outbox, consumidores separados, leases, retomada, deduplicação, dead letter e credenciais específicas. Nunca repetir atuação física automaticamente. |
| 4. Evolução dos domínios | Pendente para os novos módulos | Ativos, ordens de serviço, automações versionadas, planos/assinaturas e suporte com concessão explícita, com API/UI e testes. |
| 5. Apps Morador/Operação | Parcial | Corrigir a jornada Android de domínios, testar jornadas autenticadas iOS, integrar novos módulos/identidade/notificações e homologar em aparelhos. A inicialização iOS já passou. |
| 6. Implantação e operação | Parcial | Regressores finais verdes, operação durável, integrações externas, implantação real, documentação final e demonstrações. |

O código existente já oferece monitoramento, alertas, acessos, vagas, avisos, chamados, reservas e financeiro. Isso não significa que os novos módulos da etapa 4 nem o aceite final estejam concluídos. Ainda não é a fase de entrega final: identidade complementar, processamento durável e novos domínios representam trabalho substancial.

Documentos de referência: [arquitetura aprovada](superpowers/specs/2026-09-27-arquitetura-produto-design.md), [tracker completo](superpowers/plans/2026-09-27-product-execution.md), [sequência RBAC](superpowers/plans/2026-09-29-rbac-domain-migration.md) e [inventário das apresentações](superpowers/plans/2026-10-02-presentation-coverage.md). Entradas antigas desses documentos são históricas; o estado mais recente está aqui e nos planos específicos.

## 3. Entregas publicadas mais recentes

| Commit | Entrega |
| --- | --- |
| `ff3e528` | Estacionamento033 por condomínio/vaga/sensor, com contagem concorrente e permissão atual. |
| `fc5f53a` | Minhas sessões nos três portais, com revogação vinculada à geração da identidade. |
| `ccac601`, `ed21b67`, `6e82ce6` | Jornada Android de reservas; comentários aguardam confirmação; diálogo AndroidX reconhecido pelos elementos reais. |
| `1c80551` | Acesso físico034: leitura/gestão/pedido/histórico separados, revalidação antes do despacho, idempotência e nenhuma repetição automática. |
| `727264e` | Login035: limites persistentes compartilhados por conta/rede, segredo próprio, corpo limitado, falha fechada e proxy de produção restrito. |
| `cfd63af` | Verificador preliminar de AVD limpo. Ainda não incorpora cache aos testes autenticados. |
| `8e0be69` | Fixture de assinatura em produção compatível com a chave obrigatória de limite de login. |
| `bd52637` | Atualização de leitura web pendente passa a executar uma nova leitura ao terminar; job Playwright usa imagem oficial. |
| `42f2130` | Navegação móvel reconhece concessão de acesso por recurso; contrato HTTP real e CI. |
| `3e9c648` | Preparação de fixtures HTTP respeita429/Retry-After com limite de tentativas, sem mudar a política de produção. |
| `4c349b1` | Documento de continuidade e checkpoint portátil de 24 rascunhos, com restauração verificada. |
| `cde21f1` | Expectativas de equipamentos atualizadas para a autorização física034; 50 dirigidos aprovados. |
| `ac28caf` | CI iOS passa a abrir o build Release em simulador novo, verificar dois processos e preservar imagens. A primeira captura revelou configuração incompleta. |
| `5eda20e` | Identidades exclusivas por cenário Playwright, mantendo autenticação real e limitador; integral local de 153 combinações aprovada. |
| `7aed410`, `6d282a3`, `ab928a8` | OCR obrigatório do formulário iOS, runtime compatível e correções de assinatura. As falhas reais estão descritas abaixo; não constituem homologação. |
| `983b996` | Container de CI usa o proprietário correto do workspace. Os cenários Firefox passaram nas matrizes posteriores; falhas WebKit seguem separadas. |
| `aec9f41` | AccessPanel por recurso, confirmação explícita, conservação da intenção incerta e cancelamento por ciclo de vida; UI83/83 e Playwright21/21 aprovados. |
| `f6bf090` | Checkpoint portátil atualizado para 14 rascunhos, com restauração e hashes verificados. Os dez arquivos do AccessPanel já estão publicados. |
| `96b5f4b` | Preparação de cookies web respeita admissão de login, preservando resposta, cookies e corpo. Dirigidos21/21 e plataforma completa no CI aprovados, incluindo API633/633. |
| `b4726b9` | OCR iOS corresponde às telas reais de cada app; inicialização e novo processo aprovados nos dois produtos, com capturas conferidas. |
| `80c9798` | Playwright compila e testa os bundles dos três portais; matriz local174/174 e [CI174/174](https://github.com/helberjf/predioON/actions/runs/37024663752) aprovados, sem retries. |


## 4. Evidências e falhas conhecidas

| Verificação | Evidência e limite |
| --- | --- |
| Plataforma anterior033 | [CI c106a78](https://github.com/helberjf/predioON/actions/runs/36965837362): API570/570, banco26/26, ingestão68/68, cliente48/48, UI64/64, mobile51/51, tipos/builds/imagens aprovados. É histórico, não aprovação da fonte atual. |
| Acesso034 | API71/71, ingestão83/83 e outros46 dirigidos; permissões, corridas de locks, expiração, ACK e ausência de replay. |
| Login035 | 24 próprios, 29 dirigidos de autenticação e26 de banco/restauração. Restauração real verificou44 tabelas e35 migrations, RLS/ACL/helpers/dados. Proxy Caddy real também testado. |
| Integral Linux727264e | **602/615**, 13 falhas. Uma fixture de chave corrigida em8e0be69; duas expectativas antigas de equipment-capabilities corrigidas no checkpoint abaixo; duas faltas de dependência na cópia Linux corrigidas; oito429 de preparação de estacionamento tratados em3e9c648. Não somar dirigidos para declarar uma integral verde. |
| Após ajuste das fixtures | **3/3** próprios do helper e **60/60** dirigidos Linux de estacionamento/limites/monitoramento/lifecycle, sem skips; tipos API aprovados. |
| Equipamentos e acesso após correção das expectativas | **50/50** dirigidos Linux, sem skips, sobre a fonte publicada 4c349b1 mais o ajuste dos testes. A consulta mínima admite concessões atuais no dispositivo/gateway, nega administrador global sem concessão local e volta a negar após revogação. As provas de isolamento, validade e inventário privado foram preservadas. |
| Nova integral API035 | **632/632**, 50 suites, zero falhas/cancelamentos/skips, em Linux com PostgreSQL/Timescale real e ambas as flags de integração ativas. Fonte de API publicada em cde21f1, sem rascunhos036. Duração13min25s; log local work/api035-regression-final.log. Esse resultado substitui a integral anterior da API, mas não comprova ingestão, navegador ou alterações posteriores. |
| Mobile42f2130 | **59/59** unitários e **1/1** contrato real de navegação de portões; tipos e bundles dos dois apps aprovados. A descoberta básica exige buildings:read no mesmo recurso, além de gates:read; não foi criada concessão ampla implícita. |
| Playwright anterior publicado | [CI42f2130](https://github.com/helberjf/predioON/actions/runs/36975943741): **54/153**, 99 falhas. O log confirma429 na conta compartilhada admin de preparação. As fixtures foram corrigidas para identidades exclusivas por cenário, sem remover o limitador. |
| Playwright com identidades isoladas | **153/153** na matriz integral local Linux, três motores, sem retries, em 15min30s, após os 57/57 dirigidos. API/SQL até 035 e fixtures equivalentes a 5eda20e; AccessPanel posterior e 036 não incluídos. Log work/browser035-matrix.log. |
| Web AccessPanel publicado | **83/83** testes UI, tipos e builds dos três portais aprovados; **21/21** combinações Playwright reais, sem retries. Na rodada anterior 20/21 passaram; o teste restante segurava um poll antes do clique e desabilitava Salvar. A barreira agora começa na submissão real. Logs work/web-access-final.log e work/web-access-green.log. Não somar 153+21 como nova integral de 174. |
| Falhas anteriores do CI web | Em [983b996](https://github.com/helberjf/predioON/actions/runs/37007267359), **150/153** passaram: todos Chromium/Firefox e três falhas WebKit. Dois traces registraram `Network process crashed`; a terceira falha de logout não teve causa demonstrada. Em [aec9f41](https://github.com/helberjf/predioON/actions/runs/37009385219), **170/174**, com quatro falhas WebKit. Em [b4726b9](https://github.com/helberjf/predioON/actions/runs/37017848875), **172/174**: os dois traces WebKit de regras/sessões registram `Network process crashed`, consultas abortadas e perda da sessão. A configuração de80c9798 passou depois no CI completo. O histórico é preservado; um resultado verde não determina sozinho a causa interna desses crashes. |
| Matriz dos portais compilados | **174/174 localmente e 174/174 no [CI80c9798](https://github.com/helberjf/predioON/actions/runs/37024663752)**, 58 por motor, sem retries, um worker e API/PostgreSQL reais até035. Compila os três portais antes de servir por vite preview, verificando os bundles de produção sem HMR. Sem os rascunhos036. Duração local22min30s e CI9,7min; logs work/browser035-preview-all.log e work/browser-ci-80c9798.log; tipos da configuração aprovados. São duas execuções integrais próprias, sem somar resultados parciais. |
| Auditoria036 em validação | API completa pendente; última rodada642/645; banco26/26 com restore real de44 tabelas/36 migrations; UI83/83; Playwright15/15 e integral189/189 em26min, três motores, zero retries. Lote atual de auditoria/tenancy/lifecycle36/36, incluindo409 e rollback de mutação silenciosamente recusada. Perfis globais não recebem histórico privado implicitamente; metadata/IP/user-agent são negados. Logs locais work/audit036-api-complete-full.log, work/audit036-db-verified.log e work/audit036-web-full.log. |
| Android autenticado | Há percursos anteriores completos com19/21 fases por app; histórico e limites em scripts/android-auth-smoke/README.md. Não equivalem a homologar todos os domínios. |
| Android reservas42f2130 | [CI36975943695](https://github.com/helberjf/predioON/actions/runs/36975943695) aprovado, artefato11212879728 conferido: **23 fases**, criação/cancelamento/pedido pendente/retirada de calendário, provas no banco e buffer de crash vazio. Capturas de confirmação e revogação inspecionadas. Reserva estrangeira permaneceu intacta. |
| Android domínios | [CI42f2130](https://github.com/helberjf/predioON/actions/runs/36975943742), artefato11213644516 conferido: oito fases de Morador passaram e Operação não começou. Falhou ao localizar “Ver lançamentos (1)”. Imagens/XML mostram carregamento financeiro; o proxy recebeu respostas200 e o log do app contém MissingViewState do renderer. A causa ainda não está demonstrada; não classificar esta execução como ANR de launcher nem corrigir apenas aumentando espera sem investigar. |
| Builds nativos42f2130 | Android e [iOS](https://github.com/helberjf/predioON/actions/runs/36975943839) terminaram com sucesso. É evidência de compilação; não equivale a runtime homologado. |
| Runtime iOS | [b4726b9](https://github.com/helberjf/predioON/actions/runs/37017848643) **aprovado para Morador e Operação**, em iPhone16Pro/iOS18.5/Xcode16.4: instalação, primeira abertura, sobrevivência, OCR, encerramento e novo processo. Quatro imagens inspecionadas e hashes conferidos; simuladores descartáveis removidos. Artefatos Morador11232611156/Operação11232270958. Os erros anteriores de configuração, Keychain, assinatura e OCR estão registrados em [scripts/ios-smoke/README.md](../scripts/ios-smoke/README.md). A origem reservada smoke-api.invalid não autentica: login, API e jornadas continuam pendentes. |
| Plataforma CI | [96b5f4b](https://github.com/helberjf/predioON/actions/runs/37013422221) passou: **API633/633, banco26/26, ingestão83/83, cliente48/48, UI83/83 e mobile59/59**, dois contratos móveis reais, tipos, fronteiras, builds, imagens e proxy. Zero falhas/cancelamentos/skips. O CI de plataforma [b4726b9](https://github.com/helberjf/predioON/actions/runs/37017848487) também terminou aprovado. O ajuste da admissão dos cookies corrigiu as três falhas de preparação de983b996, sem mudar produção nem as negativas CSRF/429. Os21/21 dirigidos precederam essa integral; não substituíram a execução completa. |

## 5. Rascunhos recuperáveis

O [patch](continuidade/2026-10-02-em-andamento.patch) contém **20 arquivos** baseados em `4bbe231bc6613c9dc57ae9ace678986ab635a885`. O [manifesto](continuidade/2026-10-02-manifesto.json) registra SHA-256 do patch e de cada arquivo normalizado paraLF. A aplicação real sobre uma cópia Git limpa e os **20 hashes** foram conferidos. O snapshot AVD já está na main e saiu do patch; a recuperação inclui o novo consumidor, teste de restore e documentação em preparo.

O patch serve para revisão e continuidade; não é aprovação para implantação. Nesta máquina os rascunhos já estão aplicados: não reaplicar sobre a árvore local. Checkpoints antigos de14/24 arquivos são históricos e não devem ser aplicados sobre arquivos já publicados.

| Rascunho | Estado | Próximo passo |
| --- | --- | --- |
| Auditoria036 e consumidor | API, SQL, contrato, catálogo, revogação atômica, restore, AuditPanel, rotas e E2E. Dirigidos e matriz web aprovados; integral API ainda pendente. | Terminar a execução com dependências completas; investigar qualquer falha; publicar backend e consumidor em incrementos verificados. |
| Senha037 | Somente plano Markdown; nenhum endpoint ou SQL037 implementado. | Escrever RED e implementar confirmação atual/revogação atômica depois de036. |

## 6. Retomar em outro computador

Primeiro clone a main publicada. É possível trabalhar normalmente sem recuperar os rascunhos; para continuar exatamente esses incrementos, use a seção seguinte.

```powershell
git clone https://github.com/helberjf/predioON.git
cd predioON
git switch main
git pull --ff-only
git status --short
```

Leia este documento, a arquitetura e o tracker. Instale Node24 e pnpm**10.17.1**, Git e Docker Desktop/Compose. No Windows, WSL2 é necessário para o backend Linux do Docker. O navegador já autenticado não substitui a autenticação Git nessa nova máquina; use o fluxo normal do gerenciador de credenciais, sem registrar tokens em arquivos do repositório.

### Recuperar os rascunhos com verificação

Em clone limpo compatível com o checkpoint:

```powershell
Get-FileHash docs/continuidade/2026-10-02-em-andamento.patch -Algorithm SHA256
git apply --check docs/continuidade/2026-10-02-em-andamento.patch
git apply docs/continuidade/2026-10-02-em-andamento.patch
git diff --check
git status --short
```

SHA-256 esperado: `284a91ff2cc975ecdeb73e24c367522882200dd20bff993f1745b0acc7b4a2da`. Se a main avançou e `--check` falhar, não forçar, sobrescrever arquivos ou reaplicar trechos às cegas. Abra uma cópia de trabalho na base exata e aplique nela, preservando o clone atual:

```powershell
git worktree add --detach ../predioON-checkpoint 4bbe231bc6613c9dc57ae9ace678986ab635a885
git -C ../predioON-checkpoint apply --check ../predioON/docs/continuidade/2026-10-02-em-andamento.patch
git -C ../predioON-checkpoint apply ../predioON/docs/continuidade/2026-10-02-em-andamento.patch
```

Nesse segundo caminho, a fonte recuperada é para revisão/integração; publicar os incrementos verificados na main continua sendo a orientação do proprietário.

### Preparar ambiente descartável

```powershell
pnpm install --frozen-lockfile
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose version
pnpm setup:local
pnpm dev
```

`setup:local` é para **banco local novo e descartável**, pois inclui seed que redefine credenciais demonstrativas. Não usar seed/reset para atualizar banco real. A main aplica001–035; recuperar o patch acrescenta036 em revisão. Não iniciar código/schema036 sobre banco035. Conferir código, schema e ledger da mesma versão antes de iniciar os serviços.

Portas locais padrão: banco5434, API3000, administração5173, síndico5174, morador5175. O `.env.example` e [README](../README.md#instalação-local) contêm contas exclusivamente de demonstração. A API deve usar os três DSNs restritos; o DSN proprietário serve para migrations/fixtures/ingestão enquanto a separação desta última permanece pendente.

### Verificações a reproduzir

Executar integrações somente em banco descartável preparado conforme [MIGRATIONS.md](MIGRATIONS.md). `DATABASE_URL`, `DATABASE_URL_APP`, `DATABASE_URL_IDENTITY` e `DATABASE_URL_BROKER_AUTH` precisam apontar para o mesmo banco de teste. API/ingestão exigem as flags reais de integração:

```powershell
$env:RUN_ACCESS_DB_TESTS='1'
$env:RUN_RBAC_DB_TESTS='1'
pnpm typecheck
pnpm check:boundaries
pnpm test
pnpm build
$env:RUN_MOBILE_DB_TESTS='1'
pnpm --filter @predioon/mobile exec tsc --project test/tsconfig.integration.json
pnpm --filter @predioon/api exec tsx --test ../../packages/mobile/test/reservation-calendar.integration.mts
pnpm --filter @predioon/api exec tsx --test ../../packages/mobile/test/resident-access.integration.mts
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

Antes do Playwright, ajustar também o DSN proprietário usado pelas fixtures e seguir as restrições de `e2e/database-target.ts`. Ele aceita loopback local; no container de CI, apenas o serviço explicitamente autorizado. Para WebKit, esta máquina Windows teve DLL bloqueada pelo AppControl; usar o runnerLinux/imagem`mcr.microsoft.com/playwright:v1.63.0-noble`, sem desativar a proteção do sistema.

Banco/backup: seguir [BACKUP_E_RESTAURACAO.md](BACKUP_E_RESTAURACAO.md), incluindo restauração real, não apenas geração de arquivo. Workflows versionados explicam provisionamento, flags, SDKs e comandos exatos de cada plataforma. Não afirmar sucesso com testes ignorados ou somente typecheck.

## 7. Ordem prática para continuar

1. Conferir a main, o manifesto e o CI da versão exata; recuperar somente os rascunhos ainda não publicados.
2. Concluir a integral API036 no volume com dependências completas e banco5445; nenhuma soma de dirigidos substitui a integral. Depois publicar API/SQL e consumidor com os respectivos testes.
3. Conferir [o ensaio Android de snapshot](https://github.com/helberjf/predioON/actions/runs/37097071872). Os37 unitários Windows/Linux passaram; restauração real e posterior integração aos percursos ainda precisam de evidência. Não aceitar cache parcial, ANR/crash ou guardar estado autenticado.
4. Diagnosticar o carregamento financeiro Android e testar jornadas autenticadas iOS contra API real; inicialização iOS já passou nos dois apps.
5. Implementar identidade037 e demais itens2C/3/4/5/6: MFA/convites/recuperação, processamento durável, novos módulos, notificações e operação.
6. Manter API/banco/ingestão/clientes, Playwright e nativos aprovados a cada mudança. Preservar os traces de falhas, sem retries ou mutações repetidas para esconder problemas.
7. Concluir documentação integral, abertura dos cinco sistemas e cinco vídeos conforme o [inventário](superpowers/plans/2026-10-02-presentation-coverage.md). As imagens reais já estão versionadas; capturas isoladas não substituem as demonstrações finais.

## 8. O que não acompanha o clone

`.local`, `work`, toolchains, containers, volumes Docker, `.env`, tokens, keystores, artefatos nativos, evidências brutas e vídeos não ficam no Git. As **capturas conferidas agora são versionadas** em docs/imagens, conforme o pedido do proprietário; o [manifesto](imagens/2026-10-03/manifesto.json) identifica origem, dimensões e SHA-256. O patch de código contém somente código, testes, workflow e planos. Recriar bancos descartáveis pelos scripts; não é necessário transportar os volumes desta máquina.

Os artefatos de CI têm retenção curta (em geral 3–7 dias): baixar evidências importantes enquanto disponíveis e guardar fora do repositório. Nesta máquina os entregáveis ficam na pasta `outputs` ao lado do clone. A galeria contém **oito imagens reais**: três Android (Morador/avisos, Morador/reservas e Operação/resumo), três web (Administração, Síndico e Morador) e duas iOS (entrada de Morador/Operação). As imagens web usam a UI de5eda20e e banco fictício; Android contém os commits descritos na galeria; iOS corresponde ao novo processo de cada app em b4726b9. As oito imagens carregaram, filtros e ampliação passaram em Chromium sem erro de página. Nenhum dos cinco vídeos finais foi produzido.

O pacote local `outputs/PREDIO_ON_CONTINUIDADE.zip` reúne uma cópia deste documento, sugestões, instruções de backup, patch/manifesto e galeria com as capturas. Seus19 arquivos têm integridade conferida, incluindo os hashes iOS e do patch. A galeria extraída também passou nos testes sem servidor local. Para transportar o trabalho, salvar esse pacote fora desta máquina. Fonte publicada, rascunhos recuperáveis, galeria e imagens estão preservados no GitHub; o ZIP permanece fora do Git.

Credenciais de produção, certificados Apple/Android, FCM/APNs, domínio/TLS público e controladores físicos não foram configurados/homologados como parte do aceite atual. Essa lista não impede continuar implementando e testando localmente; define quais resultados não podem ser afirmados ainda.

## 9. Prompt sugerido para a próxima sessão

> Continue o Prédio ON pela main. Leia docs/CONTINUIDADE.md, arquitetura e tracker. Confira o commit, CI e patch/manifesto antes de recuperar os 20 arquivos em andamento. Auditoria036 e seu consumidor estão em validação: banco26/26 e Playwright189/189 aprovados; integral API ainda pendente. Não executar código036 sobre banco035. Snapshot Android4bbe231 tem37 unitários Windows/Linux; conferir restauração nativa antes da integração. Priorize concluir a validação corrente, Android de domínios, iOS autenticado e identidade; prossiga as demais etapas. Faça Conventional Commits e push na main após incrementos verificados. Inclua imagens conferidas com origem. Não reinicie o computador. O produto completo, documentação final, abertura dos cinco sistemas e cinco vídeos continuam pendentes.
