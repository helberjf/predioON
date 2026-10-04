# Melhorias e novas implementações — Prédio ON

Revisão: 03/10/2026. Documento vivo de priorização; não é uma declaração de conclusão nem substitui o [PRD](PRD.md), o [TDD](TDD.md) e o [plano de execução](superpowers/plans/2026-09-27-product-execution.md).

## 1. Como usar este documento

Antes de iniciar um item, conferir sua situação no código e nos testes do commit atual. Um recurso só deve ser marcado como concluído quando sua API, autorização, interface aplicável e validação estiverem integradas. Um build bem-sucedido comprova compilação; não comprova homologação em aparelho ou equipamento físico.

Prioridades: **P0** bloqueia uma entrega confiável; **P1** completa a operação do produto; **P2** melhora a experiência; **P3** é uma hipótese para avaliar com usuários. Dependências externas devem ser registradas sem incluir senhas, tokens, certificados ou dados pessoais reais.

## 2. Pendências do escopo já aprovado

Estes itens já pertencem à evolução prevista. Não devem ser apresentados como ideias opcionais para encobrir trabalho pendente.

Estado consolidado em [CONTINUIDADE.md](CONTINUIDADE.md). Cookies web/CSRF, coordenação entre abas e gestão das próprias sessões já foram implementados e testados. O executor de migrations com checksum/lock/no-op e a restauração local real até037 também estão entregues; implantação e recuperação do ambiente de produção continuam pendentes. Esses itens saíram da lista de implementações a iniciar e devem permanecer na regressão.

Progresso038 em03/10: outbox/worker de webhook, produtores atômicos, role própria e restauração em outro cluster estão integrados no incremento038. Passaram SQL54, worker36 Linux, ingestão123, backup2, API697 e cliente64/UI89/mobile75. A fixture de provisionamento foi corrigida preservando o endurecimentoNOLOGIN. Playwright038 passou222/222, três motores/0 retries; conferir novos jobs CI e implantação; [guia e limites](NOTIFICACOES_DURAVEIS.md). Não fecha inbox, privilégio mínimo da ingestão inteira, retenção/replay ou idempotência do provedor. Android1f concluiu domínios16/20 e senha29/29, mas persistem20 SoftExceptions de domínios e1 de senha; a reprodução mínima está sendo preparada. CIiOSa9 passou banco/ambos Releases e falhou no checkHTTPS antes do XCTest; prontidão corrigida em53a28ce com64 testes Linux e nova jornada macOS em andamento.

| Prioridade | Trabalho | Resultado esperado | Critério de aceite |
|---|---|---|---|
| P0 | Concluir autorização por capacidade nos domínios restantes | Acesso depende da concessão atual ao condomínio e ao recurso | HTTP e SQL negativos; revogação, expiração, equipe inativa e troca de condomínio sem vazamentos; nenhum privilégio global implícito sobre dados privados |
| P0 | MFA e verificação adicional para ações privilegiadas | Proteção adicional da administração e de operações sensíveis | Cadastro, desafio, recuperação e revogação; limites de tentativas; proteção contra reutilização; testes sem segredos reais |
| P1 | Convites e recuperação de senha | Entrada e recuperação sem distribuição manual de senhas | Tokens de uso único, expiração, revogação e respostas sem enumeração de contas; provedor de envio configurável |
| P0 | Inbox, outbox e workers duráveis | Trabalho obrigatório sobrevive à queda de processo | Ensaios de interrupção antes/depois do commit, deduplicação, reserva com prazo e recuperação; filas não repetem comandos físicos indiscriminadamente |
| P0 | Credenciais restritas para ingestão e workers | Processos de runtime deixam de usar a conexão proprietária | Matriz de privilégios e testes de operações negadas por processo; bootstrap/migrations continuam separados |
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
| P1 | Consolidar a matriz de testes já existente em Chromium, Firefox e WebKit | Preservar a integral222/222 dos três portais compilados, três motores e0 retries, aprovada localmente e no CI3035245; ampliar para novos módulos sem somar dirigidos como integral |
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
3. Entregar processamento durável e privilégios por carga.
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

Troca de senha e revogação atômica de todas as famílias já foram entregues na API, três portais e dois apps. MFA, convites e recuperação continuam no escopo pendente; não confundir recuperação com troca autenticada. Priorizar aceite Android/iOS e processamento durável038, preservando credenciais restritas, pausa e testes negativos.

Como melhoriaP1, manter um índice de evidências por commit com versão da fonte, suite integral, ausência de skips/retries e limites de cada imagem. Um teste React host não aprova Fabric, build não aprova sessão nativa e capturas de uma fase não aprovam toda a jornada. Galeria19 versionada; cinco vídeos ainda pendentes. O próximo ensaio Android deve reprovar na primeira MissingViewState ou removeViewAt/index-mismatch, com fase/seq/horário/PID para ligar o erro à transição real, sem declarar sua causa por correlação com GC ou teclado.
