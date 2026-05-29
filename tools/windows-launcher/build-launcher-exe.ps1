[CmdletBinding()]
param(
  [switch]$SelfContained
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Join-Path $scriptDir "MissionControlLauncher.csproj"
$output = Join-Path $scriptDir "dist"

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  Write-Host "The .NET SDK was not found." -ForegroundColor Red
  Write-Host "Install the .NET SDK, then run this script again."
  exit 1
}

$selfContainedValue = if ($SelfContained) { "true" } else { "false" }

dotnet publish $project `
  -c Release `
  -r win-x64 `
  --self-contained $selfContainedValue `
  /p:PublishSingleFile=true `
  /p:DebugType=None `
  /p:DebugSymbols=false `
  -o $output

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Launcher built:" -ForegroundColor Green
Write-Host (Join-Path $output "MissionControlLauncher.exe")
Write-Host ""
Write-Host "Keep this exe in the repo, or copy it next to start-mission-control.ps1."
