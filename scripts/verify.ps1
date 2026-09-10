[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Verification([string]$Name, [scriptblock]$Command) {
    Write-Host "==> $Name"
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

Push-Location $repositoryRoot
try {
    $env:CI = 'true'
    Invoke-Verification 'Backend type check' { npm --prefix backend run type-check }
    Invoke-Verification 'Backend tests' { npm --prefix backend test }
    Invoke-Verification 'Frontend type check' { npm --prefix frontend run type-check }
    Invoke-Verification 'Frontend tests' { npm --prefix frontend test }
    Invoke-Verification 'Python manifest tests' { python -m unittest discover -s ml-service/tests -p 'test_*.py' -v }
    Invoke-Verification 'Synthetic demo tests' { python -m unittest discover -s demo/tests -p 'test_*.py' -v }
    Invoke-Verification 'Secret scanner contract tests' {
        $result = Invoke-Pester -Script "$PSScriptRoot\tests\scan-secrets.Tests.ps1" -PassThru
        if ($result.FailedCount -gt 0) { exit 1 }
    }
    Invoke-Verification 'Secret/privacy scan' { & "$PSScriptRoot\scan-secrets.ps1" -Root $repositoryRoot }
}
finally {
    Pop-Location
}
