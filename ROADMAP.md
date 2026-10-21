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

**Gap found 2026-10-19, closed by #16.** Reported from the development server: a Tenant requested
from the console stayed `requested` ("Awaiting provisioning") and could never become active.

- **The gap.** Two Tenant transitions an operator drives had no action. `requested -> provisioning`
  (the dispatch, `POST /v1/tenants/{id}/provisioning`) was never designed for the console.
  `failed -> provisioning` (the retry) was promised by TDD-organization-experience-002 §Tenant States
  Are Rendered Individually, "Retry is available", and never built.
- **Why the exit missed it.** The item above lists "activate, suspend, restore", and the exit and the
  "Lifecycle rendered honestly" check tested how each state is displayed and that a stale mutation is
  a conflict. Nothing checked that each operator-driven transition of TDD-organization-control-003's
  machine has an action.
- **Closed.** Start provisioning and Retry provisioning (Built, below). TDD-organization-experience-002
  1.6.0 §Operator Transitions maps every transition of the machine to its action or the reason for
  none, and `tenantTransitions.test.ts` fails on a transition without a row.

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
  - An invitation is pending, granting nothing until the invited person accepts, with its countdown.
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
- ✅ **Starting and retrying provisioning (TDD-organization-experience-002 1.6.0):** reported from the
  development server, a requested Tenant could not leave `requested` from the console.
  - Start provisioning on a `requested` Tenant and Retry provisioning on a `failed` one, both
    `POST /v1/tenants/{id}/provisioning`, as provider commands like Activate: primary, confirmed in
    the row with the Tenant named, an optional reason, `expected_version`, and an `Idempotency-Key`
    per distinct request.
  - Every provisioning state shows its correlation identifier. `unresolved` offers no retry control,
    not a disabled one, and says how it is resolved (`TDD-organization-control-003` 1.15.0).
  - Unit tests, and the fixture-backed browser tests with screenshots and axe-core for both forms.
  - §Operator Transitions in TDD-organization-experience-002 1.6.0, and its test over
    `tenantTransitions.ts`.
- ✅ **Every operator transition of every machine shown has an action (TDD-organization-experience-002
  1.7.0, TDD-organization-experience-003 1.5.0).** An audit on 2026-10-19 (organization-control
  `fd935f8`, this repository `fda907d`) found transitions an operator drives with no trigger.
  - Tenant administrators on the Tenants page: the list, Grant administrator, which also grants the
    first Membership, and Revoke administrator (ADR-ORG-003). This is what makes an active Tenant usable.
  - Send deprovisioning again on a failed deprovisioning; `unresolved` has its own sentence and no
    control.
  - Projection health: a consumer's dead letters, with Replay, Resolve as replayed or superseded and
    Waive; Retire consumer; the Tenant-administration pause, shown, paused and lifted.
  - Provider grants in the Access review area: eligible or emergency, granted and revoked (ADR-ORG-002).
  - The transitions only another party drives (the provisioning system, a domain, a sweep) name why
    the console offers none, and the development server's stand-ins in organization-control.
  - `transitions.ts` holds the tables of eight machines, and `transitions.test.ts` fails on an edge
    without a row, an operator row without an action, or a disagreement with the designs.
  - Unit tests, and the fixture-backed browser tests with screenshots and axe-core for each new form.
- ✅ **An invitation can be accepted, by the person it names (TDD-organization-experience-002 1.8.0,
  TDD-organization-experience-001 1.10.0, ADR-ORG-007).** Until now an invitation stayed `pending` until
  it expired.
  - **Issue shows the link once:** `/invitations/accept#<token>`, the token in the fragment only, with
    Copy link. It is never stored, and the panel says the administrator sends it themselves on a
    development server; a lost link is revoked and issued again.
  - **The acceptance page,** `/invitations/accept`, for any signed-in person, no Tenant needed. It
    clears the fragment from the address bar, keeps the token in the tab's session storage across a
    sign-in, and sends it only in the body of `POST /v1/invitations/accept`. After acceptance it names
    the Tenant from the person's own contexts and offers its sign-in. `404`, `409`, `503` and `400` each
    have their own sentence.
  - **The scope guard** admits the acceptance in every scope as a self command, like the own contexts,
    and `verify-identity` leaves its provider-only list. `identity_verified` is gone from the states.
  - Unit tests, BFF guard and proxy tests, and the fixture-backed browser tests with screenshots and
    axe-core for the issued link and the page accepted, refused and unavailable.
  - ✅ **Works on a server** (corrected 2026-10-21): organization-control serves acceptance as a self
    command (organization-control ROADMAP item 47) and identity-control serves the address match,
    `POST /v1/principals/{principal_id}/identifiers:match` (identity-control #114), as
    `ADR-ORG-007 §5.8` asks. This line said both were still awaited.
  - ⏳ **A stack-proof journey for the acceptance: planned** (recorded 2026-10-21, `ADR-ORG-007 §5.8`).
    `e2e/tests/organization-experience.spec.ts` issues no invitation and accepts none yet. The journey
    issues one as the Tenant administrator, accepts it as the invited person signed in without a
    Tenant, and finds the Tenant in Your Tenants. Nothing it needs is unbuilt.
  - ⏳ **A person without an account: planned.** `ADR-IAM-011` was accepted on 2026-10-20. Its §5.6
    gives this repository one change: the acceptance page offers **I do not have an account** and hands
    the token, in the fragment, to identity-experience's enrolment page. Not built: it waits on
    identity-control's `POST /v1/enrolments`, organization-control's `POST /v1/invitations/resolve`
    (organization-control ROADMAP item 56), identity-control's registration of the `invitation:resolve`
    workload that calls it (identity-control ROADMAP item 17, `ADR-IAM-011` §5.7) and
    identity-experience's enrolment page, whose address is not decided yet
    (TDD-organization-experience-002 1.11.0).
  - ⏳ **Production gate:** the Notification Platform delivers the link to the invited address, and the
    shown-once panel goes (`ADR-ORG-007 §5.5`).
- ✅ **Sign in without knowing a Tenant's identifier (TDD-organization-experience-001 1.11.0,
  TDD-organization-experience-002 1.9.0).** Reported from the development server: signing in for a
  Tenant needed its UUID, and the provider sign-in sat beside it.
  - **Sign in** is the entry's one primary action: a sign-in with no Tenant, the provider form, which
    grants nothing (`ADR-IAM-008 §5.5`). The BFF is unchanged.
  - **Your Tenants** then lists the person's own contexts (`ADR-ORG-005`). Choosing one is the Tenant
    sign-in, answered by the same kernel session (`ADR-IAM-008 §5.6`). One Tenant is listed, not
    entered by itself; none says what to do.
  - **Sign in as a provider** is the secondary action, and returns to the new `/provider-mode` page.
    The overview offers that page under Provider administration.
  - **The Tenant identifier field is gone.** The list holds every Tenant a Tenant sign-in can serve,
    so typing one gains nothing (`TDD-organization-experience-001` 1.11.0 §The Sign-In Entry). A Tenant
    surface reached without a Tenant lists the person's Tenants, so a deep link still ends there.
  - Unit tests, the fixture-backed browser tests with screenshots and axe-core for the entry, the
    picker with one, several and no contexts, and the provider mode page; the stack proof signs in
    with no Tenant and chooses it from the list.
- ✅ **The owner's decisions of 2026-10-20:** see §Owner Decisions of 2026-10-20, below, one dated item
  each.
- ✅ **A panel is never sized as if it were empty (TDD-organization-experience-001 1.11.0 §Visual
  Language).** Ported from identity-experience#57: `Panel` loses `container-type: inline-size`, which
  sized an unstretched panel to its padding, and gains `min-inline-size: 0` and
  `overflow-wrap: anywhere`; `Table` keeps `overflow-wrap: normal`. Latent here. `e2e/browser/layout.spec.ts` checks
  panel width, one-character lines and sideways scroll at 1440, 1024, 768, 390 and 320 px, and every
  main route's sideways overflow is checked at the same widths and 820 (`STD-GLB-FE-005` 2.1.0 §3.10).
  Every route is laid out at 320. It found two pages that scrolled sideways: `Button` loses
  `white-space: nowrap` as identity-experience#58 did, a `StatusPill` wraps a status longer than its
  room, the scope banner wraps around its time left, and the bar's title wraps.

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

## Owner Decisions of 2026-10-20

Dated 2026-10-21, in this repository's pull request for them. organization-control #75 (`6a36b8d`) serves
what O1, O2 and O4 call. Each line names its status and the decision it comes from.

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Status                          | Source                                              |
| :-- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------ | :-------------------------------------------------- |
| O1  | **Reporters.** `/reporters` in provider mode lists, registers and retires the workloads that report provisioning and each domain's obligations. Register takes the workload, what it reports and its purpose with a required reason, and says a workload is registered once on a `409`. Retire reads the reporter again and sends that version. Reporter transition table and test (TDD-organization-experience-002 1.10.0)                                                                                                                                                                                                | ✅ 2026-10-21                   | `ADR-ORG-001 §5.11`                                 |
| O2  | **The reconciliation interval.** Projection health shows `reconciliation_interval_seconds`, marks a consumer overdue past one interval and critically past two, and shows `reconciliation_requested_at` when a restore set it. Registration stays the deployment procedure's, which sends the interval                                                                                                                                                                                                                                                                                                                     | ✅ 2026-10-21                   | `ADR-ORG-001 §5.7`                                  |
| O4  | **A provider withdraws one Membership.** Withdraw a Membership on an `active`, `suspended` or `offboarding` Tenant's row: Suspend membership or Revoke membership, confirmed in the row with a reason, the version and an `Idempotency-Key`, then its enforcement. Never grant or restore. Membership transition table and test                                                                                                                                                                                                                                                                                            | ✅ 2026-10-21                   | `ADR-ORG-003 §5.6`                                  |
| O4a | **The Membership is read first.** Withdraw a Membership takes the identifier and a reason, reads `GET /v1/tenants/{tenant_id}/memberships/{membership_id}` with that reason (organization-control ROADMAP item 61), and shows the record and its version. It offers Suspend and Revoke on an active one, Revoke on a suspended one, nothing on a revoked one, and sends the version it read; the reason it collected is offered again on the confirmation. No version is typed. `contracts/organization-control/openapi.yaml` moves to organization-control 1.1.0 (TDD-organization-experience-002 1.12.0, TDD-001 1.14.0) | ✅ 2026-10-21                   | `ADR-ORG-003 §5.6` (amended 2026-10-21)             |
| O6  | **Replay and keys.** An issue answered `201` without `token` shows "already issued, revoke and issue again", never a link. Every command takes a new `Idempotency-Key` once answered, and keeps it only while the outcome is unknown. Fixes the live defect where a second identical issue reused the first key, was replayed, and rendered `…#undefined`                                                                                                                                                                                                                                                                  | ✅ 2026-10-21                   | `ADR-ORG-007 §5.5`, `STD-GLB-001` 1.7.0             |
| O7  | **The refused invitation is known by its type**, `invitation-not-acceptable`, not by `404`; a `404` of another type keeps the token                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅ 2026-10-21                   | `ADR-ORG-007 §5.4`, RFC 9457 §3.1.1                 |
| I4  | **One client per developer device.** `dev-register-bff.ps1 -ClientKey` registers a device's own client, `.env.example` names the device's client id, and `deploy/dev/README.md` §Several devices is the procedure (TDD-organization-experience-001 1.12.0 §Configuration)                                                                                                                                                                                                                                                                                                                                                  | ✅ 2026-10-21                   | `STD-GLB-009` rule 15, `ADR-IAM-001 §5.12`          |
| I6  | **One sticky scope line on a small viewport.** Below 60rem wide or 30rem tall only the scope line is sticky, never wrapping; the bar and the full banner scroll with the page; `scroll-padding-top` follows the sticky region. Above both the full banner may wrap. `layout.spec.ts` checks 320×256, 320×844 and 1440×256, and tabs backwards with nothing hidden under the line, and since 2026-10-21 at 1440×900 too, under the bar and banner (TDD-001 1.13.0)                                                                                                                                                          | ✅ 2026-10-21                   | `STD-GLB-FE-005` 2.3.0 §3.10, `SAD-012` 1.4.0 §8.4  |
| P2  | **The UI Platform exception** is `ADR-ORG-008`, expiring 2027-04-20, cited in the README, here and in `apps/admin/src/ui/index.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ 2026-10-21                   | `ADR-ORG-008`                                       |
| P5  | **The Organization Control client is contract-tested**, not generated: the smaller change, no call site moves. `contracts/organization-control/openapi.yaml` is organization-control's at `6a36b8d` (at `b69a102`, 1.1.0, since O4a), proved byte for byte by `pnpm check:api-contract`. The tests hold every request the unit tests send, every path the source and `bff/src/scope/control.ts` write, `control.ts`'s calls, and every browser fixture. They found fixtures short of required fields and with invented identifiers; fixed                                                                                  | ✅ 2026-10-21                   | `ADR-GLB-010 §5.1`                                  |
| P6  | **Backups.** `deploy/dev/README.md` §Backups states why rule 9 asks nothing of this application: it owns no database on the server, and the laptop's session store is disposable and never backed up or restored (S1)                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ 2026-10-21                   | `STD-GLB-009` rule 9                                |
| S1  | **The session record ends with its session.** Found compliant: the store is identity-experience's (`bff/conformance.json`), with `idle_expires_at` and `absolute_expires_at` on the record, `purgeExpired` every five minutes in `bff/src/server.ts`, `destroy` and `destroyForLogout`; no backup script or restore drill includes it. A test covers the purge of a never-presented row (`bff/test/auth.test.ts`; TDD-001 1.13.0). No conformance-set file changed                                                                                                                                                         | ✅ 2026-10-21                   | `STD-IAM-001` 3.0.0 §3.4, `STD-GLB-002` 3.4.0       |
| —   | **ADR-IAM-011**, a person without an account: the acceptance page offers **I do not have an account**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ⏳ planned (Week 3 Built block) | `ADR-IAM-011 §5.1`, §5.6, §5.7 (amended 2026-10-21) |
| —   | **Stack proof witness.** identity-control's ceremony runs with a witness distinct from the operator (#21), recorded in TDD-organization-experience-001 1.12.0 §End to End                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ✅ 2026-10-20                   | `STD-IAM-001 §3.10`                                 |

## Visual language (TDD-organization-experience-001 1.9.0)

The console takes identity-experience's visual language, by copy, from its commit
`c723e417c0eee97db6b1d5b6dab608fe6a406ac2` (its pull request #54). The UI Platform stays deferred, so
the components are local, under `apps/admin/src/ui/`, behind one entry point.

- ✅ **Tokens and foundations:** every `--ds-*` token, same names and values, both schemes; the canvas,
  focus as an outline, links underlined, reduced motion, forced colours. No token departs.
- ✅ **Components ported:** ButtonBase, Button, Icon, Panel, StatusPill, Table, the field styles, the
  frame with its rail and bar, the theme toggle, and the notice. Their tests came with them.
- ✅ **The contrast test ported,** its 40 pairs unchanged, with this application's pairs added: the scope
  banner in each scope, the rows, the confirmation, the stages. All meet WCAG 2.2 AA in both themes.
- ✅ **Information design:** records drawn as dense rows with status pills and row actions; destructive
  actions in the danger variant, confirmed in place with the scope named; loading, empty and error
  states in words; the scope banner sticky under the bar with its countdown; tablet width.
- ✅ **Fixture-backed browser tests** (`e2e/browser`, the `browser` job of `ci.yml`): 48 screenshots
  of every main route, signed in, with data, Tenant scope and provider mode, light and dark, desktop and
  tablet, as the `browser-screens` artifact; axe with layout on each, no violation; colour contrast
  recorded as "needs review"; the banner, focus, links and destructive actions checked.
- ✅ **The UI Platform exception is `ADR-ORG-008`**, accepted 2026-10-20, expiring **2027-04-20**. When
  `@scnx/system` and `@scnx/core-ui` ship, `apps/admin/src/ui/index.ts` re-exports them and the copies go
  (§5.4). If they have not shipped by then, a new exception supersedes it, or the waiver check blocks the
  repository. The entry point's header cites it.

## Depends on

| Repository             | What this needs from it                                                                                                      |
| :--------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `identity-experience`  | The BFF pattern, as a normative reference and a test suite                                                                   |
| `organization-control` | The Organization Control API, which reauthorizes every command                                                               |
| `identity-kernel`      | Hosted login and step-up `acr` values                                                                                        |
| `scnehaux-ui-platform` | Design system packages, build-time only, once UI Platform ships them (SAD-012 §7.3; until then `ADR-ORG-008`, to 2027-04-20) |

Nothing here waits on the Keycloak proof-of-concept.

## Not this repository

Recorded so scope creep is visible rather than convenient:

- The BFF session pattern — inherited, not designed.
- Any authorization decision — the Organization Control API.
- Identity administration, account security, developer console — `identity-experience`.
- Membership authority, versions, revocation mechanics — `organization-control`.

## Gates

**Design gate.** All three designs at `1.0.0`.

✅ **Met.** All three are `approved`, now at 1.13.0, 1.11.0 and 1.6.0 (`docs/designs`).

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
- ✅ **Automated WCAG 2.2 A and AA checks** (axe-core) run on every route in CI, in jsdom and, since
  TDD-organization-experience-001 1.9.0, in Chromium with layout, in both themes. The first Chromium
  run found SC 2.5.8 target-size failures on the navigation links, fixed by the visual language.
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
