import { type ReactElement } from 'react';

import { messages } from '../messages';
import { tenantSignInHref } from '../session';
import { useSignedIn } from '../SessionContext';
import { facts, ListState, LoadMore, usePagedList } from './common';

// The context switcher (ADR-ORG-005, TDD-organization-experience-002 1.3.0): the operator's own
// contexts, read for themselves in any scope. An entry is a selector; choosing it is the Tenant
// sign-in, and the API checks the choice again at use.

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
  readonly current: string | null;
}): ReactElement | null {
  const session = useSignedIn();
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
    <section aria-labelledby="contexts-heading">
      <h2 id="contexts-heading">{messages.yourTenants}</h2>
      <ListState query={query} empty={messages.noContexts} count={items.length} />
      <ul>
        {items.map((context) => (
          <li key={context.membership_id}>
            {context.tenant_id === current ? (
              <strong>{messages.currentTenant(context.tenant_display_name)}</strong>
            ) : (
              <a href={tenantSignInHref(context.tenant_id, returnTo)}>{context.tenant_display_name}</a>
            )}{' '}
            {facts(
              context.administers ? messages.youAdminister : messages.youAreMember,
              context.workspace_id === null ? null : messages.workspaceRef(context.workspace_id),
            )}
          </li>
        ))}
      </ul>
      <LoadMore query={query} />
    </section>
  );
}
