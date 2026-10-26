#Requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $scriptDir 'survey-app'
$dataDir = Join-Path $appDir '.data'
$dbDir = Join-Path $dataDir 'db'
$serverPidFile = Join-Path $dataDir 'server.pid'
$mongodPidFile = Join-Path $dataDir 'mongod.pid'
$serverOut = Join-Path $dataDir 'server.out.log'
$serverErr = Join-Path $dataDir 'server.err.log'
$mongodLog = Join-Path $dataDir 'mongod.log'
$healthUrl = 'http://localhost:3000/health'
$appUrl = 'http://localhost:3000/'

function Write-Step([string]$Message) {
  Write-Host "[survey] $Message"
}

function Test-AppHealth {
  try {
    $result = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    return $result.ok -eq $true
  } catch {
    return $false
  }
}

function Test-Mongo {
  param([string]$MongoshPath)

  if ($MongoshPath) {
    try {
      $result = & $MongoshPath --quiet --eval "db.runCommand({ping:1}).ok" 2>$null
      return ($result -match '1')
    } catch {
      return $false
    }
  }

  return (Test-NetConnection -ComputerName 127.0.0.1 -Port 27017 -InformationLevel Quiet -WarningAction SilentlyContinue)
}

function Wait-Until {
  param(
    [scriptblock]$Condition,
    [int]$Seconds = 20,
    [string]$FailureMessage
  )

  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Condition) { return $true }
    Start-Sleep -Milliseconds 500
  }
  throw $FailureMessage
}

if (-not (Test-Path -LiteralPath $appDir)) {
  throw "Application directory not found: $appDir"
}

New-Item -ItemType Directory -Force -Path $dataDir, $dbDir | Out-Null

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$npmCommand = Get-Command npm -ErrorAction SilentlyContinue
if (-not $nodeCommand -or -not $npmCommand) {
  throw 'Node.js or npm was not found in PATH. Install Node.js >= 20 first.'
}

if (Test-AppHealth) {
  Write-Step 'The survey service is already running.'
  Write-Host "App: $appUrl"
  if (-not $NoBrowser) { Start-Process $appUrl | Out-Null }
  exit 0
}

$envFile = Join-Path $appDir '.env'
$envExample = Join-Path $appDir '.env.example'
if (-not (Test-Path -LiteralPath $envFile) -and (Test-Path -LiteralPath $envExample)) {
  Copy-Item -LiteralPath $envExample -Destination $envFile
}

$nodeModules = Join-Path $appDir 'node_modules'
if (-not (Test-Path -LiteralPath $nodeModules)) {
  Write-Step 'Installing npm dependencies (first run)...'
  Push-Location $appDir
  try {
    & $npmCommand.Source install
    if ($LASTEXITCODE -ne 0) {
      Write-Step 'Retrying npm install with project-local cache...'
      $localCache = Join-Path $appDir '.npm-cache'
      & $npmCommand.Source install --cache $localCache
      if ($LASTEXITCODE -ne 0) {
        throw 'npm install failed.'
      }
    }
  } finally {
    Pop-Location
  }
}

$portOwner = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($portOwner) {
  throw 'Port 3000 is already in use by another process. Stop it or change the API port.'
}

$mongodCommand = Get-Command mongod -ErrorAction SilentlyContinue
if (-not $mongodCommand) {
  $fallbackMongod = 'D:\MDB\bin\mongod.exe'
  if (Test-Path -LiteralPath $fallbackMongod) {
    $mongodPath = $fallbackMongod
  } else {
    throw 'mongod was not found. Install MongoDB or add mongod to PATH.'
  }
} else {
  $mongodPath = $mongodCommand.Source
}

$mongoshCommand = Get-Command mongosh -ErrorAction SilentlyContinue
$mongoshPath = if ($mongoshCommand) { $mongoshCommand.Source } else { $null }

if (-not (Test-Mongo -MongoshPath $mongoshPath)) {
  Write-Step 'Starting MongoDB...'
  $mongodArgs = @(
    '--dbpath', $dbDir,
    '--port', '27017',
    '--bind_ip', '127.0.0.1',
    '--logpath', $mongodLog,
    '--logappend'
  )
  $mongodProcess = Start-Process -FilePath $mongodPath -ArgumentList $mongodArgs -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $mongodPidFile -Value $mongodProcess.Id
  $null = Wait-Until -Condition { Test-Mongo -MongoshPath $mongoshPath } -Seconds 20 -FailureMessage 'MongoDB did not become ready within 20 seconds.'
} else {
  Write-Step 'MongoDB is already running on 127.0.0.1:27017.'
}

Write-Step 'Initializing database (idempotent)...'
Push-Location $appDir
try {
  & $npmCommand.Source run init-db
  if ($LASTEXITCODE -ne 0) {
    throw 'Database initialization failed.'
  }
} finally {
  Pop-Location
}

Write-Step 'Starting survey API...'
$serverProcess = Start-Process -FilePath $nodeCommand.Source `
  -ArgumentList @('src/server.js') `
  -WorkingDirectory $appDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $serverOut `
  -RedirectStandardError $serverErr `
  -PassThru
Set-Content -LiteralPath $serverPidFile -Value $serverProcess.Id

try {
  $null = Wait-Until -Condition { Test-AppHealth } -Seconds 20 -FailureMessage 'The survey API did not become ready within 20 seconds.'
} catch {
  if (Test-Path -LiteralPath $serverErr) {
    Get-Content -LiteralPath $serverErr -Tail 30 | ForEach-Object { Write-Host $_ }
  }
  throw
}

Write-Step 'Survey service started successfully.'
Write-Host "App:      $appUrl"
Write-Host 'MongoDB:  mongodb://127.0.0.1:27017/survey_app'
Write-Host "Logs:     $serverOut"
Write-Host "          $serverErr"
Write-Host 'Stop it:  stop-survey.bat'

if (-not $NoBrowser) {
  Start-Process $appUrl | Out-Null
}
