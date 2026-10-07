import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';

import { ApprovalsPage } from './features/approvals';
import { OrganizationsPage, TenantsPage } from './features/provider';
import { InvitationsPage, MembershipsPage, WorkspacesPage } from './features/tenant';
import { Home, RequireScope, Shell } from './Shell';

// The application's routes. Each surface states the scope it belongs to; the BFF's scope guard
// refuses the requests of any other.
const root = createRootRoute({ component: Shell });

const page = (path: string, component: () => React.ReactElement) =>
  createRoute({ getParentRoute: () => root, path, component });

const routeTree = root.addChildren([
  page('/', () => <Home />),
  page('/workspaces', () => (
    <RequireScope scope="tenant">{(tenantId) => <WorkspacesPage tenantId={tenantId} />}</RequireScope>
  )),
  page('/memberships', () => (
    <RequireScope scope="tenant">{(tenantId) => <MembershipsPage tenantId={tenantId} />}</RequireScope>
  )),
  page('/invitations', () => <RequireScope scope="tenant">{() => <InvitationsPage />}</RequireScope>),
  page('/organizations', () => (
    <RequireScope scope="provider-mode">{() => <OrganizationsPage />}</RequireScope>
  )),
  page('/tenants', () => <RequireScope scope="provider-mode">{() => <TenantsPage />}</RequireScope>),
  page('/approvals', () => <RequireScope scope="provider">{() => <ApprovalsPage />}</RequireScope>),
]);

export const createAppRouter = () => createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
