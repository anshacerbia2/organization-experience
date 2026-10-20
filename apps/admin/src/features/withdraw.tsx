import { useState, type ReactElement } from 'react';

import { messages } from '../messages';
import { Button, fieldClasses, layout, Notice } from '../ui';
import { Action, Field } from './common';
import { EnforcementStatus } from './enforcement';

// A provider withdraws one Membership inside a Tenant (TDD-organization-experience-002 1.10.0,
// ADR-ORG-003 §5.6): suspend or revoke, never grant or restore, with a reason, an Idempotency-Key and
// the version the operator acts on. Organization Control serves a provider no read of a Tenant's
// Memberships, so the identifier and the version are typed from the incident's record; a stale version
// is a 409 version-conflict, shown and never retried. It is recorded as privileged access naming the
// Tenant, which its administrators read on their Provider access page.

interface Withdrawn {
  readonly membership: { readonly membership_id: string; readonly status: string; readonly version: number };
  readonly accepted_at: string;
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
        size="sm"
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
        size="sm"
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
  const [version, setVersion] = useState('');
  const [withdrawn, setWithdrawn] = useState<Withdrawn | null>(null);
  const id = membership.trim();
  const expected = Number(version);
  // Drawn only once both are entered: no disabled control (§Operator Transitions).
  const ready = uuid.test(id) && /^\d+$/.test(version.trim()) && expected >= 1;
  const base = `/v1/tenants/${tenantId}/memberships/${encodeURIComponent(id)}` as const;
  const tenant = messages.inTenantNamed(name, tenantId);

  return (
    <section aria-label={messages.withdrawMembershipOf(name)} className={layout.stack}>
      <p className={layout.lead}>{messages.withdrawLead}</p>
      <div className={layout.form}>
        <Field label={messages.membershipIdentifier}>
          {(fieldId) => (
            <input
              id={fieldId}
              className={fieldClasses.input}
              value={membership}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setMembership(event.target.value);
                setWithdrawn(null);
              }}
            />
          )}
        </Field>
        <Field label={messages.membershipVersion}>
          {(fieldId) => (
            <input
              id={fieldId}
              className={fieldClasses.input}
              inputMode="numeric"
              value={version}
              autoComplete="off"
              onChange={(event) => {
                setVersion(event.target.value);
                setWithdrawn(null);
              }}
            />
          )}
        </Field>
      </div>
      {ready ? (
        <div className={layout.actions}>
          <Action<Withdrawn>
            label={messages.suspendMembership}
            tone="danger"
            path={`${base}/suspend`}
            body={{ expected_version: expected }}
            reason="required"
            scopeNote={`${messages.withdrawSuspendWill(id, name)} ${tenant}`}
            invalidates={[]}
            onDone={setWithdrawn}
          />{' '}
          <Action<Withdrawn>
            label={messages.revokeMembership}
            tone="danger"
            path={`${base}/revoke`}
            body={{ expected_version: expected }}
            reason="required"
            scopeNote={`${messages.withdrawRevokeWill(id, name)} ${tenant}`}
            invalidates={[]}
            onDone={setWithdrawn}
          />
        </div>
      ) : (
        <p className={layout.lead}>{messages.withdrawEnter}</p>
      )}
      {withdrawn === null ? null : (
        <>
          <Notice tone="info" role="status">
            <p>{messages.withdrawn(withdrawn.membership.status, withdrawn.membership.version)}</p>
          </Notice>
          <EnforcementStatus membershipId={withdrawn.membership.membership_id} tenantId={tenantId} />
        </>
      )}
    </section>
  );
}
