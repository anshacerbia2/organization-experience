import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { apiGet } from '../api/client';
import { messages } from '../messages';
import { Button, Facts, fieldClasses, layout, Notice, Row, RowMain, Rows, RowTitle } from '../ui';
import { Action, Field, formatTime, ListState } from './common';

// A Tenant's administrators (TDD-organization-experience-002 1.7.0, ADR-ORG-003). A provider grants
// and revokes them; the first one is what lets anyone sign in for the Tenant after Activate, because
// the grant also gives the Principal its first Tenant-wide Membership (ADR-ORG-003 §5.2). The list is
// a provider read and records an access, so it is read only when the operator opens it.

export interface AdministratorGrant {
  readonly grant_id: string;
  readonly tenant_id: string;
  readonly principal_id: string;
  readonly granted_by: string;
  readonly reason: string;
  readonly granted_at: string;
  readonly active: boolean;
  readonly revoked_at: string | null;
  readonly revoked_by: string | null;
  readonly revoke_reason?: string;
}

interface Granted extends AdministratorGrant {
  readonly membership_id: string;
  readonly membership_created: boolean;
}

export function TenantAdministrators({
  tenantId,
  name,
  status,
}: {
  readonly tenantId: string;
  readonly name: string;
  readonly status: string;
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
        {messages.administrators}
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
        {messages.hideAdministrators}
      </Button>
      <AdministratorsPanel tenantId={tenantId} name={name} status={status} />
    </>
  );
}

function AdministratorsPanel({
  tenantId,
  name,
  status,
}: {
  readonly tenantId: string;
  readonly name: string;
  readonly status: string;
}): ReactElement {
  const key = ['tenant-administrators', tenantId] as const;
  const grants = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      apiGet<{ grants: AdministratorGrant[] }>(`/v1/tenants/${tenantId}/administrators`, { signal }),
  });
  const [principal, setPrincipal] = useState('');
  const [granted, setGranted] = useState<Granted | null>(null);
  const items = grants.data?.grants ?? [];
  const base = `/v1/tenants/${tenantId}/administrators` as const;

  return (
    <section aria-label={messages.administratorsOf(name)} className={layout.stack}>
      <ListState query={grants} empty={messages.noAdministrators} count={items.length} />
      <Rows aria-label={messages.administratorsOf(name)}>
        {items.map((grant) => (
          <Row key={grant.grant_id}>
            <RowMain>
              <RowTitle mono>{grant.principal_id}</RowTitle>{' '}
              <Facts
                items={[
                  grant.active
                    ? { status: 'active', label: messages.grantActive }
                    : { status: 'revoked', label: messages.grantRevoked },
                  messages.grantedBy(grant.granted_by, formatTime(grant.granted_at), grant.reason),
                  grant.active
                    ? null
                    : messages.revokedBy(
                        grant.revoked_by ?? '',
                        formatTime(grant.revoked_at),
                        grant.revoke_reason ?? '',
                      ),
                ]}
              />
            </RowMain>
            {grant.active ? (
              <Action
                label={messages.revokeAdministrator}
                tone="danger"
                path={`${base}/${grant.grant_id}/revoke`}
                body={{}}
                reason="required"
                scopeNote={`${messages.revokeAdministratorWill(grant.principal_id)} ${messages.inTenantNamed(name, tenantId)}`}
                invalidates={[key]}
              />
            ) : null}
          </Row>
        ))}
      </Rows>
      {status === 'active' ? (
        <div className={layout.form}>
          <Field label={messages.principalIdentifier}>
            {(id) => (
              <input
                id={id}
                className={fieldClasses.input}
                value={principal}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setPrincipal(event.target.value);
                }}
              />
            )}
          </Field>
          <div className={layout.actions}>
            <Action<Granted>
              label={messages.grantAdministrator}
              tone="primary"
              path={base}
              body={{ principal_id: principal.trim() }}
              reason="optional"
              scopeNote={messages.grantAdministratorWill(name, tenantId)}
              invalidates={[key]}
              onDone={(result) => {
                setGranted(result);
                setPrincipal('');
              }}
            />
          </div>
        </div>
      ) : (
        <p className={layout.lead}>{messages.administratorsOnlyActive}</p>
      )}
      {granted === null ? null : (
        <Notice tone="success" role="status">
          <p>{messages.administratorGranted(granted.membership_created)}</p>
        </Notice>
      )}
    </section>
  );
}
