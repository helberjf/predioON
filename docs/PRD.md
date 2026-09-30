# PRD — Prédio ON

Documento de requisitos de produto. Revisão de 30/09/2026.

Escrito a partir do código desta árvore, da [arquitetura de produto aprovada em 27/09/2026](superpowers/specs/2026-09-27-arquitetura-produto-design.md),
do [tracker de execução](superpowers/plans/2026-09-27-product-execution.md) e do
[último plano criado, de 29/09/2026](superpowers/plans/2026-09-29-rbac-domain-migration.md).
O desenho técnico correspondente está em [TDD.md](TDD.md).

**Como ler o estado de cada item.** Três marcações, nunca misturadas:

| Marca | Significado |
|---|---|
| **Entregue** | Existe no código já commitado da plataforma web/API/ingestão e tem teste ou validação registrada |
| **Em execução** | Está sendo implementado agora na linha de trabalho `codex/product-platform`, ainda **não commitada** e não mesclada |
| **Planejado** | Definido na arquitetura de 27/09, sem implementação |

## 1. Visão

Prédio ON centraliza o monitoramento da infraestrutura do imóvel (caixa d'água, energia, bomba,
vazamentos, gás, fumaça, temperatura), o consumo com custo estimado, os alertas, os acessos
autorizados aos portões e a rotina de convivência do condomínio — avisos, reservas, chamados,
transparência e prestação de contas — em uma plataforma multi-cliente com banco central e
isolamento por condomínio.

**Proposta de valor.** O síndico enxerga em uma tela o que hoje depende de ronda, aviso de porta
e conversa de grupo; o morador consulta o que lhe é autorizado sem intermediar pedidos; a equipe
de manutenção recebe o que precisa sem ganhar poderes de gestão; o operador da plataforma
administra vários condomínios com isolamento de dados, auditoria e controle de funcionalidades.

**Não é.** Não é sistema de segurança certificado, não substitui central de incêndio (NBR 17240),
não protege circuito elétrico (isso é relé físico), não faz conciliação bancária nem cobrança do
condomínio, não prevê falhas de equipamento e não mede posição física de portão.

## 2. Problema

| Dor | Situação sem a plataforma | O que a plataforma entrega |
|---|---|---|
| Caixa d'água esvazia sem aviso | Descoberta pela falta de água no apartamento | Nível, volume, histórico e alerta por limite |
| Falta de fase queima equipamento | Percebida pelo dano | Tensão/corrente por fase, frequência e regras de limite |
| Bomba trabalha demais | Conta alta no fim do mês | Tempo diário e contínuo, limites e desvio sobre o histórico |
| Vazamento oculto | Consumo inexplicado | Sensores de vazamento e comparação do hidrômetro com a referência aprendida |
| Abertura de portão | Chave física, controle avulso, telefone | Pedido autorizado, comando com prazo, confirmação do controlador e auditoria |
| Avisos e reservas informais | Papel no elevador e grupo de mensagens | Avisos programados com repetição e reservas com aprovação e conflito |
| Chamados perdidos | Reclamação verbal sem protocolo | Chamado com gravidade, respostas, histórico e agrupamento de repetidos |
| Desconfiança na gestão | Prestação de contas opaca | Atualizações públicas e relatório mensal com comprovantes e revisões preservadas |
| Atendimento remoto | Visita técnica para tudo | Cadastro do computador, preparação do acesso AnyDesk e registro do resultado |
| Manutenção sem rastro | Ordem verbal, sem responsável nem histórico do ativo | Ordens de serviço, responsáveis e histórico por ativo (**planejado**) |

## 3. Produtos

Hoje (**entregue**): três aplicações web — administrador da plataforma, síndico e morador (web
adaptada a celular) — sobre uma API central.

Destino aprovado em 27/09/2026 (**planejado**, exceto onde indicado):

| Produto | Público | Responsabilidade | Estado |
|---|---|---|---|
| Painel web administrativo | Equipe da plataforma | Clientes, condomínios, planos, assinaturas, provisionamento, suporte, auditoria e saúde do serviço | Entregue; planos/assinaturas planejados |
| Painel web do síndico | Síndico e gestores autorizados | Gestão do condomínio: usuários e equipes, configuração, relatórios, contas, regras, automações e rotina | Entregue; equipes e automações planejados |
| Portal web do morador | Moradores | Consultas autorizadas, avisos, reservas, chamados, contas e acessos permitidos | Entregue, preservado por compatibilidade |
| App Prédio ON Morador (Android/iOS) | Moradores | Experiência simples, sem configuração técnica nem dashboards de operação | Planejado — React Native **sem Expo** |
| App Prédio ON Operação (Android/iOS) | Síndico e manutenção | Dashboards, alertas, sensores, equipamentos, ordens de serviço, automações e ações operacionais conforme permissão | Planejado — React Native **sem Expo** |

Regras de produto que valem desde já: não existe aplicativo móvel administrativo da plataforma;
os quatro produtos principais compartilham a **mesma** API e as mesmas políticas de autorização;
entrar no app de Operação não concede privilégios de síndico; a identidade do usuário é central,
uma pessoa usa os dois aplicativos sem conta duplicada.

## 4. Personas e papéis

Hoje o código tem três papéis ordenados (`PLATFORM_ADMIN`, `BUILDING_ADMIN`, `RESIDENT` em
`packages/shared/src/roles.ts`, comparados por `hasAtLeast`) com vínculo por imóvel em
`memberships`. A arquitetura aprovada substitui essa hierarquia linear por RBAC explícito —
sujeito + ação + condomínio/escopo + recurso + condição atual.

| Persona | Papel de destino | Precisa | Limites |
|---|---|---|---|
| Morador | `Morador` | Avisos, próprios chamados e reservas, informações autorizadas, contas publicadas, acesso concedido | Sem cadastro técnico, sem dados de terceiros, sem automações |
| Síndico / gestor | `Síndico` | Gestão do condomínio, equipe, operação, relatórios, automações autorizadas | Somente condomínios concedidos; delega apenas papéis delegáveis daquele escopo |
| Técnico de manutenção | `Manutenção` | Leituras e alertas necessários, ordens atribuídas, registro de execução | Sem financeiro, sem gestão de usuários; comando físico exige concessão própria |
| Coordenador de manutenção | `Gestor de manutenção` | Distribuir ordens e supervisionar a equipe nos escopos concedidos | Não recebe poderes de síndico |
| Suporte da plataforma | `Suporte` | Diagnóstico e atendimento autorizado | Concessão temporária por condomínio, com motivo, prazo e auditoria; sem personificação silenciosa |
| Operador da plataforma | `Administrador da plataforma` | Clientes, planos, provisionamento, administração global | Permissões globais explícitas; sem bypass universal de leitura privada ou atuação física |
| Técnico de campo | ator externo | Instalar sensores, configurar gateway, comissionar | Não é usuário da plataforma |

Um usuário pode ter vínculos em vários imóveis, com papel e vigência por vínculo. Conta inativa
ou vínculo fora da vigência perde acesso mesmo com token ainda válido (**entregue**). Equipes,
unidades e concessões por recurso são **em execução** (etapa 2B).

## 5. Objetivos e não-objetivos

**Objetivos da versão atual**

1. Monitorar as grandezas contratadas com contrato de dados explícito e rejeição do que não o cumpre.
2. Isolar dados por condomínio em duas camadas: autorização na API e RLS no banco.
3. Operar acessos autorizados sem nunca prometer abertura que o controlador não confirmou.
4. Dar ao operador controle por condomínio de cada funcionalidade, com justificativa e auditoria.
5. Registrar convivência, transparência e contas com histórico preservado.
6. Funcionar sem hardware para demonstração e homologação, por simulador.

**Objetivos da evolução aprovada**

7. Autorização por capacidade, com equipes, unidades e concessões temporárias de suporte.
8. Processamento durável (inbox/outbox/jobs) para que reinício não perca nem duplique trabalho.
9. Domínios novos: ativos, ordens de serviço, automações versionadas, planos e assinaturas.
10. Dois aplicativos nativos com push contextual, cada um restrito ao seu público.
11. Operação comprovável: migrações registradas, credenciais por carga, backup restaurado e observabilidade.

**Não-objetivos (decisão, não pendência)**

- Disjuntor e extintor, retirados do escopo por instrução do cliente.
- Detecção própria de incêndio; a plataforma supervisiona contato seco de central certificada.
- Aplicativo móvel administrativo da plataforma.
- Cobrança automática do SaaS por provedor de pagamento (integração separada), conciliação bancária e cobrança do condomínio.
- CFTV e execução de scripts arbitrários por automação.
- Manutenção preditiva e diagnóstico automático de causa.
- Microserviço e banco por domínio; banco permanece central.

## 6. Métricas de sucesso

Indicadores **propostos**; a instrumentação é parte da etapa 6 da execução.

| Indicador | Definição | Alvo inicial |
|---|---|---|
| Leituras aceitas | Mensagens gravadas ÷ recebidas, por condomínio | ≥ 99% em regime |
| Disponibilidade do gateway | Tempo `ONLINE` ÷ tempo total | ≥ 99% mensal |
| Latência ponta a ponta | Publicação no broker → valor visível na tela | < 5 s no p95 |
| Idade da fila | Lag da inbox e idade da outbox | < 60 s no p95 |
| Alerta acionável | Alertas reconhecidos ÷ abertos | ≥ 80% |
| Confirmação de acesso | Comandos `ACKNOWLEDGED` ÷ enviados | ≥ 98% |
| Ordem de serviço concluída | Ordens fechadas no prazo ÷ abertas | ≥ 85% |
| Uso pelo morador | Moradores ativos no mês ÷ cadastrados | ≥ 40% |
| Recuperação | RPO ≤ 15 min e RTO ≤ 4 h | Meta a validar em ensaio |

## 7. Requisitos funcionais

Prioridade: **P0** essencial, **P1** complementar, **P2** evolução. A matriz de evidências da
versão entregue está em [REVISAO_FUNCIONALIDADES.md](REVISAO_FUNCIONALIDADES.md).

### 7.1 Identidade e sessão

| ID | Requisito | Prio | Estado |
|---|---|---|---|
| RF-01 | Login por e-mail e senha, senha em Argon2 | P0 | Entregue |
| RF-02 | Access token curto e refresh token opaco armazenado por hash | P0 | Entregue |
| RF-03 | Rotação atômica do refresh com detecção de reutilização e invalidação da família | P0 | Em execução (2A concluída: 9/9 testes) |
| RF-04 | Assinatura assimétrica (Ed25519) com `kid` e rotação de chave | P0 | Em execução (2A concluída: 4/4 testes) |
| RF-05 | Listar e revogar sessões e dispositivos; revogar todas em incidente | P1 | Em execução |
| RF-06 | Web com refresh em cookie `HttpOnly` e proteção CSRF; mobile em Keychain/Keystore | P0 | Planejado (2C) |
| RF-07 | MFA para administração da plataforma e ações privilegiadas do síndico | P0 | Planejado (2C) |
| RF-08 | Convites e recuperação por token de uso único com expiração; limite de tentativas | P1 | Planejado (2C) |

### 7.2 Autorização, tenancy e auditoria

| ID | Requisito | Prio | Estado |
|---|---|---|---|
| RF-09 | Autorização por papel e vínculo verificados no banco a cada requisição | P0 | Entregue |
| RF-10 | Isolamento por condomínio também no banco, por RLS com conexão não-dona | P0 | Entregue |
| RF-11 | Catálogo explícito de permissões, papéis e concessões por condomínio/recurso | P0 | Em execução (2B.1 concluída) |
| RF-12 | Blocos, unidades, vínculo de unidade, equipes e integrantes | P0 | Em execução (2B.1) |
| RF-13 | Concessão temporária de suporte com motivo, prazo, escopo e revogação imediata | P0 | Em execução (2B.1/2B.3) |
| RF-14 | Credenciais de banco separadas por carga, sem senha de proprietário em processo de runtime | P0 | Em execução (2B.2, migração `015`) |
| RF-15 | Migrar os módulos existentes de papel ordenado para capacidade, sem mudar rotas | P0 | Em execução (2B.3 — plano de 29/09) |
| RF-16 | Auditoria de acréscimo com ator real, concessão usada, escopo, recurso e resultado | P0 | Entregue; ampliada em 2B |
| RF-17 | Revogação imediata: conta inativa, papel revogado ou concessão expirada bloqueia a próxima operação | P0 | Entregue e reforçado em 2B |

*Aceite RF-10/RF-15:* consulta autenticada sem filtro explícito retorna zero linhas em vez de
dados de outro condomínio; `INSERT`/`UPDATE` direto fora da capacidade falha no banco.

### 7.3 Cadastro, equipamentos e provisionamento

| ID | Requisito | Prio | Estado |
|---|---|---|---|
| RF-18 | Organizações/clientes e imóveis (condomínio, casa, comercial) com fuso IANA | P0 | Entregue |
| RF-19 | Gateways com credencial MQTT emitida no painel | P0 | Entregue |
| RF-20 | Dispositivos, métricas expostas e mapeamento Modbus em `metadata` | P0 | Entregue |
| RF-21 | Usuários e vínculos com papel e vigência | P0 | Entregue |
| RF-22 | Regras de alerta por dispositivo/métrica com operador, limite, gravidade e cooldown | P0 | Entregue |
| RF-23 | Perfis de consumo: tarifa, limites diário/contínuo e parâmetros do modelo adaptativo | P1 | Entregue |
| RF-24 | Ativos físicos, vínculo ativo–dispositivo e capacidades suportadas pelo firmware | P1 | Planejado (etapa 4) |
| RF-25 | Rotação e revogação de credencial por gateway, com certificado de cliente quando o hardware permitir | P0 | Planejado (Fase 3) |

### 7.4 Telemetria e monitoramento

| ID | Requisito | Prio | Estado |
|---|---|---|---|
| RF-26 | Receber leituras MQTT em contrato versionado e validado, descartando o que não o cumpre | P0 | Entregue |
| RF-27 | Gravar a mesma leitura uma única vez, mesmo com reentrega QoS 1 | P0 | Entregue |
| RF-28 | Caixa d'água: nível, volume e distância, com contrato compacto do gateway | P0 | Entregue |
| RF-29 | Elétrica: tensão e corrente das três fases e frequência | P0 | Entregue |
| RF-30 | Bomba: estado, tempo contínuo e total diário | P0 | Entregue |
| RF-31 | Vazamento de água e de esgoto como pontos distintos | P0 | Entregue |
| RF-32 | Gás (detecção e ppm), fumaça (relé da central) e temperatura | P0 | Entregue |
| RF-33 | Atualização de tela em tempo real sem recarregar | P0 | Entregue (SSE) |
| RF-34 | Detectar equipamento e gateway sem comunicação e alertar | P0 | Entregue |
| RF-35 | Histórico consultável por período e métrica, com janela e paginação limitadas | P0 | Entregue; limites revistos na etapa 4 |
| RF-36 | Estado atual em projeção própria, sem varrer o histórico bruto | P1 | Planejado (etapa 3) |
| RF-37 | Recepção durável: mensagem válida persistida em inbox antes da confirmação de transporte | P0 | Planejado (etapa 3) |

*Aceite RF-26:* a identidade é a do tópico. Divergência entre tópico e corpo, dispositivo não
cadastrado no condomínio, valor fora do intervalo do contrato ou unidade diferente da esperada
resultam em descarte com log, sem gravação parcial.

### 7.5 Consumo, custo e análise

| ID | Requisito | Prio | Estado |
|---|---|---|---|
| RF-38 | Consumo de água e energia por diferença de medidor, por dia do fuso do condomínio | P0 | Entregue |
| RF-39 | Custo estimado pela tarifa configurada, identificado como estimativa | P0 | Entregue |
| RF-40 | Alerta por limite diário de quantidade, de custo e por ciclo contínuo da bomba | P0 | Entregue |
| RF-41 | Referência estatística aprendida com até 28 dias válidos e alerta de desvio | P1 | Entregue |
| RF-42 | Lacuna, reset e dia incompleto ficam sem cálculo e fora do aprendizado, com cobertura exibida | P0 | Entregue |
| RF-43 | Previsão de falha, correlação entre sensores e causa raiz | P2 | Futuro |

*Aceite RF-41:* sem histórico suficiente a tela informa "aprendendo"; o alerta cita valor
observado, referência, dias válidos e variação.

### 7.6 Alertas e notificações

| ID | Requisito | Prio | Estado |
|---|---|---|---|
| RF-44 | Gerar alerta quando a leitura atende à regra, respeitando cooldown | P0 | Entregue |
| RF-45 | Reconhecer e resolver alerta com autor e horário | P0 | Entregue |
| RF-46 | Um alerta por tipo por dia para desvios de consumo | P1 | Entregue |
| RF-47 | Encaminhar `HIGH`/`CRITICAL` a integrador externo por webhook | P1 | Entregue |
| RF-48 | Push por FCM/APNs com destinatário calculado no servidor e preferência por categoria | P1 | Planejado (etapa 5) |
| RF-49 | Push sinaliza atualização; abrir a notificação reconsulta a API e reexige autorização | P0 | Planejado (etapa 5) |
| RF-50 | WhatsApp/e-mail automáticos | P2 | Depende de integração contratada |

### 7.7 Acessos e comandos físicos

| ID | Requisito | Prio | Estado |
|---|---|---|---|
| RF-51 | Cadastrar portão de garagem e de pedestres vinculado a gateway e controlador | P0 | Entregue |
| RF-52 | Habilitar o portão e autorizar (ou não) abertura por morador | P0 | Entregue |
| RF-53 | Solicitar abertura e receber recusa explicada quando indisponível | P0 | Entregue |
| RF-54 | Publicar comando só para o portão autorizado, com expiração de 15 s | P0 | Entregue |
| RF-55 | Registrar confirmação do controlador (ACK) e resultado executado/recusado | P0 | Entregue |
| RF-56 | Pedido repetido não aciona o equipamento duas vezes | P0 | Entregue |
| RF-57 | Auditar pedido, envio, confirmação, falha e expiração | P0 | Entregue |
| RF-58 | Único caminho de atuação: nenhum app, automação ou worker publica comando fora do módulo | P0 | Entregue por construção; reafirmado na etapa 3 |
| RF-59 | Sem replay: comando expirado nunca é reenviado, nem após reconexão | P0 | Entregue |
| RF-60 | Medir posição física do portão | — | Fora de escopo |

*Aceite RF-53:* a recusa nomeia a causa — sem permissão, portão desativado, abertura por morador
não autorizada, funcionalidade pausada ou equipamento sem comunicação recente (60 s).

### 7.8 Vagas, avisos e reservas

| ID | Requisito | Prio | Estado |
|---|---|---|---|
| RF-61 | Capacidade, ocupação e disponibilidade separadas para carro e moto | P0 | Entregue |
| RF-62 | Atualização manual pela gestão ou por sensor/contador | P0 | Entregue |
| RF-63 | Dado antigo ou ausente exibido como desconhecido, nunca como zero ocupação | P0 | Entregue |
| RF-64 | Avisos por categoria com publicação programada e repetição semanal | P0 | Entregue |
| RF-65 | Atalhos de rotina (coleta, limpeza do hall, reunião) sobre o mesmo modelo | P1 | Entregue |
| RF-66 | Reserva de área comum com aprovação e bloqueio de conflito | P0 | Entregue |
| RF-67 | Agendamento não duplica aviso após reinício ou com duas instâncias | P0 | Entregue (relógio do banco); reforçado na etapa 3 |

### 7.9 Chamados, manutenção, transparência e contas

| ID | Requisito | Prio | Estado |
|---|---|---|---|
| RF-68 | Abrir chamado nos dois portais, com protocolo e histórico | P0 | Entregue |
| RF-69 | Três gravidades, alteração com justificativa obrigatória e histórico ao solicitante | P0 | Entregue |
| RF-70 | Sugerir e agrupar relatos repetidos sob confirmação da gestão | P1 | Entregue |
| RF-71 | Resposta comum e conclusão do grupo | P1 | Entregue |
| RF-72 | Atualizações públicas da gestão preservando o relato particular do morador | P0 | Entregue |
| RF-73 | Relatório mensal em centavos com receitas, despesas, saldo e comprovante por link | P0 | Entregue |
| RF-74 | Rascunho invisível ao morador e publicação com revisões preservadas | P0 | Entregue |
| RF-75 | Ordem de serviço com responsável, checklist, anexo e histórico do ativo, vinculável ao chamado | P1 | Planejado (etapa 4) |
| RF-76 | Conciliação bancária, cobrança e pagamento do condomínio | P2 | Futuro |

### 7.10 Automações

| ID | Requisito | Prio | Estado |
|---|---|---|---|
| RF-77 | Regra versionada com gatilho, condição, ação, cooldown e histórico de execução | P1 | Planejado (etapa 4) |
| RF-78 | Começa desativada, permite simulação e usa só capacidades homologadas (notificar, criar ordem, solicitar comando suportado) | P0 | Planejado |
| RF-79 | Executa por identidade de serviço limitada ao condomínio, nunca pelo token de um síndico | P0 | Planejado |
| RF-80 | Telemetria atrasada, de qualidade inválida ou replay histórico não dispara atuação | P0 | Planejado |
| RF-81 | Execução de script arbitrário | — | Fora de escopo |

### 7.11 Funcionalidades, planos e assinaturas

| ID | Requisito | Prio | Estado |
|---|---|---|---|
| RF-82 | 23 funcionalidades ligadas/desligadas globalmente e por condomínio, com herança | P0 | Entregue |
| RF-83 | Justificativa de 3 a 1.000 caracteres em cada alteração | P0 | Entregue |
| RF-84 | Dependências respeitadas (agrupamento e gravidade dependem de chamados) | P0 | Entregue |
| RF-85 | Bloqueio efetivo na API, com `403` e `FEATURE_DISABLED` | P0 | Entregue |
| RF-86 | Conflito de edição simultânea retorna `409`, sem sobrescrever | P0 | Entregue |
| RF-87 | Auditoria `FEATURE_CONFIGURATION_CHANGED` com escopo, motivo e valores | P0 | Entregue |
| RF-88 | Efeitos de pausa e retomada conforme [FUNCIONALIDADES.md](FUNCIONALIDADES.md) | P0 | Entregue |
| RF-89 | Catálogo de planos versionado, assinatura por condomínio e histórico de vigência | P1 | Planejado (etapa 4) |
| RF-90 | Quotas (gateways, dispositivos, usuários, armazenamento) verificadas no servidor, inclusive em concorrência | P1 | Planejado |
| RF-91 | Plano contratado não eleva permissão; inadimplência não pausa sensor nem mexe em portão sem política explícita e auditada | P0 | Planejado, regra já fixada |

*Aceite RF-88:* durante a pausa de um sensor, as leituras daquele recurso são descartadas e o
heartbeat continua; na retomada o medidor estabelece nova referência, o dia afetado fica
incompleto e fora do aprendizado, e as vagas voltam como desconhecidas.

### 7.12 Suporte remoto e operação sem hardware

| ID | Requisito | Prio | Estado |
|---|---|---|---|
| RF-92 | Cadastrar o computador do condomínio (AnyDesk) por imóvel | P1 | Entregue |
| RF-93 | Solicitar acesso com autorização e auditoria e abrir no cliente instalado | P1 | Entregue |
| RF-94 | Registrar manualmente o resultado do atendimento | P1 | Entregue |
| RF-95 | Confirmar automaticamente a sessão externa | — | Não é possível pelo AnyDesk |
| RF-96 | Simulador de campo com 12 cenários, incluindo sensor travado e queda de gateway | P0 | Entregue |
| RF-97 | Simulador de acessos separado, restrito a broker local, com controlador próprio | P0 | Entregue |

## 8. Requisitos não funcionais

| ID | Requisito | Como é atendido | Estado |
|---|---|---|---|
| RNF-01 | Isolamento multi-cliente | `building_id` como fronteira, autorização na API e RLS com role não-dona | Entregue; capacidades em 2B |
| RNF-02 | Contrato de dados único | Schemas Zod compartilhados entre API, ingestão e clientes | Entregue; `packages/contracts` em execução |
| RNF-03 | Entrega ao menos uma vez sem duplicar efeito | `ingest_events` como trava antes da série temporal | Entregue |
| RNF-04 | Volume temporal | `telemetry` como hypertable com índices por dispositivo, imóvel e métrica | Entregue |
| RNF-05 | Recuperação de trabalho | Inbox/outbox/jobs com lease e reserva atômica | Planejado (etapa 3) |
| RNF-06 | Transporte seguro | MQTTS na 8883, credencial por gateway, ACL por condomínio, 1883 nunca exposta | Entregue |
| RNF-07 | Credencial mínima por processo | Roles separadas de identidade, API, broker, ingestão, workers e migração | Em execução (2B.2) |
| RNF-08 | Fuso e idioma | Fuso IANA por imóvel nos cálculos diários; interfaces em português | Entregue |
| RNF-09 | Falha isolada | Mensagem inválida não derruba a ingestão; falha de tempo real não desfaz gravação | Entregue |
| RNF-10 | Migração sem perda | SQL numerado, aditivo, com runner registrado e checksum | Em execução (runner 5/5) |
| RNF-11 | Compatibilidade de contrato | `/v1` com rotas atuais preservadas por adaptador; mobile compatível com versões suportadas | Em execução |
| RNF-12 | Verificabilidade | `pnpm test`, `pnpm typecheck`, `pnpm build` | Entregue |
| RNF-13 | Privacidade (LGPD) | Relato do morador não vira conteúdo público; refresh só por hash; auditoria sem token ou payload pessoal completo | Entregue |
| RNF-14 | Observabilidade | Logs correlacionados e métricas de latência, lag de inbox, idade de outbox, ACK e backup | Planejado (etapa 6) |
| RNF-15 | Continuidade | Backup externo criptografado com restauração provada; RPO 15 min / RTO 4 h | Planejado (etapa 6) |
| RNF-16 | Alta disponibilidade | VPS única é ponto de falha; réplicas só após medição | Planejado (Fase 3) |

## 9. Regras de negócio transversais

1. **O tópico é a identidade.** O corpo é dado do equipamento; divergência é descarte.
2. **Ligar a funcionalidade não liga o equipamento.** Portão desativado continua desativado.
3. **Desligar a funcionalidade não é ação física.** Não desliga bomba nem interrompe comando já enviado.
4. **Desligamento global é teto.** A preferência do condomínio é preservada e volta a valer.
5. **Pedido aceito não é portão aberto.** Só o ACK registra execução informada pelo controlador.
6. **Zero não é desconhecido.** Vaga sem leitura válida é desconhecida; pausa não gera consumo zero.
7. **Histórico não se apaga por pausa.** Registros anteriores voltam às consultas na retomada.
8. **Desvio é indício.** A análise aponta investigação; não afirma causa.
9. **Permissão não vem de plano, flag nem nome de aplicativo.** São quatro camadas distintas: direito comercial, funcionalidade, permissão do usuário e estado do equipamento.
10. **Papel não é degrau.** Nenhum acesso decorre de comparação ordinal entre papéis.
11. **Cobrança não pausa operação.** Suspensão exige política explícita e ação auditada.
12. **Retry de job não se aplica a comando físico.**

## 10. Fluxos principais

**Leitura até a tela.** Sensor → gateway (RS485/Modbus ou entrada digital) → MQTTS → broker →
ingestão (valida, checa funcionalidade, deduplica, grava, contabiliza consumo, avalia regras,
atualiza liveness) → PostgreSQL/Timescale → API → tela, com atualização em tempo real.
Destino: ingestão grava na inbox e o worker de telemetria faz o processamento.

**Abertura de portão.** Pedido → API verifica papel/capacidade, vínculo, portão habilitado,
permissão, funcionalidade e comunicação recente → comando `PENDING` → despacho `SENT` com prazo
de 15 s → controlador executa e publica ACK → `ACKNOWLEDGED`, ou `EXPIRED`/`FAILED`. Tudo auditado.

**Pausa de funcionalidade.** Administrador escolhe escopo, lê efeitos, justifica e confirma → API
grava com versão otimista e auditoria → telas recebem a mudança e reconciliam ao recuperar foco e
a cada 30 s → API e ingestão passam a bloquear/descartar.

**Chamado repetido.** Três relatos semelhantes → sugestão de agrupamento → confirmação da gestão →
resposta comum e conclusão, com histórico individual preservado.

**Concessão de suporte (em execução).** Administrador concede acesso diagnóstico com motivo,
escopo e prazo → suporte descobre só aquele condomínio → revogação ou expiração retira a
descoberta imediatamente, e a trilha registra a concessão usada.

## 11. Roadmap e estado da execução

Fases do produto entregue ([PLANO_TOTAL.md](PLANO_TOTAL.md)): Fase 1 piloto e Fase 2 operação
concluídas; Fase 4 (análise estatística) implementada e validada localmente; **Fase 3 (escala:
certificado por gateway, autorizador HTTP do broker, provisionamento automático,
retenção/compressão e HA) em aberto**.

Execução da arquitetura aprovada, conforme o [tracker](superpowers/plans/2026-09-27-product-execution.md):

| Etapa | Conteúdo | Estado registrado |
|---|---|---|
| 1 | Contratos e cliente HTTP portátil | Concluída — cliente 28/28, UI 28/28, seis typechecks |
| 2A | Sessões e famílias de refresh, JWT assimétrico | Concluída — 9/9 sessões, 4/4 JWT, API 116/116, migração `013` |
| 2B.1 | Fundação de RBAC/tenancy e API `/v1/tenancy`, `/v1/authorization` | Concluída — migração `014`, API 149/149, UI 32/32 |
| 2B.2 | Credenciais restritas da API (identidade, broker, sem dono) | Em execução — migração `015` |
| 2B.3 | Migração dos módulos para capacidades (plano de 29/09) | Planejada; inicia após o aceite de 2B.2 |
| 2B.4–2B.5 | Gestão web de unidades/equipes e credenciais de workers | Planejadas |
| 2C | Cookies/CSRF, MFA, convites e limites de tentativa | Planejada |
| 3 | Inbox/outbox, leases, workers por carga | Planejada |
| 4 | Ativos, ordens de serviço, automações, planos/assinaturas, suporte | Planejada |
| 5 | Apps Morador e Operação em React Native sem Expo | Planejada |
| 6 | Compose revisado, migrações, backup, observabilidade e ensaio de carga | Planejada |

**Ordem do primeiro recorte de 2B.3** (plano de 29/09): condomínios e funcionalidades → leitura
operacional → comunicação e atendimento → configuração e atuação → administração e eventos. Cada
subentrega recebe migração aditiva, testes negativos de HTTP e RLS e duas revisões.

**Risco de registro.** Nada das etapas 1 a 2B está commitado: o trabalho vive em cópias de
trabalho das linhas `codex/product-platform` (232 arquivos) e `codex/funcionalidades-predio-on`
(163 arquivos), ambas sem commit novo além de `84ffca7`. Perda de máquina ou limpeza de árvore
perde a entrega. Ver [TDD, seção 18](TDD.md#18-débitos-técnicos-e-riscos-de-implementação).

## 12. Dependências, premissas e riscos

**Dependências externas:** gateway embarcado com polling Modbus e buffer local; controlador de
portão que cumpra comando/ACK; central de incêndio certificada; FCM e APNs com credencial por
produto e ambiente; provedor de WhatsApp/e-mail, se contratado; AnyDesk no computador do
condomínio; macOS, certificados e contas de loja para os builds móveis.

**Premissas:** o mapa Modbus vem do manual do equipamento e é cadastrado em `devices.metadata`;
tarifas e limites são configurados pelo cliente; o comissionamento físico é etapa de campo; o
ambiente local não tem Java, Android SDK nem ferramentas Apple, então build nativo ainda não foi
verificado.

| Risco | Impacto | Mitigação |
|---|---|---|
| Sensor travado com valor plausível | Alerta que não dispara | Sweep de comunicação, qualidade da leitura e cenário `stuck-sensor` |
| Expectativa de detecção de incêndio | Jurídico e segurança | Escopo explícito de supervisão de contato seco |
| Expectativa de abertura garantida de portão | Operacional | ACK como única confirmação, prazo e recusa explicada |
| Mapa Modbus incorreto | Leitura sem sentido | Checklist de campo e aceite por etapa |
| Migração de papéis amplia acesso por engano | Vazamento entre condomínios | Testes negativos de HTTP e RLS por subentrega; bypasses legados isolados e documentados |
| Trabalho não commitado | Perda da entrega | Commit e publicação das linhas `codex/*` |
| Crescimento da telemetria | Custo e desempenho | Hypertable pronta; retenção/compressão e projeções pendentes |
| VPS única | Indisponibilidade total | Backup restaurado e monitoramento externo; HA depois |
| Build móvel sem ambiente | Atraso na etapa 5 | Aceite separa teste local de build de loja |

## 13. Glossário

**Condomínio/imóvel (`building`)** tenant operacional e fronteira de isolamento.
**Organização** agrupador comercial; não concede acesso operacional aos imóveis.
**Gateway** computador embarcado que lê o campo e publica MQTT. **Dispositivo** sensor, medidor,
monitor ou controlador. **Ativo** equipamento físico do condomínio, ao qual dispositivos se
vinculam. **Capacidade/permissão** par ação+recurso avaliado no servidor. **Concessão
(`role binding`, `support grant`)** atribuição com escopo e vigência. **Funcionalidade
(`feature`)** recurso ligável global e por condomínio. **Entitlement** direito comercial do plano.
**Inbox/outbox** filas duráveis no PostgreSQL. **ACK** confirmação do controlador de portão.
**RLS** política de acesso por linha no PostgreSQL.

## 14. Referências

[TDD](TDD.md) · [Arquitetura de produto (27/09)](superpowers/specs/2026-09-27-arquitetura-produto-design.md) ·
[Tracker de execução](superpowers/plans/2026-09-27-product-execution.md) ·
[Plano de 29/09 — capacidades por domínio](superpowers/plans/2026-09-29-rbac-domain-migration.md) ·
[Revisão de funcionalidades](REVISAO_FUNCIONALIDADES.md) · [Controle de funcionalidades](FUNCIONALIDADES.md) ·
[Consumo e análise](CONSUMO_E_ANALISE.md) · [Sensores](SENSORES.md) · [Acessos](ACESSOS.md) ·
[Vagas e avisos](VAGAS_AVISOS.md) · [Gestão transparente](GESTAO_TRANSPARENTE.md) ·
[Suporte remoto](SUPORTE_REMOTO.md) · [Hardware/software](HARDWARE_SOFTWARE.md) ·
[Plano total](PLANO_TOTAL.md) · [Próximos passos](NEXT_STEPS.md) · [Deploy](DEPLOY.md) ·
[Manual de implantação](IMPLANTACAO_CONDOMINIO.md)
