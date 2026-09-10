$scanScript = Join-Path $PSScriptRoot '..\scan-secrets.ps1'

Describe 'scan-secrets' {
    It 'rejects secrets and private runtime files while accepting example placeholders' {
        (Test-Path $scanScript) | Should Be $true

        $fixtureRoot = Join-Path $TestDrive 'repository'
        New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'src') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'ml-service') -Force | Out-Null

        $key = 'sk-' + ('x' * 24)
        Set-Content -Path (Join-Path $fixtureRoot 'src\credentials.vue') -Value "<script>const token = '$key'</script>" -NoNewline
        & $scanScript -Root $fixtureRoot
        $LASTEXITCODE | Should Be 1

        Remove-Item -LiteralPath (Join-Path $fixtureRoot 'src\credentials.vue')
        Set-Content -Path (Join-Path $fixtureRoot 'src\notes.md') -Value "Authorization: Bearer $('x' * 24)" -NoNewline
        & $scanScript -Root $fixtureRoot
        $LASTEXITCODE | Should Be 1

        Remove-Item -LiteralPath (Join-Path $fixtureRoot 'src\notes.md')
        Set-Content -Path (Join-Path $fixtureRoot 'ml-service\config.py') -Value 'private runtime configuration' -NoNewline
        & $scanScript -Root $fixtureRoot
        $LASTEXITCODE | Should Be 1

        Remove-Item -LiteralPath (Join-Path $fixtureRoot 'ml-service\config.py')
        $privatePath = 'C:' + '\Users\Private\workspace'
        Set-Content -Path (Join-Path $fixtureRoot 'src\runtime.ts') -Value "const path = '$privatePath'" -NoNewline
        & $scanScript -Root $fixtureRoot
        $LASTEXITCODE | Should Be 1

        Remove-Item -LiteralPath (Join-Path $fixtureRoot 'src\runtime.ts')
        Set-Content -Path (Join-Path $fixtureRoot '.env.example') -Value 'DEEPSEEK_API_KEY=sk-placeholder' -NoNewline
        Set-Content -Path (Join-Path $fixtureRoot 'src\placeholder.ts') -Value "const token = 'sk-your-service-key-here'" -NoNewline
        & $scanScript -Root $fixtureRoot
        $LASTEXITCODE | Should Be 0
    }
}
