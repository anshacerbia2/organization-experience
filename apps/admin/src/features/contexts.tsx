import { useId, type ReactElement } from 'react';

import { messages } from '../messages';
import { tenantSignInHref } from '../session';
import { useSignedIn } from '../SessionContext';
import { Facts, Panel, Row, RowMain, Rows, RowTitle } from '../ui';
import { ListState, LoadMore, usePagedList } from './common';

// The person's own Tenants (ADR-ORG-005, TDD-organization-experience-002 1.3.0 and 1.9.0): their
// contexts, read for themselves in any scope. After a sign-in without a Tenant it is the picker; in a
// Tenant scope it is the switch, with the current Tenant marked. An entry is a selector: choosing it
// is the Tenant sign-in, and the API checks the choice again at use. Nothing here starts a sign-in by
// itself, even for a single entry (WCAG 2.2 SC 3.2.5, TDD-organization-experience-001 1.11.0).

interface Context {
  readonly membership_id: string;
  readonly tenant_id: string;
  readonly tenant_display_name: string;
  readonly tenant_status: string;
  readonly workspace_id: string | null;
  readonly administers: boolean;
}

export function ContextSwitcher({
  returnTo,
  current,
}: {
  readonly returnTo: string;
  // current is the session's Tenant, or null for a session without one.
  readonly current: string | null;
}): ReactElement | null {
  const session = useSignedIn();
  const headingId = useId();
  const principal = session.principalId;
  const { query, items } = usePagedList<Context>(
    'contexts',
    `/v1/principals/${encodeURIComponent(principal ?? '')}/contexts`,
    'contexts',
    {},
    principal !== null,
  );
  if (principal === null) {
    return null;
  }
  return (
    <Panel.Root aria-labelledby={headingId}>
      <Panel.Header>
        <Panel.Title id={headingId}>{messages.yourTenants}</Panel.Title>
        {current === null ? <Panel.Description>{messages.chooseTenant}</Panel.Description> : null}
      </Panel.Header>
      <ListState
        query={query}
        empty={current === null ? messages.noContextsSignedIn : messages.noContexts}
        count={items.length}
      />
      <Rows>
        {items.map((context) => (
          <Row key={context.membership_id}>
            <RowMain>
              {context.tenant_id === current ? (
                <RowTitle>{messages.currentTenant(context.tenant_display_name)}</RowTitle>
              ) : (
                <a href={tenantSignInHref(context.tenant_id, returnTo)}>{context.tenant_display_name}</a>
              )}{' '}
              <Facts
                items={[
                  context.administers ? messages.youAdminister : messages.youAreMember,
                  context.workspace_id === null ? null : messages.workspaceRef(context.workspace_id),
                ]}
              />
            </RowMain>
          </Row>
        ))}
      </Rows>
      <LoadMore query={query} />
    </Panel.Root>
  );
}
