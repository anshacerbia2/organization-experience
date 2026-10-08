---
doc_meta:
  id: TDD-organization-experience-002
  title: Organization, Tenant, Workspace, and Membership Administration Surfaces
  owner: Core Platform Team
  version: 1.4.0
  status: approved
  classification: restricted
  review_cycle_days: 90
  created_date: 2026-08-11
  last_reviewed: 2026-10-07
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
- Membership grant, suspend, revoke, restore, and the invitation path.
- Context switching for operators holding many Memberships.
- Projection consumer health.

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
| Membership granted by invitation | "Granted" | Nothing exists until identity is verified |

Each is rendered as its own state here, with the consequence stated.

## Component Design

| Component | Responsibility |
| :-- | :-- |
| `OrganizationRegistry` | Organization list, detail, external references, relationships |
| `TenantLifecyclePanel` | State, provisioning correlation, activation gate |
| `WorkspaceManager` | Workspace list and lifecycle within one Tenant |
| `MembershipAdmin` | Grant, suspend, revoke, restore, and the invitation path |
| `ContextSwitcher` | Operator's eligible contexts and the switch |
| `ProjectionHealth` | Consumer registry, freshness, reconciliation status |

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
| `Idempotency-Key` | Generated in the browser, one per distinct request. Resubmitting the same values after an outage reuses it, so the API answers with what the first attempt did. A changed value is a new request with a new key. The BFF forwards it, as identity-experience's does |
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
    again at use. The identifier field remains for a deep link.
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

## Algorithms / Logic

### Tenant States Are Rendered Individually

```text
requested       Awaiting provisioning. Membership cannot be granted yet
provisioning    Provisioning in progress, with the correlation identifier
unresolved      Provisioning outcome unknown. Do not retry; awaiting reconciliation
failed          Provisioning refused, with the reason. Retry is available
active          Usable
suspended       Access stopped for every Membership in this Tenant
```

`unresolved` renders with the retry control **disabled** and an explanation. It is the
state most likely to be mistaken for failure, and the mistake provisions the Tenant
twice.

Activation is a deliberate action, not an automatic consequence of provisioning
succeeding. The interface shows the gate and who may pass it, matching the explicit
`:activate` transition in `TDD-organization-control-003`.

### Membership Grant Has Two Paths

```text
direct grant     the Principal already exists; Membership is created immediately
invitation       the Principal may not exist; Membership exists only after
                 identity verification completes
```

The invitation path renders as pending until both facts hold. It never renders as
"granted" on send, because `TDD-organization-control-004` is explicit that possession
of an invitation proves nothing and Membership activates on the join of two independent
facts.

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

### Projection Health

Renders the consumer registry: who is registered, their declared freshness budget,
their stale behavior, their last reported mark, and their reconciliation age.

The reconciliation age is when Organization Control last reconciled the consumer, how long ago as
the service computed it, and how many findings the run reported (1.4.0). A consumer the service has
not yet reconciled carries none of these fields and renders as "never reconciled".

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

### Lifecycle Rendering

- `requested`, `provisioning`, `unresolved`, `failed`, `active`, and `suspended` each
  render distinctly.
- `unresolved` disables retry and explains why.
- Membership cannot be granted into a Tenant that is not `active`, and the control is
  disabled with the reason shown.
- Activation is an explicit action and does not occur automatically.

### Invitation

- A sent invitation renders as pending, never as granted.
- Expiry renders as a countdown.
- An expired invitation renders as expired without an accept control.

### Refusals

- The Organization retirement refusal renders the named Tenants as reachable links.
- A version conflict renders as a conflict with the current value, not as a generic
  error.

### Context

- The full Membership set is fetched from the context API, and no view reads it from a
  token.
- A switch to a Tenant without active Membership is refused and surfaced.
- After a switch, the view reloads in the new context and shows it in the scope banner.

### Projection Health

- A consumer past its budget renders as stale with its stale behavior shown.
- An `extra` finding renders as a security finding.
- A reconciled consumer shows its reconciliation age and its findings count; a clean run shows no
  findings (1.4.0).
- A consumer without the reconciliation fields renders as "never reconciled", with no age and no
  count (1.4.0).

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
| Depends on | `TDD-organization-control-004` — the invitation join |
| Depends on | `TDD-organization-control-002` — Membership, revocation, projection health |
| Depends on | `TDD-organization-control-002` 1.13.0 §The Consumer List — the consumer's last reconciliation and its age (1.4.0) |
| Conforms to | STD-GLB-001 §Pagination — keyset paging, no offsets (1.2.0) |
| Conforms to | STD-GLB-FE-001 §Technology Stack — server state through TanStack Query (1.2.0) |
| Governed by | ADR-ORG-002 — an activation approved by another provider (1.2.0) |
