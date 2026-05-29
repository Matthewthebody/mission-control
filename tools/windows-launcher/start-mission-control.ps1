[CmdletBinding()]
param(
  [switch]$SeedDemo,
  [switch]$SkipInstall,
  [switch]$NoBrowser,
  [string]$RepoRoot
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Write-Ok {
  param([string]$Message)
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn {
  param([string]$Message)
  Write-Host "[Action needed] $Message" -ForegroundColor Yellow
}

function Fail-Friendly {
  param(
    [string]$Message,
    [string]$NextStep
  )
  Write-Host ""
  Write-Host "Mission Control could not start." -ForegroundColor Red
  Write-Host $Message -ForegroundColor Red
  if ($NextStep) {
    Write-Host ""
    Write-Warn $NextStep
  }
  Write-Host ""
  Read-Host "Press Enter to close this window"
  exit 1
}

function Find-RepoRoot {
  param([string]$StartingPath)

  if ($RepoRoot) {
    $candidate = Resolve-Path -LiteralPath $RepoRoot -ErrorAction SilentlyContinue
    if ($candidate) {
      return $candidate.Path
    }
  }

  $current = Resolve-Path -LiteralPath $StartingPath
  while ($current) {
    $packageJson = Join-Path $current.Path "package.json"
    $composeFile = Join-Path $current.Path "docker-compose.yml"
    $packagesDir = Join-Path $current.Path "packages"
    if ((Test-Path -LiteralPath $packageJson) -and (Test-Path -LiteralPath $composeFile) -and (Test-Path -LiteralPath $packagesDir)) {
      return $current.Path
    }
    $parent = Split-Path -Parent $current.Path
    if (-not $parent -or $parent -eq $current.Path) {
      break
    }
    $current = Resolve-Path -LiteralPath $parent
  }

  return $null
}

function Require-Command {
  param(
    [string]$CommandName,
    [string]$InstallHelp
  )

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if (-not $command) {
    Fail-Friendly "$CommandName was not found on this computer." $InstallHelp
  }
  return $command
}

function Run-Step {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$Arguments
  )

  Write-Step $Label
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    Fail-Friendly "$Label failed." "Review the message above. If it mentions Docker, open Docker Desktop and run this launcher again."
  }
}

function Test-HttpReady {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Wait-ForHttp {
  param(
    [string]$Name,
    [string]$Url,
    [int]$TimeoutSeconds = 90
  )

  Write-Host "Waiting for $Name at $Url ..."
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-HttpReady $Url) {
      Write-Ok "$Name is responding."
      return $true
    }
    Start-Sleep -Seconds 2
  }
  Write-Warn "$Name did not respond before the timeout. The server window may still be starting."
  return $false
}

function Wait-ForDocker {
  param([int]$TimeoutSeconds = 90)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    docker ps *> $null
    if ($LASTEXITCODE -eq 0) {
      return $true
    }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Start-DockerDesktop {
  $candidates = @(
    "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
    "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
    "$env:LOCALAPPDATA\Docker\Docker Desktop.exe"
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  if ($candidates.Count -gt 0) {
    Write-Host "Starting Docker Desktop..."
    Start-Process -FilePath $candidates[0] | Out-Null
  }
}

function Get-FileHashText {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return ""
  }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$resolvedRoot = Find-RepoRoot $scriptDir
if (-not $resolvedRoot) {
  Fail-Friendly "The launcher could not find the Mission Control repo root." "Run this from inside C:\Dev\Codex-integrated-baseline, or pass -RepoRoot with the repo path."
}

Set-Location -LiteralPath $resolvedRoot

$logsDir = Join-Path $env:LOCALAPPDATA "MissionControl\logs"
$stateDir = Join-Path $env:LOCALAPPDATA "MissionControl"
New-Item -ItemType Directory -Force -Path $logsDir, $stateDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$launcherLog = Join-Path $logsDir "launcher-$timestamp.log"
$devLog = Join-Path $logsDir "dev-server-$timestamp.log"
$stateFile = Join-Path $stateDir "launcher-state.json"

Start-Transcript -LiteralPath $launcherLog -Append | Out-Null

try {
  Write-Host "Mission Control local launcher" -ForegroundColor Cyan
  Write-Host "Repo: $resolvedRoot"
  Write-Host "Logs: $logsDir"

  Write-Step "Checking prerequisites"
  $node = Require-Command "node" "Install Node.js 20 or newer from https://nodejs.org, then run this launcher again."
  $npm = Require-Command "npm" "Install Node.js 20 or newer from https://nodejs.org, then run this launcher again."
  $docker = Require-Command "docker" "Install Docker Desktop, open it, wait until it says Docker is running, then run this launcher again."
  Write-Ok "Node found: $($node.Source)"
  Write-Ok "npm found: $($npm.Source)"
  Write-Ok "Docker found: $($docker.Source)"

  if (-not (Test-Path -LiteralPath ".env")) {
    Fail-Friendly "The repo-local .env file is missing." "Copy .env into $resolvedRoot without pasting secrets into chat."
  }

  Write-Step "Checking Docker Desktop"
  docker ps *> $null
  if ($LASTEXITCODE -ne 0) {
    Start-DockerDesktop
    if (-not (Wait-ForDocker -TimeoutSeconds 120)) {
      Fail-Friendly "Docker is installed but not reachable yet." "Open Docker Desktop, wait until it says Docker is running, then run this launcher again."
    }
  }
  Write-Ok "Docker is reachable."

  Write-Step "Starting Postgres and Redis"
  Run-Step "Docker Compose" "docker" @("compose", "up", "-d")

  Write-Step "Waiting for local services"
  $postgresReady = $false
  $redisReady = $false
  for ($i = 0; $i -lt 45; $i++) {
    docker compose exec -T postgres pg_isready -U postgres -d pmc *> $null
    $postgresReady = ($LASTEXITCODE -eq 0)
    docker compose exec -T redis redis-cli ping *> $null
    $redisReady = ($LASTEXITCODE -eq 0)
    if ($postgresReady -and $redisReady) {
      break
    }
    Start-Sleep -Seconds 2
  }
  if (-not $postgresReady) {
    Fail-Friendly "Postgres did not become ready." "Run docker compose ps and check the postgres container, then run this launcher again."
  }
  if (-not $redisReady) {
    Fail-Friendly "Redis did not become ready." "Run docker compose ps and check the redis container, then run this launcher again."
  }
  Write-Ok "Postgres and Redis are ready."

  $packageLockHash = Get-FileHashText "package-lock.json"
  $installNeeded = $false
  if (-not (Test-Path -LiteralPath "node_modules")) {
    $installNeeded = $true
  } elseif (Test-Path -LiteralPath $stateFile) {
    try {
      $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
      if ($state.packageLockHash -ne $packageLockHash) {
        $installNeeded = $true
      }
    } catch {
      $installNeeded = $true
    }
  } else {
    $installNeeded = $true
  }

  if ($SkipInstall) {
    Write-Warn "Skipping dependency install because -SkipInstall was provided."
  } elseif ($installNeeded) {
    Run-Step "Installing dependencies" $npm.Source @("install")
    @{ packageLockHash = $packageLockHash; updatedAt = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -LiteralPath $stateFile
  } else {
    Write-Ok "Dependencies look current."
  }

  Run-Step "Running database migrations" $npm.Source @("run", "db:migrate")

  if (-not $SeedDemo) {
    $answer = Read-Host "Seed or refresh Mission Control demo data now? This is non-destructive, but optional. Type Y to run it"
    $SeedDemo = ($answer -match "^[Yy]$")
  }
  if ($SeedDemo) {
    Run-Step "Seeding Mission Control demo data" $npm.Source @("run", "seed:mission-control-demo")
  } else {
    Write-Ok "Demo seed skipped."
  }

  Write-Step "Starting Mission Control"
  $devCommand = @"
Set-Location -LiteralPath '$resolvedRoot'
`$env:Path = 'C:\Program Files\nodejs;' + `$env:Path
Write-Host 'Mission Control dev servers are running. Keep this window open.' -ForegroundColor Cyan
Write-Host 'Logs are also being written to: $devLog'
& '$($npm.Source)' run dev 2>&1 | Tee-Object -FilePath '$devLog' -Append
Read-Host 'Mission Control stopped. Press Enter to close this window'
"@
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $devCommand) -WorkingDirectory $resolvedRoot

  Wait-ForHttp "API" "http://localhost:4000/health" 90 | Out-Null
  Wait-ForHttp "Admin web" "http://localhost:5173" 90 | Out-Null

  if (-not $NoBrowser) {
    Write-Step "Opening Mission Control"
    Start-Process "http://localhost:5173/#home"
  }

  Write-Host ""
  Write-Ok "Mission Control launcher finished. Keep the dev server window open while using the app."
  Write-Host "App:  http://localhost:5173/#home"
  Write-Host "API:  http://localhost:4000/health"
  Write-Host "Logs: $logsDir"
} catch {
  Fail-Friendly $_.Exception.Message "Fix the issue shown above, then run the launcher again."
} finally {
  Stop-Transcript | Out-Null
}
