# Continuidade do Prédio ON

Atualizado em **03/10/2026**, horário de São Paulo. Leia este arquivo primeiro ao retomar em outro computador. **O plano completo ainda não terminou e não há aceite para produção.** O computador não foi reiniciado.

Repositório: <https://github.com/helberjf/predioON>. Linha autorizada: **main**. As migrations **001–037 estão publicadas**. Troca de senha, cliente, três portais, dois apps e roteiro Android foram enviados em `5929348`/057722b/cc6660a. A galeria possui **19 imagens reais versionadas**, incluindo três telas de segurança web, duas financeiras e duas de segurança Android. **Não reaplicar patches antigos de037: esse código já está na main.**

API 037 passou **697/697** em integral Linux própria e no [CI 5929348](https://github.com/helberjf/predioON/actions/runs/37153986387). A [plataforma1f7bd3d](https://github.com/helberjf/predioON/actions/runs/37157034876), com logs conferidos, passou API697, banco26 com restauração real de44 tabelas/37 migrations, cliente59, ingestão83, UI89 e mobile75, sem skips. A matriz dos portais compilados passou **222/222** localmente e no [CI3035245](https://github.com/helberjf/predioON/actions/runs/37154429632), Chromium/Firefox/WebKit, sem retries. Os runs de [plataforma580a236](https://github.com/helberjf/predioON/actions/runs/37157346061) e [navegador580a236](https://github.com/helberjf/predioON/actions/runs/37157346059) também terminaram com sucesso; seus totais não foram extraídos novamente. Não somar dirigidos para criar uma integral.

Após o container de navegação Android publicado em `1f7bd3d`, a [jornada de domínios](https://github.com/helberjf/predioON/actions/runs/37157034843) passou **16 fases de Morador e20 de Operação**, incluindo financeiro, ações no banco e privacidade após revogação. A [troca de senha nativa](https://github.com/helberjf/predioON/actions/runs/37157034870) passou **29 fases por app**, com revogação das próprias famílias e isolamento entre contas. Revisão independente dos artefatos fechada. Permanecem **12 avisos MissingViewState no Morador em domínios e1 na Operação em senha**, sem crash/ANR; não declarar o Fabric totalmente corrigido nem homologação completa dos apps.

O [primeiro CI iOS autenticado9f32062](https://github.com/helberjf/predioON/actions/runs/37157173377) falhou no TLS, antes de banco/build/simulador. A seleção explícita de OpenSSL3 foi publicada em07029bd e passou no macOS. O diagnóstico3250337 confirmou falha `compiler_strchrnul_availability` ao compilar PostgreSQL16.4. O fix **a9eb62e**, com PostgreSQL16.15 oficial/checksum fixado, passou54 testes Linux e compilação/runtime real PG/Timescale. O [novo CI autenticado37161630392](https://github.com/helberjf/predioON/actions/runs/37161630392) já passou TLS, compilação do banco e bootstrap da API e está compilando os apps; **XCTest/Keychain ainda sem aceite**. Os timeouts120s de inicialização anteriores permanecem como histórico não explicado.

O novo checkpoint preserva o candidato038 completo: SQL, worker, produtores, role própria, implantação/CI e restauração. SQL54, worker36 Linux, ingestão123 e backup2 passaram em execuções próprias; tipos dos15 workspaces e imagem/proxy também passaram. A regressão integral API038 e a publicação integrada ainda estão em andamento. **038 não está aplicado ao ambiente demonstrativo nem publicado como release de produto.** Banco/API/navegador aprovados não comprovam homologação dos apps, aparelhos físicos, serviços externos, implantação pública ou conclusão de todo o plano.

## 1. Instruções permanentes do proprietário

- Continuar até concluir as implementações dos apps e websites, testes e evolução descritos na arquitetura aprovada.
- Fazer commits pequenos no padrão Conventional Commits, por exemplo `fix:`, `feat:`, `test:` e `docs:`, com push frequente na `main` depois de cada incremento verificado.
- Executar testes de API/banco/ingestão/clientes, Playwright e testes nativos apropriados. Não desativar proteções nem enfraquecer asserções para conseguir aprovação.
- Reescrever a documentação completa ao concluir o produto; manter desde já este documento e o tracker atualizados.
- Manter sugestões em [MELHORIAS_E_EVOLUCOES.md](MELHORIAS_E_EVOLUCOES.md).
- **Não reiniciar o computador nesta sessão.** Nenhum reboot foi executado pelo agente. Reiniciar um processo de teste não é reiniciar o computador.
- Ao terminar, abrir os três portais e os apps Morador/Operação neste computador e entregar cinco gravações completas, separadas, com dados fictícios. Também foram solicitadas imagens de Android, iOS e web durante o andamento.
- **Incluir as imagens conferidas nos commits**, com origem e limites identificados. Desde 03/10, as dezenove capturas e a galeria estão em [IMAGENS_DOS_SISTEMAS.md](IMAGENS_DOS_SISTEMAS.md), dentro do clone.

## 2. Estado das etapas

| Etapa da arquitetura | Estado | O que falta para encerrá-la |
| --- | --- | --- |
| 1. Contratos e cliente HTTP | Concluída no escopo original | Preservar regressões durante novas integrações. |
| 2. Identidade e RBAC | Parcial; auditoria036 concluída neste recorte | Concluir administrativos legados e consumidores restantes; preservar senha037 publicada, concluir MFA, convites, recuperação e demais fluxos de identidade. |
| 3. Processamento durável | Pendente | Inbox/outbox, consumidores separados, leases, retomada, deduplicação, dead letter e credenciais específicas. Nunca repetir atuação física automaticamente. |
| 4. Evolução dos domínios | Pendente para os novos módulos | Ativos, ordens de serviço, automações versionadas, planos/assinaturas e suporte com concessão explícita, com API/UI e testes. |
| 5. Apps Morador/Operação | Parcial | Preservar jornadas Android de domínios/senha aprovadas, investigar avisos Fabric, corrigir preparação/inicialização iOS, testar suas jornadas autenticadas, integrar novos módulos/notificações e homologar em aparelhos. |
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

| `1f7bd3d` | Container Android estável por navegação; domínio keyed com descarte do poller/rascunho e reset de rolagem.75 testes móveis,4 bundles e CI; domínios16/20 e senha29/29 fases aprovados. Avisos Fabric residuais. |
| `9f32062` | Roteiro iOS com API/PG/HTTPS reais, Keychain, senha literal e dois apps coinstalados.35 testes Windows/Linux e revisão independente; primeiro CI bloqueado na preparação TLS. |
| `a27e514` | Duas capturas JPEG originais da publicação financeira, QA manual com API/banco reais; fonte198 arquivos e6 bundles conferidos. |
| `1a003c5` | Duas capturas nativas de Minha conta, source/APK/run/artefato e hashes conferidos; galeria19. |
| `07029bd` | Seleção explícita de OpenSSL3 para o iOS; TLS real do macOS confirmado. |
| `3250337` | Diagnóstico fechado das sete etapas do banco, sem exportar logs privados; identificou a falha de compilação. |
| `a9eb62e` | PostgreSQL16.15 fixado para o cluster iOS;54 testes Linux e compilação/runtime PG16.15/Timescale2.17.2 reais. CI Apple avançou até build dos apps. |

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
- Android6da32d4 histórico: artifact11284697803,7 fases de Morador,0 de Operação. Financeiro recebeu200 três vezes, mas título esperado não renderizou;47 MissingViewState, sem erro ReactNativeJS. Não ocorreu revogação/HOME nesse run. O false positive antigo de botão Alertas foi corrigido separadamente; não explica esta falha. A jornada nova1f7bd3d passou, sem demonstrar sozinha a causa interna de todos os avisos.
- Android senha cc6660a: artifact11285575268; build dos2 APKs concluído, mas0 fases. Preflight recusou ANR do Pixel Launcher antes de instalar qualquer produto. Resultado e diagnósticos baixados em work/android-password-cc6660a-evidence. Não ignorar ANR nem afirmar aceite funcional.
- Android domínios1f7bd3d: artefato11286124411,16/20 fases aprovadas; cinco snapshots de banco e96 requests conferidos. Uma criação, dois comentários, um IN_PROGRESS e um ACK; vizinhos OPEN e nenhum evento vizinho, três concessões terminam revogadas. HOME visível e atividade STOPPED observados antes de cada revogação. XMLs sem conteúdo privado nas três retomadas. Crash vazio;12 MissingViewState no Morador permanecem. Logs globais duplicados entre pastas não foram contados duas vezes. `final.png` na pasta Morador é foreground global da Operação; usar15-logout para prova individual.
- Android senha1f7bd3d: artefato11285664020,29 fases por app,23 requests e12 POST exatos.400 preserva família,204 revoga as próprias sem revogar peer, senha antiga401/nova literal200, reinício com campos vazios, logout final2 famílias/0ativas/1logout por app. Sem crash/ANR/JS exception;1 MissingViewState na Operação. [Registro sanitizado e duas capturas](imagens/2026-10-03/android-password-evidence.json), publicados em1a003c5.
- iOS autenticado9f32062: **35/35 Windows e35/35 Linux**, Bash/YAML e geração/reabertura Ruby aprovados, revisão independente do harness. Zero POST em fases sem ação, único POST previsto nas outras, reconsulta depois do DB/antes da captura e14 POST ordenados ao terminar. Exportação exige nonce e nova observação nativa, schemas fechados, PNG íntegro e ausência de segredos; nunca upload de xcresult/log bruto. CI37157173377 falhou em `openssl verify ... -verify_ip 10.0.2.2`, exit2, stderr ausente; antes de banco/build/simulador. Correção deve preservar TLS/ATS e provar executável compatível, sem apresentar a hipótese LibreSSL como causa confirmada.
- iOS070/325/a9: TLS passou realmente com OpenSSL3.6.4 nos dois SANs; o diagnóstico confirmou a disponibilidade de `strchrnul` no SDK, não uma falha de login. Archive PostgreSQL16.15 e hash oficial conferidos; exportador fechado aceita somente a nova versão/hash. Linux54/54, Windows49+5 skips, build de fonte e cluster sem TCP com PG16.15/Timescale2.17.2/`btree_gist` aprovados. [Roteiro](../scripts/ios-smoke/README.md) registra fontes, runs e limites. CIa9 autenticado está em andamento; não há screenshots autenticados aprovados ainda.
- iOS inicialização1f/9f: runs37157034827 e37157173403, compilação aprovada, um app passa e o outro falha alternadamente em `simctl launch` timeout120s. Artefato Operação11286259371 não tem PNG; fonte assinada/instalada, sem prova de processo iniciado. Log mostra registro tardio do app, mas não comprova causa; não aumentar prazo cegamente. A entrada histórica b4726b9 permanece uma evidência de sua própria versão.
- As19 imagens tiveram hashes e referências estáticas conferidos. As3 novas capturas web são viewport real, campos vazios e screenshot do app, sem esconder elementos. A galeria8765 continua bloqueada por preferência salva do navegador; não houve contorno. O aceite antigo de10 imagens não se estende às19 atuais.
- Administração5173, síndico5174 e Morador5175 foram abertos nesta máquina com dados fictícios e compilação do recorte037; navegação/login/formulário/cancelamento inspecionados, consoles sem erros. A tentativa de redimensionar IAB não mudou viewport real1280x720; responsividade320/390 foi comprovada pelo Playwright, não por essa tentativa manual.

QA manual adicional: diretório, busca e catálogo de reservas conferidos. Prestação fictícia criada com saldo R$123,45/despesa R$23,45/final R$100,00; rascunho ausente no Morador, publicação presente, lançamento expandido nos dois perfis e consoles sem erros. Duas capturas JPEG originais adicionadas;19 hashes/referências atuais conferidos, sem aceite de navegador da galeria. Registro de fonte/bundles em imagens/2026-10-03/web-finance-manual-evidence.json. Não representa cobertura manual integral nem pagamento real.

### Candidato038 recuperável, sem aceite integrado

- SQL: **54/54 reais**,0 skips, migration SHA-256 `65c1b502621ceebc82021c9c94648de55e9ff9c63907237dd81866ce44f8c3c7`. A suíte exige `TEST_NOTIFICATION_DISPOSABLE_DB=1` antes de alterar roles globais. Log final local `work/notification038-sql-guard54-root.log`.
- Worker: **36/36 Linux**,0 falhas/skips,34,2s, com DB/HTTP/processos reais; log `work/notification038-worker-final36-pid-reuse-linux.log`. Windows35+1 skip explícito do sinal POSIX, antes do último ajuste da fixture de PID. Negativas: owner, helper malformado, backend perdido durante HTTP, unlock empilhado/delete recusado, pausa concorrente, dois workers e SIGKILL depois do efeito externo. A lease real20s foi aguardada e o POST seguinte usou a mesma chave; pode duplicar efeito sem deduplicação do destinatário. A revisão encontrou prontidão herdada do PID; RED real e correção invalidando heartbeat antes da conexão passaram na integral final.
- Produtores: **123/123 integral ingest**,15 suites,0 falhas/skips/cancelamentos,50,1s;40 próprios+83 anteriores. A reprodução independente dos40 passou40/40 em22,4s. Fonte7 arquivos congelada, ZIP SHA54cb2d1863b20503a95b6e75890e87e197e0b0beb4ecda99ecf93262197ca036. Logs `notification038-producers-ingest-final123.log` e `notification038-producers-independent-green.log`. Rodada118/119 falhou em JSONB scalar textual; três negativas provaram a correção com projeção textual explícita, sem alterar schema. Outros REDs de BEFORE/AFTER e alterações posteriores na mesma TX foram preservados.
- Backup: **2/2 reais**,0 skips,55,2s,49 tabelas/38 migrations e todos os sete estados, dois clusters físicos separados. ACL do DATABASE novo preparada explicitamente; objetos/owners/ACL/RLS/helpers/ledger vieram do archive, sem replay de migrations. Token antigo rejeitado, lease20s real e chave/witnesses conservados. Log `work/notification038-backup-frozen-green.log`; [guia](BACKUP_E_RESTAURACAO.md). Os REDs de inventário de helpers e ACL do banco estão preservados.
- Runtime/implantação: types15 workspaces, boundaries, Docker worker Node24, YAML/Compose, Caddy real e quatro testes Bash de rollout passaram. Jobs SQL/worker/produtores e backup agora têm clusters próprios para não trocar senhas da API. CI novo ainda não executado. Parar contêineres foi testado; drenagem MQTT/rollback com broker real não foi comprovado.
- Banco integral5458: **30 passaram/0 falhas/6 skips**,32,3s, após o primeiro run29/1/6. Migrations em DBUUID endureceram a role global de notificações para NOLOGIN antes de outro teste tentar usar a credencial previamente provisionada. A fixture agora provisiona novamente pelo CLI real antes do teste de login, preservando a regraNOLOGIN. Log `work/notification038-dbfull-host-real-green.log`; types do teste aprovados. Os skips são dois backups não ativados e quatro contratos Bash indisponíveis no Windows. SQL54 e backup2 foram exercitados separadamente.
- API038: snapshot isolado e cluster novo5457 em execução. O teste lifecycle antigo esperava HTTP direto de `notifyAlert`; precisa usar enqueue+worker real mantendo a mesma barreira/pausa/HTTP. A integral697 de037 não aprova automaticamente esse candidato.

Operação e limites em [NOTIFICACOES_DURAVEIS.md](NOTIFICACOES_DURAVEIS.md). Inbox, separação completa da ingestão, comandos/scheduler, retenção/replay e push continuam pendentes.

## 5. Checkpoint atual

O [manifesto](continuidade/2026-10-02-manifesto.json) registra **58 drafts**, base **a9eb62ecff1d685616bb80c30f1b59fe7866e4c8**. O [patch](continuidade/2026-10-02-em-andamento.patch) recupera a implementação candidata038; SHA-256 **26614d7ef5477232aec4f8efd5bda85ed46d36131405359dbb9e4391f101cee3**. A base foi arquivada, o patch aplicado em uma cópia limpa e os58 hashes LF comparados. Inclui o teste lifecycle API em adaptação, ainda sem integral aprovada. **Restauração verificada não é aceite de produção.**

Clonar a main recupera as entregas publicadas e o patch inerte. Para recuperar os drafts, criar um checkout separado na base exata do manifesto e aplicar somente o patch atual, primeiro com `git apply --check`. Comparar os hashes LF de todos os arquivos. Os patches antigos de37 arquivos037 são obsoletos. Não aplicar038 isoladamente nem misturar versões de produtores/worker/SQL. O pacote não contém banco, credenciais, SDKs ou evidências brutas; recriar ambientes descartáveis.

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

1. Conferir main, manifesto e CI da versão exata; recuperar somente drafts ainda não publicados. Preservar API697/banco26/cliente59/ingestão83/UI89/mobile75 e matriz web222; não atribuir esses totais a fontes históricas.
2. Preservar jornadas Android1f7bd3d de domínios16/20 e senha29/29 aprovadas e seus snapshots; investigar12+1 avisos Fabric residuais. Diagnosticar ANR de launcher no ensaio de snapshot, sem ignorar proteção nem salvar estado autenticado. Aparelhos físicos continuam pendentes.
3. Acompanhar CIa9 iOS após correção oficial de TLS/banco, diagnosticar os timeouts de inicialização e completar/verificar dois Releases coinstalados com banco/HTTPS reais e Keychain. Preservar POSTs exatos/negativa de logout duplicado. Exportar somente evidências aprovadas, nunca xcresult/logs privados.
4. Concluir regressão/revisão API e banco do candidato [038](superpowers/plans/2026-10-03-durable-alert-delivery.md), publicar o conjunto compatível e conferir novos jobs CI. SQL54/worker36/ingestão123/backup2 já passaram; preservá-los sem somar provas dirigidas para inventar uma integral. Não publicar migration isolada; ensaiar rollout com broker antes da produção.
5. Concluir identidade complementar2C (MFA/convites/recuperação), autorização administrativa restante, inbox e separação completa de ingestão/workers, novos módulos da etapa4 e push contextual. São itens substanciais ainda abertos.
6. Testar integrações/implantação/recuperação e aparelhos físicos. Manter negativos SQL/HTTP/ciclo de vida, Playwright e nativos; preservar traces de falhas e fonte exata, sem retries de mutação para esconder problemas.
7. Reconciliar documentação integral; abrir cinco sistemas e entregar cinco vídeos completos com dados fictícios, conforme [inventário](superpowers/plans/2026-10-02-presentation-coverage.md). Nenhum vídeo foi produzido.

## 8. Transferência, imagens e dependências externas

Código publicado, documentação, checkpoint, galeria e **19 imagens reais** estão no GitHub. São7 Android,10 web e2 entradas iOS; versões, fases e limites estão no [manifesto](imagens/2026-10-03/manifesto.json) e em [IMAGENS_DOS_SISTEMAS.md](IMAGENS_DOS_SISTEMAS.md). Capturas de fases aprovadas de uma jornada falha são identificadas; não representam aceite de toda a jornada. O navegador da galeria atual está bloqueado e não foi contornado.

`.local`, `work`, toolchains, containers/volumes, .env, tokens, keystores, evidências brutas e vídeos não ficam no Git. Nesta máquina, outputs ao lado do clone contém o pacote PREDIO_ON_CONTINUIDADE.zip com MDs, patch/manifesto e galeria/imagens. O manifesto do ZIP registra a versão publicada ao empacotar, hashes e quantidade real de drafts; confira-o antes de transportar. Recrie bancos descartáveis pelos scripts; não é necessário transportar volumes. Artefatos de CI têm retenção curta: guardar evidências sanitizadas importantes enquanto disponíveis.

Credenciais de produção, distribuição Apple/Android, FCM/APNs, domínio/TLS público e controladores físicos ainda não foram configurados/homologados. A documentação de instalação não representa implantação executada. O ambiente demonstrativo local usa exclusivamente dados sintéticos e não aciona hardware.

## 9. Prompt sugerido para a próxima sessão

> Continue o Prédio ON pela main. Leia docs/CONTINUIDADE.md, arquitetura e tracker. Migrations001–037 e identidade estão publicadas; não reaplique patches antigos037. Recupere somente drafts038 do manifesto atual na sua base exata e confira todos os hashes. SQL54/worker36 Linux/ingestão123/backup2 reais passaram; banco30+6 skips explícitos e fixture corrigida. Concluir integral API038 e publicar conjunto compatível com novo CI isolado. API697/web222 de037 e Android1f domínios16/20/senha29/29 estão aprovados nos respectivos recortes;12+1 Fabric persistem. TLS iOS e PostgreSQL foram corrigidos/publicados em070/325/a9; CIa9 avançou até build dos apps, ainda sem XCTest aprovado. Continue etapas substanciais de identidade, inbox/domínios/push/produção. Faça Conventional Commits/push main, atualize MD/checkpoint e preserve imagens reais. Homologação, documentação final e cinco vídeos pendentes. Não reinicie o computador nem contorne o bloqueio salvo da galeria.
