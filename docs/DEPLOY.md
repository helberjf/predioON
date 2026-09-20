# Deploy — Prédio ON

## O que vai onde, e por quê

A Vercel hospeda os três painéis. Ela **não** serve para a API nem para a ingestão, e o motivo é concreto:

| Peça | Onde | Por quê |
|---|---|---|
| `admin-web`, `building-web`, `resident-web` | **Vercel** | São SPAs estáticas — é exatamente o caso de uso da Vercel |
| `apps/api` | **Railway / Render / Fly.io** | O SSE (`/events/stream`) é uma conexão aberta e a função serverless da Vercel tem tempo máximo de execução |
| `services/ingest` | **Railway / Render / Fly.io** | Processo permanente: mantém sessão MQTT, faz a varredura de offline e escuta o broker. Não existe "requisição" que o acorde |
| PostgreSQL + TimescaleDB | **Neon**, **Timescale Cloud** ou **Supabase** | Precisa da extensão `timescaledb` e de `LISTEN/NOTIFY` |
| Broker MQTT | **EMQX Cloud** ou **HiveMQ Cloud** | Porta 8883 com TLS e credencial por gateway |

Colocar a API na Vercel derrubaria o tempo real e a ingestão. Essa parte precisa de um host com processo de longa duração.

---

## 1. Banco

Crie um PostgreSQL 16 com TimescaleDB (Neon ou Timescale Cloud) e guarde a URL de conexão.

```bash
export DATABASE_URL="postgres://usuario:senha@host/predioon?sslmode=require"
pnpm --filter @predioon/db exec drizzle-kit push --force
```

Depois aplique os scripts de `infrastructure/` **na ordem**, por `psql`:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infrastructure/001-timescale-rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infrastructure/002-app-role.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infrastructure/003-reservations.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infrastructure/004-occurrences.sql
```

⚠️ Antes de rodar o `002` em produção, **troque a senha** de `predioon_app` no arquivo. O valor que está lá é de desenvolvimento.

---

## 2. API e ingestão

Dois serviços no mesmo host, a partir do mesmo repositório:

| Serviço | Comando de start | Variáveis |
|---|---|---|
| API | `pnpm --filter @predioon/api exec tsx src/server.ts` | `DATABASE_URL`, `DATABASE_URL_APP`, `JWT_SECRET`, `CORS_ORIGINS`, `API_PORT` |
| Ingestão | `pnpm --filter @predioon/ingest exec tsx src/index.ts` | `DATABASE_URL`, `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD` |

`JWT_SECRET` precisa de 32 caracteres ou mais. Gere um de verdade:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`CORS_ORIGINS` recebe os domínios da Vercel separados por vírgula, sem barra no final.

---

## 3. Painéis na Vercel

Três projetos separados, todos apontando para este mesmo repositório. Para cada um, no painel da Vercel:

- **Root Directory**: `apps/admin-web`, `apps/building-web` ou `apps/resident-web`
- **Framework Preset**: Vite (o `vercel.json` de cada app já traz build e rewrite de SPA)
- **Environment Variable**: `VITE_API_URL` = a URL pública da API

Pela linha de comando, a partir da raiz do repositório:

```bash
npx vercel login
```

```bash
cd apps/building-web && npx vercel --prod
```

Repita para `apps/admin-web` e `apps/resident-web`. O login abre o navegador e é feito na sua conta — não dá para automatizar de fora.

O `rewrites` do `vercel.json` é obrigatório: sem ele, recarregar a página em `/agua` devolve 404, porque a rota existe só no React Router.

---

## 4. Broker MQTT

No EMQX Cloud:

1. Crie uma credencial por gateway (`gw_<id>`), gerada na tela **Gateways → Gerar credencial** do painel administrador.
2. Aplique a ACL de `infrastructure/emqx/acl.conf`: cada gateway publica apenas sob o próprio prefixo e a ingestão só assina.
3. Use a porta **8883 (TLS)**. Nunca exponha 1883 na internet.

---

## 5. Verificação depois do deploy

```bash
curl https://SUA-API/health/ready
```

Deve responder `{"ok":true,"database":"up"}`. Depois:

1. Entre no painel do síndico e confirme que o login funciona.
2. Rode o simulador apontando para o broker de produção:
   `MQTT_URL=mqtts://... pnpm simulate:hardware`
3. A telemetria tem que aparecer no painel sem recarregar a página (SSE).

---

## Custo aproximado (estimativa a confirmar)

| Item | Faixa |
|---|---|
| Vercel (3 projetos, Hobby) | grátis |
| Neon / Timescale Cloud | grátis a US$ 25/mês |
| Railway ou Render (API + ingest) | US$ 5 a 20/mês |
| EMQX Cloud Serverless | grátis até um volume baixo |

Um piloto com um prédio cabe na faixa gratuita da maioria desses serviços.
