[CmdletBinding()]
param(
    [string]$Root = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedRoot = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\', '/')
$ignoredDirectories = @('\.git\', '\node_modules\', '\dist\', '\.venv\', '\venv\', '\ml-service\output\', '\ml-service\models\')
$sourceExtensions = @(
    '.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue', '.py', '.ps1', '.sh',
    '.json', '.yml', '.yaml', '.toml', '.ini', '.conf', '.properties',
    '.md', '.txt', '.html', '.css', '.xml'
)
$rules = @(
    @{
        Name = 'DeepSeek/OpenAI-compatible key'
        Pattern = '(?i)(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}'
        AllowedPattern = '(?i)^sk-(?:your-[a-z0-9-]+|YOUR-API-KEY-HERE|1234567890abcdefghijklmnop)$'
    },
    @{ Name = 'AMap key'; Pattern = '(?i)\b(?:VITE_)?AMAP_(?:KEY|SECRET)\s*(?:=|:)\s*["'']?([A-Za-z0-9_-]{16,})' },
    @{ Name = 'Bearer token'; Pattern = '(?i)\bBearer\s+[A-Za-z0-9._~-]{20,}' },
    @{ Name = 'private key'; Pattern = '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----' },
    @{ Name = 'private Windows runtime path'; Pattern = '(?i)[a-z]:[\\/](?:Users|Documents and Settings)[\\/]' }
)

function Get-RelativePath([string]$Path) {
    return $Path.Substring($resolvedRoot.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
}

function Test-IgnoredDirectory([string]$Path) {
    $normalized = "\$($Path.Replace('/', '\'))\"
    return $ignoredDirectories | Where-Object { $normalized.Contains($_) }
}

$findings = [System.Collections.Generic.List[string]]::new()
$files = Get-ChildItem -LiteralPath $resolvedRoot -Force -Recurse -File | Where-Object {
    -not (Test-IgnoredDirectory $_.FullName)
}

foreach ($file in $files) {
    $relativePath = Get-RelativePath $file.FullName
    if ($file.Name -in @('.env.example', 'config.example.py')) {
        continue
    }

    if ($relativePath -eq 'ml-service/config.py' -or ($file.Name -eq '.env')) {
        $findings.Add("$relativePath [private runtime file]")
        continue
    }

    if ($file.Extension -notin $sourceExtensions -and $file.Name -notlike '.env*') {
        continue
    }

    $content = Get-Content -LiteralPath $file.FullName -Raw
    foreach ($rule in $rules) {
        $matches = [regex]::Matches($content, $rule.Pattern)
        $blocked = $matches | Where-Object {
            -not $rule.ContainsKey('AllowedPattern') -or $_.Value -notmatch $rule.AllowedPattern
        }
        if ($blocked) {
            $findings.Add("$relativePath [$($rule.Name)]")
        }
    }
}

if ($findings.Count -gt 0) {
    [Console]::Error.WriteLine("Secret/privacy scan failed:`n$($findings -join "`n")")
    exit 1
}

Write-Output 'Secret/privacy scan passed.'
exit 0
