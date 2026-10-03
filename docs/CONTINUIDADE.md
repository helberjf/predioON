# Continuidade do Prédio ON

Atualizado em **03/10/2026**, horário de São Paulo. Este é o ponto de retomada em outro computador ou outra sessão. **O plano completo ainda não terminou.** Resultados de uma versão não aprovam automaticamente mudanças posteriores.

Repositório: <https://github.com/helberjf/predioON>. Linha autorizada: `main`. Último incremento de código publicado: **8408a5d**, espera financeira Android com conteúdo efetivamente renderizado, 21/21 testes Linux/TLS e 20 aprovados +1 skip OpenSSL no Windows; autenticação8/8 e harness comum39/39 Linux. Não é correção nativa de MissingViewState.

A fonte publicada **cacbd9d** passou no CI completo: API658, banco26, cliente48, ingestão83, UI83, mobile59, dois contratos móveis1/1 e Playwright189/189, sem skips ou retries. As dez imagens reais continuam versionadas. O novo incremento **senha037** está implementado em rascunhos de API/cliente/web/mobile e em revisão independente; **não está aprovado nem publicado como produto**. Há **30 arquivos recuperáveis** no checkpoint descrito abaixo. As migrations de produto publicadas ainda terminam em036. Android continua com falhas nativas conhecidas e iOS com jornadas autenticadas pendentes.

## 1. Instruções permanentes do proprietário

- Continuar até concluir as implementações dos apps e websites, testes e evolução descritos na arquitetura aprovada.
- Fazer commits pequenos no padrão Conventional Commits, por exemplo `fix:`, `feat:`, `test:` e `docs:`, com push frequente na `main` depois de cada incremento verificado.
- Executar testes de API/banco/ingestão/clientes, Playwright e testes nativos apropriados. Não desativar proteções nem enfraquecer asserções para conseguir aprovação.
- Reescrever a documentação completa ao concluir o produto; manter desde já este documento e o tracker atualizados.
- Manter sugestões em [MELHORIAS_E_EVOLUCOES.md](MELHORIAS_E_EVOLUCOES.md).
- **Não reiniciar o computador nesta sessão.** Nenhum reboot foi executado pelo agente. Reiniciar um processo de teste não é reiniciar o computador.
- Ao terminar, abrir os três portais e os apps Morador/Operação neste computador e entregar cinco gravações completas, separadas, com dados fictícios. Também foram solicitadas imagens de Android, iOS e web durante o andamento.
- **Incluir as imagens conferidas nos commits**, com origem e limites identificados. Desde 03/10, as dez capturas e a galeria estão em [IMAGENS_DOS_SISTEMAS.md](IMAGENS_DOS_SISTEMAS.md), dentro do clone.

## 2. Estado das etapas

| Etapa da arquitetura | Estado | O que falta para encerrá-la |
| --- | --- | --- |
| 1. Contratos e cliente HTTP | Concluída no escopo original | Preservar regressões durante novas integrações. |
| 2. Identidade e RBAC | Parcial; auditoria036 concluída neste recorte | Concluir administrativos legados e consumidores restantes; concluir/revisar senha037 em rascunho, MFA, convites, recuperação e demais fluxos de identidade. |
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

| `ccda38c` | Oito imagens reais e galeria versionadas, com origem/hashes; CI de plataforma e navegador aprovado. |
| `4bbe231` | Verificador de snapshot Android em dois runners;37 unitários Windows/Linux e YAML conferidos, ensaio nativo em verificação. |
| `187521a` | Auditoria036 por capacidade, escopo imutável e DTO mínimo; revogação com confirmação de alteração e restore real. |
| `c2871f0` | Histórico comum nos dois portais, paginação/retry e descarte por identidade/tenant; matriz189 aprovada. |
| `b68e8e5` | Duas capturas reais de auditoria adicionadas à galeria e aos commits. |
| `3f9e064`, `db5dcbc` | Identidade ADB explícita, diagnóstico de configuração e API validada no ini do AVD;39 unitários Windows/Linux. Ensaio nativo ainda falha com ANR. |
| `17f9e47` | AtorUSER sem identificação deixa de aparecer como Sistema;15 dirigidos Playwright e tipos UI/E2E aprovados. |

| `8408a5d` | Espera financeira Android exige título publicado e botão nativo visível; repete observações incompletas e mantém privacidade/credenciais/crash/ADB terminais. 21 testes Linux/TLS, 20+1 skip Windows. |

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
| Auditoria036 publicada | API658/658 em integral própria; banco26/26 com restore real de44 tabelas/36 migrations; UI83/83; Playwright15/15 e integral189/189 em26min, três motores, zero retries. Lote atual de auditoria/tenancy/lifecycle36/36, incluindo409 e rollback de mutação silenciosamente recusada. Perfis globais não recebem histórico privado implicitamente; metadata/IP/user-agent são negados. Logs locais work/audit036-api-complete-full.log, work/audit036-db-verified.log e work/audit036-web-full.log. |
| Android autenticado | Há percursos anteriores completos com19/21 fases por app; histórico e limites em scripts/android-auth-smoke/README.md. Não equivalem a homologar todos os domínios. |
| Android reservas42f2130 | [CI36975943695](https://github.com/helberjf/predioON/actions/runs/36975943695) aprovado, artefato11212879728 conferido: **23 fases**, criação/cancelamento/pedido pendente/retirada de calendário, provas no banco e buffer de crash vazio. Capturas de confirmação e revogação inspecionadas. Reserva estrangeira permaneceu intacta. |
| Android domínios | [CI42f2130](https://github.com/helberjf/predioON/actions/runs/36975943742), artefato11213644516 conferido: oito fases de Morador passaram e Operação não começou. Falhou ao localizar “Ver lançamentos (1)”. Imagens/XML mostram carregamento financeiro; o proxy recebeu respostas200 e o log do app contém MissingViewState do renderer. A causa ainda não está demonstrada; não classificar esta execução como ANR de launcher nem corrigir apenas aumentando espera sem investigar. |
| Builds nativos42f2130 | Android e [iOS](https://github.com/helberjf/predioON/actions/runs/36975943839) terminaram com sucesso. É evidência de compilação; não equivale a runtime homologado. |
| Runtime iOS | [b4726b9](https://github.com/helberjf/predioON/actions/runs/37017848643) **aprovado para Morador e Operação**, em iPhone16Pro/iOS18.5/Xcode16.4: instalação, primeira abertura, sobrevivência, OCR, encerramento e novo processo. Quatro imagens inspecionadas e hashes conferidos; simuladores descartáveis removidos. Artefatos Morador11232611156/Operação11232270958. Os erros anteriores de configuração, Keychain, assinatura e OCR estão registrados em [scripts/ios-smoke/README.md](../scripts/ios-smoke/README.md). A origem reservada smoke-api.invalid não autentica: login, API e jornadas continuam pendentes. |
| Plataforma CI | [96b5f4b](https://github.com/helberjf/predioON/actions/runs/37013422221) passou: **API633/633, banco26/26, ingestão83/83, cliente48/48, UI83/83 e mobile59/59**, dois contratos móveis reais, tipos, fronteiras, builds, imagens e proxy. Zero falhas/cancelamentos/skips. O CI de plataforma [b4726b9](https://github.com/helberjf/predioON/actions/runs/37017848487) também terminou aprovado. O ajuste da admissão dos cookies corrigiu as três falhas de preparação de983b996, sem mudar produção nem as negativas CSRF/429. Os21/21 dirigidos precederam essa integral; não substituíram a execução completa. |

O CI da fonte **cacbd9d** foi conferido em 03/10: [plataforma37099724611](https://github.com/helberjf/predioON/actions/runs/37099724611) aprovada com API658/658, banco26/26, cliente48/48, ingestão83/83, UI83/83, mobile59/59 e dois contratos1/1; tipos/builds/imagens/proxy aprovados. O [navegador37099724651](https://github.com/helberjf/predioON/actions/runs/37099724651) passou **189/189 em6,8min**, sem retries. Essa integral inclui o rótulo17f9e47, mas não os rascunhos037. Logs locais work/platform-cacb-ci.log e work/browser-cacb-ci.log.

O [ensaio de snapshot db5dcbc](https://github.com/helberjf/predioON/actions/runs/37098757001) falhou com ANR do Pixel Launcher antes de instalar qualquer app; o job de restauração foi pulado e nenhum cache foi salvo. Os dois ensaios anteriores também falharam; identidade ADB e alvo do config.ini foram corrigidos com RED/39 testes Windows/Linux, mas não resolvem por si a saúde do Android. Evidências locais: work/android-avd-first-evidence, second-evidence e third-evidence; detalhes em scripts/android-smoke/README.md. Não foi afirmada causa comum com a falha financeira dos apps. A correção de rótulo17f9e47 passou15/15 dirigidos, depois da integral189 do consumidorc2871f0; a fonte posterior exige essa distinção.

## 5. Rascunhos recuperáveis

O [patch](continuidade/2026-10-02-em-andamento.patch) contém **30 arquivos** capturados sobre **8408a5dcdcc87e97ddb39e4fa71051fa621483c0**. O [manifesto](continuidade/2026-10-02-manifesto.json) registra os caminhos exatos, SHA-256 e hashes de conteúdo normalizado para LF. A aplicação real sobre uma cópia limpa dessa base e os 30 hashes foram conferidos. SHA-256 do patch: **3ab1474251eb5a0247d98f82d774248b7e799d1a69a6bf6d93ce58e2e71678c9**.

Esse checkpoint é uma fotografia **EM REVISÃO**, não uma release. Os rascunhos já existem nesta máquina e podem avançar depois da captura; não reaplicar o patch sobre eles. Checkpoints anteriores de1/14/20/24 arquivos são históricos e não devem ser aplicados sobre código já publicado. A tentativa removeClippedSubviews=false foi retirada após revisão indicar provável ausência de efeito; não está neste patch. O harness financeiro já publicado em8408a5d também não está no patch.

| Grupo de rascunhos | Estado na captura | Próximo aceite |
| --- | --- | --- |
| API/SQL037/contratos | Troca própria de senha, locks conta→família→geração, confirmação da senha atual e revogação de famílias; dirigidos iniciais executados. Revisão encontrou gaps de trigger, refresh e Unicode, ainda em correção. | RED/GREEN dos achados, revisão independente, regressão integral API e restauração037 antes de publicar. |
| Cliente HTTP | Fachadas native/web para troca de senha; dirigidos executados. Falha de limpeza de storage após204 ainda em revisão. | Confirmação204, geração da identidade, falha de rede sem repetir mutação e descarte de resposta antiga; preservar bloqueio local após revogação. |
| Web | Formulário comum em Minhas sessões dos três portais; UI89/89 e tipos dirigidos; 24 casos Playwright preparados. | Executar browsers com API/PostgreSQL reais, integral posterior e conferir capturas da versão publicada. |
| Apps RN | Minha conta nos dois apps; controlador/lifecycle, UI protegida; mobile71/71, tipos e quatro bundles Android/iOS. | Jornada nativa Android e inspeção de imagens; runtime/autenticação iOS continuam pendentes. |
| Android senha | Workflow e roteiro separados, allowlist mínima e prova de revogação/isolamento; Python9/9 Linux/TLS. Revisão do fluxo ainda em andamento. | Corrigir achados, executar ambos APKs contra API real e conferir banco/logs/capturas, sem declarar bundles como runtime. |
| Plano037 | Plano Markdown preservado junto do código em construção. | Atualizar para a implementação final e seus resultados; MFA/convites/recuperação permanecem outros recortes. |

Os números dirigidos acima identificam o estado do trabalho, não aprovam a fonte final nem substituem integrais. Novas alterações requerem seus próprios resultados. Logs de trabalho e bancos não acompanham o patch.

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

SHA-256 esperado: `3ab1474251eb5a0247d98f82d774248b7e799d1a69a6bf6d93ce58e2e71678c9`. Se a main avançou e `--check` falhar, não forçar, sobrescrever arquivos ou reaplicar trechos às cegas. Abra uma cópia de trabalho na base exata e aplique nela, preservando o clone atual:

```powershell
git worktree add --detach ../predioON-checkpoint 8408a5dcdcc87e97ddb39e4fa71051fa621483c0
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

`setup:local` é para **banco local novo e descartável**, pois inclui seed que redefine credenciais demonstrativas. Não usar seed/reset para atualizar banco real. A main aplica001–036. O patch acrescenta037 **em revisão**, para banco descartável e testes; não aplicar em banco real antes do aceite do incremento. Conferir código, schema e ledger da mesma versão antes de iniciar os serviços.

Portas locais padrão: banco5434, API3000, administração5173, síndico5174, morador5175. O `.env.example` e [README](../README.md#instalação-local) contêm contas exclusivamente de demonstração. A API deve usar os três DSNs restritos; o DSN proprietário serve para migrations/fixtures/ingestão enquanto a separação desta última permanece pendente.

### Verificações a reproduzir

Executar integrações somente em banco descartável preparado conforme [MIGRATIONS.md](MIGRATIONS.md). `DATABASE_URL`, `DATABASE_URL_APP`, `DATABASE_URL_IDENTITY` e `DATABASE_URL_BROKER_AUTH` precisam apontar para o mesmo banco de teste. API/ingestão exigem as flags reais de integração:

```powershell
$env:NODE_ENV='test'
$env:RUN_ACCESS_DB_TESTS='1'
$env:RUN_RBAC_DB_TESTS='1'
$env:TEST_MIGRATIONS_DATABASE_URL=$env:DATABASE_URL
$env:TEST_BACKUP_CONTAINER=(docker compose -f infrastructure/docker-compose.yml ps -q db)
pnpm --filter @predioon/db exec node --import tsx --test --test-concurrency=1 test/*.test.ts
pnpm typecheck
pnpm check:boundaries
pnpm test
pnpm build
$env:RUN_MOBILE_DB_TESTS='1'
$env:TZ='America/Sao_Paulo'
pnpm --filter @predioon/mobile exec tsc --project test/tsconfig.integration.json
pnpm --filter @predioon/api exec tsx --test ../../packages/mobile/test/reservation-calendar.integration.mts
pnpm --filter @predioon/api exec tsx --test ../../packages/mobile/test/resident-access.integration.mts
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

**Encerre pnpm dev antes de iniciar Playwright:** a configuração exige servidores próprios, portas estritas e reuseExistingServer:false. A suíte de banco acima é separada: pnpm test não inclui @predioon/db.

Antes do Playwright, ajustar também o DSN proprietário usado pelas fixtures e seguir as restrições de `e2e/database-target.ts`. Ele aceita loopback local; no container de CI, apenas o serviço explicitamente autorizado. Para WebKit, esta máquina Windows teve DLL bloqueada pelo AppControl; usar o runnerLinux/imagem`mcr.microsoft.com/playwright:v1.63.0-noble`, sem desativar a proteção do sistema.

Banco/backup: seguir [BACKUP_E_RESTAURACAO.md](BACKUP_E_RESTAURACAO.md), incluindo restauração real, não apenas geração de arquivo. Workflows versionados explicam provisionamento, flags, SDKs e comandos exatos de cada plataforma. Não afirmar sucesso com testes ignorados ou somente typecheck.

## 7. Ordem prática para continuar

1. Conferir a main, o manifesto e o CI da versão exata; recuperar somente os rascunhos ainda não publicados.
2. Preservar a auditoria036 e os regressores atuais: API658, banco26 e matriz web189.
3. Investigar [o ANR do Pixel Launcher no ensaio Android](https://github.com/helberjf/predioON/actions/runs/37098757001), anterior à instalação de qualquer app. Os39 unitários Windows/Linux passaram; correções de identidade ADB e formato de configuração foram feitas, mas o cache/restauração real ainda não passaram nem foram integrados às jornadas. Não ignorar ANR/crash nem salvar estado autenticado.
4. Diagnosticar o carregamento financeiro Android e testar jornadas autenticadas iOS contra API real; inicialização iOS já passou nos dois apps.
5. Concluir/revisar os rascunhos037 de API/web/mobile e a jornada Android; depois continuar demais itens2C/3/4/5/6: MFA/convites/recuperação, processamento durável, novos módulos, notificações e operação.
6. Manter API/banco/ingestão/clientes, Playwright e nativos aprovados a cada mudança. Preservar os traces de falhas, sem retries ou mutações repetidas para esconder problemas.
7. Concluir documentação integral, abertura dos cinco sistemas e cinco vídeos conforme o [inventário](superpowers/plans/2026-10-02-presentation-coverage.md). As imagens reais já estão versionadas; capturas isoladas não substituem as demonstrações finais.

## 8. O que não acompanha o clone

`.local`, `work`, toolchains, containers, volumes Docker, `.env`, tokens, keystores, artefatos nativos, evidências brutas e vídeos não ficam no Git. As **capturas conferidas agora são versionadas** em docs/imagens, conforme o pedido do proprietário; o [manifesto](imagens/2026-10-03/manifesto.json) identifica origem, dimensões e SHA-256. O patch de código contém somente código, testes, workflow e planos. Recriar bancos descartáveis pelos scripts; não é necessário transportar os volumes desta máquina.

Os artefatos de CI têm retenção curta (em geral 3–7 dias): baixar evidências importantes enquanto disponíveis e guardar fora do repositório. Nesta máquina os entregáveis ficam em `outputs` ao lado do clone. A galeria contém **dez imagens reais**: três Android, cinco web e duas iOS. Os três dashboards web são de5eda20e; as duas capturas de auditoria correspondem aos16 arquivos testados e publicados emc2871f0, conferidos contra esse commit com normalização LF. As imagens nativas conservam as versões/origens descritas no manifesto. As dez imagens, filtros e ampliação passaram em Chromium sem erro de página. Nenhum dos cinco vídeos finais foi produzido.

O pacote local `outputs/PREDIO_ON_CONTINUIDADE.zip` reúne MDs, patch/manifesto, galeria e dez capturas. Seus22 arquivos têm integridade conferida, incluindo hashes das imagens e do patch. A galeria extraída também é verificada sem servidor local. Para transportar o trabalho, salvar esse pacote fora desta máquina. Fonte publicada, checkpoint de30 rascunhos, galeria e imagens estão no GitHub; ZIP, banco e evidências brutas permanecem fora do Git.

Credenciais de produção, certificados Apple/Android, FCM/APNs, domínio/TLS público e controladores físicos não foram configurados/homologados como parte do aceite atual. Essa lista não impede continuar implementando e testando localmente; define quais resultados não podem ser afirmados ainda.

## 9. Prompt sugerido para a próxima sessão

> Continue o Prédio ON pela main. Leia docs/CONTINUIDADE.md, arquitetura e tracker. O checkpoint preserva 30 arquivos037 EM REVISÃO sobre 8408a5dcdcc87e97ddb39e4fa71051fa621483c0; confirme SHA/aplicação antes de recuperar. Fonte cacbd9d passou CI API658/banco26/Playwright189, e8408a5d publicou harness financeiro21Linux/TLS. Código037 API/cliente/web/mobile e jornadaAndroid precisam fechar os achados de revisão, executar integrais reais e runtime nativo antes de publicar. Há dez imagens versionadas. Android conserva falhas de launcher/Fabric; iOS autenticado está pendente. Faça Conventional Commits e push main por incremento verificado, incluindo imagens conferidas. Não reinicie o computador. MFA/convites/recuperação, processamento durável, novos módulos, operação, documentação final, abertura dos cinco sistemas e cinco vídeos ainda precisam ser concluídos.
