#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $scriptDir 'survey-app'
$dataDir = Join-Path $appDir '.data'
$serverPidFile = Join-Path $dataDir 'server.pid'
$mongodPidFile = Join-Path $dataDir 'mongod.pid'

function Stop-ProcessFromPidFile {
  param(
    [string]$PidFile,
    [string]$CommandLinePattern,
    [string]$DisplayName
  )

  if (-not (Test-Path -LiteralPath $PidFile)) {
    Write-Host "[survey] $DisplayName PID file not found; skipped."
    return
  }

  $rawPid = (Get-Content -LiteralPath $PidFile -Raw).Trim()
  $processId = 0
  if (-not [int]::TryParse($rawPid, [ref]$processId)) {
    Remove-Item -LiteralPath $PidFile -Force
    return
  }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if ($process -and $process.CommandLine -match $CommandLinePattern) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Write-Host "[survey] Stopped $DisplayName (PID $processId)."
  } else {
    Write-Host "[survey] $DisplayName is not running; cleaned stale PID file."
  }

  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

Stop-ProcessFromPidFile -PidFile $serverPidFile -CommandLinePattern 'src[\\/]server\.js' -DisplayName 'survey API'

$mongoshCommand = Get-Command mongosh -ErrorAction SilentlyContinue
if ($mongoshCommand -and (Test-Path -LiteralPath $mongodPidFile)) {
  try {
    & $mongoshCommand.Source --quiet --eval "db.getSiblingDB('admin').shutdownServer()" 2>$null | Out-Null
  } catch {
    # Fall back to the PID file below.
  }
}

Stop-ProcessFromPidFile -PidFile $mongodPidFile -CommandLinePattern 'mongod(\.exe)?.*\.data[\\/]db' -DisplayName 'MongoDB'

Write-Host '[survey] Stop command completed.'
