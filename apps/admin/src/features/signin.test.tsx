import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { navigation } from '../session';
import { checkWcag } from '../test/a11y';
import { json, me, providerScope, signedInto, stub, visit } from '../test/bff';

// TDD-organization-experience-001 1.11.0 §The Sign-In Entry and TDD-organization-experience-002 1.9.0
// §The Picker After Sign-In: signed in without a Tenant, the person chooses one of their own contexts
// (ADR-ORG-005). No surface asks for a Tenant identifier.

const tenantA = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const tenantB = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const contextsPath = `/api/v1/principals/${me}/contexts`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  visit('/');
});

const context = (tenantId: string, name: string, administers: boolean, workspace: string | null = null) => ({
  membership_id: `m-${name}`,
  tenant_id: tenantId,
  tenant_display_name: name,
  tenant_status: 'active',
  workspace_id: workspace,
  administers,
});

const contexts =
  (...entries: ReturnType<typeof context>[]) =>
  (url: string): Response | undefined =>
    url === contextsPath ? json({ contexts: entries, next: null }) : undefined;

const noTenant = signedInto(null, providerScope(null));

describe('the picker after a sign-in without a Tenant', () => {
  it('lists several Tenants first, each a Tenant sign-in returning to the overview', async () => {
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => undefined);
    stub(noTenant, contexts(context(tenantA, 'Acme', true), context(tenantB, 'Beta', false, 'w-1')));
    const { container } = render(<App />);
    const list = await screen.findByRole('region', { name: 'Your Tenants' });
    const acme = await within(list).findByRole('link', { name: 'Acme' });
    expect(acme).toHaveAttribute(
      'href',
      `/auth/login?tenant=${tenantA}&return_to=${encodeURIComponent('/')}`,
    );
    expect(acme.closest('li')).toHaveTextContent('you administer it');
    expect(within(list).getByRole('link', { name: 'Beta' }).closest('li')).toHaveTextContent(
      'member · workspace w-1',
    );
    expect(list).toHaveTextContent('Choose the Tenant to work in.');

    // The Tenants come before provider administration, in the reading order too.
    const provider = screen.getByRole('region', { name: 'Provider administration' });
    expect(list.compareDocumentPosition(provider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(provider).getByRole('link', { name: 'Go to provider mode' })).toHaveAttribute(
      'href',
      '/provider-mode',
    );
    expect(screen.queryByRole('form', { name: 'Enter provider mode' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    const banner = screen.getByRole('region', { name: 'Active scope' });
    expect(banner).toHaveTextContent('Signed in without a Tenant: provider mode is not active');
    expect(assign).not.toHaveBeenCalled();
    expect(await checkWcag(container)).toHaveNoViolations();
  });

  it('lists a single Tenant without entering it by itself', async () => {
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => undefined);
    stub(noTenant, contexts(context(tenantA, 'Acme', true)));
    render(<App />);
    expect(await screen.findByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      `/auth/login?tenant=${tenantA}&return_to=${encodeURIComponent('/')}`,
    );
    // Give a navigation that would start by itself the time to start.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(assign).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
  });

  it('says what to do with no Tenant, and offers no identifier to type', async () => {
    stub(noTenant, contexts());
    render(<App />);
    const list = await screen.findByRole('region', { name: 'Your Tenants' });
    expect(
      await within(list).findByText('You hold no active membership in an active Tenant.', { exact: false }),
    ).toHaveTextContent('ask its administrator to invite you, then open the link they send you');
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('says Organization Control could not be reached when the list cannot be read', async () => {
    stub(noTenant, (url) =>
      url === contextsPath ? json({ detail: 'organization-control is unavailable' }, 503) : undefined,
    );
    render(<App />);
    const list = await screen.findByRole('region', { name: 'Your Tenants' });
    // A failed read is retried twice before the page says so (src/api/query.ts).
    expect(
      await within(list).findByText(
        'Organization Control could not be reached.',
        { exact: false },
        { timeout: 6_000 },
      ),
    ).toBeInTheDocument();
  }, 10_000);

  it('keeps the refused sign-in’s notice above the same list', async () => {
    visit('/?sign-in=failed');
    stub(noTenant, contexts(context(tenantA, 'Acme', true)));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in did not complete.');
    expect(await screen.findByRole('link', { name: 'Acme' })).toBeInTheDocument();
  });
});

describe('a deep link reached without a Tenant', () => {
  it('lists the person’s Tenants under the notice, each returning to the surface', async () => {
    visit('/memberships?status=active');
    stub(noTenant, contexts(context(tenantA, 'Acme', true)));
    render(<App />);
    expect(
      await screen.findByText('This section belongs to a Tenant scope.', { exact: false }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      `/auth/login?tenant=${tenantA}&return_to=${encodeURIComponent('/memberships?status=active')}`,
    );
  });
});

describe('the provider mode page', () => {
  it('holds the entry ceremony for a session without a Tenant', async () => {
    visit('/provider-mode');
    stub(noTenant, contexts());
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Provider mode', level: 2 })).toBeInTheDocument();
    expect(await screen.findByRole('form', { name: 'Enter provider mode' })).toBeInTheDocument();
  });

  it('in a Tenant scope, names the provider sign-in that leads to it', async () => {
    visit('/provider-mode');
    stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }), contexts());
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Switch to provider administration' })).toHaveAttribute(
        'href',
        `/auth/login?acr_values=aal2&max_age=0&return_to=${encodeURIComponent('/provider-mode')}`,
      );
    });
    expect(screen.queryByRole('form', { name: 'Enter provider mode' })).not.toBeInTheDocument();
  });
});
