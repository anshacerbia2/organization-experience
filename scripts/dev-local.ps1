<#
.SYNOPSIS
  Runs the BFF and the admin application on this machine, signing in against the development
  kernel on the server.

.DESCRIPTION
  Nothing here needs Docker. Keycloak and organization-control stay on the server; this machine runs
  the BFF on http://127.0.0.1:8091, which serves the built admin application, and keeps its
  sessions in the local PostgreSQL.

  Reads .env beside the repository root (copy .env.example) and exports every value in it: the BFF
  reads its environment and nothing else. Relative paths in .env are relative to bff/, where the
  BFF runs. The BFF authenticates to the kernel with its own key (private_key_jwt),
  keys/organization-experience-bff.pem, made on this machine by scripts/new-client-key.mjs and
  registered on the server (deploy/dev/README.md); the client has no secret (ADR-IAM-001 §5.12).

  Steps: build the application and the BFF, create the session schema if absent, apply the
  session store's migrations, and serve. Ctrl+C stops the server.
#>
[CmdletBinding()]
param(
    # Skip the build when only the server needs restarting.
    [switch] $NoBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$bff = Join-Path $root 'bff'
$envFile = Join-Path $root '.env'

if (-not (Test-Path $envFile)) {
    throw "No .env at $envFile. Copy .env.example."
}

function Read-DotEnv([string] $path) {
    $values = [ordered]@{}
    foreach ($line in [IO.File]::ReadAllLines($path)) {
        if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') {
            $values[$Matches[1]] = $Matches[2].Trim()
        }
    }
    return $values
}

$dotenv = Read-DotEnv $envFile

# A session key is generated once and written back, so a restart does not strand every session.
if (-not $dotenv.Contains('ORGANIZATION_EXPERIENCE_SESSION_KEY') -or $dotenv['ORGANIZATION_EXPERIENCE_SESSION_KEY'] -eq '') {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $key = [Convert]::ToBase64String($bytes)
    $text = [IO.File]::ReadAllText($envFile)
    $pattern = '(?m)^ORGANIZATION_EXPERIENCE_SESSION_KEY=.*$'
    if ($text -match $pattern) {
        $text = [regex]::Replace($text, $pattern, "ORGANIZATION_EXPERIENCE_SESSION_KEY=$key")
    } else {
        if ($text.Length -gt 0 -and -not $text.EndsWith("`n")) { $text += "`n" }
        $text += "ORGANIZATION_EXPERIENCE_SESSION_KEY=$key`n"
    }
    [IO.File]::WriteAllText($envFile, $text, (New-Object Text.UTF8Encoding $false))
    $dotenv['ORGANIZATION_EXPERIENCE_SESSION_KEY'] = $key
    Write-Host 'dev-local: generated ORGANIZATION_EXPERIENCE_SESSION_KEY and wrote it to .env'
}

foreach ($required in @('ORGANIZATION_EXPERIENCE_ISSUER', 'ORGANIZATION_EXPERIENCE_CLIENT_KEY_FILE', 'ORGANIZATION_EXPERIENCE_DATABASE_URL')) {
    if (-not $dotenv.Contains($required) -or $dotenv[$required] -eq '') {
        throw "$required is empty in .env. See .env.example."
    }
}

# The schema the session store lives in is the one the database URL's search_path names.
$database = $dotenv['ORGANIZATION_EXPERIENCE_DATABASE_URL']
if ([Uri]::UnescapeDataString($database) -notmatch 'search_path=([a-z_][a-z0-9_]*)') {
    throw 'ORGANIZATION_EXPERIENCE_DATABASE_URL names no search_path. See .env.example.'
}
$schema = $Matches[1]

foreach ($name in $dotenv.Keys) { Set-Item "env:$name" $dotenv[$name] }

$clientKey = if ([IO.Path]::IsPathRooted($env:ORGANIZATION_EXPERIENCE_CLIENT_KEY_FILE)) {
    $env:ORGANIZATION_EXPERIENCE_CLIENT_KEY_FILE
} else {
    Join-Path $bff $env:ORGANIZATION_EXPERIENCE_CLIENT_KEY_FILE
}
if (-not (Test-Path $clientKey)) {
    throw "No client key at $clientKey. Run: node scripts/new-client-key.mjs, then have the server's operator register keys\organization-experience-bff.jwk.json (deploy/dev/README.md)."
}

Push-Location $root
try {
    if (-not $NoBuild) {
        pnpm build
        if ($LASTEXITCODE -ne 0) { throw 'build failed' }
    }

    # The schema first: migrations create tables, not the schema they live in.
    Push-Location $bff
    try {
        node --input-type=module -e "import pg from 'pg'; const c = new pg.Client({ connectionString: process.env.ORGANIZATION_EXPERIENCE_DATABASE_URL }); await c.connect(); await c.query('CREATE SCHEMA IF NOT EXISTS $schema'); await c.end();"
        if ($LASTEXITCODE -ne 0) { throw "could not create schema $schema" }
        $migrationSet = $dotenv.Contains('ORGANIZATION_EXPERIENCE_MIGRATION_DATABASE_URL') -and $dotenv['ORGANIZATION_EXPERIENCE_MIGRATION_DATABASE_URL'] -ne ''
        if (-not $migrationSet) { $env:ORGANIZATION_EXPERIENCE_MIGRATION_DATABASE_URL = $database }
        pnpm migrate
        if ($LASTEXITCODE -ne 0) { throw 'migrations failed' }

        Write-Host "dev-local: open $env:ORGANIZATION_EXPERIENCE_PUBLIC_ORIGIN and sign in. Ctrl+C stops the server."
        node dist/main.js
    } finally {
        Pop-Location
    }
} finally {
    Pop-Location
}
