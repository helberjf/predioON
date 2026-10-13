# Melhorias e novas implementações — Prédio ON

Revisão: 05/10/2026. Documento vivo de priorização; não é uma declaração de conclusão nem substitui o [PRD](PRD.md), o [TDD](TDD.md) e o [plano de execução](superpowers/plans/2026-09-27-product-execution.md).

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
| Entregue (042, 047) | Convites e recuperação de senha | Entrada e recuperação sem distribuição manual de senhas | Tokens de uso único, expiração, revogação e respostas sem enumeração de contas; provedor de envio configurável |
| Parcial (048); fila adiada, ver INBOX_DECISOES.md | Inbox e consumidores duráveis restantes | Trabalho obrigatório sobrevive à queda de processo; preservar outbox038 já entregue | Ensaios de interrupção antes/depois do commit, deduplicação, reserva com prazo e recuperação; filas não repetem comandos físicos indiscriminadamente |
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

Troca de senha e revogação atômica de todas as famílias já foram entregues na API, três portais e dois apps. Convites (042), MFA (046) e recuperação por e-mail (047) foram entregues depois; não confundir recuperação com troca autenticada. Priorizar aceite Android/iOS e os consumidores duráveis restantes, preservando 038, credenciais restritas, pausa e testes negativos.

Como melhoria P1, ampliar o [índice de evidências038](evidencias/notification038-ci.json) para cada incremento, com fonte, execução integral, skips/retries explícitos e limites de cada imagem. Um teste React host não aprova Fabric, build não aprova sessão nativa e capturas de uma fase não aprovam toda a jornada. [Galeria com 31 imagens versionadas](IMAGENS_DOS_SISTEMAS.md): **9 Android, 16 web e 6 iOS**, incluindo duas entradas históricas, duas de novo processo Release deb20b1 e duas de6298065. Cinco vídeos ainda pendentes; referências estáticas/hashes conferidos, sem novo aceite dos controles pelo navegador 8765 bloqueado. O monitor Android reprova na primeira MissingViewState ou removeViewAt/index-mismatch com fase/seq/horário/PID. Seu histórico conserva a rejeição inicial do formato do log e as execuções limpas [c949299](evidencias/android-renderer-c949299.json) e [77adf128](evidencias/android-77adf128.json) após corrigir o parser. Repetições e investigação dos 20+1 avisos anteriores continuam necessárias; não declarar causa por correlação com GC ou teclado.

### Applef445/4c114: startup aprovado e diagnóstico privado autenticado

Os cinco CIs monitorados encerraram. O [startup4c11487](https://github.com/helberjf/predioON/actions/runs/37247928548) passou nos dois apps,121/121host por produto, assinatura local, instalação e dois processos sem login. Quatro PNGs tiveram integridade/dimensões conferidas, sem revisão visual/publicação; galeria32 preservada. O [authf445](https://github.com/helberjf/predioON/actions/runs/37247530449) passou121Python/12Node, banco, builds e HTTPS, mas falhou no runner-build/70 antes do XCTest, zero checkpoints/imagens aprovados; requests reais desconhecidos.

O agente principal verificou origem/contexto/digest oficial e autenticou OAEP/GCM antes da abertura local única em diretório protegido. Só observações técnicas fechadas foram exportadas: o Xcode não encontrou o destino solicitado, cujoUUID foi convertido em minúsculas, embora o mesmo simulador conste duas vezes comUUID em maiúsculas, paraarm64/x86_64. Preservar a grafia validada do produtor será um experimento mínimo; a causalidade depende de nova execução Apple. Não alterarSDK/projeto/Swift/prazos por essa observação. A diferença literal device/destination também explica o marcadorunclassified desta execução. Não atribuir retroativamente a causa aos runs históricos. [Prova pública sanitizada](evidencias/ios-native-f445c99-4c11487.json). Chave, plaintext, envelope e logs privados ficam fora deGit e do pacote. Auth/Keychain/14POSTs/domínios iOS, renderer completo Android, aparelhos, produção e cinco vídeos continuam pendentes. Nenhum reboot executado.

### UUID do runner iOS preservado emf744457; checkpoint comercial completo

**f744457** publicou somente run_auth/test_auth/README: formatoUUID canônico e propriedade validados, grafia do produtor preservada em todos os comandos/cleanup, e marcador literaldevice incluído sem alterarSDK/projeto/Swift/TLS/ATS/prazos/gates. RED5/23falhas+2erros e negativo restrito2falhas preservados. Linux126/126; Windows110+16skips; root repetiuWindows110+16skip19,427s. Fontes3/ZIP/8protegidos e18outros iOS conferidos, revisão do diff sem bloqueador. [Prova de host](evidencias/ios-owned-destination-f744457.json). Novo auth37251180530 e startup37251180567 em execução: Apple ainda sem aceite autenticado.

Backend039 congelado passou161/161 adjacentes, SQL54/54 e backup same-cluster1/1. A primeira integral própria registrou **719aprovados/721,54suítes,zero skips**, com duas assertivas globais de auditoria contendo eventosPLATFORM legítimos de testes anteriores; HTTP200 e todos osIDs próprios estavam presentes. É falha de isolamento da expectativa, não negativa de autorização do produto. Corrigir o teste com paginação real e escopo deIDs próprios, manter história/negativas e repetir integral. RevisãoSQL/API/contratos sem bloqueador estático; três REDs web reais demonstraram bloqueioRBAC, cadastro indevido para leitor e seletor semread. UI em implementação no5463 exclusivo. Não publicar o checkpointA como aprovado até a nova integral.

O snapshot atual preserva **16drafts** da basef744457, patch63.979bytes/SHAd7d2afb87197d94c449675987e8fba1d7bab409fbddeea7319df0b3c364e051a, aplicado em archive novo com16hashesLF conferidos. Inclui os10backend, dois testesDB, guia039, manifest/lockadmin e specRED anterior à correção do próprio harness. Drafts não equivalem a produto aprovado; novos ajustesUI/audit posteriores a esse freeze exigem snapshot novo. Os três iOS já publicados não estão no patch. Galeria32 preservada, nenhum vídeo/reboot.

### Organizações039 publicadas; iOS f744457 avançou até o guard ATS

**758deba** publicou o backend comercial039, projeção finita, contratos e provas de banco. A segunda integral própria passou **721/721,54 suítes,zero falhas/skips/cancelamentos**. A duração real foi28.983.317,949ms, com longo intervalo de relógio de causa desconhecida; não houve reinicialização iniciada nesta sessão. A primeira719/721 permanece registrada. A correção restrita da fixture de auditoria percorre páginasHTTP reais, preserva história independente e compara seus própriosIDs sem enfraquecer as negativas. API161/161, SQL54/54 e backup2/2 são execuções separadas; o restore verificou49tabelas/39migrations em ambos os modos, inclusive clusters físicos distintos. Catálogo/roles/hash/cleanup/ledger pós-integral conferidos. [Prova do backend](evidencias/organizations039-758deba.json).

O consumidor web congelado passou21/21Chromium e63/63 nos três motores, zero retries. A revisão da raiz encontrou uma janela de resposta após revogação comercial: a próxima versão deve comparar epochs sincronicamente mesmo depois de iniciar uma escrita. Esse ajuste e a regressão adjacente/manual continuam pendentes; os63 anteriores não aprovam fonte posterior. Novas telas e testesiOS ainda são drafts.

**iOS f744457:** os três jobs de plataforma passaram. Morador passou5fases de startup e2originaisPNG revisados; Operação parou após3fases por timeout120s, semPNG e sem prova de processo iniciado. Auth avançou runner-build/plist, mas o guard obrigatório **runner-ats-check/verification-failed/null** barrou antes de test-without-building. Campo/tipoATS concreto não é observável; próxima implementação acrescenta suplemento finito sem nomes de domains, sem relaxarATS/TLS/prazos. Zero checkpoints/imagens/POSTs aprovados não prova zero tráfego real. [Prova Apple fechada](evidencias/ios-f744457.json). Uma PNG original Morador foi incluída na galeria, agora33(9Android/17web/7iOS), com SHA e origem. Sem aprovação autenticada, aparelhos, produção ou vídeos.


### Estado de 05/10: diagnóstico ATS publicado, duas inicializações iOS e QA comercial

**cf9b927** publicou o diagnóstico ATS de cinco campos, mantendo o guard obrigatório e a primeira falha. Host Linux **137/137**; Windows **121 aprovados e16 skips de137**, inclusive execução independente da raiz. [Prova host](evidencias/ios-ats-diagnostic-cf9b927.json). O CI Apple dessa fonte confirmou no runner final **NSAllowsArbitraryLoads=true**, falhando antes de XCTest. A geração e a origem histórica desse flag ainda não estão comprovadas. Uma cópia privada estrita do agente ANTES do build está em preparação, com assinatura normal do Xcode, sem editar SDK global/produto compilado ou relaxar ATS/TLS/prazos.

O startup **37293954244** passou nos dois apps: **cinco fases e duas PNGs por produto**. Quatro originais foram revisados pelo agente e os dois de novo processo também pela raiz; estes dois agora estão versionados. Plataforma **37293954270** passou os três jobs, sem inferir contagens; browser37293954374 tem statusSUCCESS auditado somente como metadata. [Prova Apple](evidencias/ios-cf9b927.json). Autenticação/Keychain/14POST/imagens autenticadas/aparelhos/produção seguem sem aceite.

WebB corrigiu a janela de resposta depois de revogação com epochs síncronos; matriz **69/69** e adjacente **69/69** passaram em execuções separadas, três motores, zero retries. Um RED real do primeiro menu lento reproduziu deslocamento entre pointerdown/up; correção somente no Shell aguarda primeira projeção e mantém links durante polling. Delta **3/3** passou; integral final **312 em18arquivos** permanece em andamento neste registro, sem resultado final alegado. QA manual próprio confirmou cadastro, edição, cancelamento/confirmação de status, recarga, conflito de slug e viewport390×844 sem overflow; banco tem um cadastro e três atualizações auditadas, sem duplicata. Duas JPEGs originais foram publicadas com commit nulo e hashes da fonte: a cópia manual antecede o último ajuste Shell. [Prova manual](evidencias/web-organizations039-manual.json). Galeria agora **37 imagens:9Android/19web/9iOS**.

A revisão de privilégio mínimo confirmou quatro REDs SQL no cluster exclusivo5467: o runtime app podia ler o próprio hash, alterar a própria flag administrativa, substituir hash e apagar própria linha. Todas as escritas foram revertidas e fixture/ACL originais conferidas. Não se alega exploração HTTP. O recorte **040-users-runtime-acl** está autorizado para retirar leitura secreta e UPDATE/DELETE diretos, conservando INSERT e sete colunas públicas, identity/helpers/RLS intactos. A proposta de inbox foi reservada para **041**. Dirigidos/integral/restore040 ainda pendentes. Não atribuir as provas039 à fonte040 posterior.


### Consumidor comercial039 publicado com integral312

**e5f98e4** publicou os nove arquivos B: entrada RBAC comercial, Clientes com leitura/gestão distintas, seletor de imóveis autorizado, epochs síncronos após resposta, tratamento de resposta de escrita incerta e menu inicial estável. Integral própria **312/312,18arquivos,104porChromium/Firefox/WebKit,umworker,zero retries/fail/flaky/skips/erros,1.583.804,071ms (26,4min)**. A raiz reconstruiu o ZIP do HTML, conferiuCRC/todas312tentativas e nove hashes publicados. Cleanup próprio zerado e dois grants preservados com microssegundos originais. Os69/69 e69/69 anteriores permanecem execuções distintas; não são somados. [Prova web final](evidencias/web-organizations039-e5f98e4.json).

A cópia manual própria foi reconstruída com o Shell final e API4500: login e navegação Sessões↔Clientes emdesktop/móvel aprovados; nome editado anteriormente persistido. Script observado no navegador tem GET igual ao dist; bytes em memória/APIloadedcommit não capturados. Uma novaJPEG original375×1017 foi publicada; galeria**38(9Android/20web/9iOS)**, provas29. A prova de CRUD28 anterior continua associada à fonte pré-Shell, sem reclassificação retroativa. Avisos de bundle/twoannotations mantidos; não bloqueiam o build, mas otimização permanece em melhorias.

040usersACL passou13 novos e dirigido199/18suítes, zero skips/fail; integralAPI ainda em andamento. Primeira11/13 tinha contextos de fixture incorretos e foi preservada. RED de ledger40vs39 comprovou dois backups e um caso de notificações; somente asserts de contagem/mensagem foram atualizados, verificações de dados/privilégios intactas. Notificações54/54 e restore040 **2/2**,49tabelas/40migrations,mesmo e clusters físicos distintos5464/5465,zero skips/fail passaram. A integralAPI em andamento teve uma falha de sessão após intervalo de relógio~13min; classificar pelo stack ao fim antes de repetir, sem alterarTTL/prazos. O novo gerador iOS continua candidato, exigindo host/revisão/Apple do SHA exato. Toda etapa maior/aparelhos/produção/docsfinal/cincovídeos permanece aberta.


### Revisão nativa: cleanup iOS e plano Android portável

A candidata iOS com 142 testes host ainda **não foi publicada**. A revisão independente identificou um bloqueador: quando o líder `xcrun` já saiu e um descendente conserva stdout, o timeout de 15 segundos podia deixar o grupo filho ativo. Um novo teste real reproduziu a falha. A correção restrita de cleanup passou no teste dirigido; a execução completa e a revisão final estão em andamento. Os 142 testes anteriores não cobriam essa variante. Preservar o guard ATS, TLS, prazos, Swift e assinatura normal. A nova versão exige testes aprovados, revisão e validação Apple do SHA exato antes de qualquer aceite autenticado. O checkpoint de seis arquivos anterior conserva a candidata anterior para recuperação, sem aprovação; recapturar após a correção.

O [plano do observador Android](superpowers/plans/2026-10-05-android-renderer-observer.md) agora acompanha o clone. Fonte RN 0.87.1 e assinaturas do AAR público foram examinadas; alterações de Kotlin/C++ em `node_modules` sozinhas não entram no APK precompilado. Desenho restrito: três classes via ASM no módulo app, buffer circular numérico fechado, com até 256 registros e exportação de até 64 KiB, logger/gates intactos; inclui inserção virtual, layout do alvo e do pai e stop assíncrono. Nenhuma implementação, DEX, build ou captura nativa desse observador foi realizada. A próxima prova ASM é descartável; a integração nos apps depende de revisão. Não atribuir ScrollView ou merge como causa.


### Executor iOS publicado e próximo aceite

`0e72f64` publicou a origem privada ATS estrita, após 143/143 host Linux e repetição Windows 121 aprovados/22 skips. A revisão fechou o descendente deixado ativo pelo cleanup anterior; a versão 142 permanece histórica. Guard ATS, Swift, TLS, assinatura e workflow foram preservados. [Fonte e prova host](evidencias/ios-strict-runner-0e72f64.json). O CI Apple do SHA exato está em execução; não há aceite autenticado. O checkpoint atual tem quatro rascunhos 040/DB na base 0e72f64, sem os arquivos iOS já publicados. Galeria 38, provas 30, vídeos completos ainda pendentes.


### Apple 0e72f64: duas fixtures host reprovadas antes do nativo

Identidade autenticada 37307304828 e os dois jobs de inicialização 37307304855 tiveram **143 testes: 141 aprovados, duas falhas, zero skips em cada job**. Falharam os casos de origem válida e do descendente após saída do líder. Banco, builds, geração real do agente Apple e XCTest não foram alcançados; metadados oficiais registram zero artefatos nos dois runs. [Prova 31 e hashes dos logs host](evidencias/ios-0e72f64.json). A causa ainda não está estabelecida. Alias de caminho macOS e interação da captura ps com o mock da fixture estão sendo reproduzidos; não alterar produto, guard ATS, prazos ou critérios sem evidência. Os 143 aprovados no Linux continuam uma execução histórica distinta.

### 06/10: relógio do estacionamento e edição de cadastros

- **Relógio do estacionamento — corrigido e verificado em12/10:** as projeções HTTP usam clock_timestamp do PostgreSQL na transação, após leituras/locks/escrita/auditoria; datas realmente futuras continuam UNKNOWN. Sete novos casos cobrem API60s atrás/à frente e espera real. Fonte atual integrada: dirigido54/54, API804/804 e ingestão129/129; catálogo/credenciais/ledger51 preservados. A fixture herdada de ativos também passa a restaurar o timestamp original do grant que removia temporariamente. [Evidência](evidencias/parking-database-clock-2026-10-12.json). O achado original foi a diferença de −30 a +34ms no Docker Desktop.
- **Cadastros 2B.4:** edição, desativação e reativação de bloco/unidade/equipe entregues em branch local com a 041. O código de bloco/unidade continua reservado por registros inativos; avaliar liberar o código ou permitir renomear o inativo.
- **Ordem das suítes de banco:** a restauração no mesmo cluster falhou quando rodada após a suíte SQL de notificações no mesmo cluster físico; investigar se a fixture depende de não haver outra entrega reivindicável.

### 06/10: convites e ordens de serviço

- **Resolvido em 07/10 (047):** o provedor escolhido foi o Resend e a recuperação foi entregue. A solicitação foi acrescentada aos dois apps na continuação de 07/10. Faltam o webhook de devolução do Resend e o ensaio de entrega real. Registro original: **Recuperação de senha depende de um canal de entrega.** Sem e-mail, a única recuperação possível seria um link gerado por terceiros (síndico ou plataforma), o que daria a quem gera o link o poder de assumir a conta. Decidir o provedor de e-mail antes de implementar; até lá a troca de senha exige a senha atual.
- **Convites nos apps nativos:** o aceite existe só no portal web do morador.
- **Ordens de serviço:** abertura/atribuição no app Operação verificada em 13/10 (código/host/bundles; aparelho pendente). Permanecem anexos e checklists, vínculo com chamado na tela, paginação além de 100, notificação ao responsável e abertura automática a partir de alerta. Avaliar uma chave de funcionalidade por condomínio.
- **Cliente HTTP web:** só trata 204 como resposta vazia; um 201 sem corpo quebra a leitura. A rota de anotações passou a devolver o registro criado; convém o cliente aceitar corpo vazio em qualquer 2xx.

### 07/10: recuperação de senha e e-mail

- **Ativar o Resend em produção:** verificar o domínio, preencher `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `PASSWORD_RESET_URL` e `RESIDENT_PORTAL_URL`, e ensaiar uma entrega real. Sem isso a recuperação existe mas não entrega nada.
- **Botão "Esqueci minha senha" nos apps nativos — código e provas de host entregues em 07/10:** formulário compartilhado Morador/Operação, transporte público sem sessão, cancelamento e confirmação genérica. Cliente 75/75, mobile 127/127 e quatro bundles JS Android/iOS; falta observação em aparelho e entrega real. [Evidência](evidencias/native-password-recovery-2026-10-07.json).
- **Webhook do Resend** para devoluções e reclamações, e reenvio de falhas do provedor; hoje a falha fica só no log.
- **Outros e-mails pelo mesmo módulo:** aviso de senha alterada, de MFA ativada/desativada e de novo acesso.
- **Push (APNs/FCM) saiu do escopo** por decisão do proprietário; os avisos seguem pelos canais já existentes.

### 07/10: inbox dos gateways

- **Reler [INBOX_DECISOES.md](INBOX_DECISOES.md)** e confirmar ou mudar: fila adiada, retained só como histórico, 5 minutos para regras, memória de eventos sem prazo.
- **Medir capacidade da ingestão** (leituras por segundo com banco real) antes de um condomínio grande; é o dado que decide se a fila separada é necessária.
- **Janela máxima de replay** quando o firmware do gateway estiver definido, para poder limpar `ingest_events`.
- **Tela dos contadores de recusa** para a administração da plataforma.
- **Tirar a conexão dona do banco da ingestão**, independentemente da fila.
- **Preservar a memória de eventos** quando um dispositivo é excluído e recriado com o mesmo identificador.

### 07/10: front-end

- **Fotos das áreas comuns** (upload pela administração) para os cartões de reserva, como no mockup.
- **Avisos não lidos:** registrar leitura por morador para mostrar o contador no sino.
- **Tela de Acessos do morador** no formato do mockup (dois botões grandes e últimos acessos) e **abertura de ocorrência por categoria** em grade de ícones; hoje usam os painéis compartilhados com a operação.
- **Unificar "Chamados" e "Ocorrências":** a navegação diz Ocorrências e o painel diz Chamados.
- **Minhas sessões:** mostrar "Chrome no Windows" em vez do identificador completo do navegador.

### 12/10: Consumo nativo sob liberação do síndico

- **Tela de Consumo do app Morador — código e provas de host/bundle verificados:** somente projeção diária 051 liberada, com menu e conteúdo na mesma leitura. Mobile 157/157, cliente 75/75, UI 93/93, quatro tipos e quatro bundles JS; duas revisões independentes aprovadas. [Evidência](evidencias/native-resident-consumption-2026-10-12.json). Falta observação em aparelho; empacotamento JS não aceita renderer nativo.
- **Retirada remota de acesso:** observada numa nova leitura; o polling de 15 s é agendado após o término do pedido. Não há retirada instantânea ou prazo máximo fixo.
- **Relógio do estacionamento:** publicado em `40fa2c3`, com SHA remoto confirmado; a fonte integrada manteve catálogo/ledger/credenciais e zero fixtures pendentes.

### 13/10: distribuição nativa de ordens

- **Abrir e atribuir no app Operação — código e provas de host/bundle verificados:** capacidade atual + lista autorizada, diretórios independentes, versões, geração de callbacks e confirmação incerta sem replay. A integral própria final passou mobile 219/219, cliente 75/75 e UI 93/93; quatro tipos/bundles e duas revisões aprovadas. [Evidência](evidencias/native-work-order-distribution-2026-10-13.json). Homologação em aparelho permanece pendente.
- **Buscas e botões antigos:** dois achados reproduzidos nas revisões foram corrigidos pela geração da ficha e dos handlers externos; os resultados 209/212 são anteriores, e o 219 final foi repetido pela raiz.
- **Menor privilégio da ingestão:** estruturar conexões por carga sem owner no processo produtivo, incluindo o dispatcher/ACK; o adiamento da fila 048 não entrega essa separação. Nenhuma role/migration desse recorte foi aplicada aqui.
