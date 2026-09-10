$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$launcher = Join-Path $projectRoot 'scripts\start-private-stack.ps1'

& $launcher -DryRun -Json | Set-Content -Path (Join-Path $env:TEMP 'geo-agent-launcher-test.json') -Encoding utf8
$result = Get-Content -Raw (Join-Path $env:TEMP 'geo-agent-launcher-test.json') | ConvertFrom-Json

if ($result.uiUrl -ne 'http://127.0.0.1:5173') {
  throw "Unexpected UI URL: $($result.uiUrl)"
}

$requiredServices = @('neo4j', 'retrieval', 'backend', 'frontend')
$actualServices = @($result.services.PSObject.Properties.Name)
foreach ($service in $requiredServices) {
  if ($actualServices -notcontains $service) {
    throw "Launcher result is missing service '$service'"
  }
}

Write-Host 'start-private-stack test passed'
