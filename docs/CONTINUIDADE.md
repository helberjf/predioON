# Continuidade do Prédio ON

Atualizado em **03/10/2026**, horário de São Paulo. Leia este arquivo primeiro ao retomar em outro computador. **O plano completo ainda não terminou e não há aceite para produção.** O computador não foi reiniciado.

Repositório: <https://github.com/helberjf/predioON>. Linha autorizada: **main**. As migrations **001–037 estão publicadas**. Troca de senha, cliente, três portais, dois apps e roteiro Android foram enviados em `5929348`/057722b/cc6660a. A galeria possui **15 imagens reais versionadas**, incluindo três telas de segurança web em `3035245`. **Não reaplicar patches antigos de037: esse código já está na main.**

API 037 passou **697/697** em integral Linux própria e no [CI 5929348](https://github.com/helberjf/predioON/actions/runs/37153986387). Cliente 59, banco 26 com restauração real de 44 tabelas/37 migrations e ingestão 83 também passaram nesse CI. A matriz dos portais compilados passou **222/222** localmente e no [CI 3035245](https://github.com/helberjf/predioON/actions/runs/37154429632), Chromium/Firefox/WebKit, sem retries. UI 89 e mobile 72 passaram antes dos incrementos nativos seguintes. Não somar dirigidos para criar uma integral.

O financeiro Android continua sem aceite nativo: o [run6da32d4](https://github.com/helberjf/predioON/actions/runs/37152831399) falhou após 7 fases de Morador, com HTTP 200 e MissingViewState no Fabric. Um recorte de container estável Android tem 75 testes móveis e 4 bundles aprovados, e foi revisado/publicado em `1f7bd3d`; o aceite Fabric depende do novo CI nativo. O [primeiro roteiro Android de senha](https://github.com/helberjf/predioON/actions/runs/37154043603) falhou **antes de instalar os apps**, por ANR do Pixel Launcher; não testou troca de senha. O roteiro autenticado iOS foi revisado/publicado em `9f32062`, com 35 testes Windows/Linux, ainda sem compilação/execução macOS. O processamento durável038 tem desenho, **sem migration ou worker implementado**.

O checkpoint abaixo foi esvaziado: todos os rascunhos de senha, navegação Android e roteiro iOS desse snapshot estão publicados. O desenvolvimento de038 deve receber um novo checkpoint próprio assim que houver arquivos recuperáveis. Banco/API/navegador aprovados não comprovam homologação dos apps, aparelhos físicos, serviços externos, implantação pública ou conclusão de todo o plano.

## 1. Instruções permanentes do proprietário

- Continuar até concluir as implementações dos apps e websites, testes e evolução descritos na arquitetura aprovada.
- Fazer commits pequenos no padrão Conventional Commits, por exemplo `fix:`, `feat:`, `test:` e `docs:`, com push frequente na `main` depois de cada incremento verificado.
- Executar testes de API/banco/ingestão/clientes, Playwright e testes nativos apropriados. Não desativar proteções nem enfraquecer asserções para conseguir aprovação.
- Reescrever a documentação completa ao concluir o produto; manter desde já este documento e o tracker atualizados.
- Manter sugestões em [MELHORIAS_E_EVOLUCOES.md](MELHORIAS_E_EVOLUCOES.md).
- **Não reiniciar o computador nesta sessão.** Nenhum reboot foi executado pelo agente. Reiniciar um processo de teste não é reiniciar o computador.
- Ao terminar, abrir os três portais e os apps Morador/Operação neste computador e entregar cinco gravações completas, separadas, com dados fictícios. Também foram solicitadas imagens de Android, iOS e web durante o andamento.
- **Incluir as imagens conferidas nos commits**, com origem e limites identificados. Desde 03/10, as quinze capturas e a galeria estão em [IMAGENS_DOS_SISTEMAS.md](IMAGENS_DOS_SISTEMAS.md), dentro do clone.

## 2. Estado das etapas

| Etapa da arquitetura | Estado | O que falta para encerrá-la |
| --- | --- | --- |
| 1. Contratos e cliente HTTP | Concluída no escopo original | Preservar regressões durante novas integrações. |
| 2. Identidade e RBAC | Parcial; auditoria036 concluída neste recorte | Concluir administrativos legados e consumidores restantes; preservar senha037 publicada, concluir MFA, convites, recuperação e demais fluxos de identidade. |
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

| `6da32d4` | HOME e atividade realmente em segundo plano antes de revogar;45 testes Linux/TLS. O CI encontrou nova falha financeira nativa, ainda aberta. |
| `5929348` | Senha037 transacional; corpo limitado, KDF antes dos locks, helper restrito, confirmação das escritas e revogação de todas as famílias. API697/697 e restore37 aprovados. |
| `057722b` | Segurança de conta nos três portais; campos literais protegidos, cancelamento/identidade e33 cenários próprios. Integral222 e CI222 aprovados. |
| `cc6660a` | Minha conta nos dois apps, controle da troca de senha e roteiro Android contra API/PG/HTTPS reais.72 unitários; primeira jornada nativa bloqueada por launcher antes da instalação. |
| `3035245` | Três capturas reais da segurança web, com 23 hashes de fonte conferidos contra057722b. Galeria15; sem aceite de navegador da galeria atual. |

| `1f7bd3d` | Container Android estável por navegação; domínio keyed com descarte do poller/rascunho e reset de rolagem.75 testes móveis e 4 bundles; revisão independente. Fabric ainda pendente. |
| `9f32062` | Roteiro iOS com API/PG/HTTPS reais, Keychain, senha literal e dois apps coinstalados.35 testes Windows/Linux e revisão independente; execução Apple pendente. |

## 4. Evidências e falhas conhecidas

| Verificação | Evidência e limite |
| --- | --- |
| Plataforma anterior033 | [CI c106a78](https://github.com/helberjf/predioON/actions/runs/36965837362): API570/570, banco 26/26, ingestão68/68, cliente48/48, UI64/64, mobile51/51, tipos/builds/imagens aprovados. É histórico, não aprovação da fonte atual. |
| Acesso034 | API71/71, ingestão 83/83 e outros46 dirigidos; permissões, corridas de locks, expiração, ACK e ausência de replay. |
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
| Auditoria036 publicada | API658/658 em integral própria; banco 26/26 com restore real de 44 tabelas/36 migrations; UI83/83; Playwright15/15 e integral189/189 em26min, três motores, zero retries. Lote atual de auditoria/tenancy/lifecycle36/36, incluindo409 e rollback de mutação silenciosamente recusada. Perfis globais não recebem histórico privado implicitamente; metadata/IP/user-agent são negados. Logs locais work/audit036-api-complete-full.log, work/audit036-db-verified.log e work/audit036-web-full.log. |
| Android autenticado | Há percursos anteriores completos com19/21 fases por app; histórico e limites em scripts/android-auth-smoke/README.md. Não equivalem a homologar todos os domínios. |
| Android reservas42f2130 | [CI36975943695](https://github.com/helberjf/predioON/actions/runs/36975943695) aprovado, artefato11212879728 conferido: **23 fases**, criação/cancelamento/pedido pendente/retirada de calendário, provas no banco e buffer de crash vazio. Capturas de confirmação e revogação inspecionadas. Reserva estrangeira permaneceu intacta. |
| Android domínios | [CI42f2130](https://github.com/helberjf/predioON/actions/runs/36975943742), artefato11213644516 conferido: oito fases de Morador passaram e Operação não começou. Falhou ao localizar “Ver lançamentos (1)”. Imagens/XML mostram carregamento financeiro; o proxy recebeu respostas200 e o log do app contém MissingViewState do renderer. A causa ainda não está demonstrada; não classificar esta execução como ANR de launcher nem corrigir apenas aumentando espera sem investigar. |
| Builds nativos42f2130 | Android e [iOS](https://github.com/helberjf/predioON/actions/runs/36975943839) terminaram com sucesso. É evidência de compilação; não equivale a runtime homologado. |
| Runtime iOS | [b4726b9](https://github.com/helberjf/predioON/actions/runs/37017848643) **aprovado para Morador e Operação**, em iPhone16Pro/iOS18.5/Xcode16.4: instalação, primeira abertura, sobrevivência, OCR, encerramento e novo processo. Quatro imagens inspecionadas e hashes conferidos; simuladores descartáveis removidos. Artefatos Morador11232611156/Operação11232270958. Os erros anteriores de configuração, Keychain, assinatura e OCR estão registrados em [scripts/ios-smoke/README.md](../scripts/ios-smoke/README.md). A origem reservada smoke-api.invalid não autentica: login, API e jornadas continuam pendentes. |
| Plataforma CI | [96b5f4b](https://github.com/helberjf/predioON/actions/runs/37013422221) passou: **API633/633, banco 26/26, ingestão 83/83, cliente48/48, UI83/83 e mobile59/59**, dois contratos móveis reais, tipos, fronteiras, builds, imagens e proxy. Zero falhas/cancelamentos/skips. O CI de plataforma [b4726b9](https://github.com/helberjf/predioON/actions/runs/37017848487) também terminou aprovado. O ajuste da admissão dos cookies corrigiu as três falhas de preparação de983b996, sem mudar produção nem as negativas CSRF/429. Os21/21 dirigidos precederam essa integral; não substituíram a execução completa. |

O CI da fonte **cacbd9d** foi conferido em 03/10: [plataforma37099724611](https://github.com/helberjf/predioON/actions/runs/37099724611) aprovada com API658/658, banco 26/26, cliente48/48, ingestão 83/83, UI83/83, mobile59/59 e dois contratos1/1; tipos/builds/imagens/proxy aprovados. O [navegador37099724651](https://github.com/helberjf/predioON/actions/runs/37099724651) passou **189/189 em6,8min**, sem retries. Essa integral inclui o rótulo17f9e47, mas não os rascunhos037. Logs locais work/platform-cacb-ci.log e work/browser-cacb-ci.log.

O [ensaio de snapshot db5dcbc](https://github.com/helberjf/predioON/actions/runs/37098757001) falhou com ANR do Pixel Launcher antes de instalar qualquer app; o job de restauração foi pulado e nenhum cache foi salvo. Os dois ensaios anteriores também falharam; identidade ADB e alvo do config.ini foram corrigidos com RED/39 testes Windows/Linux, mas não resolvem por si a saúde do Android. Evidências locais: work/android-avd-first-evidence, second-evidence e third-evidence; detalhes em scripts/android-smoke/README.md. Não foi afirmada causa comum com a falha financeira dos apps. A correção de rótulo17f9e47 passou15/15 dirigidos, depois da integral189 do consumidorc2871f0; a fonte posterior exige essa distinção.


Atualização de03/10: [plataforma2af9b9e](https://github.com/helberjf/predioON/actions/runs/37139264754) e [navegador2af9b9e](https://github.com/helberjf/predioON/actions/runs/37139264735) aprovados na fonte publicada036. Plataforma8408a5d falhou um caso de cookie; o run posterior passou, sem determinar a causa dessa falha isolada. No [Android domínios8408a5d](https://github.com/helberjf/predioON/actions/runs/37130882267), artefato11276742968, Morador passou13 fases e Operação16; a verificação terminal de conteúdo revogado falhou após retomar. XML final já mostra menus reduzidos, mas isso não apaga a primeira negativa nem explica a transição; logs mantêm MissingViewState. [Reservas8408a5d](https://github.com/helberjf/predioON/actions/runs/37130882266) falhou no Pixel Launcher antes de instalar o app. Não afirmar aceite nativo completo.

### Evidência atual037 e limitações

- Integral final API: **697/697**,52 suites, zero falhas/skips/cancelamentos,26min24s em Linux/Timescale real. Fonte17 arquivos congelada, SHA do tar3f2987d330e5ce83f824fd5322c3cabc95b9125b1e105332d120a2859befe186; hashes comparados à fonte publicada5929348. Log local: work/password037-api-final697-full.log. Monitor160 amostras sem novo salto de relógio. O CI 5929348 também passou697/697 em aproximadamente11min. Seus UI83/mobile59 são anteriores aos respectivos commits057/cc; não atribuir89/72 a esse run.
- Banco: **26/26**, dump/restore real de 44 tabelas/37 migrations, helpers/owners/ACL/RLS, hash e famílias revogadas após restauração. Log: work/password037-db-full-verified.log. Tipos dos13 workspaces e fronteiras passaram no recorte037.
- Web integral final: **222/222**, três motores,0 retries,27,2min localmente. Log: work/password037-web-stable-full222.log;23 hashes de fonte conferidos. [CI 3035245](https://github.com/helberjf/predioON/actions/runs/37154429632): **222/222 em 7,1 min**. Os33 casos próprios incluem três portais reais, troca literal, famílias/cookies, erro400, casos429/rede explicitamente interceptados, corrida A/B, ponteiro320/390 e teclado. Teclado virtual do sistema não foi homologado.
- Histórico037 preservado: Windows API691/695; Linux694/695 por watchdog global SSE e694/696 por duas expirações de fixture; matriz web221/222 por JWT estático do cliente de fixture. O trace desta última mostra salto de77min22s do relógio da VM (mesmo JWT300s), enquanto o navegador real renovou. Não se aumentou TTL nem se repetiram mutações. O teste SSE passou a limitar cada observação e excluir preparação SQL desse prazo, com casos negativos de dado ausente/tardio; não removeu asserções. Essas rodadas continuam falhas históricas, substituídas por integrais novas próprias.
- Android6da32d4: artifact11284697803,7 fases de Morador,0 de Operação. Financeiro recebeu200 três vezes, mas título esperado não renderizou;47 MissingViewState, sem erro ReactNativeJS. A causa da key é hipótese até confirmação nativa. Não ocorreu revogação/HOME nesse run. O false positive antigo de botão Alertas foi corrigido separadamente; não explica esta falha.
- Android senha cc6660a: artifact11285575268; build dos2 APKs concluído, mas0 fases. Preflight recusou ANR do Pixel Launcher antes de instalar qualquer produto. Resultado e diagnósticos baixados em work/android-password-cc6660a-evidence. Não ignorar ANR nem afirmar aceite funcional.
- iOS autenticado9f32062: **35/35 Windows e35/35 Linux**, Bash/YAML e geração/reabertura Ruby aprovados, revisão independente sem blocker no código do harness. As quatro negativas novas reproduzem e fecham o aceite indevido de logout duplicado/tardio: zero POST em fases sem ação, único POST previsto nas outras, reconsulta depois do DB/antes da captura e14 POST ordenados ao terminar. Exportação exige nonce e nova observação nativa, schemas fechados, PNG íntegro e ausência de segredos; nunca upload de xcresult/log bruto. **Compilação e execução Apple/Keychain permanecem pendentes no novo CI.**
- As15 imagens tiveram hashes e referências estáticas conferidos. As3 novas capturas web são viewport real, campos vazios e screenshot do app, sem esconder elementos. A galeria8765 continua bloqueada por preferência salva do navegador; não houve contorno. O aceite antigo de10 imagens não se estende às15 atuais.
- Administração5173, síndico5174 e Morador5175 foram abertos nesta máquina com dados fictícios e compilação do recorte037; navegação/login/formulário/cancelamento inspecionados, consoles sem erros. A tentativa de redimensionar IAB não mudou viewport real1280x720; responsividade320/390 foi comprovada pelo Playwright, não por essa tentativa manual.

## 5. Checkpoint atual

O [manifesto](continuidade/2026-10-02-manifesto.json) registra **0 drafts**, base **9f3206231f93c8d9354275686033496470c6d974**. O [patch](continuidade/2026-10-02-em-andamento.patch) está intencionalmente vazio: SHA-256 **e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855**. A base arquivada foi conferida. **Não executar git apply nesse arquivo vazio.**

Clonar ou atualizar a main recupera todas as entregas desse checkpoint. Os patches antigos de37 arquivos037 são obsoletos e não devem ser reaplicados. O desenvolvimento038 foi iniciado após esta captura; quando houver fontes parciais, atualizar patch/manifesto com a nova base, aplicar em arquivo limpo e comparar todos os hashes antes de transportar.

## 6. Preparação e testes

### Preparar ambiente descartável

```powershell
pnpm install --frozen-lockfile
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose version
pnpm setup:local
pnpm dev
```

`setup:local` é para **banco local novo e descartável**, pois inclui seed que redefine credenciais demonstrativas. Não usar seed/reset para atualizar banco real. A main aplica001–037. A atualização037 exige coordenar a parada de todos os workers API antigos antes da migration e iniciar somente a versão nova; consulte [TROCA_DE_SENHA.md](TROCA_DE_SENHA.md). Conferir código, schema e ledger da mesma versão antes de iniciar os serviços.

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

1. Conferir main, manifesto e CI da versão exata; recuperar somente drafts ainda não publicados. Preservar API697/banco 26/cliente59/ingestão 83 e matriz web222; UI 89/mobile 72 se referem aos incrementos037, não às fontes históricas.
2. Conferir o CI do recorte BuildingScreen publicado em `1f7bd3d`, com 75 testes móveis/4 bundles, e executar Android de domínios. Aceite exige todo o percurso, banco, privacidade, retomada e ausência de crash; React host não substitui Fabric. Diagnosticar ANR de launcher antes de instalar nos ensaios de senha e snapshot, sem ignorar proteção nem salvar estado autenticado.
3. Conferir o workflow iOS autenticado publicado em `9f32062`, incluindo POSTs exatos por fase e prova contra logout duplicado; executar/verificar a jornada macOS com dois Releases coinstalados, banco/HTTPS reais e Keychain. Exportar apenas evidências aprovadas; nunca xcresult ou logs que contenham credenciais.
4. Implementar [entrega durável038](superpowers/plans/2026-10-03-durable-alert-delivery.md): produtores atômicos, transição OFFLINE, outbox/leases/fencing, worker com credencial própria, pausa/ANY/ALL, falhas/recovery e backup. O arquivo é desenho, não implementação.
5. Concluir identidade complementar2C (MFA/convites/recuperação), autorização administrativa restante, inbox e separação completa de ingestão/workers, novos módulos da etapa4 e push contextual. São itens substanciais ainda abertos.
6. Testar integrações/implantação/recuperação e aparelhos físicos. Manter negativos SQL/HTTP/ciclo de vida, Playwright e nativos; preservar traces de falhas e fonte exata, sem retries de mutação para esconder problemas.
7. Reconciliar documentação integral; abrir cinco sistemas e entregar cinco vídeos completos com dados fictícios, conforme [inventário](superpowers/plans/2026-10-02-presentation-coverage.md). Nenhum vídeo foi produzido.

## 8. Transferência, imagens e dependências externas

Código publicado, documentação, checkpoint, galeria e **15 imagens reais** estão no GitHub. São 5 Android, 8 web e 2 entradas iOS; versões, fases e limites estão no [manifesto](imagens/2026-10-03/manifesto.json) e em [IMAGENS_DOS_SISTEMAS.md](IMAGENS_DOS_SISTEMAS.md). Capturas de fases aprovadas de uma jornada falha são identificadas; não representam aceite de toda a jornada. O navegador da galeria atual está bloqueado e não foi contornado.

`.local`, `work`, toolchains, containers/volumes, .env, tokens, keystores, evidências brutas e vídeos não ficam no Git. Nesta máquina, outputs ao lado do clone contém o pacote PREDIO_ON_CONTINUIDADE.zip com MDs, patch/manifesto e galeria/imagens. O manifesto do ZIP registra a versão publicada ao empacotar, hashes e quantidade real de drafts; confira-o antes de transportar. Recrie bancos descartáveis pelos scripts; não é necessário transportar volumes. Artefatos de CI têm retenção curta: guardar evidências sanitizadas importantes enquanto disponíveis.

Credenciais de produção, distribuição Apple/Android, FCM/APNs, domínio/TLS público e controladores físicos ainda não foram configurados/homologados. A documentação de instalação não representa implantação executada. O ambiente demonstrativo local usa exclusivamente dados sintéticos e não aciona hardware.

## 9. Prompt sugerido para a próxima sessão

> Continue o Prédio ON pela main. Leia docs/CONTINUIDADE.md, arquitetura e tracker. Migrations001–037, troca de senha e três telas web estão publicadas; não reaplique o antigo patch037. Confira manifesto/base/hash antes de recuperar apenas drafts atuais. API697 e web222 passaram em integrais próprias e no CI; preserve as falhas históricas e limites. Priorize aceite Android financeiro/Fabric/launcher e jornada iOS autenticada, depois038 durável e etapas restantes. Publique incrementos verificados com Conventional Commits e push main, atualize este MD e inclua capturas reais conferidas. O plano total, homologação/implantação, documentação final e cinco vídeos permanecem pendentes. Não reinicie o computador nem contorne o bloqueio salvo da galeria.
