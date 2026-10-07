# Organization Experience Operations

The three runbooks the production gate names (ROADMAP §Gates; `TDD-organization-experience-001` and
`-003` §Operational Notes). Each step names the screen or the route it uses. The Organization
Control API decides every action; these steps never work around a refusal.

Never paste a token, a session cookie or a client key into a ticket or chat. A correlation
identifier, an activation, batch or offboarding identifier, and the API's problem `type` are enough
to find everything else.

## Provider-access review

**When.** On the cadence the platform owner sets, and after every use of an emergency grant.
Privileged access needs are not fixed: "The need for access to privileged Azure resource and
Microsoft Entra roles by your users changes over time. To reduce the risk associated with stale role
assignments, you should regularly review access" [R1]. An emergency grant is also reviewed at least
every 90 days, as Microsoft's emergency access drill is [R2]
(`TDD-organization-control-001` §Emergency Grant Validation).

**Who.** A provider who is not the subject of what is being reviewed. Separation is the rule the API
already holds for approval (`provider_activation_separation_check`).

1. **Read the activations.** Sign in as a provider and open **Activation requests**. Without a window
   of your own, write a review reason first; the read is recorded as privileged access.
   - The page lists pending activations. `GET /v1/provider-activations` serves pending, in force,
     and the last 100, newest first (`TDD-organization-control-001` §Provider Activation).
   - An activation past the last 100 is read from the privileged-access record. Organization
     Control serves no route for it (see the last step).
2. **Check each activation against its own record:**
   - The reason names the work. A reason such as "investigation" names nothing to check against.
   - Another provider approved it. The database refuses a self-approval, so a self-approved row is
     a defect to report, not a judgement call.
   - The duration fits the work. A habit of the maximum (`ORGANIZATION_EXPERIENCE_PROVIDER_MAX_DURATION`,
     60 minutes) is worth raising with the holder.
   - The Tenants named were the ones needed. "Every Tenant" needs a reason that covers every Tenant.
3. **Match the work to the window.** Every provider request carries the window's correlation
   identifier (`TDD-organization-experience-001` §The Scope Guard).
   - Find the privileged-access records under that correlation.
   - A window with no records beyond the activation routes is the "Provider mode entered without a
     subsequent action" signal (`TDD-organization-experience-001` §Operational Notes). It usually
     means the Tenant-scope views lack something the operator needed. Record which view; it is a
     product gap, not a finding against the operator.
   - Records whose reason does not fit the window's reason are a finding. Go to step 6.
4. **Review every use of an emergency grant.** Organization Control logs each request an emergency
   grant authorizes at WARN, "a provider acted on an emergency grant", and records the use
   (`TDD-organization-control-001` §Provider Activation).
   - Classify each use the way Microsoft's post-mortem does: "For a planned drill to validate its
     suitability", "In response to an actual emergency where no administrator could use their
     regular accounts", or "As a result of misuse or unauthorized usage of the account" [R2].
   - Then "examine the logs to determine what actions the individual with the emergency access
     account took" [R2].
5. **Review the grants.** `GET /v1/provider-grants` lists every grant, active and revoked, to a
   provider in force.
   - Revoke a grant its holder no longer needs: `POST /v1/provider-grants/{grant_id}/revoke`, with a
     reason.
   - Keep at least two unrevoked emergency grants. Organization Control reports fewer at startup in
     production, and Microsoft's guardrail is to "Maintain at least two emergency access accounts for
     redundancy" [R2].
6. **A finding.** An action no reason explains is a provider-scope incident (SAD-012 §9.3.3).
   - End an activation still in force: `POST /v1/provider-activations/{id}/end`, by its holder or a
     provider in force, with a reason.
   - Revoke the grant, and raise the incident with the correlation identifiers.
7. **Record the review.** In the ticket that scheduled it: the period, the activation identifiers,
   the findings and the actions taken.

**Not served yet.** No Organization Control route reads `audit.privileged_access`. Step 3, and any
activation older than the last 100, needs the record read some other way. Choosing that way, and its
access control, is an owner decision recorded in the ROADMAP.

## Bulk operation partial failure

**Signals.** "Bulk operation partial-failure rate above baseline"
(`TDD-organization-experience-001` §Operational Notes), or an operator reporting a bulk action that
did not finish.

A batch is previewed, then executed. Each item's version is pinned at the preview, and each item has
its own outcome (`TDD-organization-control-002` §Membership Batches).

### The execution did not answer

The operator pressed the execute button and saw an error instead of the outcome.

1. **Leave the dialog open, and press the same button again.**
   - The application resends the same `Idempotency-Key`. Organization Control adopts the key of a
     request that did not finish, and resumes the batch. No item is applied twice: an item with an
     outcome is skipped (`TDD-organization-control-002` §Resuming an execution).
   - This is the retry the draft standard describes: a retried key gets "the result of the
     previously completed operation, success or an error" [R3].
2. **"Request in progress" (`409`).** The first request may still be running. Its lease lasts 30
   seconds from its last heartbeat. Wait at least that long, then press the button again.
3. **The dialog was closed, or the page reloaded.** The key is gone, and the application does not
   read a batch by its identifier.
   - Select the memberships again and preview again. An item the lost execution applied now
     previews as refused, for example "already revoked", and is not attempted. Nothing is applied
     twice.
   - The old batch stays `executing` until another execute resumes it. Record its correlation, from
     the error's reference, in the ticket.

### Some items failed

The outcome lists **Succeeded**, **Failed** and **Not attempted** separately. Never report the
batch as one success.

1. **Read each failure.** It is the API's own problem, as the single command would return it.
   - `version-conflict`: the Membership changed after the preview. Look at its current state
     before deciding the action is still wanted.
   - Any other problem names its cause. Fix the cause first; resubmitting cannot.
2. **Read each item not attempted.**
   - `refused_at_preview`: the preview already said why. Nothing to do.
   - `expired`: the preview was older than its `expires_at`. Preview again.
   - `error_allowance`: the run stopped at its failure allowance. The application sends none, so
     this means another client ran the batch.
3. **Resubmit the failed items only.** Press **Preview the N failed again**.
   - The new batch names the one it continues and keeps its correlation, so the audit trail links
     the two (`TDD-organization-experience-001` §Bulk Operations).
   - Give the reason again. Read the new preview; it is the current state, not the old one.
   - Do not select the whole original set again. Nothing would be applied twice, but the link
     between the batches would be lost.
4. **A succeeded revocation is not yet enforced.** It shows accepted, then propagating, then
   enforced as the consumers record that they applied it. Over budget, the screen names the
   services not applying it; raise it with the platform on-call, quoting the event and those
   services (`TDD-organization-experience-001` §Presenting Revocation Honestly).
5. **Above baseline across operators.** Group the failures by problem `type`. Version conflicts
   above baseline mean concurrent administrators or a view kept open too long, not a fault in the
   batch.

A selection over 500 memberships is refused `413` with the limit named. Act on it as several
batches, each previewed and confirmed on its own.

## Stuck offboarding

**Signals** (`TDD-organization-experience-003` and `TDD-organization-control-004` §Operational
Notes):

- elapsed in stage over 30 days (warning) or 90 days (critical);
- an obligation past `due_at`;
- release held by an unresolved deprovisioning, critical over 24 hours;
- finalisation refused repeatedly for the same actor.

Open **Offboardings** in provider mode and select the offboarding. The stage timeline shows the
stage, when it began and the time in it. The record is persisted, so what the page shows is the
offboarding's actual state after any restart (`TDD-organization-experience-003` §Resumability).

There is no "restart offboarding", and there must not be one. It would re-freeze a frozen Tenant and
re-raise open obligations. Offboarding resumes from its stage.

1. **Freeze.** Memberships are still active.
   - Press **Suspend the next 100** until none remain, then complete the freeze. The API refuses an
     early completion.
   - A batch that fails shows the API's problem, with its reference. Quote it to the platform
     on-call.
2. **Obligations.** The board sorts overdue rows first, and each row names its accountable domain.
   - Chase that domain, not the board. Only the domain resolves its obligation, by completing,
     waiving or failing it (`POST /v1/obligations/{obligation_id}/resolve`). The board offers no
     control to resolve another domain's row, by design.
   - Never ask a domain to waive in order to make progress. `waived` records that an accountable
     person decided the obligation would not be met (`TDD-organization-control-004` §Security
     Notes).
3. **Legal hold.** The banner says what the hold blocks: release and retirement. Freeze and
   obligations proceed.
   - Do not lift a hold to make progress on something it does not block. That is the misuse the
     banner exists to prevent (`TDD-organization-experience-003` §Legal Hold).
   - Lift it only on the instruction of whoever set it, with that instruction as the reason. A hold
     "prevents destructive retirement until released" (SAD-004 §6.5).
4. **Release, held by its deprovisioning.** The three states that hold retirement mean different
   things (`TDD-organization-control-004` §Where the deprovisioning outcome is recorded):
   - `requested`: still in flight. Wait.
   - `unresolved`: a timeout. The infrastructure may or may not have been released. Do not retry.
     Establish the outcome with the provisioning system's owners, which then report it to
     `/deprovisioning`.
   - `failed`: refused. Investigate the cause with the provisioning system's owners before anything
     is run again.
5. **Retirement refused.** The refusal lists the open obligations as rows. Go back to step 2 for
   each. Repeated refusals by one actor mean someone is trying to close an offboarding they cannot.
   Find the blocking domain; do not loosen the gate (`TDD-organization-experience-003` §Operational
   Notes).
6. **Begun by mistake.** In the freeze and obligations stages, **Cancel this offboarding** returns
   the Tenant to its prior status and restores the memberships the freeze suspended (`ADR-ORG-006`).
   From release on, it cannot be cancelled.

## References

| Ref | Source |
| :-- | :-- |
| R1 | Microsoft, *Create an access review of Azure resource and Microsoft Entra roles in PIM*, <https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-create-roles-and-resource-roles-review>, accessed 2026-10-07: "The need for access to privileged Azure resource and Microsoft Entra roles by your users changes over time. To reduce the risk associated with stale role assignments, you should regularly review access." |
| R2 | Microsoft, *Manage emergency access admin accounts*, <https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access>, accessed 2026-10-07: "Maintain at least two emergency access accounts for redundancy."; "Validate account functionality at least every 90 days."; a post-mortem determines whether the account was used "For a planned drill to validate its suitability", "In response to an actual emergency where no administrator could use their regular accounts", or "As a result of misuse or unauthorized usage of the account"; "Next, examine the logs to determine what actions the individual with the emergency access account took to ensure that those actions align with the authorized use of the account." |
| R3 | IETF, *The Idempotency-Key HTTP Header Field*, draft-ietf-httpapi-idempotency-key-header-07, §2.6, <https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header>, accessed 2026-10-07: "The request was retried after the original request completed. The resource SHOULD respond with the result of the previously completed operation, success or an error." |
