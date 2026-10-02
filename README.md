# Prédio ON — gestão condominial e monitoramento IoT

Plataforma para monitoramento e operação de condomínios, casas e imóveis comerciais. Reúne API, ingestão MQTT, PostgreSQL/TimescaleDB e três interfaces web: **administrador da plataforma**, **síndico** e **morador**.

Para uma instalação real, comece pelo [manual de implantação e operação](docs/IMPLANTACAO_CONDOMINIO.md). Para executar a demonstração local, siga a seção [Instalação local](#instalação-local).

O escopo do produto está no [PRD](docs/PRD.md) e o desenho técnico no [TDD](docs/TDD.md). A [arquitetura de produto aprovada em 27/09/2026](docs/superpowers/specs/2026-09-27-arquitetura-produto-design.md) define a evolução para quatro produtos — aplicativos **Morador** e **Operação** em React Native sem Expo, painel web do síndico e painel web administrativo — sobre a mesma plataforma modular e banco central. O andamento por etapa fica no [tracker de execução](docs/superpowers/plans/2026-09-27-product-execution.md). Este README descreve o que já está commitado nesta linha de código; ver [Evolução em andamento](#evolução-em-andamento).

## Funcionalidades

| Área | Recursos implementados |
|---|---|
| Monitoramento | Nível, volume e distância da caixa d'água; tensão, corrente e frequência das fases; estado da bomba; temperatura, gás, fumaça e vazamentos de água/esgoto. |
| Consumo e análise | Consumo de água e energia, custo estimado por tarifa, tempo diário/contínuo de bomba, limites e análise estatística baseada no histórico válido. |
| Alertas | Regras configuráveis, histórico, reconhecimento e acompanhamento de equipamentos sem comunicação. |
| Portões e acessos | Cadastro de garagem e entrada de pedestres, permissões, solicitação de abertura, comando MQTT, confirmação do controlador e auditoria. |
| Vagas | Capacidade, ocupação e disponibilidade separadas para carros e motos, com atualização manual ou por sensor e indicação de leitura antiga/desconhecida. |
| Rotina | Avisos com programação e repetição semanal, reservas de áreas comuns, aprovação e tratamento de conflitos de horário. |
| Ocorrências | Chamados de síndicos e moradores, três níveis de gravidade, respostas, histórico e agrupamento de problemas repetidos. |
| Transparência e contas | Atualizações da gestão e relatórios financeiros mensais com receitas, despesas, saldo, comprovantes por link e revisões publicadas. |
| Suporte remoto | Cadastro do computador do condomínio, preparação do acesso pelo AnyDesk e registro manual do resultado do atendimento. |
| Controle de funcionalidades | 23 recursos ativados ou desativados globalmente e por condomínio, com justificativa, dependências e auditoria. |

A disponibilidade nos portais segue as permissões do usuário e os controles de funcionalidades. Ao pausar um sensor, novas leituras correspondentes são descartadas, seu processamento e seus alertas ficam suspensos e o histórico é preservado. A comunicação dos gateways continua ativa. Consulte os efeitos e o procedimento de retomada em [Funcionalidades](docs/FUNCIONALIDADES.md).

A [matriz de funcionalidades e validações](docs/REVISAO_FUNCIONALIDADES.md) registra o escopo implementado e as verificações anteriores. A integração física depende da configuração e dos testes dos equipamentos instalados. Disjuntor/extintor permanece fora do escopo.

## Painéis e serviços locais

| Serviço | Endereço | Finalidade |
|---|---|---|
| Administrador da plataforma | [localhost:5173](http://localhost:5173) | Clientes, condomínios, comunicação, equipamentos, operação dos imóveis, suporte remoto, alertas, usuários, funcionalidades e histórico de atividades. |
| Painel do síndico | [localhost:5174](http://localhost:5174) | Água, energia, consumo, sensores, acessos, vagas, alertas, ocorrências, transparência, contas, avisos e áreas comuns. |
| Portal do morador | [localhost:5175](http://localhost:5175) | Consultas autorizadas, avisos, reservas, ocorrências, transparência, contas e abertura de acessos quando permitida. |
| API | [localhost:3000](http://localhost:3000) | Backend Express. |
| Saúde da API | [localhost:3000/health](http://localhost:3000/health) | Confirma que a API responde. |
| Prontidão da API | [localhost:3000/health/ready](http://localhost:3000/health/ready) | Confirma também a conexão com o banco. |
| EMQX Dashboard | [localhost:18083](http://localhost:18083) | Administração do broker MQTT. |

No administrador, **Operação dos imóveis** reúne consumo/análise, portões/acessos e vagas para o imóvel selecionado. **Funcionalidades** e **Suporte remoto** têm telas próprias.

Os painéis precisam do servidor Vite; não abra os arquivos `index.html` diretamente.

## Stack e arquitetura

- **API:** Node.js, Express 5 e TypeScript, com módulos por domínio.
- **Contratos e validação:** Zod compartilhado entre API, ingestão e interfaces.
- **Banco:** PostgreSQL 16 com TimescaleDB, Drizzle ORM e políticas de acesso por linha (RLS).
- **IoT:** EMQX e serviço de ingestão Node.js com mqtt.js.
- **Interfaces:** React 19, Vite 7, Tailwind CSS e componentes compartilhados em `packages/ui`.
- **Autenticação:** JWT, senhas com Argon2 e refresh tokens rotativos; autorização por perfil e vínculo com o condomínio.

```text
Sensores / gateway / simulador
              ↓ MQTT
             EMQX
              ↓
      Serviço de ingestão
              ↓
    PostgreSQL + TimescaleDB
              ↓
          API Express
              ↓
    Admin · Síndico · Morador
```

Para abertura de portões, a API registra o pedido, a ingestão publica o comando e o controlador devolve uma confirmação (ACK). O fluxo completo está em [Acessos](docs/ACESSOS.md).

O portal do morador permanece disponível por compatibilidade. Os aplicativos **Morador** e **Operação**, em React Native **sem Expo**, estão em `apps/resident-mobile` e `apps/operations-mobile`, com sessão segura e fluxos conectados à API. Veja [execução, requisitos e limites dos apps](packages/mobile/README.md). A publicação e integrações nativas externas continuam separadas da validação do código. Não há aplicativo móvel administrativo da plataforma.

## Instalação local

### Pré-requisitos

- Node.js compatível com os apps e ferramentas do monorepo: `^22.13.0`, `^24.3.0` ou `>=26`.
- pnpm **10.17.1**, conforme `packageManager` no `package.json`.
- Docker Desktop com o engine ativo e Docker Compose disponível.

Os exemplos abaixo usam PowerShell na raiz do repositório, onde estão este README e o `package.json` principal.

```powershell
node --version
docker compose version
corepack enable
pnpm --version
```

Se o Corepack não estiver disponível, instale a versão usada pelo projeto:

```powershell
npm install -g pnpm@10.17.1
```

### 1. Instalar dependências e preparar o ambiente

```powershell
pnpm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

O [`.env.example`](.env.example) contém os valores do Docker Compose local. O comando acima preserva um `.env` existente.

### 2. Preparar infraestrutura e banco

Com o Docker Desktop ativo:

```powershell
pnpm setup:local
```

Esse comando prepara a demonstração: sobe PostgreSQL/TimescaleDB e EMQX, aguarda o banco, aplica o SQL inicial versionado somente em banco vazio, executa as migrations e provisiona credenciais. O seed explícito da demonstração redefine senhas locais. Não use o seed para atualizar dados reais. A preparação rejeita schemas parciais em vez de reconstruir tabelas.

O banco fica em `localhost:5434`, o MQTT em `localhost:1883` e o dashboard EMQX em `localhost:18083`. O Compose local publica essas portas somente em `127.0.0.1`.

### 3. Iniciar a plataforma

```powershell
pnpm dev
```

Mantenha o terminal aberto. O comando inicia API, ingestão MQTT e os três painéis. Acesse os endereços da tabela de [painéis e serviços](#painéis-e-serviços-locais).

Como alternativa às etapas manuais, o script abaixo instala dependências, cria o `.env` se necessário, prepara o banco e inicia a plataforma:

```powershell
.\scripts\start-local.ps1 -Setup -SeedDemo
# Nas próximas execuções, sem reinstalar nem alterar o banco:
.\scripts\start-local.ps1
# Diagnóstico somente leitura:
node scripts/check-environment.mjs
```

### Contas de demonstração

Criadas por `pnpm db:seed`, também executado por `pnpm setup:local`:

| E-mail | Perfil | Painel |
|---|---|---|
| `admin@predioon.local` | Administrador da plataforma | [Administrador](http://localhost:5173) |
| `sindico@predioon.local` | Administrador do prédio | [Síndico](http://localhost:5174) |
| `morador@predioon.local` | Morador | [Morador](http://localhost:5175) |

A senha padrão local é **`predioon123`**. A variável `SEED_PASSWORD` permite defini-la durante o seed; executar o seed novamente atualiza a senha dessas contas. Os testes de integração usam a senha padrão local.

O seed cria a organização `org_001`, o imóvel `bld_001`, o gateway `gw_001`, sensores, regras, perfis de consumo, áreas comuns, avisos e cadastros de acessos/vagas. Os portões começam **desativados e sem permissão para moradores**. A tarifa de energia de R$ 1/kWh é ilustrativa.

No dashboard EMQX, as credenciais iniciais locais são usuário `admin` e senha `public-change-me`.

## Simulação sem hardware

Depois de preparar o banco e iniciar a plataforma, abra outro PowerShell na raiz:

```powershell
pnpm simulate:hardware
```

O simulador envia leituras sintéticas pelo broker MQTT a cada cinco segundos por padrão. Elas percorrem ingestão, banco, API e painéis.

| Dispositivo | Dados simulados |
|---|---|
| `water_01` | Nível, distância e volume da caixa d'água. |
| `water_meter_01` | Consumo acumulado de água. |
| `energy_01` | Consumo acumulado de energia. |
| `phase_01` | Tensões, correntes das três fases e frequência. |
| `pump_01` | Estado da bomba. |
| `leak_01` / `sewage_01` | Vazamentos de água e esgoto. |
| `gas_01` / `smoke_01` | Detecção de gás, concentração em ppm e sinal de fumaça. |
| `temp_01` | Temperatura. |

A caixa d'água usa o contrato compacto no tópico `predio/bld_001/caixa_agua/water_01/telemetria`. O simulador não lê portas RS485 nem aciona equipamentos físicos.

Para selecionar outro cenário, encerre o simulador com `Ctrl+C` e execute, por exemplo:

```powershell
pnpm simulate:hardware --scenario=low-water
```

Cenários disponíveis: `normal`, `low-water`, `power-loss`, `leak`, `sewage-leak`, `gas`, `smoke`, `high-energy`, `high-water-consumption`, `pump-overrun`, `stuck-sensor` e `gateway-drop`.

O simulador de portões é separado, aceita apenas broker local e exige gateway/controlador próprios. Siga [Simulação local de acessos](docs/ACESSOS.md#simulação-local-separada). As contagens de vagas podem ser atualizadas manualmente ou por integração conforme [Vagas e avisos](docs/VAGAS_AVISOS.md).

## Configuração

| Variável | Uso |
|---|---|
| `DATABASE_URL` | Conexão proprietária do banco, usada pela ingestão, migrations e seed. |
| `DATABASE_URL_APP` | Conexão restrita `predioon_app`, usada nas operações autorizadas da API com RLS. |
| `API_PORT` / `VITE_API_URL` | Porta da API e endereço usado pelos painéis. |
| `DATABASE_URL_IDENTITY` / `DATABASE_URL_BROKER_AUTH` | Credenciais restritas de identidade e autorização MQTT. |
| `JWT_ACTIVE_KID` / `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEYS` | Chaves Ed25519 persistentes e identificação da chave; obrigatórias em produção. |
| `CORS_ORIGINS` | Origens permitidas, separadas por vírgula. |
| `MQTT_URL` / `MQTT_USERNAME` / `MQTT_PASSWORD` | Conexão da ingestão com o broker. |
| `MQTT_AUTH_SECRET` / `MQTT_INGEST_USERNAME` / `MQTT_INGEST_PASSWORD` | Autenticação e autorização HTTP do broker quando configuradas. |
| `GATEWAY_OFFLINE_TIMEOUT_SECONDS` / `DEVICE_OFFLINE_TIMEOUT_SECONDS` | Prazos para considerar gateway ou dispositivo sem comunicação. |
| `ALERT_WEBHOOK_URL` | Opcional: encaminhamento de alertas `HIGH` e `CRITICAL` a um integrador externo. |

Consulte [`.env.example`](.env.example) para os padrões locais e [DEPLOY](docs/DEPLOY.md) para produção. Mantenha API e ingestão na mesma versão ao atualizar o controle de funcionalidades.

## Testes e verificações

Prepare o ambiente local de demonstração com `pnpm setup:local`. Execute os testes com o banco ativo e a plataforma/simuladores parados para evitar interferência nos dados de teste. Alguns testes de integração de acessos só são habilitados com `RUN_ACCESS_DB_TESTS=1`:

```powershell
$env:RUN_ACCESS_DB_TESTS = "1"
pnpm test
```

O comando executa os testes de `@predioon/ui`, `@predioon/api` e `@predioon/ingest` em sequência, incluindo autorização/RLS, sessão, contratos MQTT, telemetria, alertas, acessos, vagas, avisos, consumo, suporte, governança e pausa/retomada de funcionalidades. Os testes de acesso usam clientes MQTT em memória e não acionam portões físicos.

Para verificar tipos e compilar, execute cada etapa após a anterior terminar:

```powershell
pnpm typecheck
pnpm build
```

Em máquinas com memória limitada, use um pacote por vez:

```powershell
pnpm -r --workspace-concurrency=1 typecheck
pnpm -r --workspace-concurrency=1 build
```

Os resultados de validações anteriores e os ensaios com broker local estão em [Revisão de funcionalidades](docs/REVISAO_FUNCIONALIDADES.md).

## Comandos úteis

| Comando | Efeito |
|---|---|
| `pnpm infra:up` | Sobe apenas o banco e o broker. |
| `pnpm infra:down` | Para e remove os containers, preservando o volume do banco. |
| `pnpm db:wait` | Aguarda a disponibilidade do banco. |
| `pnpm db:bootstrap` | Cria atomicamente o banco vazio com SQL versionado; preserva dados e rejeita estruturas parciais. |
| `pnpm db:push` | Sincroniza o schema Drizzle com o banco configurado. |
| `pnpm db:infra` | Reaplica os arquivos `infrastructure/*.sql` em ordem no banco do Compose local. |
| `pnpm db:seed` | Cadastra/complementa a demonstração e redefine a senha das contas demo. |
| `pnpm --filter @predioon/admin-web dev` | Inicia apenas o painel administrador. |
| `pnpm --filter @predioon/building-web dev` | Inicia apenas o painel do síndico. |
| `pnpm --filter @predioon/resident-web dev` | Inicia apenas o portal do morador. |
| `pnpm --filter @predioon/api dev` | Inicia apenas a API. |
| `pnpm --filter @predioon/ingest dev` | Inicia apenas a ingestão MQTT. |

Para recriar uma demonstração descartável, pare os processos com `Ctrl+C` e execute:

```powershell
pnpm infra:reset
pnpm setup:local
pnpm dev
```

**`pnpm infra:reset` apaga o volume e todos os dados do banco local.** Atualizações normais usam schema/migrações, sem reset. Não execute reset nem seed de demonstração em uma instalação com dados reais.

## Solução de problemas

| Sintoma | O que conferir |
|---|---|
| `docker` não é reconhecido ou o engine não responde | Instalação e inicialização do Docker Desktop; depois reabra o PowerShell e confira `docker compose version`. |
| Porta `5434` ocupada | Ajuste a porta externa em `infrastructure/docker-compose.yml` e as duas conexões, `DATABASE_URL` e `DATABASE_URL_APP`, no `.env`. |
| Portas `3000`, `5173`, `5174` ou `5175` ocupadas | Libere as portas antes de iniciar. Se alterar os endereços, ajuste também `VITE_API_URL` e `CORS_ORIGINS`. |
| Painel mostra “API indisponível” | Confira `/health/ready`, o terminal da API e se `pnpm setup:local` terminou sem erro. |
| Painel abre, mas não mostra leituras atuais | Confira ingestão, broker e simulador; verifique cadastro do dispositivo e disponibilidade do recurso em **Funcionalidades**. |
| Portão não permite abertura | O seed começa desativado. Confira recurso, permissão, gateway/controlador habilitados e comunicação recente conforme [Acessos](docs/ACESSOS.md). |
| Testes de acessos aparecem como ignorados | Defina `$env:RUN_ACCESS_DB_TESTS = "1"` no mesmo terminal antes de `pnpm test`. |
| Build ou testes esgotam memória | Execute verificações em sequência e use as opções de concorrência descritas acima. |

## Estrutura do repositório

```text
apps/
  api/             API, autenticação e módulos de negócio
  admin-web/       Administração da plataforma
  building-web/    Painel do síndico
  resident-web/    Portal do morador
services/
  ingest/          MQTT, telemetria, alertas, análise e simuladores
packages/
  db/              Schema, contexto RLS, migrações e seeds
  shared/          Contratos, validações e regras compartilhadas
  ui/              Componentes, autenticação e clientes dos painéis
infrastructure/    Docker Compose, SQL, EMQX, Caddy e deploy
scripts/           Inicialização local no Windows
docs/              Implantação, integração, operação e materiais comerciais
```

## Evolução em andamento

A evolução de `codex/product-platform` foi integrada à `main` em 01/10/2026. O [tracker](docs/superpowers/plans/2026-09-27-product-execution.md) registra as evidências históricas; validações executadas no computador atual são registradas separadamente. Integração do código não significa conclusão de todos os critérios do produto.

| Etapa | Conteúdo | Estado |
|---|---|---|
| 1 | Contratos (`@predioon/contracts`) e cliente HTTP portátil (`@predioon/api-client`) | Concluída |
| 2A | Sessões com rotação atômica, famílias de refresh e JWT Ed25519 com `kid`; migração `013-sessions.sql` | Concluída |
| 2B.1 | Fundação de RBAC e tenancy: catálogo de permissões, concessões, unidades, equipes e suporte temporário; migração `014-rbac-tenancy.sql`; rotas `/v1/tenancy` e `/v1/authorization` | Concluída |
| 2B.2 | Credenciais restritas da API, separando identidade e autorização do broker; migração `015-api-runtime-roles.sql` | Integrada |
| 2B.3 | Capacidades para condomínios, equipamentos, telemetria, alertas, monitoramento, eventos e dashboards; migrations 016–024 | Parcial; demais domínios pendentes |
| 2B.4 | Seleção de condomínio, gestão de unidades/equipes/vínculos e diretório mínimo por capacidade (025) | Integrada; regressão executada pela CI |
| 5 | Apps Morador e Operação, sessão em Keychain/Keystore e fluxos existentes da API | Incremento integrado; publicação e módulos novos pendentes |
| 2C–6 | MFA e cookies, processamento durável (inbox/outbox/workers), ativos e ordens de serviço, automações, planos/assinaturas, aplicativos móveis e operação revisada | Planejadas |

Evidências e números de teste por etapa ficam no [tracker de execução](docs/superpowers/plans/2026-09-27-product-execution.md). Os débitos técnicos conhecidos, incluindo a fronteira entre confirmação MQTT e commit, estão em [TDD, seção 18](docs/TDD.md#18-débitos-técnicos-e-riscos-de-implementação).

## Implantação e limites da versão

O [manual de implantação](docs/IMPLANTACAO_CONDOMINIO.md) em Markdown é a referência atualizada, na versão 3. A [versão inicial em Word](docs/Manual_de_implantacao_Predio_ON.docx) preserva a versão 1 e não inclui os complementos posteriores.

Para produção, siga [DEPLOY](docs/DEPLOY.md): segredos exclusivos, conexão restrita da API, TLS, credenciais por gateway, backups e verificação da instalação. Os valores e as contas de demonstração deste README são destinados ao ambiente local.

- **Acessos:** um pedido aceito pela API não confirma abertura. O ACK registra a execução informada pelo controlador; não mede a posição do portão.
- **Consumo:** os custos são estimativas calculadas com as tarifas configuradas. Desvios estatísticos indicam necessidade de investigação, sem identificar automaticamente sua causa.
- **Sensores:** hardware e calibração precisam de validação no imóvel; sinais de fumaça/gás não substituem sistemas certificados.
- **Suporte remoto:** exige AnyDesk instalado e configurado. O Prédio ON registra solicitações e resultados, sem confirmar automaticamente uma sessão externa. Os complementos de heartbeat e diagnóstico estão no [plano de comunicação e suporte](docs/superpowers/plans/2026-09-23-suporte-remoto-e-heartbeat.md).
- **Mensagens:** WhatsApp/e-mail dependem de integração externa por webhook. A agenda de avisos não envia lembretes automaticamente por esses canais.

## Documentação

| Assunto | Referência |
|---|---|
| Produto e design técnico | [PRD](docs/PRD.md) · [TDD](docs/TDD.md) |
| Arquitetura de produto e execução | [Arquitetura (27/09/2026)](docs/superpowers/specs/2026-09-27-arquitetura-produto-design.md) · [Tracker de execução](docs/superpowers/plans/2026-09-27-product-execution.md) · [Capacidades por domínio (29/09/2026)](docs/superpowers/plans/2026-09-29-rbac-domain-migration.md) |
| Implantação e operação | [Manual do condomínio](docs/IMPLANTACAO_CONDOMINIO.md) · [Deploy](docs/DEPLOY.md) |
| Escopo e validação | [Revisão de funcionalidades](docs/REVISAO_FUNCIONALIDADES.md) · [Controle de funcionalidades](docs/FUNCIONALIDADES.md) |
| Monitoramento | [Consumo e análise](docs/CONSUMO_E_ANALISE.md) · [Sensores](docs/SENSORES.md) |
| Operação | [Acessos](docs/ACESSOS.md) · [Vagas e avisos](docs/VAGAS_AVISOS.md) |
| Atendimento e gestão | [Suporte remoto](docs/SUPORTE_REMOTO.md) · [Gestão transparente](docs/GESTAO_TRANSPARENTE.md) |
| Hardware e MQTT | [Hardware/software](docs/HARDWARE_SOFTWARE.md) · [Contrato e entrega para Helber](docs/ENTREGA_HELBER.md) · [Teste MQTT](docs/TESTE_MQTT.md) |
| Banco e arquitetura | [Modelo de dados](docs/DATABASE_MODEL.md) · [Preparação do banco](docs/DATABASE_SETUP.md) · [Plano técnico](docs/PLANO_TOTAL.md) |
| Evolução | [Próximos passos](docs/NEXT_STEPS.md) |
| Material comercial | [Apresentação](docs/marketing/APRESENTACAO_COMERCIAL.md) · [Casos de uso](docs/marketing/CASOS_DE_USO_E_EVOLUCOES.md) |
