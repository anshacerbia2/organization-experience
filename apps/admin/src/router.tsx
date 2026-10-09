import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';

import { ApprovalsPage } from './features/approvals';
import { OffboardingDetail, OffboardingsPage } from './features/offboarding';
import { ProjectionsPage } from './features/projections';
import { OrganizationsPage, TenantsPage } from './features/provider';
import { AccessReviewPage, TenantProviderAccessPage } from './features/review';
import { InvitationsPage, MembershipsPage, WorkspacesPage } from './features/tenant';
import { Home, RequireScope, Shell } from './Shell';

// The application's routes. Each surface states the scope it belongs to; the BFF's scope guard
// refuses the requests of any other. Each route is declared with its literal path, so links and
// parameters are typed against it.
const root = createRootRoute({ component: Shell });

const home = createRoute({ getParentRoute: () => root, path: '/', component: Home });

const workspaces = createRoute({
  getParentRoute: () => root,
  path: '/workspaces',
  component: () => (
    <RequireScope scope="tenant">{(tenantId) => <WorkspacesPage tenantId={tenantId} />}</RequireScope>
  ),
});

const memberships = createRoute({
  getParentRoute: () => root,
  path: '/memberships',
  component: () => (
    <RequireScope scope="tenant">{(tenantId) => <MembershipsPage tenantId={tenantId} />}</RequireScope>
  ),
});

const invitations = createRoute({
  getParentRoute: () => root,
  path: '/invitations',
  component: () => <RequireScope scope="tenant">{() => <InvitationsPage />}</RequireScope>,
});

const organizations = createRoute({
  getParentRoute: () => root,
  path: '/organizations',
  component: () => <RequireScope scope="provider-mode">{() => <OrganizationsPage />}</RequireScope>,
});

const tenants = createRoute({
  getParentRoute: () => root,
  path: '/tenants',
  component: () => <RequireScope scope="provider-mode">{() => <TenantsPage />}</RequireScope>,
});

const offboardings = createRoute({
  getParentRoute: () => root,
  path: '/offboardings',
  component: () => <RequireScope scope="provider-mode">{() => <OffboardingsPage />}</RequireScope>,
});

const offboarding = createRoute({
  getParentRoute: () => root,
  path: '/offboardings/$offboardingId',
  component: () => <RequireScope scope="provider-mode">{() => <OffboardingDetail />}</RequireScope>,
});

const projections = createRoute({
  getParentRoute: () => root,
  path: '/projections',
  component: () => <RequireScope scope="provider-mode">{() => <ProjectionsPage />}</RequireScope>,
});

// The provider-access review needs a window in force: the record is read by a provider in force
// (ADR-ORG-002 §5.6). A Tenant's read of the provider access to it is a Tenant surface.
const accessReview = createRoute({
  getParentRoute: () => root,
  path: '/access-review',
  component: () => <RequireScope scope="provider-mode">{() => <AccessReviewPage />}</RequireScope>,
});

const providerAccess = createRoute({
  getParentRoute: () => root,
  path: '/provider-access',
  component: () => <RequireScope scope="tenant">{() => <TenantProviderAccessPage />}</RequireScope>,
});

const approvals = createRoute({
  getParentRoute: () => root,
  path: '/approvals',
  component: () => <RequireScope scope="provider">{() => <ApprovalsPage />}</RequireScope>,
});

const routeTree = root.addChildren([
  home,
  workspaces,
  memberships,
  invitations,
  organizations,
  tenants,
  offboardings,
  offboarding,
  projections,
  accessReview,
  providerAccess,
  approvals,
]);

export const createAppRouter = () => createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
