import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { apiGet } from '../api/client';
import { messages } from '../messages';
import { Facts, fieldClasses, layout, Panel, Row, RowMain, Rows, RowTitle } from '../ui';
import { Action, Field, formatTime, ListState } from './common';

// Provider grants, in the Access review area (TDD-organization-experience-002 1.7.0, ADR-ORG-002 §5.1,
// §5.2). Who holds provider authority, granted and revoked by a provider with a reason. The two kinds
// are explained where they are chosen: an eligible grant confers nothing until an activation another
// provider approves; an emergency grant is standing authority, so choosing it draws the confirmation
// in the danger scheme and asks for a reason.

export interface ProviderGrant {
  readonly grant_id: string;
  readonly principal_id: string;
  readonly scope: string;
  readonly kind: 'eligible' | 'emergency';
  readonly granted_by: string | null;
  readonly bootstrap_operator?: string;
  readonly reason: string;
  readonly granted_at: string;
  readonly active: boolean;
  readonly revoked_at: string | null;
  readonly revoked_by: string | null;
  readonly revoke_reason?: string;
}

const grantsKey = ['provider-grants'] as const;
const scopes = ['provider:organization-control', 'provider:identity-control'] as const;
const kinds = ['eligible', 'emergency'] as const;

export function ProviderGrants(): ReactElement {
  const grants = useQuery({
    queryKey: grantsKey,
    queryFn: ({ signal }) => apiGet<{ grants: ProviderGrant[] }>('/v1/provider-grants', { signal }),
  });
  const [principal, setPrincipal] = useState('');
  const [scope, setScope] = useState<string>(scopes[0]);
  const [kind, setKind] = useState<string>('eligible');
  const items = grants.data?.grants ?? [];

  return (
    <Panel.Root aria-labelledby="provider-grants-heading">
      <Panel.Header>
        <Panel.Title level={3} id="provider-grants-heading">
          {messages.providerGrants}
        </Panel.Title>
        <Panel.Description>{messages.providerGrantsExplained}</Panel.Description>
      </Panel.Header>
      <ListState query={grants} empty={messages.noProviderGrants} count={items.length} />
      <Rows aria-label={messages.providerGrants}>
        {items.map((grant) => (
          <Row key={grant.grant_id} data-kind={grant.kind}>
            <RowMain>
              <RowTitle mono>{grant.principal_id}</RowTitle>{' '}
              <Facts
                items={[
                  grant.scope,
                  grant.kind === 'emergency'
                    ? { status: 'failed', label: messages.kindName(grant.kind) }
                    : messages.kindName(grant.kind),
                  grant.active
                    ? { status: 'active', label: messages.grantActive }
                    : { status: 'revoked', label: messages.grantRevoked },
                  messages.grantedBy(
                    grant.granted_by ?? grant.bootstrap_operator ?? '',
                    formatTime(grant.granted_at),
                    grant.reason,
                  ),
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
                label={messages.revokeGrant}
                tone="danger"
                path={`/v1/provider-grants/${grant.grant_id}/revoke`}
                body={{}}
                reason="required"
                scopeNote={messages.revokeGrantWill(grant.principal_id, grant.scope)}
                invalidates={[grantsKey]}
              />
            ) : null}
          </Row>
        ))}
      </Rows>

      <h4 className={layout.subtitle}>{messages.grantProvider}</h4>
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
        <Field label={messages.scope}>
          {(id) => (
            <select
              id={id}
              className={fieldClasses.select}
              value={scope}
              onChange={(event) => {
                setScope(event.target.value);
              }}
            >
              {scopes.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={messages.kind} hint={messages.kindExplained(kind)}>
          {(id, hintId) => (
            <select
              id={id}
              className={fieldClasses.select}
              value={kind}
              aria-describedby={hintId}
              onChange={(event) => {
                setKind(event.target.value === 'emergency' ? 'emergency' : 'eligible');
              }}
            >
              {kinds.map((value) => (
                <option key={value} value={value}>
                  {messages.kindName(value)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className={layout.actions}>
          <Action
            key={kind}
            label={messages.grantProvider}
            tone={kind === 'emergency' ? 'danger' : 'primary'}
            path="/v1/provider-grants"
            body={{ principal_id: principal.trim(), scope, kind }}
            reason="required"
            scopeNote={messages.grantProviderWill(kind)}
            invalidates={[grantsKey]}
            onDone={() => {
              setPrincipal('');
            }}
          />
        </div>
      </div>
    </Panel.Root>
  );
}
