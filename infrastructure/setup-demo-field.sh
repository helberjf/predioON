#!/usr/bin/env bash
# Prepara uma máquina Ubuntu (por exemplo Oracle Cloud Always Free, ARM) para o
# campo de demonstração: Docker, o repositório e o compose. Idempotente.
#
#   bash infrastructure/setup-demo-field.sh            instala e sobe
#   bash infrastructure/setup-demo-field.sh --update   atualiza o código e reconstrói
#
# Espera infrastructure/.env.demo-field preenchido (ver .env.demo-field.example).
# Não abre portas: o compose não publica nenhuma.
set -euo pipefail

cd "$(dirname "$0")/.."
compose=(docker compose -f infrastructure/docker-compose.demo-field.yml --env-file infrastructure/.env.demo-field)

if ! command -v docker >/dev/null 2>&1; then
  echo "Instalando o Docker..."
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  echo "Docker instalado. Saia e entre de novo na sessão SSH e rode este script outra vez."
  exit 0
fi

if [ ! -f infrastructure/.env.demo-field ]; then
  echo "Crie infrastructure/.env.demo-field a partir de infrastructure/.env.demo-field.example." >&2
  exit 1
fi
chmod 600 infrastructure/.env.demo-field

if [ "${1:-}" = "--update" ]; then
  git pull --ff-only
fi

"${compose[@]}" up -d --build
"${compose[@]}" ps
echo "Campo de demonstração no ar. Logs: ${compose[*]} logs -f demo-field ingest"
