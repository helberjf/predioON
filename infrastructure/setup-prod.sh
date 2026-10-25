#!/usr/bin/env bash
#
# Run from any directory: bash infrastructure/setup-prod.sh [--seed]
# ENV_FILE and COMPOSE_PROJECT_NAME can select an isolated installation.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--seed" ]; }; then
  echo "Uso: bash infrastructure/setup-prod.sh [--seed]" >&2
  exit 64
fi
ENV_FILE="${ENV_FILE:-infrastructure/.env.prod}"
[ -f "$ENV_FILE" ] || { echo "Falta $ENV_FILE. Copie de infrastructure/.env.prod.example." >&2; exit 1; }

# Docker Compose parses dotenv itself: never execute a secrets file as shell.
# Do not print config without --quiet: its output contains credentials.
COMPOSE=(docker compose -f infrastructure/docker-compose.prod.yml --env-file "$ENV_FILE")
"${COMPOSE[@]}" config --quiet
echo "→ construindo a release antes de interromper os serviços"
"${COMPOSE[@]}" build api ingest notifications web db-admin
echo "→ validando credenciais e chaves antes de interromper os serviços"
"${COMPOSE[@]}" run --rm --no-deps db-admin node --import tsx /app/infrastructure/deploy-preflight.mjs api
"${COMPOSE[@]}" run --rm --no-deps db-admin node --import tsx /app/infrastructure/deploy-preflight.mjs database "${1:-}"
echo "→ conferindo leitura dos certificados com o usuário real do broker"
"${COMPOSE[@]}" run --rm --no-deps --entrypoint sh emqx -ec 'test -s /opt/emqx/etc/certs/site/fullchain.pem && test -r /opt/emqx/etc/certs/site/fullchain.pem && test -s /opt/emqx/etc/certs/site/privkey.pem && test -r /opt/emqx/etc/certs/site/privkey.pem'

echo "→ interrompendo produtores e API anteriores antes das migrations"
"${COMPOSE[@]}" stop --timeout 30 ingest notifications api
active_producers=$("${COMPOSE[@]}" ps --status running --quiet ingest notifications api)
if [ -n "$active_producers" ]; then echo "Produtor ou worker ainda ativo; nenhuma migration aplicada."; exit 1; fi
# A parada dos containers é verificável. Ela não comprova drenagem MQTT ou a
# ausência de produtores externos: confira o procedimento de rollout em DEPLOY.

echo "→ subindo o banco e aguardando saúde"
"${COMPOSE[@]}" up -d --wait --wait-timeout 180 db

echo "→ criando as tabelas"
"${COMPOSE[@]}" run --rm --no-deps db-admin pnpm --filter @predioon/db db:bootstrap

echo "→ verificando histórico e aplicando migrations pendentes"
"${COMPOSE[@]}" run --rm --no-deps db-admin pnpm --filter @predioon/db db:infra

# Owner and all runtime credentials reach only this transient administrative run.
echo "→ provisionando as seis credenciais restritas"
"${COMPOSE[@]}" run --rm --no-deps db-admin pnpm --filter @predioon/db db:provision-runtime

if [ "${1:-}" = "--seed" ]; then
  echo "→ semeando dados de demonstração"
  "${COMPOSE[@]}" run --rm --no-deps db-admin pnpm --filter @predioon/db db:seed
fi

echo "→ subindo a release e aguardando todos os healthchecks"
"${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 240 db api emqx ingest notifications web
"${COMPOSE[@]}" ps
echo "Preparação concluída. Confira os portais, /health/ready, TLS MQTT e o roteiro docs/DEPLOY.md."
