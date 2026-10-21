---
doc_meta:
  id: TDD-organization-experience-002
  title: Organization, Tenant, Workspace, and Membership Administration Surfaces
  owner: Core Platform Team
  version: 1.13.0
  status: approved
  classification: restricted
  review_cycle_days: 90
  created_date: 2026-08-11
  last_reviewed: 2026-10-21
  parent_sad: SAD-012
---

# Organization, Tenant, Workspace, and Membership Administration Surfaces

## Purpose

Specify the day-to-day administrative surfaces: the Organization registry, Tenant
lifecycle, Workspace management, Membership administration, invitations, and context
switching.

`TDD-organization-experience-001` fixes how scope, bulk operations, freshness, and
irreversible confirmations behave across every surface. This design specifies the
surfaces themselves and the few places where a lifecycle detail must be visible in the
interface or it will be misread.

## Scope

**In scope**

- Organization registry and external reference presentation.
- Tenant lifecycle, including the states between request and active.
- Workspace administration within one Tenant.
- Membership grant, suspend, revoke, restore, and the invitation path, through its acceptance by
  the invited person (1.8.0).
- Context switching for operators holding many Memberships.
- Projection consumer health.
- The provider-access review, and a Tenant's read of the provider access to it (1.5.0).
- Every operator transition of the machines these surfaces show, each with its action or the reason
  for none (1.6.0 for the Tenant, 1.7.0 for the rest).
- The reporter registry, a provider's withdrawal of one Membership inside a Tenant, and the
  consumer's declared reconciliation interval (1.10.0, organization-control's decisions of
  2026-10-20).

**Out of scope**

- Scope, provider mode, bulk operations, freshness markers, and irreversible
  confirmation — inherited unchanged from `TDD-organization-experience-001`.
- The BFF session pattern — inherited from `TDD-identity-experience-001`.
- Offboarding views — owned by `TDD-organization-experience-003`.
- Authority, state machines, and validation — owned by the `organization-control`
  designs.

## Technical Context

Three lifecycle details are invisible in a naive interface and produce the same class of
error each time: an operator believing something is finished when it is not.

| Detail | Naive rendering | What it hides |
| :-- | :-- | :-- |
| Tenant `requested` and `provisioning` | "Creating…" | The Tenant is not usable and Membership cannot be granted into it |
| Provisioning `unresolved` | "Failed" | The outcome is unknown; retrying may provision twice |
| Membership granted by invitation | "Granted" | Nothing exists until the invited person accepts, signed in as themselves (1.8.0) |

Each is rendered as its own state here, with the consequence stated.

## Component Design

| Component | Responsibility |
| :-- | :-- |
| `OrganizationRegistry` | Organization list, detail, external references, relationships |
| `TenantLifecyclePanel` | State, provisioning correlation, activation gate, the Tenant's administrators (1.7.0), and a provider's withdrawal of one Membership (1.10.0) |
| `ReporterRegistry` | The registered reporter workloads, registered and retired by a provider (1.10.0) |
| `WorkspaceManager` | Workspace list and lifecycle within one Tenant |
| `MembershipAdmin` | Grant, suspend, revoke, restore, and the invitation path, with the acceptance link shown once (1.8.0) |
| `InvitationAcceptance` | The page where an invited person, signed in as themselves, accepts (1.8.0) |
| `ContextSwitcher` | The person's own contexts: the picker after a sign-in without a Tenant, and the switch (1.9.0) |
| `ProjectionHealth` | Consumer registry, freshness, reconciliation status; a consumer's dead letters and their resolution, its retirement, and the Tenant-administration pause (1.7.0) |
| `AccessReview` | Provider access no one has reviewed, one provider's access over a period, and the review recorded (1.5.0); the provider grants, granted and revoked (1.7.0) |
| `TenantProviderAccess` | A Tenant administrator's read of the provider access that named its Tenant (1.5.0) |

## Data Model

This experience owns no Organization, Tenant, Workspace, Membership, invitation, or
projection-health state. Paged API responses are represented as disposable view models
scoped to the active BFF session and selected Tenant context. Optimistic versions and
operation identifiers are retained only long enough to submit or poll a command; a
context switch invalidates every view model from the previous context.

## API / Interface

All calls proxy through the BFF to the Organization Control API.

```text
GET   /api/v1/organizations
POST  /api/v1/organizations
POST  /api/v1/organizations/{id}:suspend
POST  /api/v1/organizations/{id}:retire

GET   /api/v1/tenants
POST  /api/v1/tenants
POST  /api/v1/tenants/{id}:activate
POST  /api/v1/tenants/{id}:suspend
POST  /api/v1/tenants/{id}:restore

GET   /api/v1/tenants/{id}/workspaces
POST  /api/v1/tenants/{id}/workspaces
POST  /api/v1/tenants/{id}/workspaces/{wid}:archive

GET   /api/v1/tenants/{id}/memberships
POST  /api/v1/memberships
POST  /api/v1/memberships/{id}:suspend
POST  /api/v1/memberships/{id}:revoke
POST  /api/v1/memberships/{id}:restore

POST  /api/v1/tenants/{id}/invitations
POST  /api/v1/invitations/{id}:revoke

GET   /api/v1/principals/{id}/contexts
GET   /api/v1/projections/organization/consumers
```

### The Interface as Served (1.2.0)

The route list above is 1.0.0's sketch. Organization Control serves its actions as path segments,
takes the optimistic version as `expected_version` in the body, and takes a Tenant-scope caller's
Tenant from the token, so no Tenant-scope path names one. Week 3 builds against what it serves
(`TDD-organization-control-002`, `-003` and `-004`).

```text
Tenant scope                                              Provider mode, window in force
GET   /api/v1/workspaces            ?status               GET   /api/v1/organizations   ?status&classification
POST  /api/v1/workspaces                                  GET   /api/v1/organizations/{id}
POST  /api/v1/workspaces/{id}/archive|restore|retire      POST  /api/v1/organizations
GET   /api/v1/memberships           ?status&workspace_id  POST  /api/v1/organizations/{id}/suspend|restore|retire
GET   /api/v1/memberships/{id}                            GET   /api/v1/tenants         ?status&organization_id
POST  /api/v1/memberships                                 GET   /api/v1/tenants/{id}
POST  /api/v1/memberships/{id}/suspend|restore|revoke     POST  /api/v1/tenants
GET   /api/v1/invitations           ?state                POST  /api/v1/tenants/{id}/activate|suspend|restore
POST  /api/v1/invitations
POST  /api/v1/invitations/{id}/revoke                     Provider scope, any window state
                                                          GET   /api/v1/provider-activations
                                                          POST  /api/v1/provider-activations/{id}/approve|deny
```

**Lists page by keyset.** STD-GLB-001 prohibits offsets.
- **The request.** Each list takes `after` and `limit` (50 by default, 100 at most). The response is
  `{"<items>": [...], "next": <id> | null}`, the form identity-control already serves.
- **The interface.** A keyset gives no page count and no "page 7", so the interface offers the next
  page, never a numbered one. A filter change starts again from the first page.

**Every mutation carries four things.** `TDD-organization-experience-001` §API requires them, and
`TDD-organization-control-002` §API requires them of the API:

| Part | Where it comes from |
| :-- | :-- |
| `Idempotency-Key` | Generated in the browser, one per distinct request. Resubmitting the same values after an outage reuses it, so the API answers with what the first attempt did. A changed value is a new request with a new key. From 1.10.0, once the API has answered, success or refusal, the next submission is a new request with a new key, even with the same values; only an attempt whose outcome is unknown keeps its key: no answer, a `5xx`, or `409 request-in-progress` (§The Owner's Decisions of 2026-10-20, Served). The BFF forwards it, as identity-experience's does |
| `expected_version` | The record as the operator was shown it |
| `X-Administrative-Reason` | The operator's own, for the action. Required for a Membership revocation, an Organization retirement, and a Tenant or Organization suspension. In provider mode an action without one carries the window's reason (`TDD-organization-experience-001` 1.2.0) |
| Correlation | In provider mode, the window's, set by the BFF |

**A version conflict is shown, not retried.** A `409 version-conflict` reads the record again and
shows its current state and version beside what the operator acted on. The operator decides again.
A `409` for any other reason, such as a transition the state does not allow, shows the API's own
sentence.

**What Week 3 does not build, and why.**
- **The context switcher.** No Organization Control route lists the Tenants an operator
  administers. Until one does, a Tenant is entered by its identifier or by a deep link
  (`TDD-organization-experience-001` 1.2.0).
- **Projection health.** No route lists the projection consumers; Organization Control serves one
  consumer at a time.
- **`unresolved`.** It is a state of the provisioning request, not of the Tenant, and the Tenant
  read does not carry it.
  - The Tenant panel renders the Tenant states the API serves: `requested`, `provisioning`,
    `active`, `failed`, `suspended`, `offboarding` and `retired`.
  - The rule below for `unresolved` waits for the provisioning request to be readable.
- **Enforcement after a revocation.** The interface shows the revocation as accepted, at the time
  the API accepted it, and never as enforced. Its propagation is Week 4's
  (`TDD-organization-experience-001` §Presenting Revocation Honestly).

**What 1.2.0 waited on, served (1.3.0).**
- **The context switcher.** It lists the operator's own contexts from
  `GET /v1/principals/{principal_id}/contexts` (`ADR-ORG-005`).
  - It is served to the operator for themselves, signed in with or without a Tenant.
  - Each entry names the Tenant and the Workspace, and whether the operator administers the
    Tenant.
  - Choosing an entry is the Tenant sign-in. An entry is a selector, and the API checks the choice
    again at use. The identifier field remained for a deep link until 1.9.0, which removes it
    (§The Picker After Sign-In).
- **Projection health** lists the consumers from `GET /v1/projections/consumers`, in provider mode.
  - Each consumer shows its declared budget and stale behaviour, and its last reported mark and
    time.
  - A consumer past its budget renders stale, with its stale behaviour named.
- **`unresolved`** is read from the Tenant read's `provisioning`, the latest provisioning request.
  - It renders with retry disabled and the reason given ("Do not retry; awaiting
    reconciliation").
  - `failed` renders with its detail.

**The reconciliation age, served (1.4.0).** From `TDD-organization-control-002` 1.13.0 each consumer,
in the list and in the single read, carries its last reconciliation (§The Consumer List there):
`last_reconciled_at`, `last_reconciled_mark`, `last_reconciled_findings` and
`reconciliation_age_seconds`.
- **Each consumer shows when it was last reconciled and how many findings that run reported.** A
  clean run reports none, and the page says "no findings".
- **The age is the service's.** `reconciliation_age_seconds` is computed when the response is built,
  on the clock `last_reconciled_at` was written with. The page renders it as served and reads no
  clock of its own.
- **Absent fields mean no run yet.** The fields are omitted until Organization Control first
  reconciles the consumer. The page then shows "never reconciled", never an age or a count of zero.
- **The count is not classified.** The read carries how many findings a run produced, not their
  kinds, so an `extra` finding is still raised by the reconciliation alert and the repair event, not
  by this page.

**The approval surface (1.2.0).** In production, another provider approves an activation
(`ADR-ORG-002 §5.1`).
- **Who uses it.** A provider session reaches it with or without a window of its own.
- **Reading the list** needs a reason, as every provider read does. The operator writes one before
  the requests are shown, unless a window supplies it.
- **What it lists:** the activations awaiting a decision, each with its holder, reason, duration and
  age. Approving or denying takes a reason of its own.
- **The operator's own request** is shown as theirs, with no decision control. The API refuses a
  self-approval regardless.

**The provider-access review (1.5.0).** `ADR-ORG-002 §5.6` makes the privileged-access record
readable, and `TDD-organization-control-001` 1.21.0 §Privileged Access Review serves it. Until 1.5.0
the operations runbook read it some other way, and nothing recorded the review.

```text
Provider mode, window in force                                   Tenant scope
GET   /api/v1/privileged-access:unreviewed                       GET  /api/v1/provider-access
GET   /api/v1/privileged-access   ?actor_id&tenant_id&correlation_id&authority&from&to      ?authority&from&to
GET   /api/v1/privileged-access/reviews   ?actor_id
POST  /api/v1/privileged-access/reviews   {"actor_id", "from", "to", "outcome"}
```

- **Who reviews.** A provider in force, so the surface is a provider-mode one, and the window's reason
  and correlation go with every read. A grant holder with nothing in force reaches only the
  activation routes, at the API and at the scope guard.
- **What the reviewer sees first:** each Principal with provider access no review covers, oldest
  first. Each shows the number unreviewed, how many were emergency uses, the oldest, and the date it
  falls due. One past its date is marked overdue. The review is due weekly (CIS 8.11).
- **The operator's own access** is shown as theirs, with no review control. Another provider reviews
  it, and the API refuses a self-review with `403` regardless. This is the approval surface's rule,
  for the same reason.
- **Choosing a Principal** opens its accesses for the period, oldest first, from its oldest
  unreviewed access to now. Each access shows when, the authority (an emergency use named as one,
  an activation with its identifier), the operation, the Tenant it named or "across Tenants", the
  reason, and the correlation. The filters are the API's: authority, Tenant, correlation, and the
  period's `from` and `to`. The list pages by keyset; a filter change starts again.
- **Recording the review.** The reviewer states the outcome, `appropriate` or `escalated`, and a
  statement, which is the command's reason and is required. The period is the one shown, `from`
  inclusive and `to` exclusive. The command carries an `Idempotency-Key` per distinct request and the
  session's CSRF token, as every command does. The answer is shown as recorded: how many accesses,
  and how many emergency ones, the period held. Those counts are the API's, taken when the review was
  recorded, and the reviewer compares them with what they read.
- **The Principal's past reviews** are listed beside it, in the order they were recorded, paged by keyset, each with its period,
  outcome, statement, counts and reviewer.
- **A Tenant administrator** reads the provider access that named their Tenant, in Tenant scope:
  when, the authority, the operation, the reason and the correlation, with the authority filter and
  the period. The page says what it does not show: a provider read across Tenants names no Tenant,
  and is reviewed by providers. It records nothing, because a Tenant reading its own record is not
  provider access, and it offers no review: the review is the providers'.
- **Times are entered and shown in the operator's zone and sent with their offset.** A `from` or
  `to` without an offset is refused by the API (`STD-GLB-001` 1.6.0), so the page sends each as an
  RFC 3339 instant in UTC.

**Starting and retrying provisioning (1.6.0).** Reported from the development server on 2026-10-19:
a Tenant requested here stayed `requested`, "Awaiting provisioning". The console offered no action for
`POST /v1/tenants/{tenant_id}/provisioning`, so the dispatch that moves a Tenant to `provisioning` could
not be made from it, and a `failed` Tenant could not be retried, although §Tenant States Are Rendered
Individually said "Retry is available". `TDD-organization-control-003` serves both on that one route
(§Who issues which transition, §Provisioning Correlation).

```text
Provider mode, window in force
POST  /api/v1/tenants/{id}/provisioning   {"expected_version"}   requested: Start provisioning; failed: Retry provisioning
```

- **Start provisioning** on a `requested` Tenant records that the desired state has left and moves it
  to `provisioning`. It is offered whatever its request reads, `unresolved` included:
  `TDD-organization-control-003` 1.15.0 §Resolving an `unresolved` Request accepts that dispatch,
  because it records the same attempt and writes no new request.
- **Retry provisioning** on a `failed` Tenant makes a new request with a new correlation identifier. The
  failed request's reason is shown beside it, so the operator reads why before retrying.
- **Both are provider-mode commands like Activate**: the primary variant, a confirmation in the row
  that names the Tenant and takes an optional reason (the window's otherwise), the Tenant's
  `expected_version`, and an `Idempotency-Key` per distinct request with the session's CSRF token.
  Neither is destructive, so neither takes the danger variant (`TDD-organization-experience-001`
  §Visual Language). Each reads the Tenant again when it settles, so the new state and correlation
  identifier show at once.
- **The correlation identifier is shown** with every provisioning state, because it is the one handle
  the operator and the provisioning system's owner share (`docs/runbooks/provisioning.md` in
  organization-control).
- **An `unresolved` request offers no retry control at all, not a disabled one.** Retry exists only for
  a `failed` Tenant, and an `unresolved` request's Tenant is never `failed`. The 1.0.0 rule below said
  "disabled"; a disabled button explains nothing to a screen reader user and little to anyone else. The
  GOV.UK Design System: "Disabled buttons have poor contrast and can confuse some users, so avoid them
  if possible" [R1]. The state's sentence says not to retry, and why, and how it is resolved instead:
  ask the provisioning system's owner for the outcome of this correlation identifier, and have it
  reported as realized or failed (`TDD-organization-control-003` 1.15.0 §Resolving an `unresolved`
  Request). On a development server the operator reports it with organization-control's
  `scripts/dev-provisioning.ps1`.

**The operator transitions nothing triggered (1.7.0).** An audit on 2026-10-19 (organization-control
`fd935f8`, this repository `fda907d`) found more transitions like the one 1.6.0 closed: Organization
Control serves them, an operator drives them, and the console offered no action. The worst of them
left a Tenant unusable after Activate. Its first administrator is granted by a provider together with
the first Membership (`ADR-ORG-003 §5.2`), and no surface sent that grant, so no one could ever sign
in for the Tenant. 1.7.0 adds each action, and §Operator Transitions of the Other Machines lists them.

```text
Provider mode, window in force
GET   /api/v1/tenants/{id}/administrators                              every grant, newest first
POST  /api/v1/tenants/{id}/administrators                {"principal_id"}   Grant administrator
POST  /api/v1/tenants/{id}/administrators/{grant_id}/revoke                 Revoke administrator
GET   /api/v1/provider-grants                                          every grant, newest first
POST  /api/v1/provider-grants         {"principal_id", "scope", "kind"}     Grant provider access
POST  /api/v1/provider-grants/{grant_id}/revoke                             Revoke grant
GET   /api/v1/projections/consumers/{id}/dead-letters   ?state=open|resolved&after&limit
POST  /api/v1/dead-letters/{event_id}/consumers/{consumer}/replay           Replay
POST  /api/v1/dead-letters/{event_id}/consumers/{consumer}/resolve  {"resolution_type"}
POST  /api/v1/dead-letters/{event_id}/consumers/{consumer}/waive    {"reason", "expires_at"}
POST  /api/v1/projections/consumers/{id}/retire                              Retire consumer
GET   /api/v1/tenant-administration-pause
POST  /api/v1/tenant-administration-pause                {"paused"}          Pause; Lift the pause
```

Every command is a provider command under the mutation contract above: an `Idempotency-Key` per
distinct request with the session's CSRF token, the reason, and the window's correlation. None of these
routes takes an `expected_version`, so none is sent. Each opens its confirmation in the row it acts on
and names its target there.

- **Tenant administrators, on the Tenants page.** Each Tenant's row offers Administrators, which opens
  the Tenant's grants: the Principal, who granted it, when and why, and for a revoked one who revoked
  it, when and why. Opening it is a provider read and records an access, so nothing is read until the
  operator asks.
  - **Grant administrator** takes a Principal identifier and is offered on an `active` Tenant only:
    Organization Control refuses a grant in any other state (`TDD-organization-control-001` §The
    Tenant Administration Grant). The confirmation says that the grant also gives the Principal a
    Tenant-wide Membership when it has none, and the answer says whether it did
    (`membership_created`). It is the primary action: after Activate, it is what makes the Tenant
    usable.
  - **Revoke administrator** is on each active grant, in the danger variant, with a reason required. It
    does not revoke the Membership the grant stands on; that is the Tenant's own administration.
  - **Who.** A provider, as `ADR-ORG-003 §5.2` decides: "A provider grants and revokes it, through the
    API, with a reason". No Tenant-scope surface offers either.
- **Provider grants, in the Access review area.** Below the review, the grants: each holder, scope,
  kind, who granted it, when and why, and a revoked one's revocation.
  - **Grant provider access** takes a Principal, a scope (`provider:organization-control` or
    `provider:identity-control`) and a kind. The two kinds are explained where they are chosen, in
    `ADR-ORG-002`'s words: an eligible grant "confers nothing until it is activated", and an activation
    is approved by another provider (§5.1); an emergency grant "is therefore standing", every use is
    reported, it is validated at least every 90 days, and production keeps at least two (§5.2). An
    emergency grant is standing authority, so choosing it draws the confirmation in the danger scheme
    and requires a reason.
  - **Revoke grant** is on each active grant, danger, with a reason required. Organization Control
    refuses to revoke the last grant of its own scope with `409`; the page shows its sentence.
- **Dead letters, on projection health.** Each consumer's row offers Dead letters, which reads its open
  incidents (`TDD-organization-control-005` 2.5.0 §Listing a consumer's dead letters), and a filter
  shows resolved ones. Each incident shows its event type, whether it bears authority, its aggregate and
  version, its lane, its failure, attempts and times, and any waiver with its expiry and reason.
  - **Replay** re-sends the event to the consumer. It does not resolve the incident; the answer says so
    (`resolved: false`). It is offered for an active consumer only: a retired consumer no longer
    subscribes, and the API refuses with `412`.
  - **Resolve as replayed** and **Resolve as superseded** close an open or waived incident, on the
    evidence the API checks (`TDD-organization-control-005` §The resolution predicate). Missing evidence
    is `412` with the API's sentence naming the receipts it found.
  - **Waive** is offered for a retired consumer's incident only, because the API waives no active
    consumer's (§WAIVED there), with a reason and an expiry no more than 90 days ahead. The reason is
    sent as the waiver's own and as the access record's. A waiver is not a closure, and the incident
    renders as waived until its expiry, never as resolved.
- **Retire consumer, on projection health.** On an active consumer, in the danger variant, with a reason
  and the consumer's identifier typed, as Tenant retirement takes its name (`TDD-organization-experience-001`
  §Irreversible Operations): retiring abandons what the consumer was owed (`TDD-organization-control-002`
  §Consumer Registry).
- **The Tenant-administration pause, on projection health.** The page reads the latest decision and
  shows it: paused, by whom, when, why and under which correlation, or not paused. A pause naming no
  actor is the one `deploy/dev/restore.sh` records before the service serves (`ADR-ORG-003 §5.5`).
  - **Lift the pause** is the primary action while paused, with a reason required: lifting is always a
    provider's named decision.
  - **Pause Tenant administration** is offered when not paused, danger, with a reason required: every
    Tenant administrator's commands are then refused until it is lifted.
  - It sits with projection health because the reconciliation it contains is there
    (`docs/runbooks/organization-experience-operations.md`, and organization-control's
    `organization-database-restore.md`).
- **No disabled controls.** An action the API would refuse in a state is not drawn in that state; the
  state's own words say what is possible instead (1.6.0, [R1]).

**Accepting an invitation (1.8.0).** Until 1.8.0 no invitation could be accepted. Acceptance needed a
token for the Tenant, which the invitee is not a member of, and nothing verified the invitee
(`ADR-ORG-007 §3`). `ADR-ORG-007` makes acceptance a self command: the invited person accepts, signed
in as themselves, and Organization Control checks that they hold the invited address, proven. This
surface shows the link once, and serves the page where it is accepted.

```text
Tenant scope
POST  /api/v1/invitations          {"target_identifier", "subject_type", "ttl_seconds"}   answers {"invitation", "token"}

Any signed-in person, with or without a Tenant: a self command (ADR-ORG-007 §5.1)
POST  /api/v1/invitations/accept   {"token"}                                              answers {"invitation", "membership"}
```

- **The link, shown once.** When an invitation is issued, the page builds
  `https://<this origin>/invitations/accept#<token>` and shows it with a Copy link control.
  - **The token is in the fragment only.** The fragment "is separated from the rest of the URI prior
    to a dereference" [R3], so no server receives it when the link is opened, this BFF included.
  - **It is never stored.** It is held in the page's memory until the administrator chooses Done or
    leaves the page. It is never sent back to the BFF, and never written to the session, to local
    storage or to a log. It is never shown again: the list carries no token, and the API keeps only
    its digest.
  - **On a development server the administrator relays it.** Nothing delivers the link there
    (`ADR-ORG-007 §5.5`). The panel says so: the administrator sends it to the person by a channel of
    their own, and a lost link is revoked and issued again.
  - **Copying** uses the Clipboard API, which "can only be done in a secure context" [R5]. Where it is
    refused, the page says so, and the link stays selectable to copy by hand.
  - **In production the Notification Platform delivers it** to the invited address, and the
    administrator never handles it (`ADR-ORG-007 §5.5`, a production gate). The panel goes when that
    delivery is built.
- **The acceptance page, `/invitations/accept`.** Any signed-in person reaches it, with no Tenant and
  in no particular scope. It stands alone, on the canvas of the signed-out entry, without the
  administration frame: the person accepting is often no administrator at all.
  - **The token leaves the address bar first.** The page's script reads it from `location.hash`,
    moves it to session storage, and removes the fragment with `history.replaceState`, which "modifies
    the current history entry" [R6] without loading anything. No later link, reload or sign-in
    `return_to` carries it.
  - **Across a sign-in.** A person who is not signed in is asked to sign in without choosing a Tenant,
    since they are not a member yet (`ADR-ORG-007 §5.6`). The token waits in session storage, which "is
    partitioned by both origin and browser tabs", and closing the tab "clears the data" [R4]. It is
    never in a URL the BFF sees. The sign-in returns to `/invitations/accept`, and the page resumes.
    Anywhere else in the application, a token waiting in the tab is offered as "continue to your
    invitation", so a sign-in that landed elsewhere is not a lost invitation.
  - **Before acceptance** the page says that the person has been invited to join a Tenant, who they
    are signed in as, and that only the person whose proven address the invitation was sent to can
    accept it. It names no Tenant. Before acceptance Organization Control discloses nothing about the
    invitation (SAD-004 §5.5, `ADR-ORG-007 §5.4`), and the page reads nothing to find out.
  - **Accept** sends the token in the body of `POST /api/v1/invitations/accept`, with an
    `Idempotency-Key` and the session's CSRF token. The BFF forwards the person's own session, with
    or without a Tenant, and its scope guard admits the route as a self command, carrying nothing of
    a provider window (`TDD-organization-experience-001` 1.10.0 §The Scope Guard).
  - **After acceptance** the page names the Tenant joined, from the person's own contexts by the
    invitation's `tenant_id` (`ADR-ORG-005`), and offers to open it. Opening it is a sign-in for that
    Tenant (`ADR-IAM-006 §5.2`), as an entry of the context switcher is.
  - **Each answer says what to do next:**

| Answer | The page says | The token in the tab |
| :-- | :-- | :-- |
| `200` | You joined the Tenant, named, with Open it | Forgotten |
| `invitation-not-acceptable` (`404`; 1.10.0: by its type) | This invitation cannot be accepted. It may have expired, been revoked or been used already, or it was sent to an email address your account has not proven. Ask whoever invited you. If it was sent to your address, prove that address in your account first, then open the link again | Forgotten |
| `409` | You could not join: the Tenant is not active, or you already hold this Membership, with the API's sentence | Forgotten |
| `503`, or no answer | Organization Control could not check the invitation. Nothing changed. Try again later, with Try again | Kept |
| `400` | The link is incomplete. Open it exactly as you received it, or ask for it again | Forgotten |
| `401` | The session ended: sign in again, and the page resumes | Kept |

  - **One sentence for every refusal of the invitation.** The API answers one refusal for an unknown,
    expired, revoked, used or mismatched token (`ADR-ORG-007 §5.4`), so the page cannot tell them apart
    and does not try. From 1.10.0 the page knows that refusal by its problem type,
    `https://problems.scnehaux.com/invitation-not-acceptable`, not by its status (§The Owner's
    Decisions of 2026-10-20, Served).
  - **Nothing is sent again behind the person's back.** Neither the page nor the BFF retries a refused
    acceptance (`ADR-ORG-007 §6`). Try again, after a `503`, is the person's own, and it resends the
    same request with the same `Idempotency-Key`.
  - **`Referrer-Policy: no-referrer`.** OWASP asks a page reached by a URL token to add "the Referrer
    Policy tag with the no-referrer value" [R2]. The BFF's pattern sets that header on every response
    (`TDD-identity-experience-001` §Security Headers), the page's included, so nothing is added here,
    and a test holds it on this page.
  - **The account application is named in words.** This application holds no link to
    identity-experience's account application, so the `404` sentence names it and links nothing.
  - **A person without an account (1.13.0, built; planned in 1.10.0).** `ADR-IAM-011` §5.1 and §5.6
    give this page one change: offer a person who is not signed in **I do not have an account**,
    which hands the token, in the fragment, to identity-experience's enrolment page. The page's address
    is decided by identity-experience (`TDD-identity-experience-001` 1.24.0 §Enrolment From an
    Invitation): `<identity-experience origin>/account/enrol#<token>`.
    - **The link.** Beside Sign in to accept, the signed-out page shows a link **I do not have an
      account**, with one sentence: the account is created with the address the invitation was sent
      to, proven with a code, and the person then opens the invitation link again and accepts. Its
      target is `<origin>/account/enrol#<encodeURIComponent(token)>`. The token is in the fragment
      alone, never the query: "the fragment identifier is separated from the rest of the URI prior to
      a dereference" [R3], so neither identity-experience's BFF nor any server receives it when the
      link is followed. The page sends nothing itself: it calls neither `POST /v1/enrolments` nor
      Organization Control's resolve route. Its only act is the link. The token stays in this tab's
      session storage, as before a sign-in, so opening the invitation link again resumes here.
    - **The origin is configuration.** identity-experience's origin differs per deployment, so it is
      not in the code or the build: "An app's config is everything that is likely to vary between
      deploys", and "the release stage takes the build produced by the build stage and combines it
      with the deploy's current config" [R9]. The BFF reads
      `ORGANIZATION_EXPERIENCE_IDENTITY_EXPERIENCE_ORIGIN` (`TDD-organization-experience-001` 1.15.0
      §Configuration) and serves it at `GET /auth/identity-experience`, anonymous, `no-store`, with no
      session read (`TDD-organization-experience-001` 1.15.0 §API / Interface). The page asks for it
      when it shows the signed-out form. While that answer is pending, or if it fails, the page offers
      Sign in to accept alone and never a link to a guessed address.
    - **The producers.** identity-control serves the enrolment (`POST /v1/enrolments`, `:verify`;
      identity-control ROADMAP item 17), through Organization Control's `POST /v1/invitations/resolve`
      (organization-control ROADMAP item 56), and identity-experience serves the page and its BFF
      routes. None of their interfaces is called from here, so no contract of theirs is vendored.
- **The invitation states.** `identity_verified` is gone (`ADR-ORG-007 §5.4`). An invitation is
  `pending`, `accepted`, `expired` or `revoked`. The filter and the labels lose it, and a pending
  invitation reads "nothing is granted until the invited person accepts, signed in as themselves".

### The Owner's Decisions of 2026-10-20, Served (1.10.0)

organization-control #75 (`6a36b8d`) served five decisions this console shows or sends. Each is
below with what the console does.

```text
Provider mode, window in force
GET   /api/v1/reporters                   ?reports&state&after&limit           the registry
POST  /api/v1/reporters                   {"principal_id", "reports", "purpose"}   Register reporter, 201
GET   /api/v1/reporters/{reporter_id}                                          read before retiring
POST  /api/v1/reporters/{reporter_id}/retire   {"expected_version"}            Retire reporter
POST  /api/v1/tenants/{tenant_id}/memberships/{membership_id}/suspend   {"expected_version"}
POST  /api/v1/tenants/{tenant_id}/memberships/{membership_id}/revoke    {"expected_version"}
GET   /api/v1/tenants/{tenant_id}/memberships/{membership_id}/enforcement    its evidence after
```

**Reporters (`ADR-ORG-001 §5.11`, `TDD-organization-control-001` 1.27.0 §Reporters).** The
provisioning system and each domain that owns offboarding obligations report as a workload
Principal registered for what it reports: `provisioning`, or `obligation:<domain>`. Organization
Control admits a workload on its own report routes alone, from its record, and no provider resolves an
obligation. Registering and retiring are provider commands, so the registry is a provider-mode surface,
`/reporters`.

- **The list** shows each reporter: its workload Principal, what it reports, its purpose, its state as
  a pill, its version, who registered it and when, and, for a retired one, who retired it and when. It
  filters by state and by what it reports, and pages by keyset.
- **Register reporter** takes the workload's Principal identifier, what it reports (`provisioning`, or
  `obligation:` and a domain of lowercase letters, digits and hyphens, the API's pattern), and its
  purpose, at most 500 characters. The confirmation opens in place, names the workload and what it
  will report, and takes a required reason: a registration admits a workload to report outcomes no
  person checks, so it is a named decision. It is the primary action.
- **A workload is registered once.** Organization Control keeps a retired reporter's row, and answers a
  second registration of the same Principal, active or retired, with `409 state-transition-refused`.
  The page says so in its own sentence, with the API's beside it: a retired workload is not registered
  again, and a new workload is created in identity-control and registered instead.
- **Retire reporter** is on each active reporter, in the danger variant, with a reason and what it
  reports typed to confirm. Retiring is final for that Principal, and its reports are refused from its
  next request. As every irreversible operation does (`TDD-organization-experience-001` §Irreversible
  Operations), the confirmation reads the reporter again with `GET /api/v1/reporters/{reporter_id}`
  and sends the version it read. A `409 version-conflict` is shown as one.
- **The workload itself is identity-control's.** The console registers an existing workload Principal;
  it creates no workload and no key (`ADR-IAM-003 §5.8`). On a development server organization-control's
  `scripts/dev-wire.ps1` step 6b registers the development reporters, and the page lists them.

**The reconciliation interval (`ADR-ORG-001 §5.7`, `TDD-organization-control-002` 1.16.0
§Reconciliation Interval).** Each consumer reconciles itself on an interval it declares at
registration, `reconciliation_interval_seconds`, from one minute to a week, one day when absent.
Registration stays the deployment procedure's (§Operator Transitions of the Other Machines), and that
procedure sends the interval with the rest of the owner's declaration.

- **Projection health shows the interval**, as served in the list, beside the reconciliation age.
- **A consumer late against its own interval is marked inline:** past one interval, a warning that
  its reconciliation is overdue; past two, a danger notice. These are the thresholds of
  organization-control's `ReconciliationOverdueWarning` and `ReconciliationOverdueCritical`. The age is
  still the service's `reconciliation_age_seconds`, so the page reads no clock of its own. A consumer
  never reconciled shows "never reconciled", as before, and no lateness: the age is absent until a
  first run.
- **`reconciliation_requested_at`**, nullable, is set by a restore bump and cleared by the consumer's
  next reconciliation (`TDD-organization-control-002` 1.16.0 §After a Restore to an Older Point). When
  set, the row says, as a warning, that a reconciliation was requested at that time after a restore
  and has not run since. Until the consumers' schedulers exist the restore runbook runs it as a
  provider; the console offers no run, as before.

**A provider withdraws one Membership (`ADR-ORG-003 §5.6`, amended 2026-10-21;
`TDD-organization-control-002` 1.19.0 §A Provider Withdraws One Membership).** A provider in force may suspend or revoke one Membership
inside a Tenant, to contain a withdrawal a restore lost or a compromised member.

- **Where.** On the Tenants page, each `active`, `suspended` or `offboarding` Tenant's row offers
  Withdraw a Membership. It opens in the row a form for the Membership's identifier and a reason.
  The other states hold no Membership a provider could withdraw.
- **The record is read first (1.12.0).** Until 1.12.0 the identifier and the version were typed,
  because Organization Control served a provider no read of a Tenant's Memberships. It now serves
  `GET /v1/tenants/{tenant_id}/memberships/{membership_id}` (`ADR-ORG-003 §5.6`, amended 2026-10-21,
  organization-control ROADMAP item 61), with the authority of the two withdrawals and no more.
  **Read the Membership** is always drawn; on submit it says what is missing, a UUID identifier or a
  reason as the reason field asks, and sends nothing until both are given (§Operator Transitions, [R1]).
  The read carries the operator's reason in `X-Administrative-Reason`, not the window's, because it is
  recorded as privileged access naming the Tenant, which its administrators read. It sends no
  `Idempotency-Key`: it is a safe `GET`. The identifier still comes from where the incident found it:
  a reconciliation finding, the Tenant administrator, or the runbook's record.
- **What the read shows.** The Principal, subject type, status, version and Workspace, as the Tenant's
  own Memberships page shows them. A `404`, for a Membership absent or in another Tenant, says no such
  Membership is in this Tenant beside the API's sentence, and offers nothing. Changing the identifier
  or the reason drops the record.
- **Suspend membership** and **Revoke membership** are drawn only as the record's state allows:
  both on an active Membership, Revoke alone on a suspended one, neither on a revoked one, which says
  nothing is left to withdraw. Each is in the danger variant, confirms in the row, names the Tenant
  and the Membership, requires a reason, offered filled with the one the read was made with and
  editable, and sends the `Idempotency-Key` and the `expected_version` the read returned, or the one
  the last withdrawal answered, with the window's correlation. Revoke says it cannot be undone. A
  stale version is answered `409 version-conflict`, shown as one, and nothing is retried.
- **Never grant or restore.** The API offers a provider neither, and the console offers no provider
  control for either. The confirmation says that the Tenant administrator restores a suspended
  Membership, once the incident allows.
- **After the answer** the row shows the Membership's new status and version and follows its
  enforcement through the provider read of it, accepted, propagating, enforced or over budget, as
  the Tenant's own surface does (§Revocation Presentation). The withdrawal is recorded as privileged
  access naming the Tenant, which its administrators read on their Provider access page (1.5.0).

**The acceptance branches on the problem type (`ADR-ORG-007 §5.4`, `TDD-organization-control-004`
1.15.0).** Until 1.10.0 the page read every `404` as the refused invitation. Organization Control now
answers that refusal with its own type, `https://problems.scnehaux.com/invitation-not-acceptable`, and
RFC 9457 makes the type, not the status, the identifier: "Consumers MUST use the "type" URI (after
resolution, if necessary) as the problem type's primary identifier" [R7].

- **The refusal sentence and forgetting the token follow the type.** An answer of that type, whatever
  its status, is the refused invitation: its sentence, and the token forgotten.
- **Any other `404` is not the invitation's answer.** A `404` of another type, such as a route the BFF
  or the API does not serve, is shown as the refusal it is, with its reference, and the token is kept,
  because the invitation was never judged.
- `409`, `400`, `401` and `503` are unchanged.

**An issued invitation without its token is a replay (`ADR-ORG-007 §5.5`, `STD-GLB-001` 1.7.0).**
Organization Control records the issue command's answer without `token`, so a retry with the same
`Idempotency-Key` answers `201` with the invitation alone.

- **The replay is shown as one.** A `201` without `token` shows the invitation as already issued, and
  says that its link was shown when it was first issued and cannot be shown again: revoke it and issue
  another to get a new link. It never shows an empty link.
- **A new key after each answer.** Until 1.10.0 the key followed the request's values alone, so issuing
  a second invitation to the same address with the same validity, after the first was answered, reused
  the first one's key. Organization Control then answered the first invitation again; before
  `STD-GLB-001` 1.7.0 withheld it, that answer carried the first token, and the page showed it again.
  The draft standard defines the key as what "the resource uses to recognize subsequent retries of the
  same request", and "The idempotency key MUST be unique and MUST NOT be reused with another request
  with a different request payload" [R8]. A second issue after an answer is a new request, not a
  retry. So every command in the console now takes a new key once it has been answered, success or
  refusal, and keeps it only while its outcome is unknown: no answer, a `5xx`, or
  `409 request-in-progress`, the cases a resend must be recognised as the same command (§Every
  mutation carries four things; `TDD-organization-experience-001` §Bulk Operations).
- **What it fixes elsewhere.** The same rule makes Replay on a dead letter send a second replay when
  pressed twice, rather than answer the first again.

| # | Source |
| :-- | :-- |
| R1 | GOV.UK Design System, *Button*, "Disabled buttons", <https://design-system.service.gov.uk/components/button/>, accessed 2026-10-19: "Disabled buttons have poor contrast and can confuse some users, so avoid them if possible." |
| R2 | OWASP, *Forgot Password Cheat Sheet*, §URL Tokens, <https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html>, accessed 2026-10-19 (as ADR-ORG-007 [R7] quotes it): "Ensure that the reset password page adds the Referrer Policy tag with the no-referrer value"; tokens are "Single use and expire after an appropriate period." (1.8.0) |
| R3 | IETF, RFC 3986, *Uniform Resource Identifier (URI): Generic Syntax*, §3.5 Fragment, <https://www.rfc-editor.org/rfc/rfc3986#section-3.5>, accessed 2026-10-19: "the fragment identifier is not used in the scheme-specific processing of a URI; instead, the fragment identifier is separated from the rest of the URI prior to a dereference" (1.8.0) |
| R4 | MDN, *Window: sessionStorage property*, <https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage>, accessed 2026-10-19: "while localStorage is partitioned by origin only, sessionStorage is partitioned by both origin and browser tabs (top-level browsing contexts)."; "A page session lasts as long as the tab or the browser is open, and survives over page reloads and restores."; "Closing the tab/window ends the session and clears the data in sessionStorage." (1.8.0) |
| R5 | MDN, *Clipboard: writeText() method*, <https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText>, accessed 2026-10-19: "Writing to the clipboard can only be done in a secure context." (1.8.0) |
| R6 | MDN, *History: replaceState() method*, <https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState>, accessed 2026-10-19: "The replaceState() method of the History interface modifies the current history entry, replacing it with the state object and URL passed in the method parameters."; "The new URL must be of the same origin as the current URL" (1.8.0) |
| R7 | IETF, RFC 9457, *Problem Details for HTTP APIs*, §3.1.1 "type" and §3.1.4 "detail", <https://www.rfc-editor.org/rfc/rfc9457.html>, accessed 2026-10-21: "Consumers MUST use the "type" URI (after resolution, if necessary) as the problem type's primary identifier."; "Consumers SHOULD NOT parse the "detail" member for information" (1.10.0) |
| R8 | IETF HTTPAPI Working Group, *The Idempotency-Key HTTP Header Field*, draft-ietf-httpapi-idempotency-key-header-07, §2 and §2.2, <https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-07>, accessed 2026-10-21 (as `STD-GLB-001` [R10] cites it): "An idempotency key is a unique value generated by the client which the resource uses to recognize subsequent retries of the same request."; "The idempotency key MUST be unique and MUST NOT be reused with another request with a different request payload." (1.10.0) |
| R9 | *The Twelve-Factor App*, §III Config, <https://12factor.net/config>, and §V Build, release, run, <https://12factor.net/build-release-run>, accessed 2026-10-21: "An app's config is everything that is likely to vary between deploys (staging, production, developer environments, etc)."; "The twelve-factor app stores config in environment variables"; "The release stage takes the build produced by the build stage and combines it with the deploy's current config." (1.13.0) |

## Algorithms / Logic

### Tenant States Are Rendered Individually

```text
requested       Awaiting provisioning. Membership cannot be granted yet. Start provisioning (1.6.0)
provisioning    Provisioning in progress, with the correlation identifier
unresolved      Provisioning outcome unknown. Do not retry; how it is resolved (1.6.0)
failed          Provisioning refused, with the reason. Retry provisioning (1.6.0)
active          Usable
suspended       Access stopped for every Membership in this Tenant
```

`unresolved` renders with no retry control and an explanation (1.6.0: offered nowhere, rather than
disabled, §The Interface as Served). It is the state most likely to be mistaken for failure, and the
mistake provisions the Tenant twice.

Activation is a deliberate action, not an automatic consequence of provisioning
succeeding. The interface shows the gate and who may pass it, matching the explicit
`:activate` transition in `TDD-organization-control-003`.

### Operator Transitions (1.6.0)

Rendering each state honestly (above) did not make each state reachable. Until 1.6.0 a Tenant
requested here could not leave `requested`: no action sent the dispatch, and none sent the retry the
table above promised. This table closes that class of gap. It lists every transition of
`TDD-organization-control-003` §Tenant State Machine, creation included, who drives it, the route,
and the console's action for it, or `None` with the reason.

| From | To | Driven by | Route | Console action |
| :-- | :-- | :-- | :-- | :-- |
| `new` | `requested` | operator | `POST /v1/tenants` | Request tenant |
| `requested` | `provisioning` | operator | `POST /v1/tenants/{id}/provisioning` | Start provisioning |
| `provisioning` | `failed` | provisioning system | `POST /v1/provisioning/failed` | None: the provisioning system reports it. On a development server, organization-control's `scripts/dev-provisioning.ps1` |
| `failed` | `provisioning` | operator | `POST /v1/tenants/{id}/provisioning` | Retry provisioning |
| `provisioning` | `active` | operator | `POST /v1/tenants/{id}/activate` | Activate |
| `active` | `suspended` | operator | `POST /v1/tenants/{id}/suspend` | Suspend |
| `suspended` | `active` | operator | `POST /v1/tenants/{id}/restore` | Restore |
| `active` | `offboarding` | operator | `POST /v1/offboardings` | Begin offboarding |
| `suspended` | `offboarding` | operator | `POST /v1/offboardings` | Begin offboarding |
| `offboarding` | `active` | operator | `POST /v1/offboardings/{id}/cancel` | Cancel this offboarding |
| `offboarding` | `suspended` | operator | `POST /v1/offboardings/{id}/cancel` | Cancel this offboarding |
| `offboarding` | `retired` | operator | `POST /v1/offboardings/{id}/retire` | Retire |

- The first seven actions are on the Tenants page. Begin offboarding is on the Tenants page too; the
  cancellation and the retirement are on the offboarding's page (`TDD-organization-experience-003`).
- A provisioning system's realized report changes the request, not the Tenant's status, unless it
  arrives before the dispatch; then it moves `requested -> provisioning` itself
  (`TDD-organization-control-003` §Provisioning Correlation). The console does not report outcomes.
- `apps/admin/src/features/tenantTransitions.ts` holds the same table as code, and its test fails
  when the machine has an edge with no row, when an operator row names no action, or when this table
  and the code disagree (§Testing Strategy).

### Operator Transitions of the Other Machines (1.7.0)

The same table as §Operator Transitions, for each other machine these surfaces show. Each row is a
transition its organization-control design declares, who drives it, the route, and the console's
action, or `None` with the reason. `apps/admin/src/features/transitions.ts` holds the same tables as
code, and `transitions.test.ts` fails when a machine has an edge with no row, when an operator row
names no action, or when a table here and the code disagree. The offboarding machines are in
`TDD-organization-experience-003` 1.5.0 §Operator Transitions.

#### Tenant Administration Grant

`TDD-organization-control-001` §The Tenant Administration Grant, `ADR-ORG-003`.

| From | To | Driven by | Route | Console action |
| :-- | :-- | :-- | :-- | :-- |
| `new` | `active` | operator | `POST /v1/tenants/{id}/administrators` | Grant administrator |
| `active` | `revoked` | operator | `POST /v1/tenants/{id}/administrators/{grant_id}/revoke` | Revoke administrator |

#### Provider Grant

`TDD-organization-control-001` §Caller Authority, `ADR-ORG-002 §5.1`, §5.2. An activation of an
eligible grant is its own machine, served by the approval surface (1.2.0).

| From | To | Driven by | Route | Console action |
| :-- | :-- | :-- | :-- | :-- |
| `new` | `eligible` | operator | `POST /v1/provider-grants` | Grant provider access |
| `new` | `emergency` | operator | `POST /v1/provider-grants` | Grant provider access |
| `eligible` | `revoked` | operator | `POST /v1/provider-grants/{grant_id}/revoke` | Revoke grant |
| `emergency` | `revoked` | operator | `POST /v1/provider-grants/{grant_id}/revoke` | Revoke grant |

The first grant of a database is the bootstrap command's (`bootstrap-provider`, organization-control
`deploy/dev/README.md` §One-off tasks), once, before any provider can use the console.

#### Projection Consumer

`TDD-organization-control-002` §Consumer Registry.

| From | To | Driven by | Route | Console action |
| :-- | :-- | :-- | :-- | :-- |
| `new` | `active` | deployment procedure | `POST /v1/projections/consumers` | None: a consumer is registered with the declaration its owner wrote (`ADR-ORG-001 §5.7`), by the procedure that deploys it (organization-control `scripts/dev-wire.ps1`, §Wiring step 4), with its `reconciliation_interval_seconds` (1.10.0). Registering again replaces the subscription and clears the snapshot mark, so it stays with that procedure |
| `active` | `retired` | operator | `POST /v1/projections/consumers/{id}/retire` | Retire consumer |

#### Dead Letter

`TDD-organization-control-005` §API / Interface, §WAIVED. The incident is one event at one consumer.

| From | To | Driven by | Route | Console action |
| :-- | :-- | :-- | :-- | :-- |
| `new` | `open` | service | the delivery dispatcher, after its attempts | None: Organization Control dead-letters a delivery its consumer kept refusing |
| `open` | `open` | operator | `POST /v1/dead-letters/{event_id}/consumers/{consumer}/replay` | Replay |
| `open` | `resolved` | operator | `POST /v1/dead-letters/{event_id}/consumers/{consumer}/resolve` | Resolve as replayed; Resolve as superseded |
| `open` | `waived` | operator | `POST /v1/dead-letters/{event_id}/consumers/{consumer}/waive` | Waive |
| `waived` | `resolved` | operator | `POST /v1/dead-letters/{event_id}/consumers/{consumer}/resolve` | Resolve as replayed; Resolve as superseded |
| `waived` | `open` | service | none: `waived_until` passes | None: a waiver expires on its own, and the incident alerts again |

#### Tenant-Administration Pause

`ADR-ORG-003 §5.5`, `TDD-organization-control-001` §Pausing Tenant Administration.

| From | To | Driven by | Route | Console action |
| :-- | :-- | :-- | :-- | :-- |
| `new` | `paused` | restore procedure | `deploy/dev/restore.sh` with `PAUSE_REASON` | None: recorded in the restored database before the service serves, naming no actor |
| `unpaused` | `paused` | operator | `POST /v1/tenant-administration-pause` | Pause Tenant administration |
| `paused` | `unpaused` | operator | `POST /v1/tenant-administration-pause` | Lift the pause |

#### Reporter

`TDD-organization-control-001` 1.27.0 §Reporters, `ADR-ORG-001 §5.11` (1.10.0). A retired reporter
stays retired: its Principal is never registered again.

| From | To | Driven by | Route | Console action |
| :-- | :-- | :-- | :-- | :-- |
| `new` | `active` | operator | `POST /v1/reporters` | Register reporter |
| `active` | `retired` | operator | `POST /v1/reporters/{reporter_id}/retire` | Retire reporter |

#### Membership

`TDD-organization-control-002` §Algorithms and `internal/membership` there: grant, suspend, restore
and revoke; a revoked Membership is final (1.10.0). A Tenant administrator drives every edge on the
Memberships page. A provider drives the two withdrawals, and nothing else, on the Tenants page
(`ADR-ORG-003 §5.6`). The invited person's acceptance also creates a Membership, as a self command on
the acceptance page (1.8.0).

| From | To | Driven by | Route | Console action |
| :-- | :-- | :-- | :-- | :-- |
| `new` | `active` | operator | `POST /v1/memberships` | Grant membership |
| `active` | `suspended` | operator | `POST /v1/memberships/{id}/suspend`; `POST /v1/tenants/{tenant_id}/memberships/{id}/suspend` | Suspend; Suspend membership |
| `suspended` | `active` | operator | `POST /v1/memberships/{id}/restore` | Restore |
| `active` | `revoked` | operator | `POST /v1/memberships/{id}/revoke`; `POST /v1/tenants/{tenant_id}/memberships/{id}/revoke` | Revoke; Revoke membership |
| `suspended` | `revoked` | operator | `POST /v1/memberships/{id}/revoke`; `POST /v1/tenants/{tenant_id}/memberships/{id}/revoke` | Revoke; Revoke membership |

### Membership Grant Has Two Paths

```text
direct grant     the Principal already exists; Membership is created immediately
invitation       Membership exists only once the invited person accepts, signed in
                 as themselves, holding the invited address proven (1.8.0)
```

The invitation path renders as pending until it is accepted. It never renders as
"granted" on send, because possession of an invitation proves nothing (SAD-004 §5.5). Until
1.8.0 the join was of two facts recorded apart, a verification and an acceptance. `ADR-ORG-007`
checks both in the one acceptance, so the pending state is the only one before `accepted`.

A pending invitation shows its expiry as a countdown. An invitation that expires
unaccepted is a common outcome and the administrator who sent it is the only person who
will notice.

### Revocation Presentation

Inherited unchanged from `TDD-organization-experience-001`: accepted, propagating,
enforced, or over budget. Never "revoked" on a 202.

The same applies to suspension, because suspension propagates through the same
mechanisms and has the same enforcement interval.

### Organization Retirement Refusal

`TDD-organization-control-003` refuses to retire an Organization holding non-retired
Tenants and names them. The interface renders the named Tenants as links, so the
operator reaches them rather than searching for them.

A refusal that lists twelve Tenants and no way to reach them is a refusal the operator
works around.

### Context Switching

An operator holding Membership in many Tenants switches through a fresh authorization
request on the existing SSO session, per the baseline in
`TDD-identity-experience-001`.

```text
switch(tenant):
    confirm if unsaved work exists on the current view
    redirect through the authorization endpoint
    return with a token carrying exactly one context
    reload the view in the new context
```

The full Membership set is fetched from the context API, never read from a token. That
is the property that keeps token size independent of how many client relationships an
operator holds, and the interface must not defeat it by asking for a token that carries
them all.

### The Picker After Sign-In (1.9.0)

A person signs in without a Tenant and then chooses one (`TDD-organization-experience-001` 1.11.0
§The Sign-In Entry, which holds the decision and its sources). This is the surface.

**The overview of a session without a Tenant** has, in order:
1. **Your Tenants**, the person's own contexts, read for themselves (`ADR-ORG-005 §5.1`).
   - Each entry is the Tenant's display name as a link, then whether the person administers it or is
     a member, and the Workspace of a Workspace-scoped Membership (`ADR-ORG-005 §5.2`).
   - The link is `/auth/login?tenant=<tenant_id>&return_to=/`. Following it is the Tenant sign-in.
2. **Provider administration:** a sentence on what provider mode is, and a link to `/provider-mode`.
   - That page holds the provider mode form, or the open window with its one action.
   - A window open in the session comes first on the overview instead, as before 1.9.0.

**What the list says in each case:**

| Contexts | The overview shows |
| :-- | :-- |
| Several | Every one, paged with Show more. None is chosen for the person |
| One | That one, as a link. It is not entered by itself |
| None | "You hold no active membership in an active Tenant", and that a Tenant administrator invites a person, who opens the link they are sent |
| Not readable | Why, as every list says it: the API's refusal with its reference, or that Organization Control could not be reached |

**A Tenant surface reached without a Tenant** says it belongs to a Tenant scope and lists the person's
Tenants under that sentence. Each link returns to the surface, so a bookmark or a link to
`/memberships` ends in that Tenant's Memberships after one choice.

**In a Tenant scope** the overview lists the same Tenants with the current one marked, as 1.3.0 built
it, and offers Switch to provider administration. The identifier field goes from there too.

**Sign-in failure.** A Tenant sign-in the kernel or the callback refused lands on the overview with
`?sign-in=failed`, and the BFF keeps the session it had. The person sees the refusal notice above the
same list and chooses again.

### Projection Health

Renders the consumer registry: who is registered, their declared freshness budget,
their stale behavior, their last reported mark, and their reconciliation age.

The reconciliation age is when Organization Control last reconciled the consumer, how long ago as
the service computed it, and how many findings the run reported (1.4.0). A consumer the service has
not yet reconciled carries none of these fields and renders as "never reconciled".

Each consumer also shows the interval it declared, and is marked overdue past one interval and
critically overdue past two, and shows a reconciliation a restore requested and no run has cleared
(1.10.0, §The Owner's Decisions of 2026-10-20, Served).

A consumer past its declared budget renders as stale with its policy shown, because
`use_with_marker`, `revalidate`, and `fail_closed` produce materially different
consequences and an operator triaging an incident needs to know which applies.

An `extra` reconciliation finding renders as a security finding, matching how
`TDD-organization-control-002` classifies it.

## Configuration

| Variable | Default | Purpose |
| :-- | :-- | :-- |
| `ORGANIZATION_EXPERIENCE_LIST_PAGE` | `50` | Rows per page |
| `ORGANIZATION_EXPERIENCE_CONTEXT_LIST_PAGE` | `100` | Contexts per page in the switcher |

## Testing Strategy

### As Served (1.2.0)

- Each list pages by `after` and `next`, and a filter change returns to the first page.
- Every mutation sends an `Idempotency-Key`, the record's `expected_version`, and a reason where one
  is required. Resubmitting the same values reuses the key.
- A `409 version-conflict` shows the record's current state beside what was acted on, and nothing
  is retried.
- A revocation is shown as accepted, with its time, and never as enforced.
- The approval surface lists pending activations and decides with a reason. It never offers the
  operator their own request.

### Provider-Access Review (1.5.0)

- The unreviewed list renders each Principal with its counts and due date, and an overdue one as
  overdue. The operator's own Principal renders as theirs, with no review control.
- A Principal's accesses read with the filters set, page by `next`, and render an emergency use and
  an access across Tenants as such.
- Recording a review sends `actor_id`, the period, the outcome, the statement as
  `X-Administrative-Reason`, an `Idempotency-Key` and the CSRF token, and shows the counts the API
  answered. A missing statement is refused before sending, and a refusal shows the API's sentence.
- The Tenant's page lists its provider access with the authority filter and says what it leaves out.
- Both pages pass axe-core's WCAG 2.2 A and AA rules with a row of data.

### Lifecycle Rendering

- `requested`, `provisioning`, `unresolved`, `failed`, `active`, and `suspended` each
  render distinctly.
- `unresolved` offers no retry, explains why, and says how it is resolved (1.6.0).
- A `requested` Tenant offers Start provisioning, and a `failed` one Retry provisioning, each a
  confirmation in the row naming the Tenant, sending `expected_version`, an `Idempotency-Key` and the
  reason to `POST /api/v1/tenants/{id}/provisioning`. No other state offers either (1.6.0).
- Every provisioning state shows its correlation identifier (1.6.0).
- Every transition of `TDD-organization-control-003` §Tenant State Machine has a row in
  §Operator Transitions, and every operator-driven row names its action. A test over
  `tenantTransitions.ts` fails on a missing row, a missing action, or a row that disagrees with the
  table in this document (1.6.0).
- The fixture-backed browser tests render a `requested` Tenant with an `unresolved` request and open
  Start provisioning, in both themes, with a screenshot and axe-core's WCAG 2.2 A and AA rules (1.6.0).
- Every transition of the machines in §Operator Transitions of the Other Machines has a row there,
  and every operator-driven row names its action; `transitions.test.ts` fails otherwise (1.7.0).
- An `active` Tenant's administrators open on request; Grant administrator sends the Principal, an
  `Idempotency-Key`, the reason and the CSRF token to `POST /api/v1/tenants/{id}/administrators` and
  shows whether a Membership was created; it is offered on an `active` Tenant only. Revoke
  administrator requires a reason (1.7.0).
- Membership cannot be granted into a Tenant that is not `active`, and the control is
  disabled with the reason shown.
- Activation is an explicit action and does not occur automatically.

### Invitation

- A sent invitation renders as pending, never as granted.
- Expiry renders as a countdown.
- An expired invitation renders as expired without an accept control.
- No state filter or label names `identity_verified` (1.8.0).
- Issuing shows `https://<origin>/invitations/accept#<token>` once, with Copy link and the sentence
  that the administrator sends it; Done removes it, and nothing else shows the token again (1.8.0).
- The acceptance page takes the token from the fragment, clears the fragment from the address bar,
  and sends the token only in the body of `POST /api/v1/invitations/accept`, with an
  `Idempotency-Key` and the CSRF token. No request the page makes carries it in a URL (1.8.0).
- Signed out, the page keeps the token in session storage, offers a sign-in with no Tenant that
  returns to `/invitations/accept`, and resumes after it (1.8.0).
- A success names the Tenant from the person's contexts and offers its sign-in; `404`, `409`, `503`
  and `400` each render their own sentence; the token is forgotten after `200`, `404`, `409` and
  `400` and kept after `503` (1.8.0).
- The page response carries `Referrer-Policy: no-referrer` (1.8.0).
- Signed out, the page offers **I do not have an account**, a link to
  `<identity-experience origin>/account/enrol#<encodeURIComponent(token)>` with the origin from
  `GET /auth/identity-experience`; the token is in the fragment and never the query; no request the page
  makes carries it; without that answer the page offers no such link (1.13.0).
- In Chromium, following the link sends identity-experience's origin a request for `/account/enrol`
  with no token in it, and the browser holds the token in the fragment alone (1.13.0).
- The signed-out page with the link is in the browser screens and the layout widths, 320 CSS px
  included, with a screenshot and axe-core's WCAG 2.2 A and AA rules (1.13.0).
- The stack proof enrols a person invited with no account: identity-control's `POST /v1/enrolments`
  from a registered enrolment caller with `Forwarded`, the code read from the mail catcher, `:verify`
  answering the temporary password, then the new person's sign-in and acceptance here (1.13.0).
- The fixture-backed browser tests show the issued link, and the page accepted, refused and
  unavailable, in both themes, with a screenshot and axe-core's WCAG 2.2 A and AA rules (1.8.0).

### Refusals

- The Organization retirement refusal renders the named Tenants as reachable links.
- A version conflict renders as a conflict with the current value, not as a generic
  error.

### Context

- The full Membership set is fetched from the context API, and no view reads it from a
  token.
- A switch to a Tenant without active Membership is refused and surfaced.
- After a switch, the view reloads in the new context and shows it in the scope banner.
- Signed in without a Tenant, the overview lists the person's contexts before anything else, with
  one, several and none, and with a list that could not be read; each entry links to
  `/auth/login?tenant=` returning to the page, and nothing navigates without the person (1.9.0).
- No surface has a Tenant identifier field for a sign-in (1.9.0).
- A Tenant surface reached without a Tenant lists the person's contexts, each returning to it (1.9.0).
- The fixture-backed browser tests show the signed-out entry, the picker with one, several and no
  contexts, and the provider mode page, in both themes, with a screenshot and axe-core's WCAG 2.2 A
  and AA rules (1.9.0).

### Projection Health

- A consumer past its budget renders as stale with its stale behavior shown.
- An `extra` finding renders as a security finding.
- A reconciled consumer shows its reconciliation age and its findings count; a clean run shows no
  findings (1.4.0).
- A consumer without the reconciliation fields renders as "never reconciled", with no age and no
  count (1.4.0).
- A consumer's dead letters open on request, filtered by state. Replay is offered for an active
  consumer and Waive for a retired one, never both; Waive sends the reason and the expiry; Resolve
  sends its `resolution_type`. A replay's answer says the incident is still open (1.7.0).
- Retire consumer requires a reason and the consumer's identifier typed, and is offered on an active
  consumer only (1.7.0).
- The pause renders paused or not, with who, when and why; Lift the pause and Pause Tenant
  administration each require a reason and send `{"paused": false}` or `{"paused": true}` (1.7.0).

### The Owner's Decisions of 2026-10-20 (1.10.0)

- The reporters list each reporter with what it reports, its state, version and registration, and
  filters by state and reports. Register reporter sends `principal_id`, `reports` and `purpose` with a
  required reason and an `Idempotency-Key`; an obligation reporter's domain is checked against the
  API's pattern before sending; a `409` for a Principal already registered shows the page's sentence
  and the API's. Retire reporter reads the reporter first, sends the version it read, and needs a
  reason and the reports value typed. Neither is offered where the API would refuse it.
- Projection health shows each consumer's interval, marks it overdue past one interval and critically
  past two, and shows `reconciliation_requested_at` when set and nothing when null.
- On an `active`, `suspended` or `offboarding` Tenant, Withdraw a Membership reads nothing until a UUID
  and a reason are given, then sends `GET /api/v1/tenants/{tenant_id}/memberships/{id}` with that
  reason and no `Idempotency-Key`, and asks for no version (1.12.0). It draws Suspend membership and
  Revoke membership on an active Membership, Revoke alone on a suspended one, and neither on a revoked
  one or after a `404`. Each confirms in the row with the Tenant named and the read's reason offered,
  and sends `POST /api/v1/tenants/{tenant_id}/memberships/{id}/suspend|revoke` with the
  `expected_version` read, the reason and an `Idempotency-Key`; it then follows the provider
  enforcement read. No provider control grants or restores a Membership (`decisions.test.tsx`).
- The acceptance page shows the refused-invitation sentence for the `invitation-not-acceptable` type,
  and forgets the token; a `404` of another type keeps it and shows the API's refusal.
- An issue answered `201` without `token` shows the invitation as already issued, and no link. Issuing
  the same values again after an answer sends a new `Idempotency-Key`; after a `503` or no answer it
  resends the same one.
- `transitions.test.ts` holds the Reporter and Membership tables as it holds the others.
- The fixture-backed browser tests show the reporters page with Register reporter open, a Tenant's
  Withdraw a Membership confirmation, and projection health with a consumer overdue and one with a
  requested reconciliation, in both themes, with a screenshot and axe-core's WCAG 2.2 A and AA rules.

### Provider Grants (1.7.0)

- The grants list each holder, scope, kind and revocation. Grant provider access sends the Principal,
  the scope and the kind; choosing emergency draws the confirmation in the danger scheme. Revoke grant
  requires a reason, and a refusal of the last grant shows the API's sentence.
- The fixture-backed browser tests open Grant administrator, a consumer's dead letters, Lift the pause
  and Grant provider access, in both themes, with a screenshot and axe-core's WCAG 2.2 A and AA rules.

## Security Notes

Every guard rendered here is enforced by the Organization Control API. The interface
disables a control the API would refuse so an operator does not attempt it, and the API
refuses it anyway if they do. STD-IAM-001 §3.9 is explicit that user-interface
authorization is defence in depth only.

Rendering `unresolved` as its own state is a security-relevant choice rather than a
usability one. An operator who reads it as failure retries, and a retried provisioning
whose first attempt actually succeeded produces two Tenants where the isolation model
assumed one.

## Performance Notes

Every list is paged and served from projections. The context API is called on switch and
on demand, never per row render.

## Operational Notes

| Signal | Warning | Critical |
| :-- | :-- | :-- |
| Tenants held in `unresolved` | any occurrence | over 24 hours |
| Invitations expiring unaccepted | above baseline | — |
| Context switch refusals | above baseline | — |
| Consumers rendered stale | any occurrence | consumer stale policy exceeded |

Runbooks required before production: unresolved provisioning triage and stale consumer
investigation.

## Traceability

| Relationship | Target |
| :-- | :-- |
| Parent system | SAD-012 — Scnehaux Organization Experience |
| Realizes capability | PAD-PLT-002 — Organization & Tenancy Platform |
| Conforms to | `TDD-organization-experience-001` — scope, bulk, freshness, confirmation |
| Conforms to | `TDD-identity-experience-001` — BFF session and containment |
| Conforms to | STD-IAM-001 §3.3 — the Membership set is never placed in a token |
| Depends on | `TDD-organization-control-003` — Tenant, Organization, and Workspace lifecycle |
| Depends on | `TDD-organization-control-004` — the invitation join, and from `ADR-ORG-007` acceptance as a self command (1.8.0) |
| Governed by | ADR-ORG-007 §5.5, §5.6 — the link shown once on issue, and the acceptance page for a person with no Tenant (1.8.0) |
| Governed by | ADR-ORG-005 — the person's own contexts, which name the Tenant joined (1.8.0) |
| Governed by | ADR-IAM-006 §5.2 — opening the Tenant joined is a sign-in for it (1.8.0) |
| Governed by | ADR-ORG-005 §5.1–§5.3 — the picker after a sign-in without a Tenant, and no identifier field (1.9.0) |
| Conforms to | `TDD-organization-experience-001` 1.11.0 §The Sign-In Entry — the neutral sign-in, the provider sign-in apart, and why the identifier field goes (1.9.0) |
| Depends on | `TDD-organization-control-002` — Membership, revocation, projection health |
| Depends on | `TDD-organization-control-002` 1.13.0 §The Consumer List — the consumer's last reconciliation and its age (1.4.0) |
| Conforms to | STD-GLB-001 §Pagination — keyset paging, no offsets (1.2.0) |
| Conforms to | STD-GLB-FE-001 §Technology Stack — server state through TanStack Query (1.2.0) |
| Governed by | ADR-ORG-002 — an activation approved by another provider (1.2.0) |
| Governed by | ADR-ORG-002 §5.6 — the privileged-access record read and reviewed (1.5.0) |
| Depends on | `TDD-organization-control-001` 1.21.0 §Privileged Access Review — the routes this review reads and writes (1.5.0) |
| Conforms to | STD-GLB-001 1.6.0 §Pagination — the time window, `from` inclusive and `to` exclusive (1.5.0) |
| Depends on | `TDD-organization-control-003` 1.15.0 §Resolving an `unresolved` Request, §The Provisioning System on a Development Server — starting, retrying and resolving provisioning (1.6.0) |
| Follows | GOV.UK Design System, Button, "Disabled buttons" — no disabled retry control (1.6.0) |
| Governed by | ADR-ORG-003 §5.2, §5.5 — a provider grants and revokes a Tenant administrator, and pauses and lifts Tenant administration (1.7.0) |
| Governed by | ADR-ORG-002 §5.1, §5.2 — eligible and emergency provider grants, made and revoked by a provider with a reason (1.7.0) |
| Depends on | `TDD-organization-control-001` §The Tenant Administration Grant, §Pausing Tenant Administration — the grant, list, revoke and pause routes (1.7.0) |
| Depends on | `TDD-organization-control-005` 2.5.0 §Listing a consumer's dead letters, §API / Interface — the dead-letter list, replay, resolve and waive (1.7.0) |
| Depends on | `TDD-organization-control-002` §Consumer Registry — retiring a consumer (1.7.0) |
| Governed by | ADR-ORG-001 §5.11 — reporters, registered and retired by a provider (1.10.0) |
| Depends on | `TDD-organization-control-001` 1.27.0 §Reporters — the reporter routes (1.10.0) |
| Governed by | ADR-ORG-001 §5.7 — the consumer reconciles itself on its declared interval (1.10.0) |
| Depends on | `TDD-organization-control-002` 1.16.0 §Reconciliation Interval, §After a Restore to an Older Point, §A Provider Withdraws One Membership (1.10.0) |
| Governed by | ADR-ORG-003 §5.6 — a provider suspends or revokes one Membership, never grants or restores (1.10.0) |
| Governed by | ADR-ORG-003 §5.6 (amended 2026-10-21) — the provider reads the one Membership first, with a reason (1.12.0) |
| Depends on | `TDD-organization-control-002` 1.19.0 §A Provider Withdraws One Membership — `GET /v1/tenants/{tenant_id}/memberships/{membership_id}` (1.12.0) |
| Depends on | `TDD-organization-control-004` 1.15.0 — the refusal type and the issue answer without its token (1.10.0) |
| Conforms to | RFC 9457 §3.1.1 — a client branches on the problem type (1.10.0) |
| Governed by | ADR-IAM-011 §5.1, §5.6 — the acceptance page's **I do not have an account**, accepted 2026-10-20, planned (1.10.0); §5.7 as amended 2026-10-21: waits on identity-control ROADMAP item 17 and organization-control item 56 (1.11.0) |
| Governed by | ADR-IAM-011 §5.1, §5.6 — **I do not have an account**, built: the token handed in the fragment to identity-experience's enrolment page (1.13.0) |
| Depends on | `TDD-identity-experience-001` 1.24.0 §Enrolment From an Invitation — the enrolment page at `/account/enrol#<token>` (1.13.0) |
| Conforms to | RFC 3986 §3.5 — the fragment is not sent on a dereference (1.13.0) |
| Conforms to | draft-ietf-httpapi-idempotency-key-header-07 §2, §2.2; STD-GLB-001 1.7.0 — a key per request, new after an answer (1.10.0) |
