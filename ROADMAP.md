# Organization Experience — Roadmap

Execution tracker for this repository only. Architecture lives in
`scnehaux-architecture`; nothing here overrides a SAD, an ADR, or a standard.

Week numbers are relative to the first build week, not calendar dates.

## Position in the build order

This repository starts **after** `identity-experience` has a working BFF and
`organization-control` has an authority API to call.

The BFF pattern is inherited rather than designed, so the first week is conformance
rather than invention. Building a second session pattern here would produce two
security postures to maintain and two places for a defect to hide.

## Design status

| TDD                               | Subject                                                                 | Status   |
| :-------------------------------- | :---------------------------------------------------------------------- | :------- |
| `TDD-organization-experience-001` | Administrative scope, provider mode, safe bulk operations               | approved |
| `TDD-organization-experience-002` | Organization, Tenant, Workspace, and Membership administration surfaces | approved |
| `TDD-organization-experience-003` | Offboarding workflow and obligation tracking views                      | approved |

## Week 1 · BFF conformance

Not a new design. The pattern from `TDD-identity-experience-001` is implemented here,
and the tests that prove it are the same tests. The pattern's files and their tests are
byte-identical to identity-experience's at a pinned commit, listed in `bff/conformance.json`;
`pnpm check:bff-conformance` fails CI on any difference (README §Stack).

- Authorization code with PKCE, confidential client, server-side token holding
- `__Host-` session cookie, opaque value, `HttpOnly`, `Secure`, `SameSite=Lax`
- Three independent forgery defences
- Server-side refresh, failure destroying the session
- Back-channel logout, idle and absolute expiry

**Exit:** the conformance suite from `identity-experience` passes unchanged against this
BFF; cookie properties match exactly.

## Week 2 · Scope

- `ScopeContext`: active scope exposed to every view, ambiguous state refused
- Provider mode entry: step-up, reason collected **before** the scope opens, target
  selection, duration
- `ScopeBanner`: persistent, non-dismissible, naming scope, target, and remaining time
- Automatic expiry independent of session expiry
- Scope correlation identifier carried on every action

**Exit:** an operator in tenant scope cannot issue a request naming another Tenant, and
the attempt is refused before it leaves the BFF; provider mode without a reason cannot
be entered.

## Week 3 · Administration surfaces

- Organization registry views
- Tenant lifecycle: activate, suspend, restore
- Workspace administration within one Tenant
- Membership grant, suspend, revoke, restore
- Every mutation carrying idempotency key, optimistic version, reason, correlation
- Version conflict surfaced, never retried

**Exit:** a mutation on a record that changed since it was displayed returns a conflict
the operator can see and resolve.

## Week 4 · Bulk, freshness, and offboarding

- Bulk preview: per-item current state, resulting state, and refusal reasons
- Execution reusing the preview's idempotency key
- Partial failure reported as succeeded, failed, and not-attempted, separately
- Freshness markers rendered inline; irreversible paths calling the fresh check
- Revocation shown as accepted, propagating, enforced, or over budget
- Offboarding presented as staged and resumable, never as one button

**Exit:** a bulk operation never reports a single aggregate success; a queued revocation
is never shown as enforced.

## Depends on

| Repository             | What this needs from it                                                                   |
| :--------------------- | :---------------------------------------------------------------------------------------- |
| `identity-experience`  | The BFF pattern, as a normative reference and a test suite                                |
| `organization-control` | The Organization Control API, which reauthorizes every command                            |
| `identity-kernel`      | Hosted login and step-up `acr` values                                                     |
| `scnehaux-ui-platform` | Design system packages, build-time only, once UI Platform ships them (SAD-012 1.1.0 §7.3) |

Nothing here waits on the Keycloak proof-of-concept.

## Not this repository

Recorded so scope creep is visible rather than convenient:

- The BFF session pattern — inherited, not designed.
- Any authorization decision — the Organization Control API.
- Identity administration, account security, developer console — `identity-experience`.
- Membership authority, versions, revocation mechanics — `organization-control`.

## Gates

**Design gate.** All three designs at `1.0.0`.

**Production gate.** The design gate, plus: the identity BFF conformance suite passing
unchanged, provider-mode controls tested end to end including automatic expiry, bulk
partial-failure recovery exercised, WCAG 2.2 AA conformance evidence, and runbooks
written for provider-access review, bulk operation partial failure, and stuck
offboarding.
