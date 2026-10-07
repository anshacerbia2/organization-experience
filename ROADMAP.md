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

**Built (TDD-organization-experience-001 1.2.0):**

- ✅ **The two scopes are two token forms** (ADR-IAM-008).
  - The client is registered for the `per-sign-in` form.
  - A Tenant sign-in asks for `organization:<tenant_id>`, and the pattern holds the ID token to it
    (identity-experience pin moved to `d7381094`, `bff/conformance.json`).
  - A provider sign-in asks for none.
  - Moving between scopes is a sign-in.
- ✅ **The scope guard** (`bff/src/scope/guard.ts`) refuses before a request leaves the BFF:
  - a Tenant session reaches only the Tenant administration routes, and nothing naming another
    Tenant;
  - a provider session reaches only the activation routes until its window is in force;
  - an in-force window refuses a Tenant outside the ones it was entered for.
- ✅ **Provider mode** (`POST /auth/scope/provider`): the reason, the duration and the Tenants are
  stated before anything opens, after a fresh `aal2` sign-in.
  - The window rests on an activation the Organization Control API records and another provider
    approves (ADR-ORG-002). An emergency grant opens at once.
  - The window ends at the activation's `ends_at`, whatever the session does. Leaving it, or
    signing out, ends the activation.
  - The window's reason and correlation identifier go on every provider request.
- ✅ **In the application:** `ScopeContext` refuses a session and scope that disagree, and
  `ScopeBanner` is sticky, non-dismissible, and names the scope, the Tenants and the time left.
  The entry pages and the provider mode form complete it.
- ✅ **The approval surface**, where a provider decides others' requests, came in Week 3.
- Organization Control serves `GET /v1/provider-activations/grants`, so an eligible holder learns
  what it can activate.

## Week 3 · Administration surfaces

- The provider activation approval surface: requests awaiting the operator's decision, approve
  or deny with a reason, never the operator's own

- Organization registry views
- Tenant lifecycle: activate, suspend, restore
- Workspace administration within one Tenant
- Membership grant, suspend, revoke, restore
- Every mutation carrying idempotency key, optimistic version, reason, correlation
- Version conflict surfaced, never retried

**Exit:** a mutation on a record that changed since it was displayed returns a conflict
the operator can see and resolve.

**Built (TDD-organization-experience-002 1.2.0):**

- ✅ **The surfaces,** against what Organization Control serves.
  - In a Tenant scope: Workspaces, Memberships and invitations.
  - In provider mode: the Organization registry and the Tenant lifecycle.
  - In any provider session: the approval surface.
  - Each surface says which scope it needs, and the navigation offers only the active scope's.
- ✅ **Keyset lists** in the estate's form (STD-GLB-001 1.3.0). The list grows by its next page,
  and a filter change starts it again from the first.
- ✅ **Every mutation carries the contract:**
  - an `Idempotency-Key` per distinct request;
  - the `expected_version` the operator was shown;
  - the operator's reason where it is required. Revocation, retirement and suspension require
    one, and in provider mode the window's reason covers the rest;
  - in provider mode, the window's correlation.
- ✅ **A `409 version-conflict` is shown as one.** The list is read again, so the current state
  is beside it, and nothing is retried.
- ✅ **Lifecycle rendered honestly.**
  - Each Tenant state carries its own consequence, and activation is an explicit step.
  - An invitation is pending, granting nothing, with its countdown.
  - A revocation is accepted, with its time, and never shown as enforced.
  - Irreversible actions name their scope in the confirmation, and retirement needs the name
    typed.
- ✅ **Server state is in TanStack Query** (STD-GLB-FE-001), the session and the scope included.
  Routing uses TanStack Router, as identity-experience does.
- ✅ **What waited on an Organization Control route, served (TDD-organization-experience-002
  1.3.0):**
  - the context switcher: the operator's own contexts (ADR-ORG-005), offered in every scope;
  - projection health: the consumers, with a stale consumer marked inline;
  - `unresolved`: the latest provisioning request on the Tenant read, offering no retry.
- ✅ **The reconciliation age on projection health (TDD-organization-experience-002 1.4.0):** each
  consumer shows when Organization Control last reconciled it, how long ago, and how many findings
  the run reported, or "never reconciled" before its first run.

## Week 4 · Bulk, freshness, and offboarding

- Bulk preview: per-item current state, resulting state, and refusal reasons
- Execution reusing the preview's idempotency key
- Partial failure reported as succeeded, failed, and not-attempted, separately
- Freshness markers rendered inline; irreversible paths calling the fresh check
- Revocation shown as accepted, propagating, enforced, or over budget
- Offboarding presented as staged and resumable, never as one button

**Exit:** a bulk operation never reports a single aggregate success; a queued revocation
is never shown as enforced.

**Built (TDD-organization-experience-001 1.3.0, TDD-organization-experience-003 1.2.0, ADR-ORG-004):**

- ✅ **Bulk Membership actions are batches the server previews.**
  - Each item shows its current state and its resulting state, or the API's refusal.
  - The confirmation names the count and the Tenant.
  - Execution commits the previewed set, each item held to the version the preview read.
  - Outcomes are shown under succeeded, failed and not attempted, never as one success.
  - The failed subset is previewed again as a batch that continues the first.
- ✅ **A revocation or suspension is shown by its evidence:** accepted, propagating, enforced or
  over budget.
  - The interface reads it again until it settles, naming the services not yet applying it and
    the time against the budget.
  - Delivered is not enforced.
- ✅ **Freshness as built.**
  - The administrative reads are authoritative, so administrative data carries no marker.
  - An irreversible operation re-reads the record and sends its version; affected counts come
    from the API.
- ✅ **Offboarding is staged and resumable.**
  - A stage timeline says what each stage stops, with the time in stage and a stall warning.
  - The freeze runs in batches.
  - The obligation board shows waived apart from completed and overdue first, and offers no
    control to resolve another domain's row.
  - The legal hold names what proceeds and what is blocked.
  - Release and retirement are gated, with their causes shown.
  - Beginning shows the API's count, and a Tenant already offboarding resumes.
- ✅ **Returning a Tenant from a mistaken offboarding** (ADR-ORG-006,
  TDD-organization-experience-003 1.3.0).
  - Cancellation is offered in the freeze and obligations stages. It restores the Tenant's prior
    status and the Memberships the freeze suspended.
  - A cancellation that stopped partway says how many remain and finishes when sent again.

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
