#!/usr/bin/env bash
#
# Prepara o banco de produção na ordem certa:
#   1. sobe o PostgreSQL e espera ficar saudável
#   2. cria a estrutura inicial por SQL versionado se o banco estiver vazio
#   3. aplica TimescaleDB, RLS, role da aplicação e constraints
#   4. opcionalmente semeia os dados de demonstração
#
# Uso, a partir da raiz do repositório:
#   ./infrastructure/setup-prod.sh            # sem seed
#   ./infrastructure/setup-prod.sh --seed     # com usuários e dados de exemplo
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="infrastructure/.env.prod"
[ -f "$ENV_FILE" ] || { echo "Falta $ENV_FILE. Copie de infrastructure/.env.prod.example."; exit 1; }

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

COMPOSE=(docker compose -f infrastructure/docker-compose.prod.yml --env-file "$ENV_FILE")

[ -n "${NOTIFICATIONS_DB_PASSWORD:-}" ] || { echo "Defina NOTIFICATIONS_DB_PASSWORD antes de aplicar a release 038."; exit 1; }

echo "→ interrompendo produtores e worker anteriores antes das migrations"
"${COMPOSE[@]}" stop --timeout 30 ingest notifications
active_producers=$("${COMPOSE[@]}" ps --status running --quiet ingest notifications)
if [ -n "$active_producers" ]; then echo "Produtor ou worker ainda ativo; nenhuma migration aplicada."; exit 1; fi
# A parada dos containers é verificável. Ela não comprova drenagem MQTT ou a
# ausência de produtores externos: confira o procedimento de rollout em DEPLOY.

echo "→ subindo o banco"
"${COMPOSE[@]}" up -d db

echo "→ esperando o PostgreSQL aceitar conexões"
database_ready=false
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T db pg_isready -U predioon -d predioon >/dev/null 2>&1; then database_ready=true; break; fi
  sleep 2
done
if [ "$database_ready" != true ]; then echo "PostgreSQL indisponível; preparação interrompida."; exit 1; fi

echo "→ criando as tabelas"
"${COMPOSE[@]}" run --rm --build \
  -e DATABASE_URL="postgres://predioon:${POSTGRES_PASSWORD}@db:5432/predioon" \
  api pnpm --filter @predioon/db db:bootstrap

echo "→ verificando histórico e aplicando migrations pendentes"
"${COMPOSE[@]}" run --rm \
  -e DATABASE_URL="postgres://predioon:${POSTGRES_PASSWORD}@db:5432/predioon" \
  api pnpm --filter @predioon/db db:infra

echo "→ provisionando as quatro credenciais restritas"
"${COMPOSE[@]}" run --rm \
  -e DATABASE_URL="postgres://predioon:${POSTGRES_PASSWORD}@db:5432/predioon" \
  -e DATABASE_URL_NOTIFICATIONS="postgres://predioon_notifications:${NOTIFICATIONS_DB_PASSWORD}@db:5432/predioon" \
  api pnpm --filter @predioon/db db:provision-runtime

if [ "${1:-}" = "--seed" ]; then
  echo "→ semeando dados de demonstração"
  "${COMPOSE[@]}" run --rm \
    -e DATABASE_URL="postgres://predioon:${POSTGRES_PASSWORD}@db:5432/predioon" \
    -e SEED_PASSWORD="${SEED_PASSWORD:-predioon123}" \
    api pnpm --filter @predioon/db db:seed
fi

echo "→ subindo o restante da plataforma"
"${COMPOSE[@]}" up -d --build

echo
echo "Pronto. Verifique:"
echo "  https://api.${DOMAIN}/health/ready"
echo "  https://sindico.${DOMAIN}"
