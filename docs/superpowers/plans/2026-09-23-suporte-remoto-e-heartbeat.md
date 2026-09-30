# Primeira instalação, suporte remoto e heartbeat — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir manutenção à distância e comprovar, a cada minuto, a comunicação do gateway, deixando uma configuração de instalação documentada e repetível.

**Architecture:** Aproveitar MQTT, a ingestão, os alertas e os painéis existentes. Separar a comunicação do gateway, a saúde dos sensores e a disponibilidade do computador de suporte. Usar uma ferramenta de acesso remoto existente e homologar a primeira instalação antes de reproduzi-la em outros condomínios.

**Tech Stack:** TypeScript, Zod, MQTT/EMQX, PostgreSQL/Drizzle, Express e React; firmware do gateway e acesso remoto compatíveis com os equipamentos do piloto.

---

**Data da verificação inicial:** 23/09/2026. O levantamento abaixo registra a situação anterior à implementação. **Atualização:** o usuário escolheu prosseguir com suporte integrado ao AnyDesk; o cadastro e os atendimentos foram implementados por condomínio conforme o [plano específico](2026-09-23-integracao-anydesk.md) e o [guia de suporte](../../SUPORTE_REMOTO.md). As entregas de heartbeat/diagnóstico e a homologação física continuam pendentes. Não houve conexão a um condomínio ou instalação externa do AnyDesk nesta etapa.

## Resumo para encaminhar

1. Definir o gateway e o computador que ficarão no condomínio.
2. Instalar e testar o acesso remoto da equipe técnica.
3. Configurar o gateway para informar seu estado a cada 1 minuto.
4. Mostrar separadamente conexão, sensores e situação da configuração.
5. Avisar quando a comunicação cair e quando voltar.
6. Testar falta de internet, reinicialização e atendimento à distância.
7. Salvar a configuração aprovada e o roteiro para as próximas instalações.

## O que já existe e o que falta

| Necessidade | Situação encontrada | Evidência no repositório |
|---|---|---|
| Cadastro e credencial individual do gateway | Existe; credencial MQTT emitida pelo administrador | `apps/api/src/modules/gateways/routes.ts`, rota `/:gatewayId/credentials` |
| Receber ONLINE/OFFLINE e guardar último contato | Existe | `packages/shared/src/telemetry.ts:52`; `services/ingest/src/pipeline/gateway-status.ts:10` |
| Reconhecer silêncio prolongado | Existe varredura a cada 30 s; limite padrão de 120 s e de 180 s no Compose de produção | `services/ingest/src/config.ts:13`; `services/ingest/src/offline-sweeper.ts:118`; `infrastructure/docker-compose.prod.yml:98` |
| Avisar perda de comunicação | Parcial: a varredura gera alerta, mas o recebimento direto de OFFLINE não gera o mesmo alerta | `services/ingest/src/offline-sweeper.ts:37`; `services/ingest/src/pipeline/gateway-status.ts:27` |
| Heartbeat independente a cada 60 s | Não encontrado como implementação de campo. O simulador de sensores envia status ao conectar e ao mudar de estado; as leituras saem a cada 5 s por padrão | `services/ingest/src/hardware-simulator.ts:102`; `services/ingest/src/pipeline/telemetry.ts:57` |
| Heartbeat no simulador de portões | Existe a cada 5 s, apenas para simulação local | `services/ingest/src/access/simulator.ts:21` |
| Atualização automática da tela Gateways | Falta: a tela usa leitura inicial/recarregamento, sem assinar os eventos ou agendar consultas | `apps/admin-web/src/pages/Gateways.tsx:29`; `packages/ui/src/use-resource.ts:8` |
| Provar que está tudo configurado corretamente | Falta diagnóstico completo e registro de comissionamento; ONLINE comprova comunicação, não calibração | Contrato de status em `packages/shared/src/telemetry.ts:52` |
| Entrar no computador do condomínio para manutenção | Não foi encontrado agente, túnel, instalador ou fluxo de suporte remoto integrado | Árvore de `services/`, `apps/api/src/modules/`, `infrastructure/` e `scripts/` |
| Reaproveitar a configuração da primeira instalação | Há manual e orientações de hardware; falta um modelo homologado por equipamento com revisão, backup e restauração ensaiada | `docs/IMPLANTACAO_CONDOMINIO.md`; `docs/HARDWARE_SOFTWARE.md` |

O acesso remoto existente para abrir garagem/pedestre é outro recurso. Ele não permite visualizar a tela do computador local nem alterar a configuração do gateway.

### Correções necessárias para confiar no indicador

- O receptor de status usa a hora de recebimento para renovar `lastSeenAt`, sem conferir a idade do `timestamp`. Um ONLINE antigo reenviado/retido pode aparecer como contato novo.
- A ingestão de leituras também renova o contato do gateway e do sensor, inclusive para leituras antigas ainda não recebidas. Recuperar o histórico não pode provar que o equipamento está funcionando agora.
- Quando o Last Will já marcou o gateway OFFLINE, a varredura o exclui da busca. Por isso a queda pode atualizar o painel sem produzir o alerta de gateway esperado.
- A comparação de tempo não alcança `lastSeenAt = null`. A primeira instalação precisa distinguir “aguardando primeira conexão” de um equipamento já entregue que nunca se comunicou.
- A abertura de portões exige contato de gateway e controlador nos últimos 60 s (`packages/shared/src/access.ts:4`). Simplesmente trocar todos os envios para 60 s pode bloquear a abertura entre mensagens por pequenos atrasos. Preservar a supervisão mais frequente dos controladores.

## Decisões propostas

### 1. Acesso remoto para manutenção

**Caminho do piloto:** computador da equipe → conexão privada autenticada → computador dedicado no condomínio → programa/página de configuração dos equipamentos na rede local.

Como candidato inicial, usar Tailscale com Área de Trabalho Remota do Windows, se a edição instalada aceitar conexões RDP. A documentação descreve esse acesso sem redirecionamento público de portas e o modo que permite reconexão após reinicialização sem login presencial. Confirmar edição, compatibilidade dos programas de configuração e condições comerciais antes de fechar a instalação. [Referência oficial](https://tailscale.com/docs/solutions/access-remote-desktops-using-windows-rdp).

Há três opções de implantação:

| Opção | Uso previsto | Condição |
|---|---|---|
| Computador dedicado com acesso à área de trabalho | Primeira instalação proposta; facilita usar os programas dos fabricantes | Máquina ligada, sem suspensão, rede até os equipamentos e ferramenta licenciada/compatível |
| Acesso direto a gateway Linux/industrial compatível | Pode dispensar um computador separado | Fabricante deve suportar o método de acesso e as ferramentas de manutenção |
| Apenas painel web na nuvem | Consulta de leituras e alertas já existente | Não atende sozinho à manutenção das configurações locais |

Para acessar dispositivos que não aceitam um cliente de conexão privada, existe a alternativa de roteamento de sub-rede. No piloto, entrar na área de trabalho do computador local evita precisar rotear todas as redes dos condomínios; só adotar roteamento direto após validar isolamento e redes com endereços repetidos. [Referência oficial](https://tailscale.com/docs/features/subnet-routers).

Requisitos de entrega:

- Contas individuais da equipe; autenticação multifator no provedor; acesso restrito aos imóveis atendidos. Não usar uma senha compartilhada entre todos os condomínios.
- RDP/SSH/painel do gateway acessíveis pela conexão privada, sem abrir essas portas publicamente no roteador.
- Conexão automática após reinicialização, política de atualização, expiração/renovação de credenciais e teste de revogação de um técnico.
- Instalar as ferramentas do fabricante e guardar o endereço local de cada equipamento. A equipe deve conseguir abrir a configuração, exportar backup e consultar logs à distância.
- Registrar responsável, motivo do atendimento, horário, equipamento e resultado. Um clique em “iniciar atendimento” não prova que a sessão remota foi estabelecida; a evidência vem do sistema remoto/host ou deve ser identificada como registro manual.
- Falha ou desligamento do computador de suporte não deve parar o monitoramento quando este roda no gateway. Se o PC também executar a coleta, documentar essa dependência explicitamente.
- Queda da internet principal pode derrubar tanto o monitoramento quanto o suporte. Se o condomínio exigir acesso nessa situação, incluir conexão alternativa e ensaiar a troca. Equipamento sem energia exige alimentação de reserva ou atendimento local.

### 2. Heartbeat do gateway a cada minuto

O **gateway real** deve publicar a primeira mensagem logo após conectar e as seguintes a cada 60 s, em temporizador independente da coleta dos sensores. O computador de suporte não deve se passar pelo gateway para mantê-lo artificialmente online.

Configuração planejada para gateways de monitoramento:

```dotenv
GATEWAY_HEARTBEAT_INTERVAL_SECONDS=60
GATEWAY_OFFLINE_TIMEOUT_SECONDS=180
OFFLINE_SWEEP_INTERVAL_SECONDS=30
```

O primeiro parâmetro é novo e pertence ao publicador no equipamento/simulador; defini-lo apenas na plataforma não faz o hardware enviar mensagens. Os outros dois já existem na ingestão. Uniformizar exemplos e produção, mantendo possibilidade de ajuste documentado.

Após mais de 180 s sem heartbeat válido, marcar offline na próxima varredura: até aproximadamente 210 s desde o último sinal, enquanto plataforma e varredura estiverem operacionais. Um Last Will válido pode antecipar a detecção. MQTT keepalive e o ping da conexão navegador/API não substituem esse heartbeat da aplicação.

Para gateways que também comandam portões, publicar a supervisão do gateway e do controlador a cada 15 s, preservando a exigência de contato menor que 60 s e a expiração de comandos de 15 s. A supervisão geral continua atendendo ao requisito de informar pelo menos uma vez por minuto. Nunca aumentar a janela de abertura apenas para esconder falta de comunicação.

Proposta de mensagem de status, versão 2, no tópico já existente `predio/{buildingId}/gateway/{gatewayId}/status`:

```json
{
  "schemaVersion": 2,
  "buildingId": "bld_piloto",
  "gatewayId": "gw_piloto",
  "state": "ONLINE",
  "sessionId": "5aa934b2-8522-4517-b333-765809f1a002",
  "sessionStartedAt": "2026-09-23T12:00:00.000Z",
  "sequence": 1,
  "timestamp": "2026-09-23T12:01:00.000Z",
  "firmwareVersion": "piloto-1",
  "configRevision": "piloto-r1",
  "uptimeSeconds": 60,
  "checks": { "configurationLoaded": true, "collectorRunning": true },
  "sensors": { "expected": 8, "responding": 7 }
}
```

Os identificadores e números acima ilustram o contrato; não são configuração de equipamento homologado. `sequence` cresce na mesma sessão, `sessionId` muda a cada conexão MQTT e `sessionStartedAt` identifica sua ordem. Relógio sincronizado é condição para validar a atualidade; um relógio inválido gera diagnóstico, sem certificar o equipamento como pronto.

Regras de ingestão planejadas:

1. Validar schema, tópico, prédio, gateway habilitado e credencial limitada ao próprio tópico.
2. Passar os metadados MQTT do pacote ao receptor. Mensagem entregue como retida pode informar o último estado conhecido, mas não renovar a prova de comunicação atual.
3. Para ONLINE, rejeitar como prova de vida timestamps com mais de 90 s ou mais de 5 s no futuro. Registrar horário de recebimento separadamente e usar a hora válida do evento, limitada à hora de recebimento, para calcular a idade.
4. Ignorar duplicatas e mensagens fora de ordem pela sessão e sequência. Sessão antiga não substitui sessão mais nova. OFFLINE da sessão atual fecha essa sessão; seus ONLINE atrasados não a reabrem.
5. O Last Will é preparado na conexão: sua data pode ser antiga quando o broker o entrega. Conferir identidade/sessão e transição, sem aplicar ao OFFLINE a mesma regra de idade do ONLINE. Se a sessão ainda não for conhecida, aguardar o timeout em vez de derrubar uma sessão mais nova.
6. Guardar `lastHeartbeatAt` separado de `lastTelemetryAt` e do horário de recebimento. Telemetria histórica continua no histórico, sem renovar disponibilidade para comandos físicos. Dados históricos não podem criar falsa recuperação.
7. Gerar um alerta por episódio de queda, seja por timeout ou OFFLINE, e registrar a recuperação uma vez. Usar transação e unicidade para resistir a entregas simultâneas/repetidas. Aviso externo passa pelo canal já configurado; seu recebimento precisa ser testado no piloto.
8. Manter versão 1 durante a migração, identificada no painel como “protocolo anterior; diagnóstico limitado”. Não declarar equipamento antigo homologado para o novo heartbeat. Controladores de acesso devem migrar em janela própria, sem relaxar a política de abertura.

### 3. Exibir o que realmente foi comprovado

| Indicador | Significado planejado |
|---|---|
| Gateway online — último sinal há 35 s | Heartbeat recente aceito pela plataforma |
| Sensores: 7 de 8 respondendo | Uma leitura está ausente, mesmo com gateway online |
| Configuração carregada / divergente / não verificada | Revisão observada comparada à revisão esperada, com resultado de diagnóstico |
| Instalação homologada em determinada data | Checklist físico aprovado pelo técnico; revisão e evidências preservadas |
| Computador de suporte cadastrado / disponibilidade desconhecida | Cadastro não comprova que o acesso remoto está funcionando |
| Atendimento remoto testado em determinada data | A equipe confirmou a conexão e o acesso às ferramentas locais |

Na primeira entrega, não prometer o estado ao vivo do computador de suporte sem integrar uma fonte que o comprove. Mostrar “desconhecido” e o último teste quando houver apenas cadastro manual. A integração com estado do provedor pode ser adicionada posteriormente, com horário e prazo de validade próprios.

A tela Gateways deve assinar os eventos existentes, consultar novamente ao reconectar e ter consulta de recuperação a cada 30 s enquanto visível. Atualizar também o texto “há X segundos”. Falha na API/eventos deve aparecer como informação desatualizada; não manter um selo verde sem indicar sua idade.

## Sequência de implementação

As entregas A e B podem ser homologadas separadamente. A primeira dá confiança ao monitoramento; a segunda permite manutenção remota. A entrega C transforma o piloto em padrão de instalação.

### Entrega A — comunicação e diagnóstico

#### A1. Definir o equipamento do piloto e registrar a configuração inicial

**Criar:** `docs/instalacao/PILOTO.md` e `docs/instalacao/FICHA_DE_CONFIGURACAO.md`.

- [ ] Registrar marca/modelo, firmware, sistema operacional/edição do PC, programas do fabricante, interfaces disponíveis e responsável de campo.
- [ ] Confirmar no manual do gateway como executar publicação periódica, Last Will e diagnóstico sem depender do PC. Se não suportar o contrato, atribuir a adaptação ao integrador antes de classificar o modelo como compatível.
- [ ] Registrar IPs/reservas DHCP, mapa de rede, portas seriais, baud rate, paridade, endereços e registradores Modbus, escalas, unidades e calibragens a partir dos equipamentos reais.
- [ ] Fotografar posição e fixação dos aparelhos, identificar cabos/terminais e registrar distância/altura de montagem quando relevante para a medição, conforme o manual do fabricante. Guardar as evidências com a ficha do condomínio.
- [ ] Exportar a configuração anterior antes de modificar o piloto e guardar backup protegido com procedimento de retorno.

**Aceitação:** outro técnico consegue identificar cada aparelho e sua configuração a partir da ficha, sem procurar parâmetros por tentativa. Não há valores de registradores inventados nem segredos gravados no repositório.

#### A2. Criar contrato, persistência e política de atualidade

**Criar:** `packages/shared/src/gateway-health.ts`, `packages/db/src/schema-gateway-health.ts`, `infrastructure/010-gateway-health.sql`, `services/ingest/test/gateway-health.test.ts`.

**Alterar:** `packages/shared/src/telemetry.ts`, `packages/shared/src/index.ts`, `packages/db/src/schema.ts`, `packages/db/src/index.ts` e `packages/db/src/apply-infrastructure.ts` se o aplicador exigir registro explícito.

- [ ] Escrever primeiro testes para atraso, relógio futuro, repetição, retenção, troca de sessão e recebimento de Will antigo da sessão atual.
- [ ] Implementar schema da versão 2 conforme o exemplo e regras anteriores, com limites de tamanho e contagens `responding <= expected`.
- [ ] Distinguir os envelopes ONLINE e OFFLINE: diagnóstico e sequência atual pertencem ao ONLINE; o Will exige versão, identidade, estado, sessão e data de preparação, sem exigir diagnósticos que só existiriam no instante da queda.
- [ ] Acrescentar campos de heartbeat/telemetria/sessão/revisão esperada e observada, mantendo o histórico existente. Criar tabela de episódios de comunicação com no máximo um episódio aberto por gateway e vínculo ao alerta.
- [ ] Aplicar RLS por condomínio às tabelas novas. Ausência de primeiro contato deve permanecer “aguardando configuração” até o comissionamento; após este, silêncio superior ao prazo gera ocorrência.
- [ ] Ensaiar a migração aditiva em uma cópia local e o retorno da aplicação anterior. Não resetar nem apagar banco de condomínio.

**Teste dirigido após criar o arquivo:** `pnpm --filter @predioon/ingest exec node --import tsx --test test/gateway-health.test.ts`. Esperado: todos os casos passam; antes da implementação, falham pelos comportamentos novos ausentes.

#### A3. Unificar recepção, queda e recuperação

**Criar:** `services/ingest/src/pipeline/gateway-health.ts` e `services/ingest/test/gateway-health.integration.test.ts`.

**Alterar:** `services/ingest/src/mqtt.ts`, `services/ingest/src/index.ts`, `services/ingest/src/pipeline/gateway-status.ts`, `services/ingest/src/pipeline/telemetry.ts`, `services/ingest/src/offline-sweeper.ts`, `services/ingest/src/config.ts`, `.env.example`, `infrastructure/docker-compose.prod.yml` e `packages/shared/src/events.ts`.

- [ ] Escrever testes de integração com gateways exclusivos de teste; limpeza apenas desses registros. Cobrir Will seguido de varredura concorrente e recuperação repetida.
- [ ] Encaminhar retenção e demais metadados necessários do pacote MQTT; centralizar transições e criação/resolução de episódio em transação.
- [ ] Separar dados históricos de sinais recentes e preservar o contato usado na autorização dos portões apenas quando houver prova atual.
- [ ] Fazer varredura por heartbeat para versão 2 e política documentada para versão 1. Normalizar prazo de 180 s e varredura de 30 s.
- [ ] Emitir eventos e notificações para queda/recuperação sem duplicar alertas; registrar falha de entrega externa separadamente da existência do alerta.

**Teste dirigido:** `pnpm --filter @predioon/ingest exec node --import tsx --test test/gateway-health.integration.test.ts`. Esperado: um episódio por queda, uma recuperação e nenhum ONLINE renovado por histórico/retido.

#### A4. Implementar o publicador e o diagnóstico no gateway homologado

**Criar:** `services/ingest/src/simulator/heartbeat.ts` e `services/ingest/test/gateway-heartbeat.test.ts` para o publicador de referência e ensaios locais. **Alterar:** `services/ingest/src/hardware-simulator.ts`, `services/ingest/src/access/simulator.ts` e `docs/HARDWARE_SOFTWARE.md`. A adaptação ao firmware real deve ter seu código/exportação identificado em `docs/instalacao/PILOTO.md`.

- [ ] Escrever teste com relógio controlado: publicação imediata e depois em 60/120/180 s, mesmo sem nenhuma leitura de sensor.
- [ ] Implementar timer independente, cancelamento do timer anterior na reconexão, sessão nova por conexão, sequência e Will. Não acumular heartbeats para transmitir após voltar a internet.
- [ ] Testar supervisor de acesso com intervalo de 15 s e preservar comandos sem retenção/fila, expiração e deduplicação já implementadas.
- [ ] Publicar apenas diagnósticos observáveis: processo de coleta, revisão carregada, sensores esperados/respondendo e erros. Se o firmware não fornecer um item, mostrar “não verificado”.
- [ ] Reproduzir no gateway físico o comportamento validado no simulador e conferir as mensagens recebidas por pelo menos 24 h.

**Teste dirigido:** `pnpm --filter @predioon/ingest exec node --import tsx --test test/gateway-heartbeat.test.ts`. Esperado: cadência independente, reconexão sem dois timers e ausência de fila antiga. Passar este teste sozinho não homologa firmware externo.

#### A5. Atualizar API e tela de gateways

**Criar:** `packages/ui/src/gateway-health.ts`, `packages/ui/test/gateway-health.test.ts`, `apps/api/test/gateway-health.test.ts`.

**Alterar:** `apps/api/src/modules/gateways/routes.ts`, `apps/admin-web/src/pages/Gateways.tsx` e `packages/ui/src/index.ts`. Reutilizar `packages/ui/src/sse.ts` e `use-resource.ts`.

- [ ] Testar a leitura autorizada, o isolamento entre prédios e a ausência de segredos no retorno.
- [ ] Retornar horários distintos, diagnósticos, revisão esperada/observada e situação de comissionamento. Não colocar credenciais de acesso remoto em `gateways.metadata`, que hoje é parcialmente exposto pela API.
- [ ] Mostrar os indicadores da tabela anterior; atualizar por evento, reconexão e consulta periódica; informar quando os dados estiverem desatualizados.
- [ ] Testar no navegador aberto sem recarregar: primeira conexão, perda, recuperação, sensor sem resposta e falha da API.

**Testes dirigidos:** `pnpm --filter @predioon/ui exec node --import tsx --test test/gateway-health.test.ts` e `pnpm --filter @predioon/api exec node --import tsx --test test/gateway-health.test.ts`. Esperado: estados sem falsa certificação e autorização respeitada.

### Entrega B — manutenção remota

#### B1. Instalar e homologar o acesso remoto no piloto

**Criar:** `docs/instalacao/SUPORTE_REMOTO.md`. **Complementar:** `docs/instalacao/PILOTO.md`.

- [ ] Confirmar a opção compatível com o PC/gateway real e o contrato do provedor. A proposta de RDP depende da edição do Windows; não presumir compatibilidade com qualquer computador.
- [ ] Instalar o cliente nas máquinas de suporte e condomínio; cadastrar contas individuais; restringir destinos e privilégios por técnico/imóvel.
- [ ] Configurar início automático, evitar suspensão, conferir alimentação e sincronização de hora. Guardar credenciais em cofre com acesso controlado.
- [ ] De outra conexão de internet, acessar o computador e abrir a configuração de um equipamento pela rede local; exportar backup sem alterar parâmetros de atuação.
- [ ] Reiniciar o PC, testar retorno sem login presencial, revogar um técnico e comprovar que ele perdeu acesso. Registrar data, responsável e evidências.

**Aceitação:** técnico autorizado acessa as ferramentas locais de fora do condomínio; técnico revogado não acessa; morador não recebe acesso ao computador. Não há dependência de alguém abrir o programa presencialmente a cada atendimento.

#### B2. Integrar cadastro e histórico de suporte à plataforma

**Criar:** `packages/db/src/schema-support.ts`, `infrastructure/011-support.sql`, `apps/api/src/modules/support/routes.ts`, `apps/api/test/support.test.ts`, `apps/admin-web/src/components/GatewaySupport.tsx`.

**Alterar:** `packages/db/src/index.ts`, `packages/db/src/schema.ts`, `apps/api/src/app.ts` e `apps/admin-web/src/pages/Gateways.tsx`.

- [ ] Testar antes de implementar: residente e administrador predial não podem obter os dados técnicos de conexão; administrador da plataforma inativo é rejeitado mesmo com token ainda válido; registro de atendimento exige motivo.
- [ ] Criar cadastro separado de host de suporte por prédio e vínculo ao gateway: provedor, identificador/endereço privado permitido, sistema, responsável, último teste e habilitação. Armazenar referências ao cofre, nunca senhas em texto no cadastro.
- [ ] Na primeira versão, limitar a gestão a administradores da plataforma autorizados para suporte, conferindo usuário ativo no banco em cada operação. Permissões da conexão privada devem existir também no provedor; esconder botão não revoga acesso real.
- [ ] Criar rotas `GET/PUT /support/gateways/:gatewayId` e `POST /support/gateways/:gatewayId/attendances` com validação, RLS e auditoria. Registro de atendimento contém motivo, início/fim declarados, resultado e referência de evidência; não fingir confirmação automática de sessão.
- [ ] Mostrar como conectar usando o cliente homologado, identificação do equipamento e último teste. Validar endereços contra o cadastro autorizado, sem executar comandos arbitrários enviados pelo navegador.
- [ ] Testar revogação tanto no aplicativo quanto no provedor e verificar que desabilitar o suporte não interrompe MQTT.

**Teste dirigido:** `pnpm --filter @predioon/api exec node --import tsx --test test/support.test.ts`. Esperado: leitura/alteração restritas, auditoria e ausência de segredos no retorno. Estado ao vivo do provedor e gravação de tela não fazem parte desta primeira integração.

### Entrega C — transformar o piloto em instalação repetível

#### C1. Homologar, salvar o padrão e atualizar o manual

**Criar:** `docs/instalacao/CHECKLIST_DE_ACEITE.md`. **Atualizar:** ficha do piloto, `docs/IMPLANTACAO_CONDOMINIO.md`, `docs/Manual_de_implantacao_Predio_ON.docx`, `docs/DEPLOY.md`, `docs/HARDWARE_SOFTWARE.md` e `docs/NEXT_STEPS.md`.

- [ ] Executar a matriz de aceite abaixo e guardar os horários, resultado e responsável por cada ensaio.
- [ ] Exportar configuração homologada por modelo/firmware; registrar revisão, checksum do backup, local protegido e como restaurar.
- [ ] Separar no modelo os valores reaproveitáveis dos específicos de cada imóvel: identificadores, credenciais, endereços, capacidade da caixa, calibração e limites. Nunca clonar a identidade ou senha do condomínio anterior.
- [ ] Restaurar o backup em bancada ou equipamento de reserva e medir se o roteiro é suficiente para outro técnico instalar sem descoberta por tentativa.
- [ ] Atualizar o resumo de WhatsApp e as etapas detalhadas do manual, incluindo suporte remoto e heartbeat. Gerar o Word a partir do conteúdo revisado e conferir sua apresentação.
- [ ] Validar um segundo condomínio com o roteiro e anotar as diferenças de modelo/rede. Só então classificar o procedimento como padrão repetível.

## Matriz de aceite

| Ensaio | Resultado exigido |
|---|---|
| Sensores sem variação durante 10 min | Heartbeat continua a cada 60 s; valores constantes não são confundidos com desconexão |
| Coletor travado, conexão MQTT ativa | Gateway comunica, diagnóstico acusa coleta parada e sensores ficam sem leitura recente |
| Cortar internet do gateway | Offline após o prazo ou Will válido, um alerta por episódio e registro de horário |
| Reconectar internet | Sessão nova, heartbeat imediato e recuperação única; histórico não se passa por leitura atual |
| Reiniciar ingestão/broker com ONLINE retido antigo | Nenhuma renovação indevida de prova de vida |
| Entregar mensagens duplicadas, fora de ordem ou de outra sessão | Estado não regride nem cria episódios duplicados |
| Relógio errado e equipamento nunca conectado | Diagnóstico/pendência explícitos, sem selo de instalação pronta |
| Desconectar um sensor | Gateway pode continuar online; o sensor afetado aparece separado |
| Alterar revisão da configuração | Divergência visível; manter o registro histórico do último aceite |
| Abrir portões entre heartbeats e após perda de contato | Operação autorizada quando recente; bloqueio ao vencer a janela, sem comando atrasado ao reconectar |
| Deixar a tela aberta durante queda/recuperação | Atualização automática e aviso de dados antigos quando a plataforma falhar |
| Acessar PC do condomínio de outra internet | Técnico usa a ferramenta real do fabricante e exporta backup |
| Reiniciar/desligar PC de suporte | Retorno automático após reinício; gateway independente continua monitorando quando o PC desliga |
| Revogar técnico e tentar acesso de outro prédio | Bloqueio no app e na conexão privada, com registro verificável |
| Restaurar configuração homologada | Equipamento volta ao comportamento aprovado; nenhum segredo de outro condomínio é reutilizado |
| Observar operação normal por 24 h | Intervalos registrados, sem lacunas acima do limite sem explicação; alertas e canal externo conferidos |

## Verificação de software durante a execução

Na infraestrutura local de testes, executar primeiro os testes dirigidos de cada entrega. Depois integrar e executar, em PowerShell:

```powershell
$env:RUN_ACCESS_DB_TESTS = '1'
pnpm test
pnpm -r --workspace-concurrency=1 typecheck
pnpm -r --workspace-concurrency=1 build
```

Esperado: testes existentes e novos sem falhas; casos de integração necessários executados, não ignorados; tipos e build com saída zero. As novas suítes devem falhar com mensagem clara se sua infraestrutura estiver indisponível. Validar MQTT/Last Will no broker real local e o painel no navegador. Não executar testes que escrevem dados no banco de produção.

Cada entrega deve ter revisão do diff e registro próprio das evidências; versionar somente os arquivos da entrega, preservando alterações anteriores. Os 114 testes registrados na entrega anterior não comprovam estes recursos novos. A conclusão desta etapa exige evidências de software e os ensaios físicos do piloto.

## Informações a levantar antes da instalação

Marca/modelo/firmware do gateway; sistema e edição do computador local; ferramentas exigidas pelos fabricantes; rede e alimentação disponíveis; equipamentos que precisam de calibração; equipe autorizada e canal de alertas. Esses dados definem a adaptação do firmware e a ferramenta de suporte. A ausência deles não impede preparar a plataforma, mas impede prometer a instalação física como pronta.
