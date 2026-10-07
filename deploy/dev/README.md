# Development client registration

The BFF signs in as its own confidential client, `organization-experience-bff`, exactly as the
identity BFF does (`TDD-identity-experience-001`, which this repository conforms to without
variation). This page states how that client is registered. Nothing here creates a Keycloak client
directly: identity-experience's `deploy/dev/create-bff-client.sh` did that before Identity Control
could register a confidential client, it is superseded, and it is not ported.

It follows the skeleton of STD-GLB-009 §Development Server Deployment for a laptop-run application.
The procedure across the server's stacks is the architecture repository's development server runbook
(`scnehaux-architecture/deploy/dev/README.md`); this client is its step 8.

## What runs

On the server, nothing: no compose stack, no container, and no script in this directory. The server
holds this application's client, in the kernel's `scnehaux` realm, and its registration, in
identity-control.

On the laptop, the BFF serves the built admin application on `http://127.0.0.1:8091` and keeps its
sessions in a local PostgreSQL.

### The client

| Property              | Value                                                                                                |
| :-------------------- | :--------------------------------------------------------------------------------------------------- |
| Client                | `organization-experience-bff`                                                                        |
| Registered through    | identity-control's `POST /v1/registrations` (`TDD-identity-control-003`)                             |
| Profile               | `confidential`: Authorization Code with PKCE `S256`, nothing else                                    |
| Audience class        | `privileged`, in the `per-sign-in` form (ADR-IAM-008): both form scopes and `organization`, optional |
| Client authentication | `private_key_jwt`, PS256. The client has no secret (ADR-IAM-001 §5.12)                               |
| Audience              | `organization-control-api`, the Organization Control API's keyless resource registration             |
| Redirect URI          | `http://127.0.0.1:8091/auth/callback`, exactly, no wildcard                                          |
| Back-channel logout   | none on the development server: Keycloak cannot reach a developer's machine                          |

**Port 8091.** The identity BFF listens on `127.0.0.1:8090`, so this one takes 8091 and the two do
not collide on a port (they still share a cookie; see [Wiring to other services](#wiring-to-other-services)). It is not `localhost:8080` for the identity BFF's reason: the dev tunnel forwards the
server's 8080 and rewrites a redirect to `localhost:8080` into its own URL. A port the tunnel does
not forward is left alone.

**The audience is the resource, never a client.** STD-IAM-002 §3.1 forbids naming a client that
authenticates in `aud`, because Keycloak lets a client named there exchange the token.
`organization-control-api` is registered first, as identity-control's `docs/run.md` shows.

## Before you start

On the server, already running:

- **identity-kernel**, with its realm applied.
- **identity-control** with ADR-IAM-008, after its ceremony, so a provider can register a client in
  the `per-sign-in` form, and with `organization-control-api` registered.
- **organization-control**, for the API this BFF proxies.

On the laptop: Node.js 24 and pnpm, and a local PostgreSQL for the session store.

From the server's operator: the client, registered with this laptop's public key.

## First start

### Registering it

On this machine, make the key pair. The private key stays here; only the public JWK leaves:

```sh
node scripts/new-client-key.mjs     # keys/organization-experience-bff.pem and .jwk.json
```

Whoever operates the development server then registers the client with a provider-scope token,
an `Idempotency-Key` and an `X-Administrative-Reason`. It is registered for the `per-sign-in` form,
which needs identity-control with ADR-IAM-008. Each sign-in then names one form: a Tenant with
`?tenant=`, or the provider form:

```text
POST /v1/registrations

{"client_key":"organization-experience-bff","profile":"confidential","audience_class":"privileged",
 "privileged_form":"per-sign-in","application_ref":"organization-experience",
 "redirect_uris":["http://127.0.0.1:8091/auth/callback"],"audience":["organization-control-api"],
 "public_key":<keys/organization-experience-bff.jwk.json>}
```

The fields are those identity-control's `POST /v1/registrations` reads (`internal/httpapi/registrations.go`,
`TDD-identity-control-003`). A client declares no `lifetime_class`: identity-control derives a
client's token lifetime from its audience's resource registration, and refuses one declared.

### Running the BFF

The BFF's own configuration is `.env.example`: `ORGANIZATION_EXPERIENCE_CLIENT_ID` names this client,
`ORGANIZATION_EXPERIENCE_CLIENT_KEY_FILE` the private key, and `ORGANIZATION_EXPERIENCE_REDIRECT_URI`
the callback above. Copy it to `.env`, fill in `ORGANIZATION_EXPERIENCE_ISSUER`,
`ORGANIZATION_EXPERIENCE_DATABASE_URL` and `ORGANIZATION_EXPERIENCE_SESSION_KEY` (its comment shows how
to make one), and export the values: the BFF reads its environment and nothing else. Then:

```sh
pnpm install
pnpm build
pnpm --filter @organization-experience/bff migrate   # the session store, as below
pnpm dev:bff
```

The migration runs as the owning role, with `ORGANIZATION_EXPERIENCE_MIGRATION_DATABASE_URL` naming the
database and `ORGANIZATION_EXPERIENCE_RUNTIME_ROLE` the serving role it grants. Open
`http://127.0.0.1:8091` and sign in.

**Provider mode on the development server.** The bootstrap provider holds an emergency grant
(`ADR-ORG-002 §5.2`). Its window opens at once with no activation, and still ends at the duration
stated. An eligible provider's window waits for another provider's approval, because Organization
Control's `ORGANIZATION_PROVIDER_ACTIVATION_APPROVAL` defaults to `required`. The
approver uses the Activation requests page (`/approvals`), which calls
`POST /v1/provider-activations/{id}/approve`.

## Updating

On the laptop, `git pull`, then `pnpm build`, the session store's migration, and `pnpm dev:bff` again.
On the server, nothing is updated for this application. A change to the client is a change to its
registration in identity-control, never a change in the Keycloak console.

## One-off tasks

None on the server. On the laptop, the session store's migration
(`pnpm --filter @organization-experience/bff migrate`) runs before a run that needs a new migration;
the BFF never runs it itself.

## Wiring to other services

The BFF joins no Docker network. It reaches the server over HTTPS and the dev tunnel:

- **The kernel**, at `ORGANIZATION_EXPERIENCE_ISSUER`, through the tunnel's anonymous port 8080.
- **organization-control**, at `ORGANIZATION_EXPERIENCE_ORGANIZATION_CONTROL_URL`, for every `/api/*`
  call. Sign-in works without it; the proxied calls answer 503 until it runs.

### Before running both BFFs at once

Both BFFs set `__Host-ident_session`, because the cookie is part of the conformed pattern. A browser
scopes cookies by host, not by port, so on `127.0.0.1:8090` and `127.0.0.1:8091` the two share one
cookie: signing in to one signs the browser out of the other. Use one at a time, or two browser
profiles.

## Keys

`node scripts/new-client-key.mjs` makes `keys/organization-experience-bff.pem`, the private key, which
stays on this machine and is gitignored, and `keys/organization-experience-bff.jwk.json`, its public
half, which the operator registers. The client has no secret.

### Rotating the key

A new key is a rotation, never an overwrite. Make it under a new name and send its public half:

```sh
node scripts/new-client-key.mjs organization-experience-bff-next
```

```text
POST /v1/registrations/{registration_id}/keys

{"public_key":<keys/organization-experience-bff-next.jwk.json>}
```

## Backups

Nothing here needs a backup. The client lives in the kernel's database and its registration in
identity-control's, and each stack backs up its own. The laptop's session store, in the database
`ORGANIZATION_EXPERIENCE_DATABASE_URL` names, is disposable: clear it and apply the migration again,
and you sign in again. A lost private key is replaced by a new one, registered as a rotation.

## Never do

- **Copy `keys/organization-experience-bff.pem` anywhere, or commit `.env` or `keys/`.** Only the public
  JWK leaves this machine.
- **Port identity-experience's `create-bff-client.sh`, or create this client in the Keycloak console.**
  The client is registered through identity-control alone.
- **Name a client in `audience`.** The audience is the resource, `organization-control-api`.
- **Declare a `lifetime_class`.** identity-control refuses it.
- **Serve the BFF on `localhost:8080`, or on any port the tunnel forwards, or on 8090.** The tunnel
  rewrites a redirect to a forwarded port, and 8090 is the identity BFF's.

## Troubleshooting

| Symptom                                                              | Cause                                                                                         | Fix                                                                                                   |
| :------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| After sign-in, the browser lands back on Keycloak instead of the BFF | The BFF ran on a port the tunnel forwards, and the tunnel rewrote the redirect                | Serve on `http://127.0.0.1:8091`. Use `127.0.0.1`, not `localhost`, for the callback                  |
| Keycloak refuses the redirect URI                                    | The BFF's origin is not exactly the registered `http://127.0.0.1:8091/auth/callback`          | Keep `ORGANIZATION_EXPERIENCE_PUBLIC_ORIGIN` and `ORGANIZATION_EXPERIENCE_REDIRECT_URI` as registered |
| The registration is refused                                          | identity-control without ADR-IAM-008, a `lifetime_class` declared, or a client named in `aud` | Update identity-control; declare the body as above                                                    |
| Signing in to this BFF signs the browser out of the identity BFF     | Both set `__Host-ident_session`, and a browser scopes cookies by host, not by port            | One BFF at a time, or two browser profiles                                                            |
| `/api/*` answers 503                                                 | organization-control does not listen on `ORGANIZATION_EXPERIENCE_ORGANIZATION_CONTROL_URL`    | Start it there, or point the variable at where it runs                                                |
| Every session ends when the BFF restarts                             | `ORGANIZATION_EXPERIENCE_SESSION_KEY` changed or was empty                                    | Make it once and keep it in `.env`                                                                    |
| An eligible provider's window does not open                          | Organization Control's `ORGANIZATION_PROVIDER_ACTIVATION_APPROVAL` is `required` by default   | Another provider approves it on the Activation requests page (`/approvals`)                           |
