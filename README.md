# Prédio ON — plataforma full-stack + IoT

Starter executável da plataforma Prédio ON, com API, ingestão MQTT, banco PostgreSQL/TimescaleDB e três interfaces: **administrador global**, **administrador do prédio** e **morador**.

> **Escopo atual:** monitoramento, telemetria, alertas e histórico. A funcionalidade de abertura/acionamento remoto de portão foi removida desta versão.

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

Cenários disponíveis: `normal`, `low-water`, `power-loss`, `leak`, `stuck-sensor`, `gateway-drop`.

## Testes

```bash
pnpm test
```

Cobrem isolamento entre prédios (RBAC + RLS), rotação de refresh token, idempotência da
ingestão por `eventId`, motor de regras e conflito de reserva. Precisam da infraestrutura
local no ar (`pnpm infra:up && pnpm db:seed`).

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
water_01     nível e volume da caixa d'água
phase_01     tensão da fase L1
leak_01      sensor de vazamento
temp_01      temperatura
```

A cada aproximadamente 5 segundos ele envia dados. Em alguns ciclos gera propositalmente nível baixo ou subtensão para demonstrar os alertas.

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

O middleware `devAuth.ts` simula perfis apenas em desenvolvimento. Antes de produção, substitua por autenticação real (OIDC/Cognito/Auth0/Keycloak) e use uma role PostgreSQL não proprietária para que o RLS funcione como barreira efetiva.

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
