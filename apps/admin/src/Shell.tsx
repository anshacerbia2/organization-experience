import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useState, type ReactElement, type ReactNode } from 'react';

import { sessionQueryKey } from './api/query';
import { ContextSwitcher } from './features/contexts';
import { Gate, gateClasses } from './Gate';
import { acceptancePath, waitingInvitationToken } from './invitationLink';
import { messages } from './messages';
import { ProviderClosed, ProviderModeGate } from './ProviderMode';
import { ScopeBanner, ScopeLine } from './ScopeBanner';
import { ScopeProvider, useScope, useWindowInForce } from './ScopeContext';
import { ProviderSignIn, SignIn } from './ScopeEntry';
import { providerModePath, signInOutcome, signOut } from './session';
import { SignedInProvider, useSessionQuery, useSignedIn } from './SessionContext';
import {
  AppFrame,
  barClasses,
  ButtonBase,
  Button,
  Icon,
  layout,
  navClasses,
  Notice,
  Page,
  PageHeader,
  PageTitle,
  Panel,
  ThemeToggle,
} from './ui';

// here is the path a sign-in returns to: where the browser is, on this origin.
export const here = (): string =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;

// Root picks the frame. The invitation acceptance page stands alone, outside the administration
// frame and its signed-out entry, because its visitor is often no administrator and its address bar
// must lose the token before anything reads the location (TDD-organization-experience-002 1.8.0).
export function Root(): ReactElement {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return path === acceptancePath ? <Outlet /> : <Shell />;
}

// Shell frames every view: the session, the scope banner, the navigation the active scope allows,
// and the view itself. It makes no authorization decision; the BFF's scope guard and the
// Organization Control API decide every request.
export function Shell(): ReactElement {
  const client = useQueryClient();
  const session = useSessionQuery();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const outcome = signInOutcome(window.location.search);
  const themeToggle = <ThemeToggle />;
  // A token waiting in this tab: a sign-in for an invitation that landed somewhere else, such as a
  // failed one, which lands at the root.
  const [invitationWaiting] = useState(() => waitingInvitationToken() !== null);

  // What the page says about the sign-in and the session before anything else.
  const notices = (
    <>
      {outcome === null ? null : (
        <Notice tone="danger" role="alert">
          <p>{outcome === 'failed' ? messages.signInFailed : messages.signInUnavailable}</p>
        </Notice>
      )}
      {session.isPending ? (
        <Notice tone="neutral" icon="clock">
          <p>{messages.checking}</p>
        </Notice>
      ) : null}
      {session.isError ? (
        <Notice tone="danger">
          <p>{messages.unavailable}</p>
        </Notice>
      ) : null}
      {invitationWaiting ? (
        <Notice tone="info" icon="mail" role="status">
          <p>
            {messages.invitationWaiting} <Link to={acceptancePath}>{messages.invitationContinue}</Link>
          </p>
        </Notice>
      ) : null}
    </>
  );

  // Signed out: the entry, alone on the canvas, as the kernel's hosted login stands
  // (TDD-identity-kernel-004 §Visual Language). One neutral sign-in, and the provider's apart under a
  // rule (TDD-organization-experience-001 1.11.0 §The Sign-In Entry). Neither takes a Tenant: the
  // person chooses one of their own after signing in.
  if (session.data?.authenticated !== true) {
    return (
      <Gate title={messages.title} description={session.data === undefined ? undefined : messages.signedOut}>
        {notices}
        {session.data === undefined ? null : (
          <div className={gateClasses.body}>
            <div className={gateClasses.entry}>
              <p className={gateClasses.lead}>{messages.signInLead}</p>
              <SignIn returnTo={here()} />
            </div>
            <div className={gateClasses.provider}>
              <p className={gateClasses.lead}>{messages.signInProviderLead}</p>
              <ProviderSignIn returnTo={providerModePath} label={messages.signInProvider} />
            </div>
          </div>
        )}
      </Gate>
    );
  }

  const signedIn = session.data;
  const onSignOut = (): void => {
    setSigningOut(true);
    setSignOutFailed(false);
    signOut(signedIn.csrfToken)
      .catch(() => {
        setSignOutFailed(true);
      })
      .finally(() => {
        setSigningOut(false);
        // Every view's data belonged to the session that ended.
        client.removeQueries({ predicate: (query) => query.queryKey[0] !== sessionQueryKey[0] });
        void client.invalidateQueries({ queryKey: sessionQueryKey });
      });
  };

  return (
    <SignedInProvider session={signedIn}>
      <ScopeProvider sessionTenantId={signedIn.tenantId}>
        <AppFrame
          title={messages.title}
          nav={<Navigation />}
          banner={<ScopeBanner />}
          line={<ScopeLine />}
          session={
            <>
              <span className={barClasses.who}>
                {signedIn.displayName ?? signedIn.principalId ?? messages.signedIn}
              </span>
              <ButtonBase className={barClasses.action ?? ''} disabled={signingOut} onClick={onSignOut}>
                {messages.signOut}
              </ButtonBase>
              <span className={barClasses.cell}>{themeToggle}</span>
            </>
          }
        >
          {notices}
          {signOutFailed ? (
            <Notice tone="danger" role="alert">
              <p>{messages.signOutFailed}</p>
            </Notice>
          ) : null}
          <Outlet />
        </AppFrame>
      </ScopeProvider>
    </SignedInProvider>
  );
}

interface NavLink {
  readonly to: string;
  readonly label: string;
}

// The navigation offers what the active scope allows, grouped by the scope each section acts in
// (TDD-organization-experience-001 §Visual Language): the Tenant's own, the provider mode's across
// Tenants, and the provider's approvals.
function Navigation(): ReactElement | null {
  const { state } = useScope();
  const inForce = useWindowInForce();
  if (state.status !== 'ready') {
    return null;
  }
  const groups: { id: string; label: string | null; links: NavLink[] }[] = [
    { id: 'home', label: null, links: [{ to: '/', label: messages.overview }] },
  ];
  if (state.scope.scope === 'tenant') {
    groups.push({
      id: 'tenant',
      label: messages.navGroupTenant,
      links: [
        { to: '/workspaces', label: messages.workspaces },
        { to: '/memberships', label: messages.memberships },
        { to: '/invitations', label: messages.invitations },
        { to: '/provider-access', label: messages.providerAccess },
      ],
    });
  } else {
    if (inForce) {
      groups.push({
        id: 'provider-mode',
        label: messages.navGroupProviderMode,
        links: [
          { to: '/organizations', label: messages.organizations },
          { to: '/tenants', label: messages.tenants },
          { to: '/offboardings', label: messages.offboardings },
          { to: '/projections', label: messages.projectionHealth },
          { to: '/reporters', label: messages.reporters },
          { to: '/access-review', label: messages.accessReview },
        ],
      });
    }
    groups.push({
      id: 'provider',
      label: messages.navGroupProvider,
      links: [{ to: '/approvals', label: messages.approvals }],
    });
  }
  return (
    <nav aria-label={messages.navigation} className={navClasses.nav}>
      {groups.map((group) => (
        <div key={group.id} className={navClasses.group}>
          {group.label === null ? null : (
            <p id={`nav-group-${group.id}`} className={navClasses.section}>
              {group.label}
            </p>
          )}
          <ul
            className={navClasses.list}
            aria-labelledby={group.label === null ? undefined : `nav-group-${group.id}`}
          >
            {group.links.map((link) => (
              <li key={link.to}>
                <Link
                  to={link.to}
                  className={navClasses.item}
                  activeProps={{ 'aria-current': 'page' }}
                  activeOptions={{ exact: link.to === '/' }}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

// Home offers what the active scope allows. In a Tenant scope: the person's other Tenants and the
// provider sign-in. Without a Tenant: the person's Tenants first, to choose one, then provider
// administration; a provider window open in the session comes first instead, with its one action
// (TDD-organization-experience-002 1.9.0 §The Picker After Sign-In).
export function Home(): ReactElement | null {
  const session = useSignedIn();
  const { state, reload } = useScope();
  if (state.status === 'loading') {
    return null;
  }
  if (state.status !== 'ready') {
    return (
      <div className={layout.actions}>
        <Button variant="secondary" onClick={reload}>
          {messages.scopeRetry}
        </Button>
      </div>
    );
  }
  const scope = state.scope;
  if (scope.scope === 'tenant') {
    return (
      <div className={layout.cards}>
        <ContextSwitcher returnTo={here()} current={scope.tenantId} />
        <ProviderAdministration>
          <ProviderSignIn returnTo={providerModePath} label={messages.switchToProvider} />
        </ProviderAdministration>
      </div>
    );
  }
  // Switching to a Tenant replaces the session; an open window is left first, so its activation ends
  // rather than outliving the session that asked for it.
  if (scope.window !== null) {
    return <ProviderModeGate scope={scope} csrfToken={session.csrfToken} returnTo={here()} />;
  }
  return (
    <div className={layout.stack}>
      <ProviderClosed scope={scope} />
      <div className={layout.cards}>
        <ContextSwitcher returnTo={here()} current={null} />
        <ProviderAdministration>
          <Button variant="secondary" href={providerModePath}>
            <Icon name="shield" />
            {messages.goToProviderMode}
          </Button>
        </ProviderAdministration>
      </div>
    </div>
  );
}

// ProviderAdministration is the overview's way to provider mode, below the person's Tenants.
function ProviderAdministration({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <Panel.Root aria-labelledby="provider-administration-heading">
      <Panel.Header>
        <Panel.Title id="provider-administration-heading">{messages.providerAdministration}</Panel.Title>
        <Panel.Description>{messages.providerAdministrationLead}</Panel.Description>
      </Panel.Header>
      <div className={layout.actions}>{children}</div>
    </Panel.Root>
  );
}

// ProviderModePage holds the provider mode ceremony: the form, or the open window with its one action.
// The provider sign-in returns here (TDD-organization-experience-001 1.11.0).
export function ProviderModePage(): ReactElement | null {
  const session = useSignedIn();
  const { state } = useScope();
  if (state.status !== 'ready' || state.scope.scope !== 'provider') {
    return null;
  }
  return (
    <Page aria-labelledby="provider-mode-heading">
      <PageHeader>
        <PageTitle id="provider-mode-heading">{messages.providerModePage}</PageTitle>
      </PageHeader>
      <ProviderModeGate scope={state.scope} csrfToken={session.csrfToken} returnTo={providerModePath} />
    </Page>
  );
}

// RequireScope renders a surface only in the scope it belongs to, and otherwise says which scope it
// needs. The BFF refuses the requests anyway; this keeps the operator from making them.
export function RequireScope({
  scope,
  children,
}: {
  readonly scope: 'tenant' | 'provider-mode' | 'provider';
  readonly children: (tenantId: string) => ReactNode;
}): ReactElement | null {
  const { state } = useScope();
  const inForce = useWindowInForce();
  if (state.status !== 'ready') {
    return null;
  }
  const active = state.scope;
  if (scope === 'tenant' && active.scope === 'tenant') {
    return <>{children(active.tenantId)}</>;
  }
  if (scope === 'provider' && active.scope === 'provider') {
    return <>{children('')}</>;
  }
  if (scope === 'provider-mode' && inForce) {
    return <>{children('')}</>;
  }
  // The way to the scope the surface needs, under the sentence that names it: the person's Tenants,
  // each returning here, so a deep link ends on its surface after one choice; the provider sign-in;
  // or the provider mode page.
  let way: ReactNode = null;
  if (scope === 'tenant' && active.scope === 'provider' && active.window === null) {
    way = <ContextSwitcher returnTo={here()} current={null} />;
  } else if (scope !== 'tenant' && active.scope === 'tenant') {
    way = (
      <div className={layout.actions}>
        <ProviderSignIn returnTo={providerModePath} label={messages.switchToProvider} />
      </div>
    );
  } else if (scope === 'provider-mode') {
    way = (
      <div className={layout.actions}>
        <Button variant="secondary" href={providerModePath}>
          <Icon name="shield" />
          {messages.goToProviderMode}
        </Button>
      </div>
    );
  }
  return (
    <div className={layout.stack}>
      <Notice tone="warning" icon="shield" role="status">
        <p>
          {scope === 'tenant'
            ? messages.needsTenantScope
            : scope === 'provider'
              ? messages.needsProvider
              : messages.needsProviderMode}
        </p>
      </Notice>
      {way}
    </div>
  );
}
