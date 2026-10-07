import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { headersOf, inForce, json, me, providerScope, sent, signedInto, stub, visit } from '../test/bff';

// TDD-organization-experience-002 and -003 1.3.0: the context switcher (ADR-ORG-005), projection
// health, provisioning outcomes, and cancelling an offboarding (ADR-ORG-006).

const tenantA = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const tenantB = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const offboardingId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d02';

afterEach(() => {
  vi.unstubAllGlobals();
  visit('/');
});

// A fresh response each time: a Response body is read once.
const contexts = (): Response =>
  json({
    contexts: [
      {
        membership_id: 'm-a',
        tenant_id: tenantA,
        tenant_display_name: 'Acme',
        tenant_status: 'active',
        workspace_id: null,
        administers: true,
      },
      {
        membership_id: 'm-b',
        tenant_id: tenantB,
        tenant_display_name: 'Beta',
        tenant_status: 'active',
        workspace_id: 'w-1',
        administers: false,
      },
    ],
    next: null,
  });

describe('the context switcher', () => {
  it('lists the operator’s own Tenants, marks the current one, and switches by signing in', async () => {
    stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }), (url) =>
      url === `/api/v1/principals/${me}/contexts` ? contexts() : undefined,
    );
    render(<App />);
    const list = await screen.findByRole('region', { name: 'Your Tenants' });
    expect(await within(list).findByText('Acme (current)')).toBeInTheDocument();
    expect(within(list).getByText('Acme (current)').closest('li')).toHaveTextContent('you administer it');
    const beta = within(list).getByRole('link', { name: 'Beta' });
    expect(beta).toHaveAttribute(
      'href',
      `/auth/login?tenant=${tenantB}&return_to=${encodeURIComponent('/')}`,
    );
    expect(beta.closest('li')).toHaveTextContent('member · workspace w-1');
  });

  it('is offered to a provider sign-in with no window, to pick a Tenant', async () => {
    stub(signedInto(null, providerScope(null)), (url) =>
      url === `/api/v1/principals/${me}/contexts` ? contexts() : undefined,
    );
    render(<App />);
    expect(await screen.findByRole('link', { name: 'Acme' })).toBeInTheDocument();
  });
});

describe('projection health', () => {
  it('marks a consumer past its budget as stale, naming its stale behaviour', async () => {
    visit('/projections');
    stub(signedInto(null, providerScope(inForce)), (url) =>
      url === '/api/v1/projections/consumers'
        ? json({
            consumers: [
              {
                consumer_id: 'billing',
                state: 'active',
                max_accepted_age_seconds: 30,
                stale_behavior: 'use_with_marker',
                last_reported_at: '2026-10-07T10:00:00Z',
                stale: true,
              },
              {
                consumer_id: 'identity-control',
                state: 'active',
                max_accepted_age_seconds: 10,
                stale_behavior: 'fail_closed',
                last_reported_at: new Date().toISOString(),
                stale: false,
              },
            ],
            next: null,
          })
        : undefined,
    );
    render(<App />);
    const billing = (await screen.findByText('billing')).closest('li') as HTMLElement;
    expect(within(billing).getByRole('status')).toHaveTextContent(
      'Stale: past its budget. It applies its stale behaviour, use with marker.',
    );
    const identity = screen.getByText('identity-control').closest('li') as HTMLElement;
    expect(within(identity).queryByRole('status')).not.toBeInTheDocument();
    expect(identity).toHaveTextContent('when stale: fail closed');
  });
});

describe('provisioning', () => {
  it('shows an unresolved provisioning as unknown, and offers no retry', async () => {
    visit('/tenants');
    stub(signedInto(null, providerScope(inForce)), (url) => {
      if (url === '/api/v1/tenants') {
        return json({
          tenants: [
            {
              tenant_id: tenantA,
              organization_id: 'org-1',
              display_name: 'Acme',
              status: 'provisioning',
              isolation_profile: 'pooled',
              version: 2,
              security_version: 1,
              created_at: '2026-10-01T00:00:00Z',
            },
          ],
          next: null,
        });
      }
      if (url === `/api/v1/tenants/${tenantA}`) {
        return json({
          tenant_id: tenantA,
          display_name: 'Acme',
          status: 'provisioning',
          version: 2,
          provisioning: { request_id: 'r-1', correlation_id: 'corr-9', state: 'unresolved' },
        });
      }
      return undefined;
    });
    render(<App />);
    const status = await screen.findByText(/Provisioning outcome unknown \(corr-9\)/);
    expect(status).toHaveTextContent('Do not retry');
    expect(
      within(status.closest('li') as HTMLElement).queryByRole('button', { name: /retry/i }),
    ).not.toBeInTheDocument();
  });
});

describe('cancelling an offboarding', () => {
  const record = (overrides: Record<string, unknown> = {}) => ({
    offboarding_id: offboardingId,
    tenant_id: tenantA,
    stage: 'freeze',
    legal_hold: false,
    started_at: new Date().toISOString(),
    obligations_at: null,
    released_at: null,
    deprovisioning: null,
    active_memberships: 12,
    ...overrides,
  });
  const detail =
    (offboarding: unknown) =>
    (url: string): Response | undefined =>
      url === `/api/v1/offboardings/${offboardingId}`
        ? json(offboarding)
        : url === `/api/v1/offboardings/${offboardingId}/obligations`
          ? json({ obligations: [], outstanding: [] })
          : url === `/api/v1/tenants/${tenantA}`
            ? json({ tenant_id: tenantA, display_name: 'Acme', status: 'offboarding', version: 9 })
            : undefined;

  it('is offered before release, with a reason and the Tenant’s version, saying what it restores', async () => {
    visit(`/offboardings/${offboardingId}`);
    const fetchMock = stub(signedInto(null, providerScope(inForce)), (url, init) =>
      url.endsWith('/cancel') && init?.method === 'POST'
        ? json(record({ stage: 'cancelled' }))
        : detail(record())(url),
    );
    render(<App />);
    expect(await screen.findByText(/it can be cancelled until release/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Cancel this offboarding' })[0]).toBeEnabled();
    });
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Cancel this offboarding' })[0] as HTMLElement,
    );
    const form = screen.getByRole('form', { name: 'Cancel this offboarding' });
    expect(form).toHaveTextContent('restores access for the memberships the freeze suspended');
    await userEvent.type(within(form).getByLabelText('Reason'), 'Offboarded the wrong Tenant by mistake');
    await userEvent.click(within(form).getByRole('button', { name: 'Cancel this offboarding' }));
    await waitFor(() => {
      expect(sent(fetchMock, `/api/v1/offboardings/${offboardingId}/cancel`)).toHaveLength(1);
    });
    const [init] = sent(fetchMock, `/api/v1/offboardings/${offboardingId}/cancel`);
    expect(JSON.parse(init?.body as string)).toEqual({ expected_version: 9 });
    expect(headersOf(init)['x-administrative-reason']).toBe('Offboarded the wrong Tenant by mistake');
  });

  it('is not offered from release on, and a cancelled offboarding says who cancelled it and why', async () => {
    visit(`/offboardings/${offboardingId}`);
    stub(
      signedInto(null, providerScope(inForce)),
      detail(record({ stage: 'release', active_memberships: 0 })),
    );
    const { unmount } = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Retirement' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel this offboarding' })).not.toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();

    stub(
      signedInto(null, providerScope(inForce)),
      detail(
        record({
          stage: 'cancelled',
          cancelled_by: 'prn-x',
          cancelled_at: '2026-10-07T12:00:00Z',
          cancel_reason: 'wrong Tenant',
        }),
      ),
    );
    render(<App />);
    expect(await screen.findByText(/Cancelled by prn-x, .*: wrong Tenant\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set legal hold' })).not.toBeInTheDocument();
  });
});
