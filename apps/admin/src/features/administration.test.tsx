import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { App } from '../App';

// TDD-organization-experience-002 1.2.0 §Testing Strategy: the administration surfaces against a
// stubbed BFF, through the application's own router.

const tenantA = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const me = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aaa';

const session = (tenantId: string | null) => ({
  authenticated: true,
  principalId: me,
  displayName: 'Ada Admin',
  acr: 'aal2',
  authTime: new Date().toISOString(),
  tenantId,
  idleExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  absoluteExpiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString(),
  csrfToken: 'csrf-token',
});

const providerScope = (window: unknown) => ({
  scope: 'provider',
  acr: 'aal2',
  authTime: new Date().toISOString(),
  limits: { maxDurationMinutes: 60, defaultDurationMinutes: 15 },
  window,
});

const inForce = {
  state: 'in-force',
  emergency: false,
  reason: 'Investigating a stuck offboarding',
  correlationId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aff',
  tenants: 'all',
  durationMinutes: 15,
  requestedAt: new Date().toISOString(),
  endsAt: new Date(Date.now() + 15 * 60_000).toISOString(),
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

type Handler = (url: string, init: RequestInit | undefined) => Response | undefined;

// stub answers the BFF: each handler may answer a request; the first that does wins.
function stub(...handlers: Handler[]) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    for (const handler of handlers) {
      const answer = handler(input, init);
      if (answer !== undefined) {
        return Promise.resolve(answer);
      }
    }
    return Promise.resolve(json({ detail: `unexpected ${input}` }, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const signedInto =
  (tenantId: string | null, scope: unknown): Handler =>
  (url) =>
    url === '/auth/session' ? json(session(tenantId)) : url === '/auth/scope' ? json(scope) : undefined;

const sent = (fetchMock: ReturnType<typeof stub>, path: string) =>
  fetchMock.mock.calls.filter(([url]) => url === path).map(([, init]) => init);

const headersOf = (init: RequestInit | undefined): Record<string, string> =>
  (init?.headers ?? {}) as Record<string, string>;

const visit = (path: string): void => {
  window.history.replaceState(null, '', path);
};

afterEach(() => {
  vi.unstubAllGlobals();
  visit('/');
});

const workspace = (version: number, status = 'active') => ({
  workspace_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b01',
  tenant_id: tenantA,
  display_name: 'Finance',
  type: 'department',
  status,
  version,
  created_at: '2026-10-01T00:00:00Z',
});

describe('navigation', () => {
  it('offers the Tenant surfaces in a Tenant scope, and not the provider ones', async () => {
    stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }));
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Sections' });
    expect(within(nav).getByRole('link', { name: 'Memberships' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Tenants' })).not.toBeInTheDocument();
  });

  it('offers the Organization registry and Tenants only while provider mode is in force', async () => {
    stub(signedInto(null, providerScope(null)));
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Sections' });
    expect(within(nav).getByRole('link', { name: 'Activation requests' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Organizations' })).not.toBeInTheDocument();
  });

  it('a surface reached in the wrong scope says which scope it needs, and asks nothing of the API', async () => {
    visit('/tenants');
    const fetchMock = stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }));
    render(<App />);
    expect(await screen.findByRole('status')).toHaveTextContent('opens in provider mode');
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/'))).toBe(false);
  });
});

describe('workspaces', () => {
  it('pages by keyset, and the next page continues after the last item', async () => {
    visit('/workspaces');
    const fetchMock = stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }), (url) => {
      if (url === '/api/v1/workspaces') {
        return json({ workspaces: [workspace(3)], next: 'cursor-1' });
      }
      if (url === '/api/v1/workspaces?after=cursor-1') {
        return json({
          workspaces: [{ ...workspace(1), workspace_id: 'w2', display_name: 'Legal' }],
          next: null,
        });
      }
      return undefined;
    });
    const { container } = render(<App />);
    expect(await screen.findByText('Finance')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Legal')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/workspaces?after=cursor-1', expect.anything());
  });

  it('a filter starts again from the first page', async () => {
    visit('/workspaces');
    const fetchMock = stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }), (url) =>
      url.startsWith('/api/v1/workspaces') ? json({ workspaces: [], next: null }) : undefined,
    );
    render(<App />);
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'archived');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/workspaces?status=archived', expect.anything());
    });
  });

  it('archives with the version shown, an idempotency key and the CSRF token', async () => {
    visit('/workspaces');
    const fetchMock = stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }), (url, init) => {
      if (url === '/api/v1/workspaces') {
        return json({ workspaces: [workspace(3)], next: null });
      }
      if (url.endsWith('/archive') && init?.method === 'POST') {
        return json(workspace(4, 'archived'));
      }
      return undefined;
    });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    await waitFor(() => {
      expect(sent(fetchMock, `/api/v1/workspaces/${workspace(3).workspace_id}/archive`)).toHaveLength(1);
    });
    const [init] = sent(fetchMock, `/api/v1/workspaces/${workspace(3).workspace_id}/archive`);
    expect(JSON.parse(init?.body as string)).toEqual({ expected_version: 3 });
    expect(headersOf(init)['x-csrf-token']).toBe('csrf-token');
    expect(headersOf(init)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('shows a version conflict as one, and reads the list again rather than retrying', async () => {
    visit('/workspaces');
    let reads = 0;
    const fetchMock = stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }), (url, init) => {
      if (url === '/api/v1/workspaces') {
        reads += 1;
        return json({ workspaces: [workspace(reads === 1 ? 3 : 5)], next: null });
      }
      if (url.endsWith('/archive') && init?.method === 'POST') {
        return json(
          { type: 'https://problems.scnehaux.com/version-conflict', detail: 'stale', correlation_id: 'c-9' },
          409,
        );
      }
      return undefined;
    });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('the record changed since it was shown');
    expect(await screen.findByText(/version 5/)).toBeInTheDocument();
    expect(sent(fetchMock, `/api/v1/workspaces/${workspace(3).workspace_id}/archive`)).toHaveLength(1);
  });
});

describe('memberships', () => {
  const membership = {
    membership_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c01',
    principal_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c02',
    subject_type: 'human',
    status: 'active',
    version: 7,
    valid_from: '2026-10-01T00:00:00Z',
    provenance: 'request REQ-1',
  };
  const revokePath = `/api/v1/memberships/${membership.membership_id}/revoke`;

  it('cannot revoke without a reason, names the Tenant, and shows the revocation by its evidence', async () => {
    visit('/memberships');
    let reads = 0;
    const evidence = (applied: boolean) => ({
      membership_id: membership.membership_id,
      event_id: 'ev-1',
      transition: 'revoked',
      accepted_at: '2026-10-07T12:00:00Z',
      published_at: '2026-10-07T12:00:01Z',
      budget_seconds: 10,
      consumers: [
        {
          consumer_id: 'identity-control',
          evidence: 'consumer_applied',
          recorded_at: '2026-10-07T12:00:02Z',
        },
        {
          consumer_id: 'billing',
          evidence: applied ? 'consumer_applied' : 'transport_accepted',
          recorded_at: '2026-10-07T12:00:03Z',
        },
      ],
      state: applied ? 'enforced' : 'propagating',
      evaluated_at: '2026-10-07T12:00:04Z',
    });
    const fetchMock = stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }), (url, init) => {
      if (url === '/api/v1/memberships') {
        return json({ memberships: [membership], next: null });
      }
      if (url === `/api/v1/memberships/${membership.membership_id}/enforcement`) {
        reads += 1;
        return json(evidence(reads > 1));
      }
      if (url === revokePath && init?.method === 'POST') {
        return json({
          membership: { ...membership, status: 'revoked', version: 8 },
          accepted_at: '2026-10-07T12:00:00Z',
        });
      }
      return undefined;
    });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    const form = screen.getByRole('form', { name: 'Revoke' });
    expect(form).toHaveTextContent(`In Tenant ${tenantA}.`);
    await userEvent.click(within(form).getByRole('button', { name: 'Revoke' }));
    expect(sent(fetchMock, revokePath)).toHaveLength(0);

    await userEvent.type(within(form).getByLabelText('Reason'), 'Left the company on 2026-10-06');
    await userEvent.click(within(form).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => {
      expect(sent(fetchMock, revokePath)).toHaveLength(1);
    });
    const [init] = sent(fetchMock, revokePath);
    expect(JSON.parse(init?.body as string)).toEqual({ expected_version: 7 });
    expect(headersOf(init)['x-administrative-reason']).toBe('Left the company on 2026-10-06');
    // Delivered is not applied: the first read is propagating, naming the service still pending.
    const propagating = await screen.findByText('Propagating');
    expect(propagating.closest('[role="status"]')).toHaveTextContent('billing: delivered, not yet applied');
    expect(propagating.closest('[role="status"]')).toHaveTextContent('4 s of a 10 s budget');
    // Enforced only once every service has applied it, read again without a reload.
    expect(await screen.findByText('Enforced', {}, { timeout: 5_000 })).toBeInTheDocument();
  }, 10_000);
});

describe('invitations', () => {
  it('shows a pending invitation as granting nothing yet, with its countdown', async () => {
    visit('/invitations');
    stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }), (url) =>
      url === '/api/v1/invitations'
        ? json({
            invitations: [
              {
                invitation_id: 'inv-1',
                subject_type: 'human',
                state: 'pending',
                expires_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
                created_at: new Date().toISOString(),
              },
              {
                invitation_id: 'inv-2',
                subject_type: 'human',
                state: 'expired',
                expires_at: new Date(Date.now() - 3_600_000).toISOString(),
                created_at: new Date().toISOString(),
              },
            ],
            next: null,
          })
        : undefined,
    );
    render(<App />);
    const pending = (await screen.findByText('inv-1')).closest('li');
    expect(pending).toHaveTextContent('nothing is granted until the invitee is verified');
    expect(pending).toHaveTextContent(/expires in 2:59:\d\d|expires in 3:00:00/);
    const expired = screen.getByText('inv-2').closest('li');
    expect(expired).toHaveTextContent('expired');
    expect(within(expired as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('tenants', () => {
  const tenant = (status: string, name: string) => ({
    tenant_id: `t-${status}`,
    organization_id: 'org-1',
    display_name: name,
    status,
    isolation_profile: 'pooled',
    version: 2,
    security_version: 1,
    created_at: '2026-10-01T00:00:00Z',
  });

  it('renders each state with its own consequence, and activation only as a deliberate step', async () => {
    visit('/tenants');
    stub(signedInto(null, providerScope(inForce)), (url) =>
      url === '/api/v1/tenants'
        ? json({
            tenants: [
              tenant('requested', 'Acme'),
              tenant('provisioning', 'Beta'),
              tenant('suspended', 'Gamma'),
            ],
            next: null,
          })
        : undefined,
    );
    render(<App />);
    const requested = (await screen.findByText('Acme')).closest('li') as HTMLElement;
    expect(requested).toHaveTextContent('Membership cannot be granted yet');
    expect(within(requested).queryByRole('button')).not.toBeInTheDocument();
    const provisioning = screen.getByText('Beta').closest('li') as HTMLElement;
    expect(within(provisioning).getByRole('button', { name: 'Activate' })).toBeInTheDocument();
    const suspended = screen.getByText('Gamma').closest('li') as HTMLElement;
    expect(suspended).toHaveTextContent('Access is stopped for every membership');
  });

  it('a suspension names the Tenant in its confirmation and needs a reason', async () => {
    visit('/tenants');
    stub(signedInto(null, providerScope(inForce)), (url) =>
      url === '/api/v1/tenants' ? json({ tenants: [tenant('active', 'Acme')], next: null }) : undefined,
    );
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
    const form = screen.getByRole('form', { name: 'Suspend' });
    expect(form).toHaveTextContent('In Tenant Acme (t-active), in provider mode.');
    expect(within(form).getByLabelText('Reason')).toBeInTheDocument();
  });
});

describe('organizations', () => {
  it('retires only after the name is typed', async () => {
    visit('/organizations');
    const organization = {
      organization_id: 'org-1',
      display_name: 'Acme Holdings',
      classification: 'customer',
      status: 'active',
      version: 4,
    };
    const fetchMock = stub(signedInto(null, providerScope(inForce)), (url, init) => {
      if (url === '/api/v1/organizations') {
        return json({ organizations: [organization], next: null });
      }
      if (url === '/api/v1/organizations/org-1/retire' && init?.method === 'POST') {
        return json({ ...organization, status: 'retired', version: 5 });
      }
      return undefined;
    });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retire' }));
    const form = screen.getByRole('form', { name: 'Retire' });
    await userEvent.type(within(form).getByLabelText('Reason'), 'Customer contract ended in September');
    await userEvent.type(within(form).getByLabelText('Type Acme Holdings to confirm'), 'Acme');
    await userEvent.click(within(form).getByRole('button', { name: 'Retire' }));
    expect(sent(fetchMock, '/api/v1/organizations/org-1/retire')).toHaveLength(0);
    await userEvent.type(within(form).getByLabelText('Type Acme Holdings to confirm'), ' Holdings');
    await userEvent.click(within(form).getByRole('button', { name: 'Retire' }));
    await waitFor(() => {
      expect(sent(fetchMock, '/api/v1/organizations/org-1/retire')).toHaveLength(1);
    });
  });
});

describe('approvals', () => {
  const activation = (principal: string, id: string) => ({
    activation_id: id,
    principal_id: principal,
    scope: 'provider:organization-control',
    reason: 'Investigating an incident',
    duration_seconds: 900,
    requested_at: new Date().toISOString(),
    decision: '',
  });

  it('asks for a reason before listing without a window, and never offers the operator their own', async () => {
    visit('/approvals');
    const fetchMock = stub(signedInto(null, providerScope(null)), (url, init) => {
      if (url === '/api/v1/provider-activations') {
        return json({ activations: [activation(me, 'a-own'), activation('someone-else', 'a-other')] });
      }
      if (url === '/api/v1/provider-activations/a-other/approve' && init?.method === 'POST') {
        return json({ ...activation('someone-else', 'a-other'), decision: 'approved' });
      }
      return undefined;
    });
    render(<App />);
    const reasonForm = await screen.findByRole('form', { name: 'Review requests' });
    expect(sent(fetchMock, '/api/v1/provider-activations')).toHaveLength(0);
    await userEvent.type(within(reasonForm).getByLabelText('Reason'), 'Daily review of activation requests');
    await userEvent.click(within(reasonForm).getByRole('button', { name: 'Review requests' }));

    const own = (await screen.findAllByText(me))[0]?.closest('li') as HTMLElement;
    expect(own).toHaveTextContent('Your own request');
    expect(within(own).queryByRole('button')).not.toBeInTheDocument();
    const [read] = sent(fetchMock, '/api/v1/provider-activations');
    expect(headersOf(read)['x-administrative-reason']).toBe('Daily review of activation requests');

    const other = screen.getByText('someone-else').closest('li') as HTMLElement;
    await userEvent.click(within(other).getByRole('button', { name: 'Approve' }));
    await userEvent.type(within(other).getByLabelText('Reason'), 'Confirmed with the incident lead');
    await userEvent.click(
      within(within(other).getByRole('form', { name: 'Approve' })).getByRole('button', { name: 'Approve' }),
    );
    await waitFor(() => {
      expect(sent(fetchMock, '/api/v1/provider-activations/a-other/approve')).toHaveLength(1);
    });
    const [approval] = sent(fetchMock, '/api/v1/provider-activations/a-other/approve');
    expect(headersOf(approval)['x-administrative-reason']).toBe('Confirmed with the incident lead');
  });
});
