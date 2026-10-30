import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { ApiError, apiGet } from '../api/client';
import { messages } from '../messages';
import { maxReasonLength, minReasonLength, normalizeReason, reasonProblem } from '../scope';
import { Button, Facts, fieldClasses, layout, Loading, Notice, RowTitle } from '../ui';
import { Action, ApiErrorMessage, Field } from './common';
import { EnforcementStatus } from './enforcement';
import type { Membership } from './tenant';

// A provider withdraws one Membership inside a Tenant (TDD-organization-experience-002 1.12.0,
// ADR-ORG-003 §5.6 amended 2026-10-21): suspend or revoke, never grant or restore. The operator enters
// the Membership's identifier and a reason; the console reads the Membership as a provider through the
// Tenant the path names (organization-control `GET /v1/tenants/{tenant_id}/memberships/{membership_id}`,
// recorded as privileged access naming the Tenant), shows its record and version, and offers only the
// withdrawals its state allows, sending the version it read. The reason it collected goes with the
// read and is offered again on the withdrawal's confirmation. A stale version is a 409
// version-conflict, shown and never retried.

interface Withdrawn {
  readonly membership: { readonly membership_id: string; readonly status: string; readonly version: number };
  readonly accepted_at: string;
}

interface Read {
  readonly id: string;
  readonly reason: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function WithdrawMembership({
  tenantId,
  name,
}: {
  readonly tenantId: string;
  readonly name: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button
        variant="secondary"
        size="small"
        onClick={() => {
          setOpen(true);
        }}
      >
        {messages.withdrawMembership}
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="secondary"
        size="small"
        pressed
        onClick={() => {
          setOpen(false);
        }}
      >
        {messages.hideWithdrawMembership}
      </Button>
      <WithdrawForm tenantId={tenantId} name={name} />
    </>
  );
}

function WithdrawForm({
  tenantId,
  name,
}: {
  readonly tenantId: string;
  readonly name: string;
}): ReactElement {
  const [membership, setMembership] = useState('');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [read, setRead] = useState<Read | null>(null);
  const id = membership.trim();
  const idProblem = uuid.test(id) ? null : messages.membershipIdentifierProblem;
  const problem = reasonProblem(reason);
  const forget = (): void => {
    setRead(null);
    setSubmitted(false);
  };

  return (
    <section aria-label={messages.withdrawMembershipOf(name)} className={layout.stack}>
      <p className={layout.lead}>{messages.withdrawLead}</p>
      <form
        aria-label={messages.readMembership}
        noValidate
        className={layout.form}
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (idProblem === null && problem === null) {
            setRead({ id, reason: normalizeReason(reason) });
          }
        }}
      >
        <Field label={messages.membershipIdentifier}>
          {(fieldId) => (
            <>
              <input
                id={fieldId}
                className={fieldClasses.input}
                value={membership}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={submitted && idProblem !== null}
                onChange={(event) => {
                  setMembership(event.target.value);
                  forget();
                }}
              />
              {submitted && idProblem !== null ? (
                <p role="alert" className={fieldClasses.error}>
                  {idProblem}
                </p>
              ) : null}
            </>
          )}
        </Field>
        <Field label={messages.readReason} hint={messages.readReasonHint}>
          {(fieldId, hintId) => (
            <>
              <textarea
                id={fieldId}
                className={fieldClasses.area}
                value={reason}
                aria-describedby={hintId}
                aria-invalid={submitted && problem !== null}
                onChange={(event) => {
                  setReason(event.target.value);
                  forget();
                }}
              />
              {submitted && problem !== null ? (
                <p role="alert" className={fieldClasses.error}>
                  {problem === 'short'
                    ? messages.reasonShort(minReasonLength)
                    : problem === 'long'
                      ? messages.reasonLong(maxReasonLength)
                      : messages.reasonCharacters}
                </p>
              ) : null}
            </>
          )}
        </Field>
        <div className={layout.actions}>
          <Button type="submit">{messages.readMembership}</Button>
        </div>
      </form>
      {read === null ? null : (
        <MembershipRead key={`${read.id} ${read.reason}`} tenantId={tenantId} name={name} read={read} />
      )}
    </section>
  );
}

// MembershipRead reads the one Membership as a provider, with the reason the operator gave, and offers
// the withdrawals its state allows: suspend and revoke on an active one, revoke on a suspended one, and
// nothing on a revoked one. Each sends the version this read returned, or the one the last withdrawal
// answered.
function MembershipRead({
  tenantId,
  name,
  read,
}: {
  readonly tenantId: string;
  readonly name: string;
  readonly read: Read;
}): ReactElement {
  const [withdrawn, setWithdrawn] = useState<Withdrawn | null>(null);
  const base = `/v1/tenants/${tenantId}/memberships/${encodeURIComponent(read.id)}` as const;
  const query = useQuery({
    queryKey: ['provider-membership', tenantId, read.id, read.reason],
    staleTime: 0,
    retry: false,
    queryFn: ({ signal }) => apiGet<Membership>(base, { signal, reason: read.reason }),
  });
  if (query.isPending) {
    return (
      <div role="status">
        <Loading />
      </div>
    );
  }
  if (query.isError) {
    return (
      <>
        {query.error instanceof ApiError && query.error.status === 404 ? (
          <Notice tone="warning" role="status">
            <p>{messages.withdrawNotFound(read.id, name)}</p>
          </Notice>
        ) : null}
        <ApiErrorMessage error={query.error} />
      </>
    );
  }
  const record = query.data;
  const status = withdrawn?.membership.status ?? record.status;
  const version = withdrawn?.membership.version ?? record.version;
  const tenant = messages.inTenantNamed(name, tenantId);
  const body = { expected_version: version };

  return (
    <div className={layout.stack} aria-label={messages.membershipRead(read.id)} role="group">
      <p>
        <RowTitle mono>{record.principal_id}</RowTitle>{' '}
        <Facts
          items={[
            record.subject_type,
            { status, label: messages.state(status) },
            messages.versionOf(version),
            record.workspace_id === undefined || record.workspace_id === null
              ? null
              : messages.workspaceRef(record.workspace_id),
          ]}
        />
      </p>
      {status === 'revoked' ? (
        withdrawn === null ? (
          <Notice tone="info" role="status">
            <p>{messages.withdrawAlreadyRevoked}</p>
          </Notice>
        ) : null
      ) : (
        <div className={layout.actions}>
          {status === 'active' ? (
            <>
              <Action<Withdrawn>
                key={`suspend ${String(version)}`}
                label={messages.suspendMembership}
                tone="danger"
                path={`${base}/suspend`}
                body={body}
                reason="required"
                initialReason={read.reason}
                scopeNote={`${messages.withdrawSuspendWill(read.id, name)} ${tenant}`}
                invalidates={[]}
                onDone={setWithdrawn}
              />{' '}
            </>
          ) : null}
          <Action<Withdrawn>
            key={`revoke ${String(version)}`}
            label={messages.revokeMembership}
            tone="danger"
            path={`${base}/revoke`}
            body={body}
            reason="required"
            initialReason={read.reason}
            scopeNote={`${messages.withdrawRevokeWill(read.id, name)} ${tenant}`}
            invalidates={[]}
            onDone={setWithdrawn}
          />
        </div>
      )}
      {withdrawn === null ? null : (
        <>
          <Notice tone="info" role="status">
            <p>{messages.withdrawn(withdrawn.membership.status, withdrawn.membership.version)}</p>
          </Notice>
          <EnforcementStatus membershipId={withdrawn.membership.membership_id} tenantId={tenantId} />
        </>
      )}
    </div>
  );
}
