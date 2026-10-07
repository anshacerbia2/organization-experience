# Development client registration

The BFF signs in as its own confidential client, `organization-experience-bff`, exactly as the
identity BFF does (`TDD-identity-experience-001`, which this repository conforms to without
variation). This page states how that client is registered. Nothing here creates a Keycloak client
directly: identity-experience's `deploy/dev/create-bff-client.sh` did that before Identity Control
could register a confidential client, it is superseded, and it is not ported.

## The client

| Property              | Value                                                                                    |
| :-------------------- | :--------------------------------------------------------------------------------------- |
| Client                | `organization-experience-bff`                                                            |
| Registered through    | identity-control's `POST /v1/registrations` (`TDD-identity-control-003`)                 |
| Profile               | `confidential`: Authorization Code with PKCE `S256`, nothing else                        |
| Audience class        | `privileged`, in the `provider-scope` form, so it holds `scnehaux-provider`              |
| Client authentication | `private_key_jwt`, PS256. The client has no secret (ADR-IAM-001 §5.12)                   |
| Audience              | `organization-control-api`, the Organization Control API's keyless resource registration |
| Redirect URI          | `http://127.0.0.1:8091/auth/callback`, exactly, no wildcard                              |
| Back-channel logout   | none on the development server: Keycloak cannot reach a developer's machine              |

**Port 8091.** The identity BFF listens on `127.0.0.1:8090`, so this one takes 8091 and the two do
not collide on a port (they still share a cookie; see the last section). It is not `localhost:8080` for the identity BFF's reason: the dev tunnel forwards the
server's 8080 and rewrites a redirect to `localhost:8080` into its own URL. A port the tunnel does
not forward is left alone.

**The audience is the resource, never a client.** STD-IAM-002 §3.1 forbids naming a client that
authenticates in `aud`, because Keycloak lets a client named there exchange the token.
`organization-control-api` is registered first, as identity-control's `docs/run.md` shows.

## Registering it

On this machine, make the key pair. The private key stays here; only the public JWK leaves:

```sh
node scripts/new-client-key.mjs     # keys/organization-experience-bff.pem and .jwk.json
```

Whoever operates the development server then registers the client with a provider-scope token,
an `Idempotency-Key` and an `X-Administrative-Reason`:

```text
POST /v1/registrations

{"client_key":"organization-experience-bff","profile":"confidential","audience_class":"privileged",
 "privileged_form":"provider-scope","application_ref":"organization-experience",
 "redirect_uris":["http://127.0.0.1:8091/auth/callback"],"audience":["organization-control-api"],
 "public_key":<keys/organization-experience-bff.jwk.json>}
```

The fields are those identity-control's `POST /v1/registrations` reads (`internal/httpapi/registrations.go`,
`TDD-identity-control-003`). A client declares no `lifetime_class`: identity-control derives a
client's token lifetime from its audience's resource registration, and refuses one declared.

The BFF's own configuration is `.env.example`: `ORGANIZATION_EXPERIENCE_CLIENT_ID` names this client,
`ORGANIZATION_EXPERIENCE_CLIENT_KEY_FILE` the private key, and `ORGANIZATION_EXPERIENCE_REDIRECT_URI`
the callback above.

## Rotating the key

A new key is a rotation, never an overwrite. Make it under a new name and send its public half:

```sh
node scripts/new-client-key.mjs organization-experience-bff-next
```

```text
POST /v1/registrations/{registration_id}/keys

{"public_key":<keys/organization-experience-bff-next.jwk.json>}
```

## Before running both BFFs at once

Both BFFs set `__Host-ident_session`, because the cookie is part of the conformed pattern. A browser
scopes cookies by host, not by port, so on `127.0.0.1:8090` and `127.0.0.1:8091` the two share one
cookie: signing in to one signs the browser out of the other. Use one at a time, or two browser
profiles.
