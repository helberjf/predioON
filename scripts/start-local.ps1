#requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$Setup,
  [switch]$SeedDemo
)

$ErrorActionPreference = "Stop"

function Invoke-CheckedCommand {
  param([string]$Executable, [string[]]$Arguments)
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Falha em '$Executable $($Arguments -join ' ')' (codigo $LASTEXITCODE). A inicializacao foi interrompida."
  }
}

if ($SeedDemo -and -not $Setup) {
  throw "-SeedDemo exige -Setup. Use -Setup -SeedDemo apenas em uma demonstracao local descartavel: o seed redefine as senhas das contas demo."
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
Push-Location -LiteralPath $projectRoot
try {
  Write-Host "Predio ON - inicializacao local" -ForegroundColor Cyan
  foreach ($requiredTool in @("node", "pnpm", "docker")) {
    if (-not (Get-Command $requiredTool -ErrorAction SilentlyContinue)) {
      throw "$requiredTool nao encontrado no PATH. Execute 'node scripts/check-environment.mjs' para ver os requisitos."
    }
  }

  $manifest = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
  if ($manifest.packageManager -notmatch '^pnpm@(\d+\.\d+\.\d+)(?:\+.*)?$') {
    throw "packageManager deve declarar uma versao exata do pnpm no package.json."
  }
  $requiredPnpmVersion = $Matches[1]
  $pnpmVersion = ((Invoke-CheckedCommand "pnpm" @("--version")) -join "`n").Trim()
  if ($pnpmVersion -ne $requiredPnpmVersion) {
    throw "Este projeto exige pnpm $requiredPnpmVersion. Instale/ative a versao fixada (npm install --global pnpm@$requiredPnpmVersion), reabra o terminal e confira 'pnpm --version'."
  }

  Invoke-CheckedCommand "node" @("-e", "const [major,minor]=process.versions.node.split('.').map(Number); if (!(major===22&&minor>=13 || major===24&&minor>=3 || major>=26)) { console.error('Node incompativel: use 22.13+, 24.3+ ou 26+ conforme os aplicativos moveis.'); process.exit(1); }")
  Write-Host "Verificando Docker Compose e engine..." -ForegroundColor Cyan
  Invoke-CheckedCommand "docker" @("compose", "version", "--short")
  Invoke-CheckedCommand "docker" @("info", "--format", "{{.ServerVersion}}")

  $environmentPath = Join-Path $projectRoot ".env"
  if (-not (Test-Path -LiteralPath $environmentPath)) {
    if (-not $Setup) {
      throw ".env ausente. Execute '.\scripts\start-local.ps1 -Setup' para preparar o ambiente local."
    }
    Copy-Item -LiteralPath (Join-Path $projectRoot ".env.example") -Destination $environmentPath
    Write-Host ".env criado a partir de .env.example. Valores existentes nunca sao sobrescritos." -ForegroundColor Green
  }

  if ($Setup) {
    Write-Host "Instalando dependencias com o lockfile..." -ForegroundColor Cyan
    Invoke-CheckedCommand "pnpm" @("install", "--frozen-lockfile")
  } elseif (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules/.pnpm/lock.yaml"))) {
    throw "Dependencias ausentes. Execute '.\scripts\start-local.ps1 -Setup' primeiro."
  }

  Write-Host "Iniciando banco e broker locais e aguardando o PostgreSQL..." -ForegroundColor Cyan
  Invoke-CheckedCommand "pnpm" @("infra:up")
  Invoke-CheckedCommand "pnpm" @("db:wait")

  if ($Setup) {
    Write-Host "Preparando infraestrutura, schema e credenciais restritas..." -ForegroundColor Cyan
    foreach ($setupCommand in @("db:bootstrap", "db:infra", "db:provision-runtime")) {
      Invoke-CheckedCommand "pnpm" @($setupCommand)
    }
    if ($SeedDemo) {
      Write-Host "Cadastrando demonstracao e redefinindo senhas demo (solicitado com -SeedDemo)..." -ForegroundColor Yellow
      Invoke-CheckedCommand "pnpm" @("db:seed")
    }
  }

  Write-Host "Conferindo migrations sem alterar o banco..." -ForegroundColor Cyan
  try { Invoke-CheckedCommand "pnpm" @("db:infra", "--check") }
  catch {
    throw "Banco ainda nao liberado para esta versao. Confira o diagnostico acima. Para uma preparacao ou atualizacao revisada, execute '.\scripts\start-local.ps1 -Setup' sem -SeedDemo. Divergencia de checksum ou banco legado sem ledger exigem revisao do historico; consulte docs/MIGRATIONS.md. API e ingestao nao foram iniciadas."
  }

  Write-Host "Iniciando API, ingestao e paineis. Ctrl+C para encerrar." -ForegroundColor Green
  Write-Host "Administrador: http://localhost:5173"
  Write-Host "Condominio:    http://localhost:5174"
  Write-Host "Morador:       http://localhost:5175"
  Write-Host "API:           http://localhost:3000/health"
  Write-Host "EMQX:          http://localhost:18083"
  Invoke-CheckedCommand "pnpm" @("dev")
} finally {
  Pop-Location
}
