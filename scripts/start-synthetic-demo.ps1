[CmdletBinding()]
param(
    [int]$BackendPort = 3000,
    [int]$FrontendPort = 5173,
    [switch]$SkipInstall,
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $repositoryRoot '.demo-runtime'
$runtimeFile = Join-Path $runtimeDir 'processes.json'

function Invoke-Checked([string]$Label, [scriptblock]$Command) {
    Write-Host "==> $Label"
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE" }
}

function Test-Listening([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(250)) { return $false }
        $client.EndConnect($pending)
        return $true
    }
    catch { return $false }
    finally { $client.Dispose() }
}

function Wait-Http([string]$Url, [int]$TimeoutSeconds = 45) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { return }
        }
        catch {}
        Start-Sleep -Milliseconds 500
    }
    throw "Timed out waiting for $Url"
}

if (Test-Path -LiteralPath $runtimeFile) {
    & (Join-Path $PSScriptRoot 'stop-synthetic-demo.ps1')
}
foreach ($port in @($BackendPort, $FrontendPort)) {
    if (Test-Listening $port) {
        throw "Port $port is already occupied. Stop the owning service or choose another port."
    }
}

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
Push-Location $repositoryRoot
$backendProcess = $null
$frontendProcess = $null
try {
    if (-not $SkipInstall) {
        if (-not (Test-Path 'backend/node_modules')) {
            Invoke-Checked 'Install backend dependencies' { npm.cmd ci --prefix backend }
        }
        if (-not (Test-Path 'frontend/node_modules')) {
            Invoke-Checked 'Install frontend dependencies' { npm.cmd ci --prefix frontend }
        }
    }

    Invoke-Checked 'Generate deterministic synthetic fixtures' {
        python demo/generate_synthetic_demo.py --output demo/generated
    }
    if (-not $SkipBuild) {
        Invoke-Checked 'Build backend' { npm.cmd run build --prefix backend }
        Invoke-Checked 'Build frontend' { npm.cmd run build --prefix frontend }
    }

    $node = (Get-Command node -ErrorAction Stop).Source
    $env:SYNTHETIC_DEMO = 'true'
    $env:PORT = [string]$BackendPort
    $env:DEEPSEEK_API_KEY = ''
    $env:TONGYI_API_KEY = ''
    $env:RETRIEVAL_MODE = 'tfidf'
    $env:FRONTEND_ORIGIN = "http://127.0.0.1:$FrontendPort"
    $env:VITE_API_BASE = "http://127.0.0.1:$BackendPort/api"
    $env:VITE_BACKEND_ORIGIN = "http://127.0.0.1:$BackendPort"

    $backendProcess = Start-Process -FilePath $node -ArgumentList 'dist/index.js' `
        -WorkingDirectory (Join-Path $repositoryRoot 'backend') -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtimeDir 'backend.log') `
        -RedirectStandardError (Join-Path $runtimeDir 'backend.error.log')

    $vite = Join-Path $repositoryRoot 'frontend/node_modules/vite/bin/vite.js'
    $frontendProcess = Start-Process -FilePath $node `
        -ArgumentList @($vite, '--host', '127.0.0.1', '--port', [string]$FrontendPort) `
        -WorkingDirectory (Join-Path $repositoryRoot 'frontend') -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtimeDir 'frontend.log') `
        -RedirectStandardError (Join-Path $runtimeDir 'frontend.error.log')

    @{
        backendPid = $backendProcess.Id
        frontendPid = $frontendProcess.Id
        backendPort = $BackendPort
        frontendPort = $FrontendPort
    } | ConvertTo-Json | Set-Content -LiteralPath $runtimeFile -Encoding utf8

    Wait-Http "http://127.0.0.1:$BackendPort/api/health"
    Wait-Http "http://127.0.0.1:$FrontendPort"

    $login = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$BackendPort/api/auth/login" `
        -ContentType 'application/json' -Body '{"username":"user","password":"user123"}' -TimeoutSec 10
    $headers = @{ Authorization = "Bearer $($login.token)" }
    $body = @{
        question = 'What controls Synthetic Aurora Deposit 1?'
        retrievalMode = 'hybrid'
        agentMode = 'direct'
    } | ConvertTo-Json
    $answer = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$BackendPort/api/qa/ask" `
        -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 60
    if (@($answer.sources).Count -lt 1 -or @($answer.kgContext).Count -lt 1) {
        throw 'Synthetic Q&A smoke check returned no document or graph evidence.'
    }

    Write-Output 'Synthetic demo smoke check passed.'
    Write-Output "Frontend: http://127.0.0.1:$FrontendPort"
    Write-Output "Backend:  http://127.0.0.1:$BackendPort/api/health"
    Write-Output 'Login: user / user123'
    Write-Output 'Stop: npm run demo:stop'
}
catch {
    foreach ($process in @($backendProcess, $frontendProcess)) {
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force
        }
    }
    if (Test-Path -LiteralPath $runtimeFile) { Remove-Item -LiteralPath $runtimeFile -Force }
    throw
}
finally {
    Pop-Location
}
