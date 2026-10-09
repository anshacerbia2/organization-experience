# Registers this BFF's client, organization-experience-bff, in identity-control: deploy/dev/README.md
# §Registering it, as one procedure. STD-GLB-009 1.3.0 asks that a procedure step be a script CI runs,
# so the stack-proof workflow runs this against the stack it brings up, and the development server's
# operator runs the same file.
#
# The client is privileged, in the per-sign-in form (ADR-IAM-008), names the Organization Control API's
# resource as its audience, and redirects to this BFF's callback alone. It authenticates with the key
# whose public half -JwkFile holds (ADR-IAM-001 §5.12): keys/organization-experience-bff.jwk.json, made
# on the laptop by scripts/new-client-key.mjs. Only kty, n and e are sent.
#
# It runs where identity-control's scripts run, with a provider-scope token for the bootstrap operator
# from identity-control's scripts/dev-token.ps1. A client registered before is refused by identity-control,
# and the script stops there: a new key for it is a rotation (README §Keys).
#
# SECRETS: read from the environment, as identity-control's dev-smoke.ps1 reads them, and never printed.
#   $env:IDENTITY_CALLER_KEY_FILE      identity-control-caller's private key (identity-control's .env)
#   $env:IDENTITY_CALLER_PASSWORD      the bootstrap operator's password
#   $env:IDENTITY_OPERATOR_TOTP_FILE   optional, the operator's TOTP file (dev-token.ps1)
#
# Usage:
#   pwsh ./scripts/dev-register-bff.ps1 -IdentityRepo /srv/identity-control -JwkFile ./organization-experience-bff.jwk.json

param(
    [Parameter(Mandatory = $true)] [string] $IdentityRepo,
    [Parameter(Mandatory = $true)] [string] $JwkFile,
    [string] $RedirectUri = "http://127.0.0.1:8091/auth/callback"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$identityApi = if ($env:IDENTITY_API_URL) { $env:IDENTITY_API_URL } else { "http://127.0.0.1:8082" }
foreach ($name in @("IDENTITY_CALLER_KEY_FILE", "IDENTITY_CALLER_PASSWORD")) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) { throw "$name is required." }
}

Add-Type -AssemblyName System.Net.Http
. (Join-Path $IdentityRepo "scripts/dev-token.ps1")
$operatorTotp = if ($env:IDENTITY_OPERATOR_TOTP_FILE) { @{ OperatorTotpFile = $env:IDENTITY_OPERATOR_TOTP_FILE } } else { @{} }

$jwk = Get-Content -Raw $JwkFile | ConvertFrom-Json
if ($jwk.kty -ne "RSA" -or -not $jwk.n -or -not $jwk.e) { throw "$JwkFile is not an RSA public JWK" }
if ($jwk.PSObject.Properties.Name -contains "d") { throw "$JwkFile holds a private key; send the public JWK only" }

$token = Get-ScnehauxToken -Username "bootstrap-operator" -Password $env:IDENTITY_CALLER_PASSWORD `
    -KeyFile $env:IDENTITY_CALLER_KEY_FILE @operatorTotp

$body = @{
    client_key = "organization-experience-bff"; profile = "confidential"; audience_class = "privileged"
    privileged_form = "per-sign-in"; application_ref = "organization-experience"
    redirect_uris = @($RedirectUri); audience = @("organization-control-api")
    public_key = @{ kty = $jwk.kty; n = $jwk.n; e = $jwk.e }
} | ConvertTo-Json -Compress -Depth 4

$client = New-Object System.Net.Http.HttpClient
$request = New-Object System.Net.Http.HttpRequestMessage("POST", "$identityApi/v1/registrations")
$request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $token)
$request.Headers.Add("Idempotency-Key", "register-organization-experience-bff-$([Guid]::NewGuid().ToString('N'))")
$request.Headers.Add("X-Administrative-Reason", "registering the organization-experience BFF client")
$request.Content = New-Object System.Net.Http.StringContent($body, [System.Text.Encoding]::UTF8, "application/json")
$response = $client.SendAsync($request).Result
$text = $response.Content.ReadAsStringAsync().Result
if ([int]$response.StatusCode -ne 201) {
    throw "identity-control answered $([int]$response.StatusCode) to the registration: $text"
}
$registration = $text | ConvertFrom-Json
$id = $registration.PSObject.Properties["registration_id"]
Write-Host "registered organization-experience-bff$(if ($id) { ": registration $($id.Value)" })"
