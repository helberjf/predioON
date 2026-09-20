# Deploy — Prédio ON

## Caminho principal: uma VPS

A plataforma inteira sobe em um `docker compose`: banco, broker, API, ingestão e os três
painéis atrás de um Caddy com TLS automático.

### 1. Pré-requisitos na VPS

- Docker e o plugin Compose instalados
- portas **80**, **443** e **8883** liberadas no firewall
- quatro registros A apontando para o IP da máquina:
  `api`, `admin`, `sindico` e `morador` do seu domínio

Mínimo confortável: 2 vCPU e 4 GB de RAM. O TimescaleDB é quem pede memória.

### 2. Subir

```bash
git clone SEU_REPO predioon && cd predioon
```

```bash
cp infrastructure/.env.prod.example infrastructure/.env.prod
```

Preencha o domínio e gere as senhas:

```bash
openssl rand -base64 32
```

```bash
./infrastructure/setup-prod.sh --seed
```

O script sobe o banco, cria as tabelas, aplica TimescaleDB + RLS + a role `predioon_app`
com a senha que você definiu, semeia os dados de demonstração e sobe o resto.
Sem `--seed` o banco fica vazio, pronto para o cadastro real.

O Caddy pede os certificados Let's Encrypt sozinho na primeira subida. Se os registros DNS
ainda não propagaram, ele tenta de novo automaticamente.

### 3. Conferir

```bash
curl https://api.SEUDOMINIO/health/ready
```

Deve responder `{"ok":true,"database":"up"}`. Depois entre em `https://sindico.SEUDOMINIO`.

### 4. Atualizar depois de um push

```bash
git pull && docker compose -f infrastructure/docker-compose.prod.yml --env-file infrastructure/.env.prod up -d --build
```

Se o schema mudou, rode `./infrastructure/setup-prod.sh` de novo — ele é idempotente.

### O que cada serviço faz

| Serviço | Exposto | Papel |
|---|---|---|
| `web` (Caddy) | 80, 443 | TLS, serve os três painéis e faz proxy da API |
| `api` | interno | Express: autenticação, cadastros, consultas, SSE |
| `ingest` | interno | MQTT: valida, grava, avalia regras, varre offline |
| `emqx` | 8883 | Broker onde os gateways publicam |
| `db` | interno | PostgreSQL + TimescaleDB |

Banco e API **não** têm porta publicada — só o Caddy e o broker falam com a internet.

### Ajustes de produção que valem a pena

- **Backup**: `docker compose ... exec -T db pg_dump -U predioon predioon | gzip > backup.sql.gz`, num cron diário.
- **Retenção e compressão**: as políticas estão comentadas no fim de
  `infrastructure/001-timescale-rls.sql`. Ligue quando o volume crescer.
- **TLS no broker**: o EMQX já expõe 8883; configure o certificado do seu domínio no dashboard.
- **Trocar a senha do dashboard do EMQX** na primeira entrada.

---

## Alternativa: painéis na Vercel

### Estado atual

Os três painéis estão publicados na conta Vercel `catarinasoaresjf-9232`:

| Painel | URL |
|---|---|
| Administrador da plataforma | https://predio-on-admin.vercel.app |
| Operação do condomínio | https://predio-on-sindico.vercel.app |
| Portal do morador | https://predio-on-morador.vercel.app |

Eles abrem na tela de login e **ainda não autenticam**, porque a API não está publicada.
Enquanto isso, a tela mostra a mensagem `Não foi possível falar com a API`. Falta o passo 1
(banco) e o passo 2 (API) desta página; feito isso, basta reconstruir os painéis com
`VITE_API_URL` apontando para a API e publicar de novo.

### Republicar um painel

Os projetos foram criados a partir da saída de build, sem integração com git. Para atualizar:

```bash
pnpm --filter @predioon/building-web build && cd apps/building-web/dist && npx vercel deploy --prod --yes
```

Para ligar a publicação automática a cada push, conecte o repositório no painel da Vercel e
defina o **Root Directory** de cada projeto conforme a seção 3.

### Por que a Vercel não serve para tudo

A Vercel hospeda bem os três painéis, mas **não** a API nem a ingestão:

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
