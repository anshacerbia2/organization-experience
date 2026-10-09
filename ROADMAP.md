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

- ✅ Authorization code with PKCE, confidential client, server-side token holding
- ✅ `__Host-` session cookie, opaque value, `HttpOnly`, `Secure`, `SameSite=Lax`
- ✅ Three independent forgery defences
- ✅ Server-side refresh, failure destroying the session
- ✅ Back-channel logout, idle and absolute expiry

**Exit:** the conformance suite from `identity-experience` passes unchanged against this
BFF; cookie properties match exactly.

✅ **Met, as `pnpm check:bff-conformance` proves in CI.**

- The files that implement the five items above are byte-identical to identity-experience's at the
  pinned commit (`bff/conformance.json`), `cookies.ts` among them, so the cookie properties match
  exactly.
- `oidc.test.ts` and `tenant.test.ts` are byte-identical too.
- **Not literally unchanged.** `auth.test.ts` has two assertions adapted, and `server.test.ts`
  replaces the suites for applications this repository does not serve. Each is listed with its
  reason in `bff/conformance.json`:
  - every sign-in lands at the root of the one application;
  - every sign-in asks for `aal2`.
- ✅ **A session-store outage answers `503`, and an unreadable session signs out** (TDD-organization-experience-001 1.5.0,
  identity-experience pin moved to `9899e257`, `bff/conformance.json`). The pattern's
  `bff/test/store-outage.test.ts` runs here byte for byte. The provider window store names an outage
  as the session store does, so the scope routes answer `503` too.

## Week 2 · Scope

- ✅ `ScopeContext`: active scope exposed to every view, ambiguous state refused
- ✅ Provider mode entry: step-up, reason collected **before** the scope opens, target
  selection, duration
- ✅ `ScopeBanner`: persistent, non-dismissible, naming scope, target, and remaining time
- ✅ Automatic expiry independent of session expiry
- ✅ Scope correlation identifier carried on every action. The scope correlation is the provider
  window's, so it is on every provider request; a Tenant-scope request carries none
  (TDD-organization-experience-001 §The Scope Guard)

**Exit:** an operator in tenant scope cannot issue a request naming another Tenant, and
the attempt is refused before it leaves the BFF; provider mode without a reason cannot
be entered.

✅ **Met** by the Built block below, and tested in `bff/test/scope.test.ts`: "refuses a request
naming another Tenant before it leaves the BFF" and "cannot be entered without a reason, and the API
is never asked".

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
- ✅ Organization Control serves `GET /v1/provider-activations/grants`, so an eligible holder learns
  what it can activate. The BFF reads it before every window request (`ownGrants`,
  `bff/src/scope/control.ts`).

## Week 3 · Administration surfaces

- ✅ The provider activation approval surface: requests awaiting the operator's decision, approve
  or deny with a reason, never the operator's own
- ✅ Organization registry views
- ✅ Tenant lifecycle: activate, suspend, restore
- ✅ Workspace administration within one Tenant
- ✅ Membership grant, suspend, revoke, restore
- ✅ Every mutation carrying idempotency key, optimistic version, reason, correlation. The
  correlation is the provider window's, in provider mode only
- ✅ Version conflict surfaced, never retried

**Exit:** a mutation on a record that changed since it was displayed returns a conflict
the operator can see and resolve.

✅ **Met** by the Built block below, and tested in `administration.test.tsx`: "shows a version
conflict as one, and reads the list again rather than retrying".

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

- ✅ Bulk preview: per-item current state, resulting state, and refusal reasons
- ✅ Execution reusing the preview's idempotency key. As served, the preview is a batch resource,
  and execution commits it with the key generated for that batch (ADR-ORG-004 §5.1)
- ✅ Partial failure reported as succeeded, failed, and not-attempted, separately
- ✅ Freshness markers rendered inline; irreversible paths calling the fresh check. As built, the
  administrative reads are authoritative and carry no marker, and an irreversible operation
  re-reads the record (Built block below)
- ✅ Revocation shown as accepted, propagating, enforced, or over budget
- ✅ Offboarding presented as staged and resumable, never as one button

**Exit:** a bulk operation never reports a single aggregate success; a queued revocation
is never shown as enforced.

✅ **Met** by the Built block below, and tested in `bulk.test.tsx` (outcomes under three headings)
and `administration.test.tsx` (a revocation shown by its evidence).

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

✅ **Met.** All three are `approved`, at 1.4.0 (`docs/designs`).

**Production gate.** The design gate, plus: the identity BFF conformance suite passing
unchanged, provider-mode controls tested end to end including automatic expiry, bulk
partial-failure recovery exercised, WCAG 2.2 AA conformance evidence, and runbooks
written for provider-access review, bulk operation partial failure, and stuck
offboarding.

**Where the production gate stands (TDD-organization-experience-001 1.4.0):**

- ✅ **The design gate.**
- ✅ **The identity BFF conformance suite passes in CI.** It is not literally unchanged: Week 1
  lists the two adapted assertions. Whether that meets "unchanged" is the owner's call.
- ✅ **Provider-mode controls are tested across each boundary, including automatic expiry.**
  - At the BFF, against PostgreSQL and a stand-in Organization Control: the window ends at
    `ends_at`.
  - In the application: the scope is read again at `ends_at`, and the provider surfaces close.
- ✅ **A browser end to end against the stack** (TDD-organization-experience-001 1.7.0 §End to End).
  `.github/workflows/stack-proof.yml` brings up the kernel, identity-control and organization-control
  as organization-control's `deploy-dev` does, both BFFs beside them, and drives Chromium through the
  kernel's hosted login (STD-GLB-009 §Stack-Level Proofs). It runs on pull requests, on `main`, daily
  and on dispatch with a `*_ref` per producer, in about 15 minutes. Covered, in run
  [37853070937](https://github.com/anshacerbia2/organization-experience/actions/runs/37853070937):
  - sign-in, with the TOTP the kernel asks for at `aal2`, and the cookie as the pattern sets it;
  - provider mode: a fresh `aal2` sign-in, refused without a reason in the browser, requested with one
    for one minute and one Tenant;
  - a second provider's approval, after which the window opened in the requester's browser in 9.3 s;
  - a Membership granted, and one revoked, shown by its evidence until `enforced`;
  - the window's end reaching the browser 0.6 s after `ends_at`, and a provider read after it refused;
  - the revocation reaching the revoked administrator's open tab in 162.9 s, against a bound of 192.6 s
    (`TDD-identity-experience-001` §Revocation), with no request served after it was accepted.
- ✅ **It found a defect, fixed here.** The Tenant sign-in form submitted itself to `/auth/login`, and
  Chromium refused the redirect to the kernel under the BFF's `form-action 'self'`. The form now
  navigates by script (STD-GLB-FE-003 2.1.0 §3.5, `App.test.tsx`).
- ✅ **Moving from a provider sign-in to a Tenant on the same kernel session works, and the proof requires
  it.** The kernel answered its own error page (`AuthenticationFlowException`, `invalid_user_credentials`)
  for `organization:<tenant_id>` on a provider sign-in's session. identity-kernel
  [#63](https://github.com/anshacerbia2/identity-kernel/pull/63) fixed it in the realm
  (`scnehaux-browser-v4`, an Organization Identity-First step after the cookie). Run
  [37916092312](https://github.com/anshacerbia2/organization-experience/actions/runs/37916092312), with
  `kernel_ref=batch3`, recorded "signed in to the Tenant on the provider sign-in's kernel session". Step 4
  now asserts the switch in the operator's own browser, on the same kernel session, and the separate
  browser is gone (TDD-organization-experience-001 1.8.0).
- ✅ **Bulk partial-failure recovery is exercised,** in the application and through the BFF.
  - Covered: an interrupted execution sent again with the same key, then the failed items
    continued as a new batch.
  - It found a defect, fixed in 1.4.0: the scope guard refused `/v1/membership-batches` in a Tenant
    scope, so bulk actions could not leave the BFF.
- ✅ **Automated WCAG 2.2 A and AA checks** (axe-core) run on every route in CI.
- ⏳ **Manual WCAG 2.2 AA evidence is still needed:** keyboard, screen reader, contrast and target
  size in a real browser. Automated checks find only part of what conformance needs.
- ✅ **Runbooks:** `docs/runbooks/organization-experience-operations.md`.
- ✅ **The provider-access review reads and records against `audit.privileged_access`**
  (`ADR-ORG-002 §5.6`, `TDD-organization-experience-002` 1.5.0, 2026-10-08).
  - **Access review**, in provider mode, lists each provider with access no review covers, reads
    one provider's accesses over a period with the API's filters, and records a review with an
    outcome and a statement. The operator's own access offers no review; the API refuses one.
  - **Provider access**, in Tenant scope, lists the provider access that named the Tenant. The scope
    guard admits `/v1/provider-access` in a Tenant scope (`TDD-organization-experience-001` 1.6.0).
  - Served by Organization Control from `TDD-organization-control-001` 1.21.0 (its backlog item 40).
