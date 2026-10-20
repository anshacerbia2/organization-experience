---
doc_meta:
  id: TDD-organization-experience-003
  title: Offboarding Workflow and Obligation Tracking Views
  owner: Core Platform Team
  version: 1.6.0
  status: approved
  classification: restricted
  review_cycle_days: 90
  created_date: 2026-08-11
  last_reviewed: 2026-10-21
  parent_sad: SAD-012
---

# Offboarding Workflow and Obligation Tracking Views

## Purpose

Specify how a Tenant offboarding is presented: the stages, the obligations owed by other
domains, what legal hold blocks, and why finalisation is refused while anything remains
open.

`TDD-organization-control-004` makes offboarding staged, resumable, and unable to infer
completion from any single response. That design is only as good as the interface that
renders it. A progress bar over a multi-domain obligation set would report a percentage
nobody can act on and would make finalisation look like the next step.

## Scope

**In scope**

- Stage presentation and what each stage has and has not stopped.
- The obligation board: which domain owes what, and its state.
- Legal hold, and rendering precisely what it blocks.
- Resumability made visible.
- The finalisation refusal.
- Every operator transition of the offboarding, deprovisioning and obligation machines, with its
  action or the reason for none (1.5.0).

**Out of scope**

- Stage transitions, obligation registry, and the refusal logic — owned by
  `TDD-organization-control-004`.
- Scope, provider mode, bulk operations, and irreversible confirmation — inherited from
  `TDD-organization-experience-001`.
- Day-to-day administration — owned by `TDD-organization-experience-002`.

## Technical Context

Offboarding has a property that makes it easy to render dishonestly: **access stops at
the first stage and data is destroyed at the third.** An operator who reads the freeze as
"offboarded" believes the Tenant is gone while its data remains, and an operator who
reads the whole flow as one action hesitates to start it at all.

Both readings are avoided by the same choice: render the stages as distinct, and state
for each one what it has stopped and what it has not.

The obligations belong to other domains. This service records them and refuses to finish
while any is open, which means the interface is a coordination board rather than a
progress indicator. Nobody here can complete another domain's obligation, and pretending
otherwise with a percentage invites someone to try.

## Component Design

| Component | Responsibility |
| :-- | :-- |
| `StageTimeline` | The four stages, current position, and what each has stopped |
| `ObligationBoard` | One row per obligation: domain, type, state, due date, detail |
| `LegalHoldBanner` | Presence of a hold and exactly what it blocks |
| `FinalisationGate` | The refusal, naming what remains |

## Data Model

The view owns no offboarding state. It renders the authoritative offboarding record,
stage timestamps, legal-hold marker, and obligation rows returned by Organization
Control. The BFF session may cache one response for request coalescing only; command
completion, page reload, or version conflict invalidates it so a stale obligation board
cannot authorize advancement or finalisation.

## API / Interface

All routes proxy through the BFF to Organization Control. The BFF forwards the
optimistic version, reason, correlation identifier, and idempotency key without
inferring that an accepted asynchronous command has completed.

```text
GET   /api/v1/offboardings
GET   /api/v1/offboardings/{id}
POST  /api/v1/tenants/{id}:begin-offboarding
POST  /api/v1/offboardings/{id}/obligations/{oid}:complete
POST  /api/v1/offboardings/{id}/obligations/{oid}:waive
POST  /api/v1/offboardings/{id}:advance
POST  /api/v1/offboardings/{id}:finalise
```

### As Served (1.2.0)

The route list above is 1.0.0's sketch. Organization Control serves offboarding to a provider in
provider mode only (`TDD-organization-control-004` 1.7.0), and this experience builds against
what it serves:

```text
GET   /api/v1/offboardings              ?stage&tenant_id   the estate list form (STD-GLB-001 1.3.0)
GET   /api/v1/offboardings/{id}                            stage, stage timestamps, legal hold,
                                                           deprovisioning, active_memberships
GET   /api/v1/offboardings/{id}/obligations                every row, overdue open first
GET   /api/v1/tenants/{id}                                 offboarding_id, active_memberships, version
POST  /api/v1/offboardings                {tenant_id, expected_version}      begin
POST  /api/v1/offboardings/{id}/freeze    {size}                             one freeze batch
POST  /api/v1/offboardings/{id}/complete-freeze                              freeze → obligations
POST  /api/v1/offboardings/{id}/obligations {domain, type, due_at?}          raise an obligation
POST  /api/v1/offboardings/{id}/legal-hold {hold}                            set or lift the hold
POST  /api/v1/offboardings/{id}/release                                      obligations → release
POST  /api/v1/offboardings/{id}/retire    {expected_version}                 release → retired
POST  /api/v1/offboardings/{id}/deprovisioning/resend                        a failed deprovisioning (1.5.0)
```

How the served API meets this design:
- **Advance and finalise are the served transitions.**
  - Advancing is `complete-freeze`, then `release`.
  - Finalising is `retire`, which takes the Tenant's version read immediately before the
    confirmation.
  - Each refusal is the API's own problem document. The finalisation refusal renders the open
    obligations from the board as rows.
- **The freeze runs in batches,** as the API serves it.
  - The interface shows the Memberships still active and offers the next batch.
  - It completes the freeze only when none remain. The API refuses an early completion anyway.
- **The obligation board offers no completion or waiver.**
  - An obligation is resolved by its accountable domain, which states its domain to the API.
  - The board shows who resolved each row and when, and offers no control that would let an
    operator resolve another domain's obligation.
- **The freeze is reversible as served (1.3.0, `ADR-ORG-006`).**
  - `POST /v1/offboardings/{id}/cancel`, with a reason and the Tenant's version, is offered in the
    freeze and obligations stages and nowhere after.
  - It returns the Tenant to the status it held when offboarding began, and restores the
    Memberships the freeze suspended and no others. The offboarding ends `cancelled`, recorded.
  - The freeze stage now says what is true of it: access is stopped, nothing is deleted, and it
    can be cancelled until release.
  - An offboarding begun before the freeze recorded what it suspended cannot be cancelled. The
    interface shows the API's refusal.
- **Before 1.3.0 the freeze was not called reversible here.**
  - Organization Control serves no transition from `offboarding` back to `active`.
  - The freeze stage therefore states what is true of it: access is stopped and nothing is
    deleted.
  - Returning a Tenant from a mistaken offboarding waits on that transition, and is recorded in
    the ROADMAP.
- **Ambiguous release** is a deprovisioning that was requested and has no outcome yet. It renders
  as awaiting its outcome, with retirement disabled and the cause named.

**A failed deprovisioning is sent again from the release stage (1.5.0).** The audit of 2026-10-19
found it unreachable: `TDD-organization-control-004` 1.11.0 serves
`POST /v1/offboardings/{id}/deprovisioning/resend`, and the console rendered a failed deprovisioning
with its detail and offered nothing, so the offboarding stayed in `release` with Retire disabled.

- **Send deprovisioning again** is offered on a `failed` deprovisioning only, beside its detail, so the
  operator reads why it failed first. It repeats a command that removes infrastructure, so it takes
  the danger variant, a reason, and a confirmation in place naming the Tenant
  (`TDD-organization-experience-001` §Visual Language). It sends no `expected_version`: the route takes
  none. The offboarding is read again when it settles; the new request reads `requested`.
- **Each deprovisioning state has its own sentence.** `requested` waits for the provisioning system's
  report. `unresolved` says the outcome is unknown, not to send it again, because the target may have
  released the infrastructure already, and how it is resolved: the provisioning system's owner reports
  it as realized or failed (`TDD-organization-control-004` §Sending a Failed Deprovisioning Again).
  `realized` enables Retire. On a development server no provisioning system runs, and the sentences for
  `requested` and `unresolved` name organization-control's `scripts/dev-deprovisioning.ps1`, which
  reports for it (`TDD-organization-control-004` 1.13.0).
- **No resend control is drawn for `requested`, `unresolved` or `realized`,** not even a disabled one.
  The GOV.UK Design System: "Disabled buttons have poor contrast and can confuse some users, so avoid
  them if possible" [R1]. Retire keeps its disabled form with the cause named, as §Legal Hold decides,
  because a missing finalisation is indistinguishable from a permission problem.
- **Obligations are still resolved by their domains, not here.** No domain is connected on a
  development server, so the board says that organization-control's `scripts/dev-obligation.ps1`
  resolves an obligation there, acting for its domain through the same route
  (`TDD-organization-control-004` 1.13.0). The board itself still offers no completion or waiver.
- **The identifiers those scripts take are shown.** The page's lead names the offboarding's identifier,
  and the board has an Identifier column with each obligation's, so an operator reads them from the
  console rather than from the API.

## Algorithms / Logic

### Stage Presentation

Each stage states what it has stopped and what it has not:

| Stage | Stopped | Not stopped |
| :-- | :-- | :-- |
| `freeze` | Access, for every Membership in the Tenant | Nothing has been deleted. This stage is reversible |
| `obligations` | Access remains stopped | Data remains. Domains are exporting, retaining, and reporting |
| `release` | Access remains stopped | Infrastructure release is in progress |
| `retired` | Everything | — |

The reversibility of the freeze is stated on the freeze stage, not buried in help text.
An operator hesitating to begin offboarding is usually hesitating because they cannot
tell how far the first click goes.

### Beginning Offboarding

```text
begin:
    show the count of Memberships that will be suspended
    show that access stops immediately and that nothing is deleted
    require a reason
    require typed confirmation of the Tenant name
    submit
```

The count comes from the API. A confirmation that says "this will suspend all
Memberships" is weaker than one that says "this will suspend 847 Memberships", because
the second is a number an operator can recognise as wrong.

### The Obligation Board

One row per obligation. No aggregate percentage.

```text
domain        obligation          state       due          detail
HCM           workforce export    completed   2026-09-01   completed by ...
Audit         evidence retention  open        2026-09-15   —
Document      export delivery     open        2026-09-01   overdue
Billing       final invoice       waived      —            waived by ..., reason ...
Provisioning  storage release     open        —            blocked by legal hold
```

`waived` renders distinctly from `completed`, matching the separate state in
`TDD-organization-control-004`. Rendering them the same would make an audit read as
though an obligation was satisfied when a person decided it would not be.

Overdue rows render as overdue against `due_at`, and the board sorts them first. An
obligation whose due date has passed is the reason an offboarding stalls, and it should
not require scrolling to find.

Each row names the accountable domain. Nobody using this board can complete another
domain's obligation, and the row makes clear who can.

### Legal Hold

The banner states precisely what a hold blocks, because a hold that appears to block
everything invites someone to release it in order to make progress on something it does
not affect:

```text
Legal hold is set.
    Freeze        proceeds
    Obligations   proceed
    Release       blocked
    Retirement    blocked
```

Release and retirement controls render disabled with the hold named as the cause, rather
than absent. A missing control is indistinguishable from a permission problem.

### Resumability

The current stage and every obligation state come from the persisted record, so the view
reflects reality after any restart. The interface shows the stage entry timestamp and the
elapsed time in stage, which is what makes a stalled offboarding visible without
comparing dates by hand.

There is no "restart offboarding" control. Offboarding resumes; it does not begin again,
and a control suggesting otherwise would invite an operator to re-freeze a Tenant that is
already frozen and re-raise obligations that are already open.

### The Finalisation Refusal

```text
finalise:
    if any obligation is open:
        refuse, and list the open obligations with their domains
    if legal hold is set:
        refuse, and name the hold
    else:
        require typed confirmation of the Tenant name
        state that this is irreversible
        submit
```

The refusal lists rather than counts. `TDD-organization-control-004` returns the open
obligations; the interface renders them as reachable rows so the operator can chase the
right domain instead of asking who is blocking.

### Ambiguous Release

A deprovisioning outcome that never arrived holds the release stage. It renders as
unresolved, not failed, with no retry control — the same treatment
`TDD-organization-experience-002` gives Tenant provisioning, and for the same reason. Until 1.5.0
this said "the retry control disabled"; 1.5.0 offers it nowhere instead, and only a `failed`
deprovisioning is sent again (§As Served).

### Operator Transitions (1.5.0)

`TDD-organization-experience-002` 1.6.0 §Operator Transitions lists every transition of the Tenant
machine with the console's action or the reason for none. These are the same tables for the three
machines this view shows, from `TDD-organization-control-004` §Offboarding Stages, §Where the
deprovisioning outcome is recorded and §Sending a Failed Deprovisioning Again.
`apps/admin/src/features/transitions.ts` holds them as code, and `transitions.test.ts` fails on an
edge with no row, an operator row with no action, or a disagreement with these tables.

#### Offboarding Stage

| From | To | Driven by | Route | Console action |
| :-- | :-- | :-- | :-- | :-- |
| `new` | `freeze` | operator | `POST /v1/offboardings` | Begin offboarding |
| `freeze` | `obligations` | operator | `POST /v1/offboardings/{id}/complete-freeze` | Complete the freeze |
| `obligations` | `release` | operator | `POST /v1/offboardings/{id}/release` | Release |
| `release` | `retired` | operator | `POST /v1/offboardings/{id}/retire` | Retire |
| `freeze` | `cancelled` | operator | `POST /v1/offboardings/{id}/cancel` | Cancel this offboarding |
| `obligations` | `cancelled` | operator | `POST /v1/offboardings/{id}/cancel` | Cancel this offboarding |

#### Deprovisioning Request

The latest deprovisioning request of an offboarding, the one retirement is gated on.

| From | To | Driven by | Route | Console action |
| :-- | :-- | :-- | :-- | :-- |
| `new` | `requested` | operator | `POST /v1/offboardings/{id}/release` | Release |
| `requested` | `realized` | provisioning system | `POST /v1/offboardings/{id}/deprovisioning` | None: the provisioning system reports it, as its registered reporter workload (1.6.0), and the console reports no outcome. On a development server, organization-control's `scripts/dev-deprovisioning.ps1`, as the development reporter |
| `requested` | `failed` | provisioning system | `POST /v1/offboardings/{id}/deprovisioning` | None: as realized |
| `requested` | `unresolved` | service | the scheduled sweep, after `ORGANIZATION_PROVISIONING_TIMEOUT` | None: the sweep ages a request with no outcome |
| `unresolved` | `realized` | provisioning system | `POST /v1/offboardings/{id}/deprovisioning` | None: reported with the provisioning system's answer, never sent again. On a development server, `scripts/dev-deprovisioning.ps1` |
| `unresolved` | `failed` | provisioning system | `POST /v1/offboardings/{id}/deprovisioning` | None: as realized |
| `failed` | `requested` | operator | `POST /v1/offboardings/{id}/deprovisioning/resend` | Send deprovisioning again |

#### Obligation

| From | To | Driven by | Route | Console action |
| :-- | :-- | :-- | :-- | :-- |
| `new` | `open` | operator | `POST /v1/offboardings/{id}/obligations` | Raise obligation |
| `open` | `completed` | owning domain | `POST /v1/obligations/{id}/resolve` | None: the accountable domain resolves its own obligation, as the reporter workload registered for `obligation:<domain>`, and no provider can (1.6.0); the board offers no control that would let an operator resolve another domain's (§As Served). On a development server, organization-control's `scripts/dev-obligation.ps1`, as that domain's development reporter |
| `open` | `waived` | owning domain | `POST /v1/obligations/{id}/resolve` | None: as completed |
| `open` | `failed` | owning domain | `POST /v1/obligations/{id}/resolve` | None: as completed |
| `failed` | `completed` | owning domain | `POST /v1/obligations/{id}/resolve` | None: as completed |
| `failed` | `waived` | owning domain | `POST /v1/obligations/{id}/resolve` | None: as completed |
| `open` | `cancelled` | operator | `POST /v1/offboardings/{id}/cancel` | Cancel this offboarding |

#### Who Reports, From 1.6.0

`ADR-ORG-001 §5.11` (amended 2026-10-20) makes the provisioning system and each obligation-owning
domain a reporter workload, registered with Organization Control for what it reports, and admitted on
its own report routes alone (`TDD-organization-control-001` 1.27.0 §Reporters). Nothing in these
tables changes: the console still reports no outcome and resolves no obligation, and no provider
resolves one at the API either. What the console adds is the registry, `/reporters`, where a provider
registers a reporter and retires it (`TDD-organization-experience-002` 1.10.0). An obligation whose
domain has no active reporter cannot be resolved; the operations runbook's stuck offboarding steps
check the registry first.

## Configuration

| Variable | Default | Purpose |
| :-- | :-- | :-- |
| `ORGANIZATION_EXPERIENCE_OFFBOARDING_STALL_WARN` | `30d` | Elapsed time in stage before a stall is surfaced |

## Testing Strategy

### Stage Presentation

- Each stage states what it has stopped and what it has not.
- The freeze stage states that nothing is deleted. As served it does not claim to be reversible
  (1.2.0).
- Elapsed time in stage renders and drives the stall indication.

### Beginning

- The Membership count comes from the API and appears in the confirmation.
- Typed confirmation of the Tenant name is required.
- A reason is required and is carried on the request.

### Obligation Board

- One row per obligation, with no aggregate percentage anywhere in the view.
- `waived` renders distinctly from `completed`, with the waiving actor and reason.
- Overdue rows render as overdue and sort first.
- Each row names its accountable domain.

### Legal Hold

- The banner names exactly what is blocked and what proceeds.
- Release and retirement controls render disabled with the hold as the cause, not
  absent.

### Finalisation

- Finalisation with any open obligation is refused and the open obligations are listed
  as reachable rows.
- Finalisation under legal hold is refused with the hold named.
- Finalisation requires typed confirmation and states irreversibility.

### Resumability

- The view reflects the persisted stage after a restart.
- No control offers to restart offboarding.

### Ambiguous Release

- An unresolved deprovisioning outcome renders as unresolved with no resend control, and says how
  it is resolved (1.5.0).

### Deprovisioning and Transitions (1.5.0)

- A failed deprovisioning offers Send deprovisioning again beside its detail, in the danger variant
  with a reason, and sends `POST /api/v1/offboardings/{id}/deprovisioning/resend` with an
  `Idempotency-Key`, the reason and the CSRF token. No other deprovisioning state offers it.
- The `requested` and `unresolved` sentences name `scripts/dev-deprovisioning.ps1`, and the board
  names `scripts/dev-obligation.ps1`, for a development server.
- Every transition of §Operator Transitions has a row, and every operator-driven row names its
  action; `transitions.test.ts` fails otherwise.
- The fixture-backed browser tests open Send deprovisioning again, in both themes, with a screenshot
  and axe-core's WCAG 2.2 A and AA rules.

## Security Notes

The honest rendering of stages is a safety control. An operator who believes the freeze
completed offboarding stops chasing obligations, and the data the contract required to be
exported is never exported. An operator who believes the whole flow is one irreversible
action postpones a freeze that should have happened immediately.

Legal hold is scoped precisely in the banner because an over-broad presentation creates
pressure to release the hold. A hold released to unblock something it never blocked is a
compliance failure caused by an interface.

The absence of a restart control removes an action that looks recoverable and is not:
re-freezing and re-raising obligations against a partially completed offboarding produces
duplicate obligations and an unclear record of which one was satisfied.

## Performance Notes

The obligation board is a small bounded read per offboarding. The offboarding list is
paged and served from the authoritative store rather than a projection, because the
population is small and the operator needs current state.

## Operational Notes

| Signal | Warning | Critical |
| :-- | :-- | :-- |
| Offboarding elapsed in stage | 30 days | 90 days |
| Obligations past `due_at` | any occurrence | past a contract deadline |
| Release held by an unresolved outcome | any occurrence | over 24 hours |
| Finalisation attempts refused | any occurrence | repeated by the same actor |

Repeated refused finalisation attempts by one actor mean somebody is trying to close an
offboarding they cannot close. The right response is to find the blocking domain, not to
loosen the gate.

Runbooks required before production: stalled offboarding obligation, unresolved
deprovisioning, and legal hold release. They are written as one, "Stuck offboarding", in
`docs/runbooks/organization-experience-operations.md` (1.4.0): its obligations, legal hold and
release steps are these three.

## Traceability

| Relationship | Target |
| :-- | :-- |
| Parent system | SAD-012 — Scnehaux Organization Experience |
| Realizes capability | PAD-PLT-002 — Tenant offboarding and retirement coordination |
| Conforms to | `TDD-organization-experience-001` — scope, confirmation, honest presentation |
| Conforms to | `TDD-identity-experience-001` — BFF session and containment |
| Depends on | `TDD-organization-control-004` — stages, obligations, legal hold, refusals |
| Depends on | `TDD-organization-control-003` — the Tenant terminal transitions this flow drives |
| Enterprise constraint | EAD-003 — deletion accounts for projections, derived products, backups, evidence, and legal hold |
| Depends on | `TDD-organization-control-004` 1.11.0 §Sending a Failed Deprovisioning Again — the resend route (1.5.0) |
| Depends on | `TDD-organization-control-004` 1.13.0 — the development server's stand-ins for the provisioning system's deprovisioning report and for a domain's obligation resolution (1.5.0) |
| Follows | GOV.UK Design System, Button, "Disabled buttons" — no disabled resend control (1.5.0) |
| Governed by | ADR-ORG-001 §5.11 — the reporters who resolve obligations and report deprovisioning, registered on `/reporters` (1.6.0) |

| # | Source |
| :-- | :-- |
| R1 | GOV.UK Design System, *Button*, "Disabled buttons", <https://design-system.service.gov.uk/components/button/>, accessed 2026-10-19: "Disabled buttons have poor contrast and can confuse some users, so avoid them if possible." |
