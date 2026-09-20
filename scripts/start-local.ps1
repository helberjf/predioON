$ErrorActionPreference = "Stop"

Write-Host "Prédio ON - preparação local" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js não encontrado." }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker não encontrado. Abra/instale o Docker Desktop." }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "pnpm não encontrado. Tentando habilitar Corepack..." -ForegroundColor Yellow
  corepack enable
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host ".env criado a partir de .env.example" -ForegroundColor Green
}

Write-Host "Instalando dependências..." -ForegroundColor Cyan
pnpm install

Write-Host "Subindo infraestrutura e preparando banco..." -ForegroundColor Cyan
pnpm setup:local

Write-Host "Iniciando API, ingestão e painéis..." -ForegroundColor Green
Write-Host "Admin:    http://localhost:5173"
Write-Host "Prédio:   http://localhost:5174"
Write-Host "Morador:  http://localhost:5175"
Write-Host "API:      http://localhost:3000/health"
Write-Host "EMQX:     http://localhost:18083"
pnpm dev
