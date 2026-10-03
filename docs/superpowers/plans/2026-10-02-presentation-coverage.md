# Cobertura das demonstrações finais

Pedido do proprietário: abrir os websites e os dois aplicativos neste computador e entregar uma gravação completa de cada sistema após concluir o plano. Este documento é o inventário preparatório, baseado nas rotas e telas atuais. **Nenhuma gravação final foi produzida ou aprovada ainda.** Conferir novamente o inventário após os novos domínios do plano de produto.

## Arquivos e evidência de conclusão

Entregar cinco vídeos separados em `outputs`, fora do Git: administração, operação web, morador web, Morador Android e Operação Android. Cada um terá um roteiro com capítulos e tempos reais, commit do sistema demonstrado, resolução, ambiente e perfil utilizado. Gravação de Android em emulador deve ser identificada como tal. Os apps iOS já abriram e reabriram no simulador do runner Apple em `b4726b9`, com imagens inspecionadas; isso não constitui demonstração completa nem execução nativa neste Windows.

A [galeria versionada](../../IMAGENS_DOS_SISTEMAS.md) e `outputs/IMAGENS_DOS_SISTEMAS.html` contêm dez capturas reais: três Android, cinco web e duas iOS. As duas novas imagens mostram auditoria global/local; as dez conservam origem, SHA-256 e limites no manifesto. A galeria e as imagens acompanham o ZIP portátil, cujo carregamento e controles são verificados também depois da extração, sem servidor. Estado consolidado e recuperação: [CONTINUIDADE.md](../../CONTINUIDADE.md). As capturas atendem à prévia visual solicitada; os cinco vídeos permanecem pendentes.

Antes de gravar, criar um ambiente de apresentação isolado, com nomes fictícios coerentes, dois condomínios, gestores, moradores e uma equipe com concessões limitadas. Configurar leituras e histórico suficientes para diferenciar dado atual, histórico, ausência de leitura, pausa e acesso parcial. Preparar segundo usuário/dispositivo para conversas, reservas e revogação de sessões. Não modificar os bancos das regressões enquanto estiverem em execução.

Fazer a entrada antes de iniciar a captura; nunca mostrar senhas, tokens, consoles de autenticação, chaves ou dados reais. Demonstrar operações de hardware somente com controlador/broker de teste claramente identificado no roteiro. Mostrar a preparação de suporte remoto e seu histórico sem abrir sessão em computador de terceiros. Os vídeos não devem sugerir que provedores externos ou aparelhos físicos indisponíveis foram homologados.

## Administração web

| Rota atual | Conteúdo a demonstrar |
| --- | --- |
| `/` | Resumo agregado; diferença entre totais disponíveis, zero e escopo indisponível. |
| `/clientes` | Lista, cadastro e edição de cliente/organização conforme autoridade vigente. |
| `/predios` | Cadastro de condomínio, organização, endereço e seleção. |
| `/gateways` | Comunicação, vínculo do gateway, estado e configuração permitida. |
| `/dispositivos` | Cadastro e configuração de equipamento, tipo e vínculo; diferenciação entre consulta e gestão. |
| `/operacao` | Seleção de imóvel e módulos de consumo, acessos e vagas, respeitando concessões locais. |
| `/suporte-remoto` | Cadastro fictício do computador, motivo, preparação, resultado e histórico do atendimento. |
| `/alertas` | Alertas e seus estados, incluindo atualização recebida do serviço de teste. |
| `/usuarios` | Cadastro e vínculos; privacidade e restrições dos papéis após a migração pendente. |
| `/unidades-equipes` | Blocos, unidades, pessoas, equipes, vínculos com vigência, motivo e revogação. |
| `/funcionalidades` | Configuração global/local, herança, justificativa, pausa e retomada. |
| `/auditoria` | Histórico036: escopos global/local/exato, páginas de25, atualização, erro/retry e vazio autorizado. Uma concessão global não lê histórico privado implicitamente. |
| `/sessoes` | Sessão atual, outros dispositivos, encerradas/expiradas, confirmação de revogação e saída de todos os dispositivos. |

“Minhas sessões” já está implementado e coberto pela matriz de navegador. Conferir administração comercial, planos/assinaturas e suporte com concessão explícita quando a etapa4 estiver integrada; as rotas futuras não estão contabilizadas como implementadas.

## Operação web do condomínio

| Rota atual | Conteúdo a demonstrar |
| --- | --- |
| `/` | Resumo completo e perfil com resumo parcial, incluindo contador de chamados. |
| `/agua` | Reservatório e medições; estado sem leitura ou leitura antiga. |
| `/energia` | Energia, fases e histórico disponível. |
| `/consumo` | Consumos, períodos, análise, limites e configuração permitida. |
| `/sensores` | Gás, fumaça, vazamento e estados dos sensores. |
| `/acessos` | Configuração permitida, disponibilidade, intenção de abertura e resultado do simulador; sem reenvio automático. |
| `/vagas` | Carros/motos, capacidade, contagem manual, sensor, origem/frescor e concorrência de edição. |
| `/dispositivos` | Inventário e configuração de recursos concedidos. |
| `/alertas` | Consulta, reconhecimento e resolução com permissões independentes por recurso. |
| `/regras` | Criação, edição, habilitação, recurso concedido e retirada dos controles após revogação. |
| `/chamados` | Fila, conversa, andamento, gravidade/justificativa e grupo; concessão exata não atua no vizinho oculto. |
| `/transparencia` | Informes, rascunho financeiro, lançamentos, publicação e nova revisão sem alterar a anterior publicada. |
| `/avisos` | Comunicado, agenda, repetição semanal, fuso, publicação futura, expiração e edição. |
| `/areas` | Áreas comuns e aprovação/rejeição de reservas; acompanhamento das confirmadas. |
| `/unidades-equipes` | Cadastros locais e concessões autorizadas, incluindo vencimento/revogação. |
| `/auditoria` | Histórico do condomínio em uso, concessão exata, paginação, atualização, perda de permissão e troca de condomínio/conta sem resposta antiga. |
| `/sessoes` | Identificação da conexão atual, revogação de outro dispositivo, confirmação cancelável e encerramento de todas as conexões da própria conta. |

Acrescentar ativos, ordens de serviço e automações quando implementados. Mostrar troca de condomínio descartando os dados e rascunhos do anterior, menu responsivo e recuperação de uma falha de leitura. Na gestão de sessões já existente, mostrar a conclusão da saída mesmo após navegar para outra página durante a revogação.

## Morador web

| Rota atual | Conteúdo a demonstrar |
| --- | --- |
| `/` | Resumo e nível de água publicado, sem inventário privado. |
| `/avisos` | Somente avisos publicados e agenda pertinente. |
| `/acessos` | Acessos permitidos e resultado do simulador, incluindo indisponibilidade. |
| `/consumo` | Projeções e períodos autorizados ao morador. |
| `/vagas` | Disponibilidade de carros/motos, origem e frescor da informação. |
| `/chamados` | Criar solicitação, acompanhar resposta, comentar e cancelar a própria; não mostrar vizinho. |
| `/transparencia` | Informes e prestação publicada, expansão dos lançamentos; rascunhos permanecem privados. |
| `/reservas` | Calendário que mostra somente horários ocupados, reserva, conflito, aprovação e cancelamento. |
| `/perfil` | Identidade, quantidade de condomínios, painel de sessões já integrado, confirmação de revogação e saída. |

## Aplicativos Android

No Morador, cobrir seleção/troca de condomínio e as cinco telas atuais: Avisos, Solicitações, Reservas, Transparência e Acessos. Demonstrar criação/conversa/cancelamento de solicitação, reserva com conflito e decisão da gestão, lançamentos publicados e uma intenção de abertura no simulador. Mostrar restauração após novo processo, retomada do segundo plano, retirada de uma concessão e saída.

No Operação, cobrir seleção/troca e as quatro telas atuais: Resumo, Alertas, Sensores e Solicitações. Mostrar concessão exata, resumo parcial, reconhecimento/resolução quando autorizados, leitura do equipamento, andamento e conversa do chamado. Retirar uma concessão com a tela aberta e retomar o aplicativo, confirmando remoção dos dados e controles. Incluir restauração de sessão e saída.

Notificações, novos domínios, anexos e outras telas devem ser adicionados a este inventário somente quando implementados. Não narrar uma função planejada como função disponível no vídeo. Testes de API, builds ou capturas avulsas não substituem o percurso gravado.

## Verificação e entrega

- [ ] Reconciliar este inventário com a fonte final e o estado real das funcionalidades.
- [ ] Vincular cada capítulo a dados fictícios preparados e ao respectivo teste de comportamento.
- [ ] Executar os percursos completos, sem erros ocultados por cortes ou repetição de mutações.
- [ ] Abrir e assistir a cada arquivo; conferir legibilidade, começo/fim, todas as ações do roteiro e ausência de credenciais.
- [ ] Registrar duração/resolução e capítulos reais, com cobertura e limites explícitos.
- [ ] Deixar os cinco sistemas disponíveis para inspeção local e entregar links dos vídeos em `outputs`.

O computador não será reiniciado durante esta sessão. Reiniciar processo de aplicativo, servidor ou emulador de teste não deve ser descrito como reinício do computador.
