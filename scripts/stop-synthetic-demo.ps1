[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$runtimeFile = Join-Path $repositoryRoot '.demo-runtime/processes.json'

if (-not (Test-Path -LiteralPath $runtimeFile)) {
    Write-Output 'Synthetic demo is not running.'
    exit 0
}

$state = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
foreach ($processId in @($state.backendPid, $state.frontendPid)) {
    if ($processId -isnot [int] -and $processId -isnot [long]) { continue }
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($null -ne $process) {
        Stop-Process -Id $processId -Force
        Write-Output "Stopped synthetic demo process $processId."
    }
}

Remove-Item -LiteralPath $runtimeFile -Force
Write-Output 'Synthetic demo stopped.'
