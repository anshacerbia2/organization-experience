import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { App } from '../App';
import { headersOf, inForce, json, providerScope, sent, signedInto, stub, visit } from '../test/bff';

// TDD-organization-experience-003 1.2.0 §Testing Strategy, against a stubbed BFF.

const tenantId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d01';
const offboardingId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d02';
const provider = signedInto(null, providerScope(inForce));

const tenantRow = {
  tenant_id: tenantId,
  organization_id: 'org-1',
  display_name: 'Acme',
  status: 'active',
  isolation_profile: 'pooled',
  version: 6,
  security_version: 2,
  created_at: '2026-01-01T00:00:00Z',
};

const offboarding = (overrides: Record<string, unknown> = {}) => ({
  offboarding_id: offboardingId,
  tenant_id: tenantId,
  stage: 'freeze',
  reason: 'Contract ended',
  legal_hold: false,
  started_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  obligations_at: null,
  released_at: null,
  deprovisioning: null,
  active_memberships: 240,
  ...overrides,
});

const obligation = (overrides: Record<string, unknown>) => ({
  obligation_id: `ob-${String(overrides.domain)}`,
  offboarding_id: offboardingId,
  tenant_id: tenantId,
  domain: 'HCM',
  type: 'workforce export',
  state: 'open',
  ...overrides,
});

// detail answers the offboarding, its board and its Tenant.
const detail =
  (record: unknown, obligations: unknown[] = []) =>
  (url: string) =>
    url === `/api/v1/offboardings/${offboardingId}`
      ? json(record)
      : url === `/api/v1/offboardings/${offboardingId}/obligations`
        ? json({ obligations, outstanding: [] })
        : url === `/api/v1/tenants/${tenantId}`
          ? json({
              ...tenantRow,
              status: 'offboarding',
              offboarding_id: offboardingId,
              active_memberships: 0,
            })
          : undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  visit('/');
});

describe('beginning', () => {
  it('names the count from the API, needs a reason and the name typed, and opens the offboarding', async () => {
    visit('/tenants');
    const fetchMock = stub(provider, (url, init) => {
      if (url === '/api/v1/tenants') {
        return json({ tenants: [tenantRow], next: null });
      }
      if (url === `/api/v1/tenants/${tenantId}`) {
        return json({ ...tenantRow, offboarding_id: null, active_memberships: 847 });
      }
      if (url === '/api/v1/offboardings' && init?.method === 'POST') {
        return json(offboarding(), 201);
      }
      return detail(offboarding())(url);
    });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Offboarding' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Begin offboarding' }));
    const form = screen.getByRole('form', { name: 'Begin offboarding' });
    expect(form).toHaveTextContent('This suspends 847 memberships now and stops access. Nothing is deleted.');
    expect(form).toHaveTextContent(`In Tenant Acme (${tenantId})`);

    await userEvent.type(within(form).getByLabelText('Reason'), 'Customer contract ended in September');
    await userEvent.type(within(form).getByLabelText('Type Acme to confirm'), 'Acm');
    await userEvent.click(within(form).getByRole('button', { name: 'Begin offboarding' }));
    expect(sent(fetchMock, '/api/v1/offboardings')).toHaveLength(0);

    await userEvent.type(within(form).getByLabelText('Type Acme to confirm'), 'e');
    await userEvent.click(within(form).getByRole('button', { name: 'Begin offboarding' }));
    await waitFor(() => {
      expect(sent(fetchMock, '/api/v1/offboardings')).toHaveLength(1);
    });
    const [init] = sent(fetchMock, '/api/v1/offboardings');
    expect(JSON.parse(init?.body as string)).toEqual({ tenant_id: tenantId, expected_version: 6 });
    expect(headersOf(init)['x-administrative-reason']).toBe('Customer contract ended in September');
    expect(await screen.findByRole('heading', { name: 'Offboarding of Acme' })).toBeInTheDocument();
  });

  it('resumes an offboarding already under way, and offers no way to start again', async () => {
    visit('/tenants');
    stub(provider, (url) => {
      if (url === '/api/v1/tenants') {
        return json({ tenants: [{ ...tenantRow, status: 'offboarding' }], next: null });
      }
      if (url === `/api/v1/tenants/${tenantId}`) {
        return json({
          ...tenantRow,
          status: 'offboarding',
          offboarding_id: offboardingId,
          active_memberships: 0,
        });
      }
      return undefined;
    });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Offboarding' }));
    expect(await screen.findByRole('link', { name: 'Resume its offboarding' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Begin offboarding' })).not.toBeInTheDocument();
    expect(screen.queryByText(/restart/i)).not.toBeInTheDocument();
  });
});

describe('stages', () => {
  it('states what the freeze stops, never that it is reversible, and freezes in batches', async () => {
    visit(`/offboardings/${offboardingId}`);
    const fetchMock = stub(provider, (url, init) =>
      url.endsWith('/freeze') && init?.method === 'POST'
        ? json({ affected: 100 })
        : detail(offboarding())(url),
    );
    const { container } = render(<App />);
    expect(await screen.findByText(/240 memberships are still active/)).toBeInTheDocument();
    expect(
      screen.getByText(/stops access for every membership in the Tenant. Nothing is deleted./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/reversible/i)).not.toBeInTheDocument();
    expect(screen.getByText(/In Freeze since .*, 2 days./)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Suspend the next 100' }));
    await waitFor(() => {
      expect(sent(fetchMock, `/api/v1/offboardings/${offboardingId}/freeze`)).toHaveLength(1);
    });
    expect(
      JSON.parse(sent(fetchMock, `/api/v1/offboardings/${offboardingId}/freeze`)[0]?.body as string),
    ).toEqual({
      size: 100,
    });
    expect(screen.queryByRole('button', { name: 'Complete the freeze' })).not.toBeInTheDocument();
  });

  it('flags a stage that has stalled past thirty days', async () => {
    visit(`/offboardings/${offboardingId}`);
    stub(provider, detail(offboarding({ started_at: new Date(Date.now() - 40 * 86_400_000).toISOString() })));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('more than 30 days');
  });
});

describe('the obligation board', () => {
  it('shows waived apart from completed, overdue as overdue, and no control to resolve another domain’s row', async () => {
    visit(`/offboardings/${offboardingId}`);
    stub(
      provider,
      detail(
        offboarding({
          stage: 'obligations',
          active_memberships: 0,
          obligations_at: new Date().toISOString(),
        }),
        [
          obligation({ domain: 'Document', type: 'export delivery', due_at: '2026-01-01T00:00:00Z' }),
          obligation({
            domain: 'Billing',
            type: 'final invoice',
            state: 'waived',
            resolved_by: 'prn-b',
            detail: 'credited',
          }),
          obligation({ domain: 'HCM', state: 'completed', resolved_by: 'prn-h' }),
        ],
      ),
    );
    render(<App />);
    const board = await screen.findByRole('table', { name: 'Obligations' });
    const rows = within(board).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('overdue');
    expect(rows[0]).toHaveTextContent('Resolved by the Document domain, not here.');
    expect(rows[1]).toHaveTextContent('waived: decided not to be done');
    expect(rows[1]).toHaveTextContent('by prn-b');
    expect(rows[2]).toHaveTextContent('completed');
    expect(within(board).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('release waits on the open obligations, listed as rows', async () => {
    visit(`/offboardings/${offboardingId}`);
    stub(
      provider,
      detail(offboarding({ stage: 'obligations', active_memberships: 0 }), [
        obligation({ domain: 'Audit', type: 'evidence retention' }),
      ]),
    );
    render(<App />);
    const waits = await screen.findByText('Release waits on these obligations:');
    expect(waits.parentElement).toHaveTextContent('Audit · evidence retention · open');
    expect(screen.getByRole('button', { name: 'Release' })).toBeDisabled();
  });
});

describe('legal hold', () => {
  it('names what it blocks and what proceeds, and disables release with the hold as the cause', async () => {
    visit(`/offboardings/${offboardingId}`);
    stub(provider, detail(offboarding({ stage: 'obligations', legal_hold: true, active_memberships: 0 })));
    render(<App />);
    const banner = await screen.findByRole('region', { name: 'Legal hold is set' });
    expect(banner).toHaveTextContent('Freeze proceeds');
    expect(banner).toHaveTextContent('Obligations proceeds');
    expect(banner).toHaveTextContent('Release is blocked');
    expect(banner).toHaveTextContent('Retirement is blocked');
    expect(screen.getByText('Release is blocked by the legal hold.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Release' })).toBeDisabled();
  });
});

describe('retirement', () => {
  it('waits on a deprovisioning with no outcome, retrying nothing', async () => {
    visit(`/offboardings/${offboardingId}`);
    stub(
      provider,
      detail(
        offboarding({
          stage: 'release',
          active_memberships: 0,
          deprovisioning: {
            state: 'requested',
            detail: null,
            requested_at: new Date().toISOString(),
            resolved_at: null,
          },
        }),
      ),
    );
    render(<App />);
    expect(
      await screen.findByText(/has no outcome yet. Retirement waits; nothing is retried here./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retire' })).toBeDisabled();
  });

  it('retires with the Tenant’s version, a reason and the name typed, stating it cannot be undone', async () => {
    visit(`/offboardings/${offboardingId}`);
    const fetchMock = stub(provider, (url, init) =>
      url.endsWith('/retire') && init?.method === 'POST'
        ? json(offboarding({ stage: 'retired' }))
        : detail(
            offboarding({
              stage: 'release',
              active_memberships: 0,
              deprovisioning: {
                state: 'realized',
                detail: null,
                requested_at: new Date().toISOString(),
                resolved_at: new Date().toISOString(),
              },
            }),
          )(url),
    );
    render(<App />);
    // Retirement is enabled once the Tenant's version has been read.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retire' })).toBeEnabled();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Retire' }));
    const form = screen.getByRole('form', { name: 'Retire' });
    expect(form).toHaveTextContent('This cannot be undone.');
    await userEvent.type(within(form).getByLabelText('Reason'), 'All obligations met and data released');
    await userEvent.type(within(form).getByLabelText('Type Acme to confirm'), 'Acme');
    await userEvent.click(within(form).getByRole('button', { name: 'Retire' }));
    await waitFor(() => {
      expect(sent(fetchMock, `/api/v1/offboardings/${offboardingId}/retire`)).toHaveLength(1);
    });
    expect(
      JSON.parse(sent(fetchMock, `/api/v1/offboardings/${offboardingId}/retire`)[0]?.body as string),
    ).toEqual({
      expected_version: 6,
    });
  });
});
