# Melhorias e novas implementações — Prédio ON

Revisão: 04/10/2026. Documento vivo de priorização; não é uma declaração de conclusão nem substitui o [PRD](PRD.md), o [TDD](TDD.md) e o [plano de execução](superpowers/plans/2026-09-27-product-execution.md).

## 1. Como usar este documento

Antes de iniciar um item, conferir sua situação no código e nos testes do commit atual. Um recurso só deve ser marcado como concluído quando sua API, autorização, interface aplicável e validação estiverem integradas. Um build bem-sucedido comprova compilação; não comprova homologação em aparelho ou equipamento físico.

Prioridades: **P0** bloqueia uma entrega confiável; **P1** completa a operação do produto; **P2** melhora a experiência; **P3** é uma hipótese para avaliar com usuários. Dependências externas devem ser registradas sem incluir senhas, tokens, certificados ou dados pessoais reais.

## 2. Pendências do escopo já aprovado

Estes itens já pertencem à evolução prevista. Não devem ser apresentados como ideias opcionais para encobrir trabalho pendente.

Estado consolidado em [CONTINUIDADE.md](CONTINUIDADE.md). Cookies web/CSRF, coordenação entre abas e gestão das próprias sessões já foram implementados e testados. O executor de migrations com checksum/lock/no-op e a restauração real até038, inclusive em outro cluster físico, também estão entregues; implantação e recuperação do ambiente de produção continuam pendentes. Esses itens saíram da lista de implementações a iniciar e devem permanecer na regressão.

Progresso038 em 03/10: outbox/worker de webhook, produtores atômicos, role própria e restauração em outro cluster foram publicados em **292e12e**. O [CI 586cc92](https://github.com/helberjf/predioON/actions/runs/37164944806) confirmou API **697/697**, cliente **64/64**, UI **89/89**, mobile **75/75**, ingestão **83/83** e banco **34 aprovados de 36 casos, 2 skips de backup**. Nos jobs próprios passaram SQL **54/54**, worker **36/36**, produtores **40/40** e backup **2/2**, sem skips; SQL/produtores dedicados não foram executados no job geral. A integral local de ingestão **123/123** é uma prova distinta. O [navegador 292e12e](https://github.com/helberjf/predioON/actions/runs/37164756602) passou **222/222**, três motores, sem falhas, instabilidade, skips ou retries. [Registro versionado](evidencias/notification038-ci.json) e [guia operacional](NOTIFICACOES_DURAVEIS.md). Não repetir038: permanecem inbox, privilégios da ingestão inteira, retenção/replay, idempotência do destinatário e rollout real.

Android 1f7bd3d concluiu domínios 16/20 e senha 29/29, com 20 SoftExceptions de domínios e 1 de senha ainda pendentes de investigação. O monitor **f96b0ae** conserva primeira negativa terminal, exportação fechada e revisão independente; host Linux 30/30 e Windows 29 com 1 skip. Sua primeira execução [37166294051](https://github.com/helberjf/predioON/actions/runs/37166294051) falhou antes do login por `log-format-rejected`, conforme o [registro histórico](evidencias/android-renderer-f96b0ae.json). Após a correção do padding AOSP, o [renderer c949299, run 37208975852](https://github.com/helberjf/predioON/actions/runs/37208975852) passou **8 fases e 78 marcadores em 94,748 s**, no Morador, React Native 0.87.1/Android API35/x86_64. Domínio permaneceu inalterado e `firstFailure` foi `null`; [registro público com fonte e hash do APK](evidencias/android-renderer-c949299.json). Essa execução limpa cobre o percurso de Avisos, Transparência, expansão e Solicitações observado; não encerra os **20+1 avisos históricos**, nem exclui intermitência ou homologa ambos os apps/aparelhos.

A fonte **77adf128** teve quatro jornadas Android aprovadas: autenticação **19 fases Morador/21 Operação e 13 snapshots de sessão**; reservas **23 fases e 8 snapshots do banco**; domínios **16 fases Morador/20 Operação e 5 snapshots**, com privacidade, HOME/STOPPED e revogações conferidos; renderer **8 fases/78 marcadores em 88,584 s**, domínio inalterado e primeira negativa ausente. Os cinco digests dos artefatos foram conferidos. A jornada de senha dessa fonte falhou no guard HOME por diálogo do sistema, **antes de instalar ou autenticar, zero fases dos apps**. A auditoria dos buffers de domínios, sem contar cópias/frames como novos incidentes, encontrou **7 cabeçalhos MissingViewState e 1 registro removeViewAt no Morador**; Operação não teve esses registros. Portanto, aprovação funcional/privacidade e renderer limpo no percurso próprio não encerram os avisos dos outros fluxos. [Registro público dos cinco runs, fontes e limites](evidencias/android-77adf128.json).

No iOS, preservar o histórico **53a28ce → 48f1505 → 032ff6f**: timeout do fixture HTTPS, dependência de DNS reproduzida e posterior opção de socket indisponível no macOS. O [run 032ff6f](https://github.com/helberjf/predioON/actions/runs/37165815983) passou **65/65 host macOS**, TLS OpenSSL 3.6.4, banco/provisionamento/fixture, API pronta e ambos os Releases, mas falhou na **etapa 12**, prontidão HTTPS após **30 s**, causa desconhecida. O diagnóstico posterior **77adf128** remove DNS reverso do bind loopback e publica apenas categorias fechadas por etapa. Seu [run autenticado 37209972512](https://github.com/helberjf/predioON/actions/runs/37209972512) terminou **71/72 no host**: a única negativa exigia errno `none`, enquanto o watchdog retornou `other`; o ensaio de processo do proxy com TLS real passou. O [run de inicialização 37209972488](https://github.com/helberjf/predioON/actions/runs/37209972488) parou pelo mesmo guard nos dois produtos. Nenhum desses runs 77 chegou ao banco, build ou execução nativa; não há artefatos. **deb20b1** corrige somente essa assertiva, com **73/73 Linux e 64 aprovados/9 skips Windows**, preservando a negativa de framing antes do prazo e os limites de 30/3 s. **XCTest/Keychain continuam sem aceite**; nova execução Apple completa necessária. DNS do fixture não é causa demonstrada do timeout Apple anterior. [Histórico e limites do iOS](../scripts/ios-smoke/README.md).

Na rodada **deb20b1**, os três jobs macOS passaram **73/73 testes host cada**, zero skips. O [autenticado 37210947033](https://github.com/helberjf/predioON/actions/runs/37210947033) falhou na **etapa 11, segundo `pod install`**, com `ArgumentError: pathname contains null byte` em CocoaPods `PodFileAccessor` → Xcodeproj `realdirpath`, Ruby 3.3.12/CocoaPods 1.15.2/Xcode 16.4. A causa ainda não foi estabelecida; esse run não chegou à prontidão HTTPS nem ao XCTest e produziu **zero artefatos autenticados**. O [startup separado 37210946972](https://github.com/helberjf/predioON/actions/runs/37210946972) passou para ambos os apps, com os dois ZIPs/digests/resultados e quatro PNGs conferidos. Release assinado localmente, sobrevivência de 15 s e abertura com outro PID terminaram no formulário vazio; duas imagens do novo processo foram publicadas na [galeria](IMAGENS_DOS_SISTEMAS.md). [Registro público de origem, hashes e limites](evidencias/ios-deb20b1.json). Esse aceite cobre somente entrada/inicialização; login, restauração de sessão pelo Keychain, XCTest e domínios iOS continuam pendentes. Verificação TLS e limites de 30/3 s da prontidão permanecem obrigatórios.

Preparação posterior **5144913**: o DTO MQTT conserva `qos`, `retain` e `dup`; dirigido de transporte 8/8 e integral local de ingestão **125/125**, sem skips/falhas, em 51,25 s, com credenciais dos quatro papéis no cluster exclusivo. Essa prova não altera os totais do CI 038 e não entrega inbox039; o plano durável restante continua necessário.

**aee38f2** rejeita UTF-8 inválido antes de JSON/schema, mantendo o teto de 16.384 bytes, BOM inicial rejeitado e Unicode literal sem normalização. A prova RED reproduziu 17 negativas antes da correção; dirigido **36/36**, revisão independente, tipos e fronteiras passaram. A nova integral local de ingestão passou **161/161**, 15 suítes, zero skips/falhas, em 31,407 s, com os quatro DSNs e integrações reais habilitadas no cluster exclusivo. É validação da entrada atual, sem inbox nova; esse total não substitui o CI038. [Registro público da fonte e dos testes](evidencias/ingest-utf8-aee38f2.json). A [proposta039 publicada em ec04b1d](superpowers/plans/2026-10-03-durable-inbox.md) define o recorte de telemetria e suas provas de queda/deduplicação/privilégios, mas permanece **desenho: zero SQL039 ou runtime implementado**. Defaults e condições de ativação ainda exigem homologação operacional.

O [CI da plataforma aee38f2, run 37211000112](https://github.com/helberjf/predioON/actions/runs/37211000112) confirmou **API 697/697, cliente 64/64, UI 89/89, mobile 75/75 e ingestão geral 121/121**, sem falhas/skips/cancelamentos nessas suítes, Node 24.21.0. Banco: **34 aprovados de 36 casos, 2 skips de backup**. Nos jobs próprios passaram **SQL 54/54, worker 36/36, produtores 40/40 e backup 2/2**, zero skips/falhas/cancelamentos; contratos móveis reais 1/1 cada, tipos, fronteiras, builds, imagens de produção e proxy também passaram. O [navegador 37211000109](https://github.com/helberjf/predioON/actions/runs/37211000109) passou **222/222**, 74 por Chromium/Firefox/WebKit, um worker e zero retries/falhas/flaky/skips; digest oficial do artefato 11306753993 conferido: `61f6dc0d5685fb8c6d2307284a6b03869b0f19fb5e4b4287cc09f84be5224f52`. [Registro público de fonte, totais e limites](evidencias/platform-aee38f2.json). **121 gerais e 40 produtores são execuções separadas; sua soma não é uma nova integral de 161.** A prova local de 161 acima permanece distinta, e esses CIs não homologam produção, aparelhos ou iOS autenticado.

Portabilidade das imagens: os registros históricos [web](imagens/2026-10-03/web-evidence.json), [iOS Morador](imagens/2026-10-03/ios-morador-evidence.json) e [iOS Operação](imagens/2026-10-03/ios-operacao-evidence.json) agora acompanham o clone. São cópias byte a byte das três provas antes locais, sem nova execução ou imagem dessa etapa; naquele instante a galeria tinha 21 itens. Arquivos/fontes foram confrontados com o [manifesto](imagens/2026-10-03/manifesto.json): web 5eda20e resolvido para o commit completo e duas iOS b4726b9 com SHA-256 de `02-new-process` iguais às PNGs históricas. iOS registra somente inicialização sem requests autenticadas, com origem reservada `smoke-api.invalid`; não contém credenciais ou logs privados. O pacote pode recuperar essas três provas diretamente do repositório, sem depender da pasta local outputs.

**1414f02** publicou um segundo recorte de reprodução Android que conserva as capturas privadas do prefixo original. Host final **59/59 Linux**, **58 aprovados/1 skip Windows**, domínios **45/45 Linux** e revisão independente passaram, incluindo RED da primeira categoria privacidade/nativa. Os dois [runs nativos conferidos](evidencias/android-renderer-1414f02.json), 37215518745 e 37215518749, falharam com `renderer-missing-view-state` em finance após o tap de Transparência. Ambos completaram startup/login/building/notices, sem expand/requests/final; 59/59 e 45/45 host passaram em cada CI. Digests oficiais dos dois ZIPs de `result.json`, esquema fechado e 14 fontes Git LF foram verificados. O erro do app está reproduzido; a menor correção ainda precisa de implementação e nova prova nativa. O campo de snapshot falso significa verificação não alcançada, não prova mutação; nenhum aviso foi suprimido.

### QA manual de chamados posterior

3abb76a publicou três capturas originais, levando a galeria a24 itens. Criação/validação, resposta, três transições de estado, filtros e leitura própria pelo Morador passaram no navegador, com consoles sem erros. [Prova e limites de fonte/runtime](imagens/2026-10-03/web-occurrences-manual-evidence.json): demo037, manual parcial, sem aprovação nativa/produção/vídeos. b6761fd publicou o observer dos Pods: 18/152 Ruby e duas reproduções independentes, resolver/bootstrap/exit preservados; o CI37237681193 falhou no XCTest antes do primeiro checkpoint:73/73 host, dois builds e HTTPS aprovados, zero fases/imagens/POSTs aprovados. Os dois Pods não observaram NUL, mas isso não explica o erro histórico; [prova sanitizada](evidencias/ios-auth-b6761fd.json), causa/subestágio nativo a investigar nos logs privados. Não confundir GC forçado com causa Apple nem builds com jornada aprovada.

**Android a34346b** publicou a View nativa estável com Fragment por domínio: RED6/3falhas eGREEN6/6, integral78/78 Windows/Linux, tipos/fronteiras e revisão independente. [Prova](evidencias/android-stable-view-a34346b.json). Os testes host preservam descarte de estado privado; falta aceite Fabric nos dois gates e nas jornadas completas. Não tratar a hipótese de lifecycle como causa confirmada.

Os dois gates a343 falharam antes do PID, ui-incomplete/zero fases; [prova](evidencias/android-preflight-a34346b.json). Acrescentar diagnóstico fechado sem relaxar gates; o teste nativo da View continua pendente. f701f07 publicou três fotos de reserva pendente/aprovada/cancelada em QA manual parcial, com estados persistidos nos dois perfis e consoles sem erros; [prova sourceCommit nulo/demo037](imagens/2026-10-03/web-reservations-manual-evidence.json). A galeria atual tem27 imagens; isso não encerra apps/produção/vídeos.

6298065 publicou diagnóstico nativo iOS por estágio com primeira falha preservada:89/89 Linux e80+9skips Windows, revisão e repetição independente; [prova](evidencias/ios-native-diagnostic-6298065.json). Conferir próximo CI Apple sem tratar os testes host como XCTest/Keychain aprovados.

Auditoria da fonte a343 concluída: autenticação19/21 com13 snapshots de famílias e reservas23 com8 snapshots DB aprovados; [prova fechada](evidencias/android-a34346b.json),17 hashes Git/oito ZIPs oficiais conferidos. Domínios/senha/smokes foram bloqueados antes da instalação por diálogo do sistema; renderer/prefixo antes do PID. Duas PNGs originais de confirmação/cancelamento foram revisadas e publicadas: galeria29,9Android/16web/4iOS. Ainda faltam gates nativos, jornadas bloqueadas, aparelhos, produção e vídeos.

Apple629 observado: startup dos dois produtos passou; auth passou89/89 host e ambos builds/HTTPS, mas o executor falhou em runner-build/nonzero-exit70 antes dos testes nativos. [Prova](evidencias/ios-6298065.json). Investigar a causa de compilação com diagnóstico fechado;14POSTs, Keychain/famílias e imagens autenticadas continuam pendentes.

Duas PNGs originais02-new-process iOS629 foram revistas visualmente e versionadas; galeria31(9Android/16web/6iOS), preservando29 registros anteriores. São prova de entrada/startup, sem aprovação autenticada; [origem e limites](evidencias/ios-6298065.json).

0674c78 publicou diagnóstico Android pré-PID e primeira rejeição imediata:86/86Linux+45/45domínios,85+1/44+1Windows, revisão independente/450schemas e comandos/tempos intactos; [prova](evidencias/android-preflight-diagnostic-0674c78.json). Próximo aceite continua nos gates nativos e jornadas completas, sem reclassificação dos artefatos anteriores.

Dois gates nativos Android0674 foram aprovados (8 fases/78 e28 marcadores), com domínio inalterado, ZIPs/digests/esquemas e18 fontes conferidos; [prova](evidencias/android-0674c78.json). Próximo trabalho: concluir jornadas completas bloqueadas antes da instalação e investigar a intermitência, mantendo os REDs históricos e testes em aparelhos.

O diagnóstico de build iOS5a8 foi publicado após105/105Linux e96+9Windows, repetição independente,32/49schemas e11 comandos intactos; [prova](evidencias/ios-build-signals-5a8d2f6.json). Auditar o CI Apple dessa fonte antes de qualquer aceite autenticado; enums são observações de texto e não prova de causa.

Menu compartilhado corrigido em bc2fcc8 apósRED6,18dirigidos e240integrais reais (80por motor, sem retry/skip), UI89 e QA manual de teclado/desktop. Uma captura original foi incluída na galeria32; [prova](evidencias/web-menu-bc2fcc8.json). Seguir cobertura manual dos demais fluxos, jornadas nativas e módulos do plano.

Apple5a8 auditado: auth105host/ambosReleases/HTTPSready, falha runner-build70unclassified; startupOperação5fases/2PNG e Morador timeout120na primeira abertura. [Prova](evidencias/ios-5a8d2f6.json). Próximo recorte: companion cifrado opcional do log privado já capturado, sem mudar teste/plist/Swift/SDK/tempos; falta causa demonstrada e aceite autenticado.

Android5a8: domínio16/20 e inicialização5por app aprovados; senha falhou antes da instalação. Permanecem dois cabeçalhos e duas declarações MissingViewState no Morador, sem componente/causa demonstrados. [Prova pública](evidencias/android-5a8d2f6.json). Próximo experimento deve identificar a tag nativa com dados fechados, preservando guards, comandos e prazos.

Companion iOSf445 publicado/revisado:Linux121Python/12Node e Windows105+16skips/11+1skip, [prova21](evidencias/ios-encrypted-diagnostic-f445c99.json). Startup guard foi movido após Node24 em4c11487; CI novo e auth aguardam resultado. Organizações comerciais são o próximo recorte2B.3,039 reservado; backend/testes em execução, consumidor posterior. Inbox permanece proposta agora040. Nenhum desses itens aprova produção ou substitui a homologação nativa.

| Prioridade | Trabalho | Resultado esperado | Critério de aceite |
|---|---|---|---|
| P0 | Concluir autorização por capacidade nos domínios restantes | Acesso depende da concessão atual ao condomínio e ao recurso | HTTP e SQL negativos; revogação, expiração, equipe inativa e troca de condomínio sem vazamentos; nenhum privilégio global implícito sobre dados privados |
| P0 | MFA e verificação adicional para ações privilegiadas | Proteção adicional da administração e de operações sensíveis | Cadastro, desafio, recuperação e revogação; limites de tentativas; proteção contra reutilização; testes sem segredos reais |
| P1 | Convites e recuperação de senha | Entrada e recuperação sem distribuição manual de senhas | Tokens de uso único, expiração, revogação e respostas sem enumeração de contas; provedor de envio configurável |
| P0 | Inbox e consumidores duráveis restantes | Trabalho obrigatório sobrevive à queda de processo; preservar outbox038 já entregue | Ensaios de interrupção antes/depois do commit, deduplicação, reserva com prazo e recuperação; filas não repetem comandos físicos indiscriminadamente |
| P0 | Credenciais restritas para ingestão e demais workers | Separar as responsabilidades legadas ainda proprietárias; preservar a role de notificações038 | Matriz de privilégios e testes de operações negadas por processo; bootstrap/migrations continuam separados |
| P1 | Ativos e ordens de serviço | Manutenção com responsável e histórico do equipamento | Criar, atribuir, executar, concluir e reabrir conforme permissão; histórico auditável; relação explícita com chamados |
| P1 | Automações versionadas | Regras controladas, simuláveis e rastreáveis | Versão imutável, simulação antes de ativar, limites, histórico de execução e desligamento; sem execução de scripts arbitrários |
| P1 | Planos e assinaturas | Condições comerciais separadas dos dados operacionais | Plano versionado, vigência, limites e eventos; cobrança por provedor continua sendo integração separada |
| P1 | Push contextual nos dois aplicativos | Aviso útil direcionado à conta e ao condomínio corretos | Registro/revogação da instalação, preferências, deduplicação, link para recurso autorizado e ausência de conteúdo privado na tela bloqueada |
| P0 | Homologação nativa Android/iOS | Instalação e uso comprovados em aparelhos | Sessão segura, retomada do app, permissões do sistema, conectividade ruim, notificações e acessibilidade em aparelhos representativos |
| P0 | Implantação, backup e restauração | Recuperação comprovada da plataforma | Banco restaurado em ambiente separado, integridade verificada, tempo medido e procedimento reproduzível |
| P1 | Observabilidade por serviço | Falhas identificadas sem registrar conteúdo privado | Saúde, métricas de fila, latência, falhas por categoria e alertas operacionais com instruções de atendimento |
| P0 | Documentação final coerente | Instalação e operação reproduzíveis por outra pessoa | Comandos executados, variáveis descritas, matriz de permissões, fluxos por produto, limitações e evidências do commit final |

## 3. Sugestões novas para a experiência do morador

### 3.1 Acessibilidade e linguagem — P1

Revisar contraste, foco, tamanho de toque, leitor de tela, ampliação de texto e mensagens dos formulários. Padronizar nomes acessíveis separados dos textos de ajuda. O aceite deve incluir navegação sem mouse na web e TalkBack/VoiceOver em cenários de login, reserva e chamado. Não depender apenas de uma pontuação automática.

### 3.2 Calendário de disponibilidade — P2

Mostrar os intervalos ocupados das áreas comuns sem nome, unidade, identificador da reserva ou observações de terceiros. A seleção de horário deve indicar fuso do condomínio e duração permitida. Aceite: dois moradores não conseguem inferir dados privados e uma disputa pelo mesmo horário continua decidida pela restrição do banco.

Progresso em 02/10: calendário privado entregue no portal Morador em `da6c7ca`, com testes reais de conflito, cancelamento e privacidade nos três navegadores. A interface explicita o fuso do aparelho, usado também pelo formulário existente. Ainda falta unificar seleção, disponibilidade e apresentação no fuso configurado do condomínio, inclusive quando o usuário está em outro fuso; essa parte não está marcada como concluída.

A jornada Android de reservas em `42f2130` passou em 23 fases contra API/banco reais, incluindo criação, cancelamento, pedido pendente e perda de autorização do calendário. Isso amplia a evidência móvel, sem encerrar a pendência de fuso nem homologar todas as telas nativas.

### 3.3 Atualizações de chamado sem perda de rascunho — P1

Preservar a mensagem que está sendo escrita quando o andamento ou o histórico são atualizados. Informar quando outra pessoa alterou o chamado. Aceite: atualizar, receber um comentário e perder temporariamente a conexão não apagam uma nova resposta nem duplicam seu envio.

### 3.4 Preferências de comunicação — P2

Permitir escolher categorias e horários de notificações, distinguindo informativos de ocorrências que exigem atenção. A decisão sobre comunicações obrigatórias deve ser uma regra explícita do produto. Depende do serviço de notificações e de entrega auditável.

### 3.5 Consulta com conectividade limitada — P2

Avaliar cache local mínimo de dados previamente autorizados, com data de atualização visível e limpeza no logout. Antes de implementar, definir quais informações podem permanecer no aparelho. Comandos físicos e decisões administrativas não devem entrar em uma fila automática de reenvio offline.

## 4. Sugestões para gestão e manutenção

### 4.1 Painel de pendências por responsabilidade — P2

Unir chamados, reservas aguardando decisão e ordens atribuídas, mantendo as permissões de cada origem. Aceite: o contador e a lista usam o mesmo escopo, e a ausência de permissão aparece como indisponibilidade, não como zero pendências.

### 4.2 Histórico do ativo com QR Code — P2

Uma etiqueta abre o ativo no aplicativo de Operação. O código não contém credenciais nem concede acesso; a API verifica a sessão e o condomínio. Depende do módulo de ativos. Testar códigos revogados, equipamento transferido e acesso por usuário sem concessão.

### 4.3 Rotinas preventivas e checklists — P2

Gerar ordens recorrentes com responsável, prazo, evidência e justificativa de não execução. Depende de jobs duráveis. Aceite: executar o agendador duas vezes não duplica a ordem; fuso e mudança de horário são tratados explicitamente.

### 4.4 Exportações autorizadas — P2

Exportar relatórios de manutenção, consumo e contas em formatos adequados. Registrar solicitante, escopo, data e validade do arquivo. Testar revogação durante a geração, limite de tamanho e ausência de dados de outro condomínio. Separar exportação financeira de qualquer integração bancária.

### 4.5 Importação assistida de unidades e moradores — P2

Oferecer prévia, erros por linha e confirmação do lote antes de aplicar. Usar identificadores estáveis e evitar duplicar contas existentes. Aceite: lote inválido não cria vínculos parciais silenciosamente; o relatório permite corrigir e repetir apenas o necessário.

## 5. Sugestões para operação técnica

| Prioridade | Sugestão | Evidência necessária antes da entrega |
|---|---|---|
| P1 | Ampliar a matriz já existente em Chromium, Firefox e WebKit | Preservar 222/222 dos três portais compilados no CI292e12e, três motores e zero retries/falhas/flaky/skips; ampliar para novos módulos sem somar dirigidos como integral |
| P1 | Testes de componente e acessibilidade nativa | Controles, estados de erro e nomes acessíveis verificados; complementar testes em aparelho |
| P1 | Ensaio de atualização e retorno de versão | Backup anterior restaurável, migrations compatíveis e procedimento de recuperação exercitado |
| P2 | Dividir o JavaScript do painel por rota | Medição antes/depois de download e abertura inicial; sem regressão de navegação ou autorização |
| P2 | Imagens responsivas e tamanhos menores | Aparência preservada, menor transferência em celular e dimensões que evitam deslocamento do layout |
| P2 | Orçamento de desempenho por fluxo | Valores medidos para login, dashboard, histórico e criação; documentar ambiente e volume da medição |
| P1 | Ensaios de falhas MQTT e banco | Queda do broker, redelivery, desconexão no commit, ACK atrasado e reinício de worker sem atuação física duplicada |
| P2 | Provisionamento de gateway guiado | Identificação do dispositivo, emissão/revogação de credencial e checklist de instalação auditados |
| P2 | Ambiente demonstrativo separado | Dados sintéticos, limitações visíveis e ausência de conexão com portões ou sensores reais |

## 6. Ideias a validar antes de entrar no plano

- **P3 — Visitantes e prestadores:** verificar a demanda, regras de validade e modelo de consentimento. Qualquer autorização de acesso exige projeto próprio e testes com o controlador.
- **P3 — Análise comparativa de consumo:** avaliar se indicadores agregados ajudam a gestão, definindo qualidade mínima e tratamento de períodos incompletos. Não transformar estimativas em cobranças.
- **P3 — Detecção de anomalias:** validar com histórico e alertas revisados por pessoas; apresentar incerteza e medir falsos positivos. Não anunciar manutenção preditiva sem evidência.
- **P3 — Integrações externas:** priorizar por necessidade concreta e contrato documentado; considerar agenda, armazenamento de comprovantes e sistemas de manutenção. Conector instalado não equivale a integração implementada.

## 7. Sequência sugerida

1. Estabilizar regressão, permissões e builds nativos da versão atual.
2. Concluir identidade segura e migrations operáveis antes de ampliar distribuição.
3. Preservar 038 e homologar a [proposta de inbox039](superpowers/plans/2026-10-03-durable-inbox.md) antes de implementar telemetria e worker compatível; consumidores restantes e privilégios por carga precisam de provas próprias.
4. Integrar ativos/ordens e notificações com os dois apps e a gestão web.
5. Homologar implantação e recuperação; finalizar a documentação técnica e de operação.
6. Selecionar sugestões P2/P3 com base no uso observado, sem misturá-las aos requisitos pendentes.

## 8. Modelo para promover uma sugestão ao plano

Para cada item aprovado, registrar: problema observado, público, fluxo esperado, limites de escopo, dependências, dados tratados, capacidades exigidas, critérios de aceite, testes negativos, estratégia de implantação e evidência final. Usar commits pequenos no padrão `feat(escopo): ...`, `fix(escopo): ...`, `test(escopo): ...` e `docs(escopo): ...`. Não registrar um item como concluído apenas porque o código foi escrito ou enviado à `main`.

## 9. Sugestões adicionais após auditoria036

- Exibir nomes de atores e recursos por uma projeção autorizada própria, preservando o ID de referência e a restrição de campos privados.
- Localizar as ações de auditoria para português e oferecer filtros por ação/período, mantendo escopo e autorização no servidor.
- Implementar cursor e exportação com autorização/limites próprios para percorrer histórico sob inserções concorrentes; o offset atual não representa um snapshot imutável.
- Medir memória, CPU, boot e traces de ANR do Pixel Launcher no runner Android antes de integrar snapshot às jornadas. Cache hit não é prova de restauração ou saúde.

## 10. Atualização após senha037

Troca de senha e revogação atômica de todas as famílias já foram entregues na API, três portais e dois apps. MFA, convites e recuperação continuam no escopo pendente; não confundir recuperação com troca autenticada. Priorizar aceite Android/iOS e os consumidores duráveis restantes, preservando 038, credenciais restritas, pausa e testes negativos.

Como melhoria P1, ampliar o [índice de evidências038](evidencias/notification038-ci.json) para cada incremento, com fonte, execução integral, skips/retries explícitos e limites de cada imagem. Um teste React host não aprova Fabric, build não aprova sessão nativa e capturas de uma fase não aprovam toda a jornada. [Galeria com 31 imagens versionadas](IMAGENS_DOS_SISTEMAS.md): **9 Android, 16 web e 6 iOS**, incluindo duas entradas históricas, duas de novo processo Release deb20b1 e duas de6298065. Cinco vídeos ainda pendentes; referências estáticas/hashes conferidos, sem novo aceite dos controles pelo navegador 8765 bloqueado. O monitor Android reprova na primeira MissingViewState ou removeViewAt/index-mismatch com fase/seq/horário/PID. Seu histórico conserva a rejeição inicial do formato do log e as execuções limpas [c949299](evidencias/android-renderer-c949299.json) e [77adf128](evidencias/android-77adf128.json) após corrigir o parser. Repetições e investigação dos 20+1 avisos anteriores continuam necessárias; não declarar causa por correlação com GC ou teclado.

### Applef445/4c114: startup aprovado e diagnóstico privado autenticado

Os cinco CIs monitorados encerraram. O [startup4c11487](https://github.com/helberjf/predioON/actions/runs/37247928548) passou nos dois apps,121/121host por produto, assinatura local, instalação e dois processos sem login. Quatro PNGs tiveram integridade/dimensões conferidas, sem revisão visual/publicação; galeria32 preservada. O [authf445](https://github.com/helberjf/predioON/actions/runs/37247530449) passou121Python/12Node, banco, builds e HTTPS, mas falhou no runner-build/70 antes do XCTest, zero checkpoints/imagens aprovados; requests reais desconhecidos.

O agente principal verificou origem/contexto/digest oficial e autenticou OAEP/GCM antes da abertura local única em diretório protegido. Só observações técnicas fechadas foram exportadas: o Xcode não encontrou o destino solicitado, cujoUUID foi convertido em minúsculas, embora o mesmo simulador conste duas vezes comUUID em maiúsculas, paraarm64/x86_64. Preservar a grafia validada do produtor será um experimento mínimo; a causalidade depende de nova execução Apple. Não alterarSDK/projeto/Swift/prazos por essa observação. A diferença literal device/destination também explica o marcadorunclassified desta execução. Não atribuir retroativamente a causa aos runs históricos. [Prova pública sanitizada](evidencias/ios-native-f445c99-4c11487.json). Chave, plaintext, envelope e logs privados ficam fora deGit e do pacote. Auth/Keychain/14POSTs/domínios iOS, renderer completo Android, aparelhos, produção e cinco vídeos continuam pendentes. Nenhum reboot executado.
