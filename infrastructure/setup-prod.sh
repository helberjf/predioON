#!/usr/bin/env bash
#
# Prepara o banco de produção na ordem certa:
#   1. sobe o PostgreSQL e espera ficar saudável
#   2. cria as tabelas com drizzle-kit
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

echo "→ subindo o banco"
"${COMPOSE[@]}" up -d db

echo "→ esperando o PostgreSQL aceitar conexões"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T db pg_isready -U predioon -d predioon >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "→ criando as tabelas"
"${COMPOSE[@]}" run --rm \
  -e DATABASE_URL="postgres://predioon:${POSTGRES_PASSWORD}@db:5432/predioon" \
  api pnpm --filter @predioon/db exec drizzle-kit push --force

echo "→ aplicando TimescaleDB, RLS e a role da aplicação"
for script in infrastructure/0*.sql; do
  echo "   $script"
  psql_transaction=()
  migration_number="${script##*/}"
  migration_number="${migration_number%%-*}"
  if (( 10#${migration_number} >= 15 )); then
    psql_transaction=(--single-transaction)
  fi
  "${COMPOSE[@]}" exec -T db psql -U predioon -d predioon \
    -v ON_ERROR_STOP=1 \
    -v app_password="${APP_DB_PASSWORD}" \
    "${psql_transaction[@]}" \
    -f - < "$script"
done

echo "→ provisionando credenciais restritas da API"
"${COMPOSE[@]}" run --rm \
  -e DATABASE_URL="postgres://predioon:${POSTGRES_PASSWORD}@db:5432/predioon" \
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
