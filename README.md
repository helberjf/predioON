# Prédio ON — plataforma full-stack + IoT

Plataforma Prédio ON, com API, ingestão MQTT, banco PostgreSQL/TimescaleDB e três interfaces: **administrador global**, **administrador do prédio** e **morador**.

Entrega ampliada e validada localmente em 24/09/2026: veja [a matriz de funcionalidades](docs/REVISAO_FUNCIONALIDADES.md) e [o contrato MQTT e as instruções para Helber](docs/ENTREGA_HELBER.md). As imagens fornecidas orientam a identidade visual.

> **Escopo atual:** monitoramento, consumo/custo estimado, análise histórica, sensores, acessos remotos, vagas e agenda de avisos. A integração física depende dos equipamentos instalados. Disjuntor/extintor ficou fora desta entrega.

## Funcionalidades e marketing

Para implantar em um condomínio real, comece pelo [manual de implantação e operação](docs/IMPLANTACAO_CONDOMINIO.md), com resumo para WhatsApp, etapas detalhadas e testes de aceitação. O Markdown é a referência atualizada (versão 3); a [versão inicial em Word](docs/Manual_de_implantacao_Predio_ON.docx) preserva a versão 1 e não inclui os complementos posteriores.

A central [Funcionalidades](docs/FUNCIONALIDADES.md), no painel administrativo, permite ao administrador ativo da plataforma controlar 23 recursos globalmente e por condomínio, com justificativa e auditoria. A pausa bloqueia operações, análises e alertas do recurso e descarta novas leituras correspondentes, preservando o histórico. A comunicação dos gateways permanece ativa.

A integração de [suporte remoto com AnyDesk](docs/SUPORTE_REMOTO.md) oferece cadastro por condomínio, preparação do acesso e histórico de atendimentos no painel administrativo. O [plano de primeira instalação e heartbeat](docs/superpowers/plans/2026-09-23-suporte-remoto-e-heartbeat.md) descreve os complementos de comunicação e diagnóstico; o acesso ao computador real depende da instalação e configuração do AnyDesk no local.

Os portais do síndico e do morador incluem [transparência e prestação de contas](docs/GESTAO_TRANSPARENTE.md), chamados com três níveis de gravidade, histórico de respostas e agrupamento de problemas repetidos. A análise estatística de água e energia continua disponível em Consumo e análise.

Conferência da lista de funcionalidades em 22/09/2026:

- [Funcionalidades implementadas e estado da validação](docs/REVISAO_FUNCIONALIDADES.md), incluindo vagas disponíveis para carros e motos.
- [Apresentação comercial da versão atual](docs/marketing/APRESENTACAO_COMERCIAL.md).
- [Exemplos de uso](docs/marketing/CASOS_DE_USO_E_EVOLUCOES.md): consumo de energia/água fora do padrão, custo diário, tempo de bomba e vagas.

Configuração: [consumo e análise](docs/CONSUMO_E_ANALISE.md), [sensores](docs/SENSORES.md), [acessos](docs/ACESSOS.md) e [vagas/avisos](docs/VAGAS_AVISOS.md). Os painéis exibem informações de medição e uma referência estatística aprendida; alertas não diagnosticam sozinhos a causa do desvio.

## Stack

- **API:** Express 5 + TypeScript, separação por domínio
- **Validação:** Zod compartilhado entre MQTT e aplicações
- **Banco:** PostgreSQL + TimescaleDB + Drizzle + RLS
- **Ingestão:** serviço Node.js separado + mqtt.js
- **Broker:** EMQX
- **Painéis:** React + Vite + Tailwind; estrutura compatível com shadcn/ui
- **Mobile:** Expo em etapa posterior

## O que abre nesta versão

| Serviço | Endereço local | Finalidade |
|---|---|---|
| Painel administrador | http://localhost:5173 | Gestão global da plataforma |
| Painel do prédio | http://localhost:5174 | Operação e monitoramento do condomínio |
| Portal do morador | http://localhost:5175 | Visualização autorizada para o morador |
| API | http://localhost:3000 | Backend Express |
| Health da API | http://localhost:3000/health | Teste rápido do backend |
| EMQX Dashboard | http://localhost:18083 | Broker MQTT |

> Não abra `index.html` com duplo clique. Os painéis usam Vite e precisam ser iniciados com `pnpm dev`.

## Contas de demonstração

Criadas por `pnpm db:seed`, todas com a senha `predioon123`:

| E-mail | Perfil | Painel |
|---|---|---|
| `admin@predioon.local` | Administrador da plataforma | http://localhost:5173 |
| `sindico@predioon.local` | Administrador do prédio | http://localhost:5174 |
| `morador@predioon.local` | Morador | http://localhost:5175 |

## Ver o sistema funcionando sem hardware

```bash
pnpm simulate:hardware
```

O simulador publica telemetria real no broker. Os cenários de falha ficam atrás de um argumento:

```bash
pnpm simulate:hardware --scenario=low-water
```

Cenários disponíveis: `normal`, `low-water`, `power-loss`, `leak`, `sewage-leak`, `gas`, `smoke`, `high-energy`, `high-water-consumption`, `pump-overrun`, `stuck-sensor`, `gateway-drop`. O simulador isolado de portões tem instruções próprias em [Acessos](docs/ACESSOS.md).

## Testes

```bash
pnpm test
```

Cobrem isolamento entre prédios (RBAC + RLS), rotação de refresh token, autorização MQTT,
credencial por gateway, o contrato compacto da caixa d'água, idempotência, regras de alerta,
conflito de reserva e tratamento de leituras na interface. Prepare o banco local com
`pnpm setup:local`. Confira também `pnpm typecheck` e `pnpm build`.

---

# Como abrir no Windows — passo a passo

## 1. Pré-requisitos

Instale:

1. **Node.js 22 LTS recomendado** (ou Node 20.19+)
2. **Docker Desktop**
3. **pnpm** via Corepack

No PowerShell:

```powershell
node -v
docker --version
corepack enable
pnpm -v
```

Se `pnpm` ainda não estiver disponível:

```powershell
npm install -g pnpm
```

## 2. Extraia o ZIP e entre na pasta

Exemplo:

```powershell
cd "C:\Users\SEU_USUARIO\Downloads\predio-on-platform"
```

Você precisa estar na pasta que contém este `README.md` e o `package.json` principal.

## 3. Instale as dependências

```powershell
pnpm install
```

## 4. Crie o `.env`

```powershell
Copy-Item .env.example .env
```

Os valores padrão foram preparados para o Docker Compose local.

## 5. Ligue o Docker Desktop

Espere o engine ficar ativo e execute:

```powershell
pnpm setup:local
```

O comando executa:

```text
Docker Compose
   ↓
PostgreSQL + TimescaleDB + EMQX
   ↓
aguarda banco
   ↓
Drizzle cria/atualiza tabelas
   ↓
TimescaleDB + índices + RLS
   ↓
seed com prédio e sensores demo
```

## 6. Inicie a plataforma

```powershell
pnpm dev
```

Mantenha o terminal aberto.

## 7. Abra no navegador

Administrador:

```text
http://localhost:5173
```

Prédio:

```text
http://localhost:5174
```

Morador:

```text
http://localhost:5175
```

API/health:

```text
http://localhost:3000/health
```

EMQX:

```text
http://localhost:18083
```

Credenciais locais do dashboard EMQX:

```text
usuário: admin
senha: public-change-me
```

### Atalho opcional

Na raiz do projeto:

```powershell
.\scripts\start-local.ps1
```

---

# Testar sem hardware físico

Abra um segundo PowerShell na raiz:

```powershell
pnpm simulate:hardware
```

O simulador publica apenas telemetria MQTT, representando sensores reais:

```text
water_01     nível, distância e volume da caixa d'água
phase_01     tensão das fases L1, L2 e L3
pump_01      estado da bomba
leak_01      sensor de vazamento
temp_01      temperatura
```

A cada aproximadamente 5 segundos ele envia dados sintéticos. O cenário padrão é normal; falhas só são geradas quando selecionadas com `--scenario`. A caixa d'água usa o tópico `predio/bld_001/caixa_agua/water_01/telemetria` e o contrato compacto solicitado. O simulador não lê uma porta RS485.

```text
Simulador
   ↓ MQTT
EMQX
   ↓
Node ingest
   ↓
TimescaleDB
   ↓
Express API
   ↓
Painéis
```

O painel administrador atualiza os dados automaticamente a cada 10 segundos.

---

# Painel administrador

O painel em `http://localhost:5173` possui:

```text
Visão geral
Clientes
Prédios
Gateways
Dispositivos
Alertas
Usuários
Auditoria
```

Não existe tela de comandos físicos nem controle remoto de portão nesta versão.

---

# Comandos úteis

Subir apenas infraestrutura:

```powershell
pnpm infra:up
```

Parar containers sem apagar dados:

```powershell
pnpm infra:down
```

Zerar banco/volumes:

```powershell
pnpm infra:reset
pnpm setup:local
```

Rodar apenas o painel administrador:

```powershell
pnpm --filter @predioon/admin-web dev
```

Rodar apenas a API:

```powershell
pnpm --filter @predioon/api dev
```

Rodar apenas ingest MQTT:

```powershell
pnpm --filter @predioon/ingest dev
```

Verificar TypeScript:

```powershell
pnpm typecheck
```

Compilar:

```powershell
pnpm build
```

---

# Solução rápida de problemas

### `docker` não é reconhecido

Abra/instale o Docker Desktop e reinicie o PowerShell.

### Porta `5434` já está em uso

O projeto usa a porta externa `5434` para não conflitar com um PostgreSQL local. Se ela também estiver ocupada, altere a porta externa em `infrastructure/docker-compose.yml` e ajuste `DATABASE_URL` no `.env`.

### Porta `5173`, `5174`, `5175` ou `3000` está ocupada

Encerre o processo que usa a porta antes de `pnpm dev`.

### O painel mostra `API indisponível`

Abra primeiro:

```text
http://localhost:3000/health
```

Depois confira o terminal de `pnpm dev` e se `pnpm setup:local` terminou sem erro.

### Recomeçar do zero

```powershell
Ctrl+C
pnpm infra:reset
pnpm setup:local
pnpm dev
```

Depois, em outro terminal:

```powershell
pnpm simulate:hardware
```

---

# Dados demo

```text
organização:      org_001
prédio:           bld_001
admin global:     platform_admin
admin do prédio:  building_admin
morador:          resident_demo
gateway:          gw_001
caixa d'água:     water_01
monitor de fase:  phase_01
vazamento:        leak_01
temperatura:      temp_01
```

A autenticação usa JWT, senha com Argon2 e refresh token rotativo. A API usa a role
`predioon_app`, sem propriedade das tabelas, com RLS por prédio. Para produção, configure
segredos exclusivos, certificado MQTT válido e os demais valores de [DEPLOY.md](docs/DEPLOY.md).

---

# Estrutura

```text
apps/
  api/
  admin-web/
  building-web/
  resident-web/
services/
  ingest/
packages/
  db/
  shared/
infrastructure/
docs/
```

## Banco

```text
users
organizations
buildings
memberships
gateways
devices
device_metrics
ingest_events
telemetry
alert_rules
alerts
audit_logs
```

Leia também:

- `docs/DATABASE_MODEL.md` — modelo e relacionamentos
- `docs/DATABASE_SETUP.md` — banco, TimescaleDB e RLS
- `docs/PLANO_TOTAL.md` — arquitetura completa
- `docs/HARDWARE_SOFTWARE.md` — integração sensor → gateway → MQTT → software
- `docs/NEXT_STEPS.md` — evolução recomendada
