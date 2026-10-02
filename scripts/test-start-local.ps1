#requires -Version 5.1
# Behavioral checks of the real startup script with isolated files and fake tools.
# No Docker command, database, package install or application process is executed.
$ErrorActionPreference = "Stop"
$sourceScript = Join-Path $PSScriptRoot "start-local.ps1"
$fixtureName = "predioon-startup-test-" + [guid]::NewGuid().ToString("N")
$fixtureRoot = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) $fixtureName))
$fixtureScript = Join-Path $fixtureRoot "scripts/start-local.ps1"

function Assert-StartupTest([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "Teste falhou: $Message" }
}

function global:pnpm {
  $arguments = @($args)
  $command = $arguments -join " "
  $state = $global:PredioOnStartupTestState
  $state.Calls.Add("pnpm $command")
  $global:LASTEXITCODE = 0
  switch ($command) {
    "--version" { Write-Output "10.17.1" }
    "infra:up" {
      if ($state.InfraFailure) { $global:LASTEXITCODE = 1 }
      else { $state.InfrastructureStarted = $true }
    }
    "db:wait" {
      if (-not $state.InfrastructureStarted) { throw "Banco consultado antes da infraestrutura" }
      $state.DatabaseReady = $true
    }
    "db:infra" { $state.Pending = $false }
    "db:infra --check" {
      if (-not $state.DatabaseReady) { throw "Historico consultado antes do banco pronto" }
      if ($state.Pending) { $global:LASTEXITCODE = 2 }
      elseif ($state.Legacy) { $global:LASTEXITCODE = 1 }
      else { $state.Checked = $true }
    }
    "dev" {
      if (-not $state.Checked) { throw "Aplicacao iniciada antes da verificacao do historico" }
    }
  }
}

function global:docker {
  $global:PredioOnStartupTestState.Calls.Add("docker " + ($args -join " "))
  $global:LASTEXITCODE = 0
  Write-Output "28.0.0"
}

function global:node {
  $global:PredioOnStartupTestState.Calls.Add("node")
  $global:LASTEXITCODE = 0
}

function Run-StartupCase([string]$Name, [hashtable]$Switches, [hashtable]$State = @{}, [bool]$ExpectFailure = $false) {
  $global:PredioOnStartupTestState = @{
    Calls = New-Object 'System.Collections.Generic.List[string]'
    InfrastructureStarted = $false; DatabaseReady = $false; Checked = $false
    Pending = $false; Legacy = $false; InfraFailure = $false
  }
  foreach ($key in $State.Keys) { $global:PredioOnStartupTestState[$key] = $State[$key] }
  $failed = $false
  try { & $fixtureScript @Switches | Out-Null }
  catch { $failed = $true }
  Assert-StartupTest ($failed -eq $ExpectFailure) "${Name}: estado de saida inesperado"
  $calls = $global:PredioOnStartupTestState.Calls
  Assert-StartupTest (-not ($calls -match 'reset|db:push|reboot|restart-computer')) "${Name}: comando destrutivo inesperado"
  Write-Host "PASS: $Name"
  return ,$calls
}

try {
  $null = New-Item -ItemType Directory -Path (Join-Path $fixtureRoot "scripts") -Force
  $null = New-Item -ItemType Directory -Path (Join-Path $fixtureRoot "node_modules/.pnpm") -Force
  Copy-Item -LiteralPath $sourceScript -Destination $fixtureScript
  '{"packageManager":"pnpm@10.17.1"}' | Set-Content -LiteralPath (Join-Path $fixtureRoot "package.json")
  "# fixture; no credentials" | Set-Content -LiteralPath (Join-Path $fixtureRoot ".env")
  "lockfileVersion: '9.0'" | Set-Content -LiteralPath (Join-Path $fixtureRoot "node_modules/.pnpm/lock.yaml")

  $calls = Run-StartupCase "retoma infraestrutura parada sem aplicar migrations" @{}
  Assert-StartupTest ($calls.IndexOf("pnpm infra:up") -lt $calls.IndexOf("pnpm db:wait")) "infra deve iniciar antes de aguardar banco"
  Assert-StartupTest ($calls.IndexOf("pnpm db:wait") -lt $calls.IndexOf("pnpm db:infra --check")) "banco deve estar pronto antes do check"
  Assert-StartupTest ($calls.Contains("pnpm dev")) "retomada deve iniciar aplicacao"
  Assert-StartupTest (-not $calls.Contains("pnpm db:infra") -and -not $calls.Contains("pnpm db:seed") -and -not $calls.Contains("pnpm install --frozen-lockfile")) "retomada nao deve aplicar schema, seed ou instalar dependencias"

  foreach ($blocked in @("Pending", "Legacy")) {
    $calls = Run-StartupCase "bloqueia $blocked antes da aplicacao" @{} @{ $blocked = $true } $true
    Assert-StartupTest (-not $calls.Contains("pnpm dev") -and -not $calls.Contains("pnpm db:infra")) "historico bloqueado nao pode iniciar nem migrar automaticamente"
  }
  $calls = Run-StartupCase "setup aplica release e credenciais sem seed implicito" @{ Setup = $true } @{ Pending = $true }
  Assert-StartupTest ($calls.Contains("pnpm db:bootstrap") -and $calls.Contains("pnpm db:infra") -and $calls.Contains("pnpm db:provision-runtime")) "setup incompleto"
  Assert-StartupTest (-not $calls.Contains("pnpm db:seed")) "setup nao deve semear sem pedido"
  Assert-StartupTest ($calls.IndexOf("pnpm db:infra") -lt $calls.IndexOf("pnpm db:infra --check")) "check deve confirmar release aplicada"

  $calls = Run-StartupCase "demonstracao explicitamente solicitada" @{ Setup = $true; SeedDemo = $true }
  Assert-StartupTest ($calls.Contains("pnpm db:seed")) "SeedDemo deve semear"
  $calls = Run-StartupCase "recusa SeedDemo sem Setup" @{ SeedDemo = $true } @{} $true
  Assert-StartupTest ($calls.Count -eq 0) "flag invalida nao deve executar ferramentas"
  $calls = Run-StartupCase "falha de infraestrutura interrompe a retomada" @{} @{ InfraFailure = $true } $true
  Assert-StartupTest (-not $calls.Contains("pnpm db:wait") -and -not $calls.Contains("pnpm dev")) "falha Docker nao deve continuar"
  Write-Host "7 cenarios passaram; nenhum servico real executado."
  # Expected command failures above are asserted. Do not leave the simulated
  # final exit code for a caller such as GitHub Actions to treat as test failure.
  $global:LASTEXITCODE = 0
} finally {
  Remove-Item -LiteralPath Function:\pnpm, Function:\docker, Function:\node -ErrorAction SilentlyContinue
  Remove-Variable -Name PredioOnStartupTestState -Scope Global -ErrorAction SilentlyContinue
  # Remove only the exact temporary fixture created by this test invocation.
  $tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
  if ([System.IO.Path]::GetDirectoryName($fixtureRoot) -eq $tempBase -and [System.IO.Path]::GetFileName($fixtureRoot) -eq $fixtureName) {
    if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
  } else { throw "Caminho temporario inesperado; limpeza recusada" }
}
