---
doc_meta:
  id: TDD-organization-experience-003
  title: Offboarding Workflow and Obligation Tracking Views
  owner: Core Platform Team
  version: 1.1.0
  status: approved
  classification: restricted
  review_cycle_days: 90
  created_date: 2026-08-11
  last_reviewed: 2026-08-14
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
unresolved, not failed, with the retry control disabled — the same treatment
`TDD-organization-experience-002` gives Tenant provisioning, and for the same reason.

## Configuration

| Variable | Default | Purpose |
| :-- | :-- | :-- |
| `ORGANIZATION_EXPERIENCE_OFFBOARDING_STALL_WARN` | `30d` | Elapsed time in stage before a stall is surfaced |

## Testing Strategy

### Stage Presentation

- Each stage states what it has stopped and what it has not.
- The freeze stage states that it is reversible and that nothing is deleted.
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

- An unresolved deprovisioning outcome renders as unresolved with retry disabled.

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
deprovisioning, and legal hold release.

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
