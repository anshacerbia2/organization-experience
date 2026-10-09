# The people, grants and Tenant the stack-level journeys need, made on the stack the stack-proof
# workflow brought up, after organization-control's scripts/dev-wire.ps1 wired it
# (TDD-organization-experience-001 §End to End). It runs on a CI stack the job throws away, never on a
# shared server: it creates people and gives them passwords.
#
#   1. identity-experience-bff registered in identity-control, as identity-experience's
#      deploy/dev/README.md §First start step 2 declares a new server's client, with the back-channel
#      logout URI where the kernel reaches it when -IdentityExperienceBackChannelUri names one;
#   2. three people, created through identity-control's POST /v1/principals as any Principal is:
#      a second provider, a Tenant administrator, and a person with two devices. Each is given a
#      password through the kernel's administrator and its pending action cleared. DEVELOPMENT ONLY,
#      the same step identity-control's deploy/dev/bootstrap.sh takes for the bootstrap operator: the
#      production path leaves a credential to the person, through the kernel's own flow;
#   3. the second provider's eligible grant for provider:organization-control, so its provider mode
#      waits for another provider's approval (ADR-ORG-002 §5.1);
#   4. an Organization and an active Tenant, with the bootstrap operator and the Tenant administrator
#      as its administrators (ADR-ORG-003), waited on until both are members of the Tenant's
#      Organization in the kernel.
#
# Every request goes as the bootstrap operator, through dev-wire.ps1's dev-provider-caller, whose
# token names both APIs; Organization Control authorizes it by the operator's emergency grant.
#
# SECRETS, read from the environment and never printed: IDENTITY_CALLER_PASSWORD,
# IDENTITY_OPERATOR_TOTP_FILE, KC_BOOTSTRAP_ADMIN_PASSWORD. The people's passwords are written to
# -Out, mode 0600, for the journeys to type.
#
#   pwsh ./e2e/seed.ps1 -IdentityRepo .identity -WiringState <dev-wire state> `
#       -IdentityExperienceJwk <identity-experience-bff.jwk.json> -Out <seed.json>

param(
    [Parameter(Mandatory = $true)] [string] $IdentityRepo,
    [Parameter(Mandatory = $true)] [string] $WiringState,
    [Parameter(Mandatory = $true)] [string] $IdentityExperienceJwk,
    [Parameter(Mandatory = $true)] [string] $Out,
    # Where the kernel reaches the identity BFF's POST /auth/back-channel-logout, declared in its
    # registration. The workflow passes it only to an identity-control that takes
    # backchannel_logout_uri (TDD-identity-control-003 1.37.0), and the evidence reads what the kernel
    # holds rather than what was sent.
    [string] $IdentityExperienceBackChannelUri = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$identityApi     = if ($env:IDENTITY_API_URL) { $env:IDENTITY_API_URL } else { "http://127.0.0.1:8082" }
$organizationApi = if ($env:ORGANIZATION_API_URL) { $env:ORGANIZATION_API_URL } else { "http://127.0.0.1:8083" }
$kcAdmin   = if ($env:KC_ADMIN_URL) { $env:KC_ADMIN_URL } else { "http://localhost:8080" }
$adminUser = if ($env:KC_BOOTSTRAP_ADMIN_USERNAME) { $env:KC_BOOTSTRAP_ADMIN_USERNAME } else { "admin" }
foreach ($name in @("IDENTITY_CALLER_PASSWORD", "KC_BOOTSTRAP_ADMIN_PASSWORD")) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) { throw "$name is required." }
}

Add-Type -AssemblyName System.Net.Http
. (Join-Path $IdentityRepo "scripts/dev-token.ps1")
$operatorTotp = if ($env:IDENTITY_OPERATOR_TOTP_FILE) { @{ OperatorTotpFile = $env:IDENTITY_OPERATOR_TOTP_FILE } } else { @{} }
$wiring = Get-Content -Raw $WiringState | ConvertFrom-Json
$client = New-Object System.Net.Http.HttpClient
$run = [Guid]::NewGuid().ToString("N").Substring(0, 8)

# A token naming organization-control-api lives 240 seconds (L0), so it is renewed well before that.
$script:token = $null
$script:tokenAt = [datetime]::MinValue
function Provider-Token {
    if (((Get-Date) - $script:tokenAt).TotalSeconds -gt 150) {
        $script:token = Get-ScnehauxToken -Username "bootstrap-operator" -Password $env:IDENTITY_CALLER_PASSWORD `
            -ClientId $wiring.caller_client_id -KeyFile $wiring.caller_key_file @operatorTotp
        $script:tokenAt = Get-Date
    }
    return $script:token
}

# Call sends one request as the operator, with the administrative reason provider routes require and an
# Idempotency-Key unique to this run on a command.
function Call([string] $method, [string] $url, $body, [string] $key) {
    $request = New-Object System.Net.Http.HttpRequestMessage($method, $url)
    $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", (Provider-Token))
    $request.Headers.Add("X-Administrative-Reason", "stack proof: the people and the Tenant of the end to end journeys")
    if ($key) { $request.Headers.Add("Idempotency-Key", "$key-$run") }
    if ($null -ne $body) {
        $json = $body | ConvertTo-Json -Compress -Depth 6
        $request.Content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, "application/json")
    }
    $response = $client.SendAsync($request).Result
    $text = $response.Content.ReadAsStringAsync().Result
    $parsed = $null
    if ($text) { try { $parsed = $text | ConvertFrom-Json } catch { $parsed = $null } }
    return @{ code = [int]$response.StatusCode; json = $parsed; text = $text }
}

function Require([string] $label, $response, [int] $want) {
    if ($response.code -ne $want) { throw "$label answered $($response.code), want $($want): $($response.text)" }
    Write-Host "  ok    $label"
    return $response.json
}

function Get-Prop($object, [string] $name) {
    if ($null -ne $object -and $object.PSObject.Properties.Name -contains $name) { return $object.$name }
    return $null
}

# Kc calls the kernel's Admin API as its console administrator. Master-realm tokens live a minute.
$script:adminToken = $null
$script:adminTokenAt = [datetime]::MinValue
function Kc([string] $method, [string] $path, $body) {
    if (((Get-Date) - $script:adminTokenAt).TotalSeconds -gt 30) {
        $form = New-Object 'System.Collections.Generic.Dictionary[string,string]'
        $form["grant_type"] = "password"
        $form["client_id"] = "admin-cli"
        $form["username"] = $adminUser
        $form["password"] = $env:KC_BOOTSTRAP_ADMIN_PASSWORD
        $response = $client.PostAsync("$kcAdmin/realms/master/protocol/openid-connect/token",
            (New-Object System.Net.Http.FormUrlEncodedContent($form))).Result
        if (-not $response.IsSuccessStatusCode) { throw "the console administrator could not log in: $([int]$response.StatusCode)" }
        $script:adminToken = ($response.Content.ReadAsStringAsync().Result | ConvertFrom-Json).access_token
        $script:adminTokenAt = Get-Date
    }
    $request = New-Object System.Net.Http.HttpRequestMessage($method, "$kcAdmin/admin/realms/scnehaux$path")
    $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $script:adminToken)
    if ($null -ne $body) {
        $request.Content = New-Object System.Net.Http.StringContent(($body | ConvertTo-Json -Compress -Depth 10),
            [System.Text.Encoding]::UTF8, "application/json")
    }
    $response = $client.SendAsync($request).Result
    $text = $response.Content.ReadAsStringAsync().Result
    if (-not $response.IsSuccessStatusCode) { throw "the kernel answered $([int]$response.StatusCode) to $method $($path): $text" }
    if ($text) { return $text | ConvertFrom-Json }
    return $null
}

function Kernel-User([string] $principal) {
    $users = @(Kc "GET" "/users?q=scnehaux_principal_id:$($principal)&exact=true" $null | Where-Object { $null -ne $_ })
    if ($users.Count -ne 1) { throw "$($users.Count) kernel users carry $principal" }
    return $users[0]
}

function Organization-Members([string] $tenant) {
    $organization = @(Kc "GET" "/organizations?search=$($tenant)&exact=true" $null |
            Where-Object { $null -ne $_ -and (Get-Prop $_ "alias") -eq $tenant }) | Select-Object -First 1
    if ($null -eq $organization) { return @() }
    return @(Kc "GET" "/organizations/$($organization.id)/members?first=0&max=1000" $null |
            Where-Object { $null -ne $_ } | ForEach-Object { $_.id })
}

function Wait-For([string] $label, [int] $seconds, [scriptblock] $condition) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (& $condition) { Write-Host "  ok    $label"; return }
        Start-Sleep -Seconds 2
    }
    throw "$label (not within $seconds s)"
}

Write-Host "1. identity-experience-bff registered"
$jwk = Get-Content -Raw $IdentityExperienceJwk | ConvertFrom-Json
$declaration = @{
    client_key = "identity-experience-bff"; profile = "confidential"; audience_class = "privileged"
    privileged_form = "provider-scope"; application_ref = "identity-experience"
    redirect_uris = @("http://127.0.0.1:8090/auth/callback"); audience = @("identity-control-api")
    public_key = @{ kty = $jwk.kty; n = $jwk.n; e = $jwk.e } }
# In this stack the kernel can reach the BFF, as it reaches a deployed one, so it declares the URI a
# deployed BFF declares (identity-experience deploy/dev/README.md, ADR-IAM-009). A laptop's does not.
if ($IdentityExperienceBackChannelUri) { $declaration["backchannel_logout_uri"] = $IdentityExperienceBackChannelUri }
$null = Require "identity-experience-bff registered" (Call "POST" "$identityApi/v1/registrations" $declaration "stack-identity-bff") 201

Write-Host "2. the people"
# New-Person creates a Principal the way POST /v1/principals creates any, then gives it a password.
function New-Person([string] $role) {
    $username = "stack.$role.$run"
    $created = Require "$username created in identity-control" (Call "POST" "$identityApi/v1/principals" @{
            username = $username; email = "$username@scnehaux.local"; subject_type = "human" } "stack-$role") 201
    $principal = $created.principal_id
    # DEVELOPMENT ONLY, as deploy/dev/bootstrap.sh step 2 does for the bootstrap operator.
    $bytes = New-Object byte[] 12
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $password = "Stack-$(-join ($bytes | ForEach-Object { $_.ToString('x2') }))!"
    $user = Kernel-User $principal
    $null = Kc "PUT" "/users/$($user.id)/reset-password" @{ type = "password"; value = $password; temporary = $false }
    $stored = Kc "GET" "/users/$($user.id)" $null
    $stored | Add-Member -NotePropertyName requiredActions -NotePropertyValue @() -Force
    $null = Kc "PUT" "/users/$($user.id)" $stored
    Write-Host "  ok    $username can sign in (development only)"
    return [ordered]@{ username = $username; password = $password; principalId = $principal }
}
$provider = New-Person "provider"
$administrator = New-Person "administrator"
$device = New-Person "device"

Write-Host "3. the second provider's eligible grant"
$null = Require "an eligible provider:organization-control grant" (Call "POST" "$organizationApi/v1/provider-grants" @{
        principal_id = $provider.principalId; scope = "provider:organization-control"; kind = "eligible" } "stack-grant") 201

Write-Host "4. the Tenant and its administrators"
$tenantName = "Stack proof $run"
$organization = Require "an Organization registered" (Call "POST" "$organizationApi/v1/organizations" @{
        display_name = $tenantName; classification = "customer" } "stack-organization") 201
$requested = Require "a Tenant requested" (Call "POST" "$organizationApi/v1/tenants" @{
        organization_id = $organization.organization_id; display_name = $tenantName; isolation_profile = "pooled" } "stack-tenant") 201
$tenantId = $requested.tenant.tenant_id
$null = Require "its provisioning dispatched" (Call "POST" "$organizationApi/v1/tenants/$tenantId/provisioning" @{
        expected_version = $requested.tenant.version } "stack-provision") 200
$null = Require "its provisioning realized" (Call "POST" "$organizationApi/v1/provisioning/realized" @{
        correlation_id = $requested.correlation_id } "stack-realized") 200
$current = Require "the Tenant read" (Call "GET" "$organizationApi/v1/tenants/$tenantId" $null $null) 200
$null = Require "the Tenant activated" (Call "POST" "$organizationApi/v1/tenants/$tenantId/activate" @{
        expected_version = $current.version } "stack-activate") 200
foreach ($principal in @($wiring.operator_principal_id, $administrator.principalId)) {
    $null = Require "$principal made an administrator of the Tenant" (Call "POST" "$organizationApi/v1/tenants/$tenantId/administrators" @{
            principal_id = $principal } "stack-administrator-$principal") 201
}
$operatorUser = (Kernel-User $wiring.operator_principal_id).id
$administratorUser = (Kernel-User $administrator.principalId).id
Wait-For "both administrators are members of the Tenant's Organization in the kernel" 120 {
    $members = @(Organization-Members $tenantId)
    ($members -contains $operatorUser) -and ($members -contains $administratorUser)
}

[ordered]@{
    run = $run; tenantId = $tenantId; tenantName = $tenantName
    operator = [ordered]@{ username = "bootstrap-operator"; principalId = $wiring.operator_principal_id }
    provider = $provider; administrator = $administrator; device = $device
} | ConvertTo-Json -Depth 4 | Set-Content -NoNewline $Out
if ($IsLinux -or $IsMacOS) { chmod 600 $Out }
Write-Host ""
Write-Host "seeded: Tenant $tenantId, the people in $Out"
