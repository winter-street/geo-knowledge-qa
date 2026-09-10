[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Json,
  [switch]$CreateDesktopShortcut
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $ProjectRoot 'tmp\private-runtime'
$UiUrl = 'http://127.0.0.1:5173'
$Neo4jHome = 'D:\neo4j-community-5.26.4-windows\neo4j-community-5.26.4'
$Java = 'C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot\bin\java.exe'
$Python = 'D:\py313\python.exe'
$PreferredNode = 'C:\nvm4w\nodejs\node.exe'

function Test-ListeningPort([int]$Port) {
  return @(
    Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  ).Count -gt 0
}

function Test-HttpOk([string]$Url) {
  try {
    return (Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3).StatusCode -eq 200
  } catch {
    return $false
  }
}

function Wait-ForService([string]$Name, [scriptblock]$Check, [int]$TimeoutSeconds = 45) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Check) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "$Name did not become ready within $TimeoutSeconds seconds. Check $RuntimeDir"
}

function Start-LoggedProcess([string]$Name, [string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory) {
  $stdout = Join-Path $RuntimeDir "$Name.stdout.log"
  $stderr = Join-Path $RuntimeDir "$Name.stderr.log"
  Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory `
    -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru | Out-Null
}

function Get-NodePath {
  if (Test-Path $PreferredNode) { return $PreferredNode }
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($node) { return $node.Source }
  throw 'Node.js was not found. Install Node 22 or update PreferredNode in scripts/start-private-stack.ps1.'
}

function Create-DesktopShortcut {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $shortcutPath = Join-Path $desktop 'Geology Knowledge Agent - Private Data.lnk'
  $launcherPath = Join-Path $ProjectRoot 'Start Geo Agent.cmd'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $launcherPath
  $shortcut.WorkingDirectory = $ProjectRoot
  $shortcut.Description = 'Start the private Geo-Knowledge Agent stack and open the main page.'
  $shortcut.Save()
  return $shortcutPath
}

function Get-ServiceState {
  return [ordered]@{
    neo4j = [ordered]@{
      running = (Test-ListeningPort 7474) -and (Test-ListeningPort 7687)
      ports = @(7474, 7687)
    }
    retrieval = [ordered]@{
      running = Test-HttpOk 'http://127.0.0.1:5000/health'
      port = 5000
    }
    backend = [ordered]@{
      running = Test-HttpOk 'http://127.0.0.1:3000/api/health'
      port = 3000
    }
    frontend = [ordered]@{
      running = Test-HttpOk $UiUrl
      port = 5173
    }
  }
}

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

if ($CreateDesktopShortcut) {
  $shortcutPath = Create-DesktopShortcut
  Write-Host "Desktop shortcut ready: $shortcutPath"
}

$state = Get-ServiceState
if ($DryRun) {
  $result = [ordered]@{ uiUrl = $UiUrl; services = $state }
  if ($Json) { $result | ConvertTo-Json -Depth 4 -Compress } else { $result }
  exit 0
}

if (-not $state.neo4j.running) {
  if (-not (Test-Path $Java)) { throw "Java was not found at $Java" }
  if (-not (Test-Path $Neo4jHome)) { throw "Neo4j was not found at $Neo4jHome" }
  Write-Host 'Starting Neo4j...'
  Start-LoggedProcess 'neo4j' $Java @(
    '-cp', (Join-Path $Neo4jHome 'lib\*'),
    "-Dbasedir=$Neo4jHome",
    'org.neo4j.server.startup.Neo4jCommand', 'console'
  ) $Neo4jHome
  Wait-ForService 'Neo4j' { (Test-ListeningPort 7474) -and (Test-ListeningPort 7687) }
} else {
  Write-Host 'Neo4j is already running.'
}

$state = Get-ServiceState
if (-not $state.retrieval.running) {
  if (-not (Test-Path $Python)) { throw "Python was not found at $Python" }
  Write-Host 'Starting retrieval service...'
  Start-LoggedProcess 'ml-service' $Python @('server.py') (Join-Path $ProjectRoot 'ml-service')
  Wait-ForService 'Retrieval service' { Test-HttpOk 'http://127.0.0.1:5000/health' }
} else {
  Write-Host 'Retrieval service is already running.'
}

$state = Get-ServiceState
if (-not $state.backend.running) {
  $node = Get-NodePath
  Write-Host 'Starting backend...'
  Start-LoggedProcess 'backend' $node @('dist/index.js') (Join-Path $ProjectRoot 'backend')
  Wait-ForService 'Backend' { Test-HttpOk 'http://127.0.0.1:3000/api/health' }
} else {
  Write-Host 'Backend is already running.'
}

$state = Get-ServiceState
if (-not $state.frontend.running) {
  $node = Get-NodePath
  $vite = Join-Path $ProjectRoot 'frontend\node_modules\vite\bin\vite.js'
  if (-not (Test-Path $vite)) { throw "Vite was not found at $vite. Run npm ci --prefix frontend first." }
  Write-Host 'Starting frontend...'
  Start-LoggedProcess 'frontend' $node @($vite, '--host', '127.0.0.1', '--port', '5173') (Join-Path $ProjectRoot 'frontend')
  Wait-ForService 'Frontend' { Test-HttpOk $UiUrl }
} else {
  Write-Host 'Frontend is already running.'
}

Write-Host "Opening $UiUrl"
Start-Process $UiUrl
