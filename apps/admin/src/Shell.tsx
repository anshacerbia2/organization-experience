import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet } from '@tanstack/react-router';
import { useState, type ReactElement, type ReactNode } from 'react';

import { sessionQueryKey } from './api/query';
import { ContextSwitcher } from './features/contexts';
import { messages } from './messages';
import { ProviderModeGate } from './ProviderMode';
import { ScopeBanner } from './ScopeBanner';
import { ScopeProvider, useScope, useWindowInForce } from './ScopeContext';
import { ProviderSignIn, TenantSignIn } from './ScopeEntry';
import { signInOutcome, signOut } from './session';
import { SignedInProvider, useSessionQuery, useSignedIn } from './SessionContext';
import shellStyles from './Shell.module.scss';
import {
  AppFrame,
  Button,
  Icon,
  layout,
  navClasses,
  Notice,
  Panel,
  StatusPill,
  ThemeToggle,
  useTheme,
  type IconName,
} from './ui';

// here is the path a sign-in returns to: where the browser is, on this origin.
export const here = (): string =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;

// Shell frames every view: the session, the scope banner, the navigation the active scope allows,
// and the view itself. It makes no authorization decision; the BFF's scope guard and the
// Organization Control API decide every request.
export function Shell(): ReactElement {
  const client = useQueryClient();
  const session = useSessionQuery();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const outcome = signInOutcome(window.location.search);
  const { theme, choose } = useTheme();
  const themeToggle = <ThemeToggle theme={theme} onChoose={choose} />;

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
    </>
  );

  // Signed out: the entry, alone on the canvas, as the kernel's hosted login stands
  // (TDD-identity-kernel-004 §Visual Language).
  if (session.data?.authenticated !== true) {
    return (
      <div className={shellStyles['gate']}>
        <div className={shellStyles['gateTheme']}>{themeToggle}</div>
        <main className={shellStyles['gateMain']}>
          <div className={shellStyles['gateBrand']}>
            <span className={shellStyles['gateMark']} aria-hidden="true">
              <Icon name="shield" />
            </span>
            <span className={shellStyles['gateBrandName']}>{messages.brand}</span>
          </div>
          <Panel.Root elevation="floating">
            <Panel.Header>
              <h1 className={shellStyles['gateTitle']}>{messages.title}</h1>
              {session.data === undefined ? null : (
                <Panel.Description>{messages.signedOut}</Panel.Description>
              )}
            </Panel.Header>
            {notices}
            {session.data === undefined ? null : (
              <div className={shellStyles['gateBody']}>
                <TenantSignIn returnTo={here()} label={messages.signInTenant} />
                <div className={shellStyles['gateProvider']}>
                  <ProviderSignIn returnTo={here()} label={messages.signInProvider} />
                </div>
              </div>
            )}
          </Panel.Root>
        </main>
      </div>
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
          session={
            <>
              <StatusPill tone="success">
                {signedIn.displayName ?? signedIn.principalId ?? messages.signedIn}
              </StatusPill>{' '}
              <Button
                variant="ghost"
                size="sm"
                icon={<Icon name="logout" />}
                disabled={signingOut}
                onClick={onSignOut}
              >
                {messages.signOut}
              </Button>
              {themeToggle}
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
  readonly icon: IconName;
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
    { id: 'home', label: null, links: [{ to: '/', label: messages.overview, icon: 'grid' }] },
  ];
  if (state.scope.scope === 'tenant') {
    groups.push({
      id: 'tenant',
      label: messages.navGroupTenant,
      links: [
        { to: '/workspaces', label: messages.workspaces, icon: 'layers' },
        { to: '/memberships', label: messages.memberships, icon: 'users' },
        { to: '/invitations', label: messages.invitations, icon: 'mail' },
        { to: '/provider-access', label: messages.providerAccess, icon: 'eye' },
      ],
    });
  } else {
    if (inForce) {
      groups.push({
        id: 'provider-mode',
        label: messages.navGroupProviderMode,
        links: [
          { to: '/organizations', label: messages.organizations, icon: 'building' },
          { to: '/tenants', label: messages.tenants, icon: 'globe' },
          { to: '/offboardings', label: messages.offboardings, icon: 'archive' },
          { to: '/projections', label: messages.projectionHealth, icon: 'pulse' },
          { to: '/access-review', label: messages.accessReview, icon: 'review' },
        ],
      });
    }
    groups.push({
      id: 'provider',
      label: messages.navGroupProvider,
      links: [{ to: '/approvals', label: messages.approvals, icon: 'key' }],
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
                  <span className={navClasses.icon}>
                    <Icon name={link.icon} />
                  </span>
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

// Home offers what the active scope allows: moving to another scope, and in provider scope the
// provider mode ceremony.
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
        <Panel.Root>
          <TenantSignIn returnTo={here()} label={messages.switchTenant} />
          <div className={layout.actions}>
            <ProviderSignIn returnTo={here()} label={messages.switchToProvider} />
          </div>
        </Panel.Root>
      </div>
    );
  }
  return (
    <div className={layout.stack}>
      <ProviderModeGate scope={scope} csrfToken={session.csrfToken} returnTo={here()} />
      {/* Switching to a Tenant replaces the session; an open window is left first, so its
          activation ends rather than outliving the session that asked for it. */}
      {scope.window === null ? (
        <div className={layout.cards}>
          <ContextSwitcher returnTo={here()} current={null} />
          <Panel.Root>
            <TenantSignIn returnTo={here()} label={messages.signInTenant} />
          </Panel.Root>
        </div>
      ) : null}
    </div>
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
  return (
    <Notice tone="warning" icon="shield" role="status">
      <p>
        {scope === 'tenant'
          ? messages.needsTenantScope
          : scope === 'provider'
            ? messages.needsProvider
            : messages.needsProviderMode}
      </p>
    </Notice>
  );
}
