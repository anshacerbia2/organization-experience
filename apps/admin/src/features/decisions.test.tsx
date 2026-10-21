import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { checkWcag } from '../test/a11y';
import { headersOf, inForce, json, me, providerScope, sent, signedInto, stub, visit } from '../test/bff';

// TDD-organization-experience-002 1.10.0 §Testing Strategy, The Owner's Decisions of 2026-10-20:
// reporters, the reconciliation interval, a provider's withdrawal of one Membership, and a new
// Idempotency-Key after each answer. Every request is also held against organization-control's
// specification (test/contract.ts).

const provider = signedInto(null, providerScope(inForce));
const workload = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d01';
const reporterId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d11';
const tenantId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const membershipId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d21';

afterEach(() => {
  vi.unstubAllGlobals();
  visit('/');
});

const reporter = (overrides: Record<string, unknown> = {}) => ({
  reporter_id: reporterId,
  principal_id: workload,
  reports: 'obligation:billing',
  purpose: 'Billing resolves its offboarding obligations',
  state: 'active',
  version: 3,
  registered_at: '2026-10-20T10:00:00Z',
  registered_by: me,
  retired_at: null,
  retired_by: null,
  ...overrides,
});

const bodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;

describe('reporters', () => {
  it('lists reporters, and registers one with its reports, purpose, a reason and a key', async () => {
    visit('/reporters');
    const fetchMock = stub(provider, (url, init) => {
      if (url === '/api/v1/reporters' && init?.method === 'POST') {
        return json(reporter({ reporter_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d12', version: 1 }), 201);
      }
      if (url.startsWith('/api/v1/reporters')) {
        return json({
          reporters: [
            reporter(),
            reporter({
              reporter_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d13',
              reports: 'provisioning',
              state: 'retired',
              retired_at: '2026-10-20T12:00:00Z',
              retired_by: me,
            }),
          ],
          next: null,
        });
      }
      return undefined;
    });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findAllByText(workload);
    const rows = screen.getByRole('list', { name: 'Reporters' });
    expect(within(rows).getAllByRole('listitem')).toHaveLength(2);
    expect(within(rows).getAllByRole('button', { name: 'Retire reporter' })).toHaveLength(1);

    const panel = screen.getByRole('region', { name: 'Register reporter' });
    await user.type(within(panel).getByLabelText('Workload Principal identifier'), workload);
    await user.selectOptions(within(panel).getByLabelText('Reports'), 'obligation');
    await user.type(within(panel).getByLabelText('Domain'), 'Billing');
    await user.type(within(panel).getByLabelText('Purpose'), 'Bills');
    await user.click(within(panel).getByRole('button', { name: 'Register reporter' }));
    const form = within(panel).getByRole('form', { name: 'Register reporter' });
    expect(form).toHaveTextContent(`This admits workload ${workload} to report obligation:Billing`);
    await user.type(within(form).getByLabelText('Reason'), 'Billing owner confirmed the workload');
    await user.click(within(form).getByRole('button', { name: 'Register reporter' }));
    // The domain is refused before anything is sent: the API's pattern is lowercase.
    expect(await within(form).findByText(/1 to 63 lowercase letters/)).toBeInTheDocument();
    expect(sent(fetchMock, '/api/v1/reporters').filter((init) => init?.method === 'POST')).toHaveLength(0);

    await user.clear(within(panel).getByLabelText('Domain'));
    await user.type(within(panel).getByLabelText('Domain'), 'billing');
    await user.click(within(form).getByRole('button', { name: 'Register reporter' }));
    expect(await screen.findByText('Registered: it reports obligation:billing.')).toBeInTheDocument();
    const [posted] = sent(fetchMock, '/api/v1/reporters').filter((init) => init?.method === 'POST');
    expect(bodyOf(posted)).toEqual({
      principal_id: workload,
      reports: 'obligation:billing',
      purpose: 'Bills',
    });
    expect(headersOf(posted)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(headersOf(posted)['x-administrative-reason']).toBe('Billing owner confirmed the workload');
    expect(await checkWcag(container)).toHaveNoViolations();
  });

  it('says a workload is registered once when the API refuses a second registration', async () => {
    visit('/reporters');
    stub(provider, (url, init) => {
      if (url === '/api/v1/reporters' && init?.method === 'POST') {
        return json(
          {
            type: 'https://problems.scnehaux.com/state-transition-refused',
            status: 409,
            detail: 'the workload is already registered',
          },
          409,
        );
      }
      return url.startsWith('/api/v1/reporters') ? json({ reporters: [], next: null }) : undefined;
    });
    const user = userEvent.setup();
    render(<App />);
    const panel = await screen.findByRole('region', { name: 'Register reporter' });
    await user.type(within(panel).getByLabelText('Workload Principal identifier'), workload);
    await user.type(within(panel).getByLabelText('Purpose'), 'The provisioning system');
    await user.click(within(panel).getByRole('button', { name: 'Register reporter' }));
    const form = within(panel).getByRole('form', { name: 'Register reporter' });
    await user.type(within(form).getByLabelText('Reason'), 'Provisioning goes live');
    await user.click(within(form).getByRole('button', { name: 'Register reporter' }));
    expect(await within(form).findByText(/already registered, active or retired/)).toBeInTheDocument();
    expect(within(form).getByRole('alert')).toHaveTextContent('the workload is already registered');
  });

  it('reads a reporter again before retiring it, and sends the version it read', async () => {
    visit('/reporters');
    const fetchMock = stub(provider, (url, init) => {
      if (url === `/api/v1/reporters/${reporterId}/retire` && init?.method === 'POST') {
        return json(
          reporter({ state: 'retired', version: 5, retired_at: '2026-10-21T10:00:00Z', retired_by: me }),
        );
      }
      if (url === `/api/v1/reporters/${reporterId}`) {
        return json(reporter({ version: 4 }));
      }
      return url.startsWith('/api/v1/reporters') ? json({ reporters: [reporter()], next: null }) : undefined;
    });
    const user = userEvent.setup();
    render(<App />);
    const row = (await screen.findByText(workload)).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Retire reporter' }));
    const form = await within(row).findByRole('form', { name: 'Retire reporter' });
    expect(form).toHaveTextContent('never registered again');
    await user.type(within(form).getByLabelText('Reason'), 'Billing replaced its integration');
    await user.type(within(form).getByLabelText('Type obligation:billing to confirm'), 'obligation:billing');
    await user.click(within(form).getByRole('button', { name: 'Retire reporter' }));
    await waitFor(() => {
      expect(sent(fetchMock, `/api/v1/reporters/${reporterId}/retire`)).toHaveLength(1);
    });
    expect(bodyOf(sent(fetchMock, `/api/v1/reporters/${reporterId}/retire`)[0])).toEqual({
      expected_version: 4,
    });
  });
});

describe('projection health, the reconciliation interval', () => {
  const consumer = (id: string, overrides: Record<string, unknown>) => ({
    consumer_id: id,
    principal_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c01',
    projection_version: '1',
    max_accepted_age_seconds: 60,
    stale_behavior: 'fail_closed',
    registered_at: '2026-10-01T00:00:00Z',
    event_types: ['membership.changed'],
    state: 'active',
    stale: false,
    reconciliation_interval_seconds: 600,
    reconciliation_requested_at: null,
    ...overrides,
  });

  it('shows the interval, marks late consumers, and shows a reconciliation a restore requested', async () => {
    visit('/projections');
    stub(provider, (url) => {
      if (url === '/api/v1/projections/consumers') {
        return json({
          consumers: [
            consumer('on-time', {
              last_reconciled_at: '2026-10-21T10:00:00Z',
              reconciliation_age_seconds: 300,
            }),
            consumer('late', { last_reconciled_at: '2026-10-21T10:00:00Z', reconciliation_age_seconds: 900 }),
            consumer('very-late', {
              last_reconciled_at: '2026-10-21T10:00:00Z',
              reconciliation_age_seconds: 1300,
            }),
            consumer('restored', { reconciliation_requested_at: '2026-10-21T09:00:00Z' }),
          ],
          next: null,
        });
      }
      if (url === '/api/v1/tenant-administration-pause') {
        return json({
          paused: false,
          pause_id: null,
          reason: null,
          actor_id: null,
          correlation_id: null,
          recorded_at: null,
        });
      }
      return undefined;
    });
    render(<App />);
    const rowOf = async (id: string) => (await screen.findByText(id)).closest('li') as HTMLElement;
    const onTime = await rowOf('on-time');
    expect(onTime).toHaveTextContent('reconciles every 10 min');
    expect(onTime.querySelector('[data-overdue]')).toBeNull();
    expect((await rowOf('late')).querySelector('[data-overdue="warning"]')).toHaveTextContent(
      'Reconciliation overdue: last run 15 min ago, past its interval of 10 min.',
    );
    expect((await rowOf('very-late')).querySelector('[data-overdue="critical"]')).toHaveTextContent(
      'critically overdue',
    );
    const restored = await rowOf('restored');
    expect(restored).toHaveTextContent('never reconciled');
    expect(restored.querySelector('[data-overdue]')).toBeNull();
    expect(restored).toHaveTextContent(/Reconciliation requested .* after a restore/);
  });
});

describe('a provider withdraws one Membership', () => {
  const tenant = {
    tenant_id: tenantId,
    organization_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4f01',
    display_name: 'Acme',
    status: 'active',
    isolation_profile: 'pooled',
    version: 4,
  };

  const record = (status: 'active' | 'suspended' | 'revoked', version: number) => ({
    membership_id: membershipId,
    principal_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c21',
    tenant_id: tenantId,
    workspace_id: null,
    subject_type: 'human',
    status,
    version,
    valid_from: '2026-09-01T00:00:00Z',
    valid_until: null,
    provenance: 'HR-1042',
  });
  const reason = 'Incident 4471: a compromised member';

  // openAndRead opens the row's withdrawal, enters the identifier and the reason, and reads it.
  const openAndRead = async (
    user: ReturnType<typeof userEvent.setup>,
    row: HTMLElement,
  ): Promise<HTMLElement> => {
    await user.click(within(row).getByRole('button', { name: 'Withdraw a Membership' }));
    const section = within(row).getByRole('region', { name: 'Withdraw a Membership in Acme' });
    await user.type(within(section).getByLabelText('Membership identifier'), membershipId);
    await user.type(within(section).getByLabelText('Why you read it'), reason);
    await user.click(within(section).getByRole('button', { name: 'Read the Membership' }));
    return section;
  };

  it('reads the Membership with the reason, then offers its withdrawals with the version it read', async () => {
    visit('/tenants');
    const base = `/api/v1/tenants/${tenantId}/memberships/${membershipId}`;
    const fetchMock = stub(provider, (url, init) => {
      if (url === '/api/v1/tenants') {
        return json({ tenants: [tenant], next: null });
      }
      if (url === base && (init?.method ?? 'GET') === 'GET') {
        return json(record('active', 7));
      }
      if (url === `${base}/revoke` && init?.method === 'POST') {
        return json({
          membership: { ...record('revoked', 8) },
          accepted_at: '2026-10-21T10:00:00Z',
          tenant_security_version: 3,
          event_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e09',
        });
      }
      if (url === `${base}/enforcement`) {
        return json({
          membership_id: membershipId,
          event_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e09',
          transition: 'revoke',
          accepted_at: '2026-10-21T10:00:00Z',
          published_at: '2026-10-21T10:00:01Z',
          budget_seconds: 10,
          consumers: [],
          state: 'enforced',
          evaluated_at: '2026-10-21T10:00:03Z',
        });
      }
      return undefined;
    });
    const user = userEvent.setup();
    const { container } = render(<App />);
    const row = (await screen.findByText('Acme')).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Withdraw a Membership' }));
    const section = within(row).getByRole('region', { name: 'Withdraw a Membership in Acme' });
    expect(
      within(section).queryByRole('button', { name: /Suspend membership|Revoke membership/ }),
    ).toBeNull();
    expect(within(section).queryByLabelText(/version/i)).toBeNull();
    expect(section).toHaveTextContent('A provider never grants or restores a Membership.');
    expect(within(row).queryByRole('button', { name: /Grant|Restore/ })).toBeNull();

    // Nothing is read until the identifier is a UUID and the reason is given; neither is disabled.
    await user.type(within(section).getByLabelText('Membership identifier'), 'm-1');
    await user.click(within(section).getByRole('button', { name: 'Read the Membership' }));
    expect(within(section).getAllByRole('alert')).toHaveLength(2);
    expect(sent(fetchMock, base)).toHaveLength(0);
    await user.clear(within(section).getByLabelText('Membership identifier'));
    await user.type(within(section).getByLabelText('Membership identifier'), membershipId);
    await user.type(within(section).getByLabelText('Why you read it'), reason);
    await user.click(within(section).getByRole('button', { name: 'Read the Membership' }));

    const shown = await within(section).findByRole('group', { name: `Membership ${membershipId}` });
    expect(shown).toHaveTextContent('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c21');
    expect(shown).toHaveTextContent('version 7');
    const [readRequest] = sent(fetchMock, base);
    expect(headersOf(readRequest)['x-administrative-reason']).toBe(reason);
    expect(headersOf(readRequest)['idempotency-key']).toBeUndefined();

    await user.click(within(shown).getByRole('button', { name: 'Revoke membership' }));
    const form = within(shown).getByRole('form', { name: 'Revoke membership' });
    expect(form).toHaveAttribute('data-tone', 'danger');
    expect(form).toHaveTextContent(
      `Revokes Membership ${membershipId} in Tenant Acme. This cannot be undone`,
    );
    // The reason the read was made with is offered again, and the operator may change it.
    expect(within(form).getByLabelText('Reason')).toHaveValue(reason);
    await user.click(within(form).getByRole('button', { name: 'Revoke membership' }));
    expect(await within(section).findByText(/the Membership is revoked, version 8/)).toBeInTheDocument();
    const [posted] = sent(fetchMock, `${base}/revoke`);
    expect(bodyOf(posted)).toEqual({ expected_version: 7 });
    expect(headersOf(posted)['x-administrative-reason']).toBe(reason);
    expect(headersOf(posted)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => {
      expect(section.querySelector('[data-enforcement="enforced"]')).not.toBeNull();
    });
    expect(within(shown).queryByRole('button', { name: /Suspend membership|Revoke membership/ })).toBeNull();
    expect(await checkWcag(container)).toHaveNoViolations();
  });

  it('offers revoke alone on a suspended Membership, and nothing on a revoked one', async () => {
    visit('/tenants');
    const base = `/api/v1/tenants/${tenantId}/memberships/${membershipId}`;
    let status: 'suspended' | 'revoked' = 'suspended';
    stub(provider, (url) => {
      if (url === '/api/v1/tenants') {
        return json({ tenants: [tenant], next: null });
      }
      if (url === base) {
        return json(record(status, status === 'suspended' ? 5 : 9));
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(<App />);
    const row = (await screen.findByText('Acme')).closest('li') as HTMLElement;
    const section = await openAndRead(user, row);
    const shown = await within(section).findByRole('group', { name: `Membership ${membershipId}` });
    expect(within(shown).getByRole('button', { name: 'Revoke membership' })).toBeInTheDocument();
    expect(within(shown).queryByRole('button', { name: 'Suspend membership' })).toBeNull();

    status = 'revoked';
    await user.type(within(section).getByLabelText('Why you read it'), ' again');
    await user.click(within(section).getByRole('button', { name: 'Read the Membership' }));
    expect(
      await within(section).findByText(/This Membership is revoked\. Nothing is left to withdraw/),
    ).toBeInTheDocument();
    expect(
      within(section).queryByRole('button', { name: /Suspend membership|Revoke membership/ }),
    ).toBeNull();
  });

  it('says a Membership not in this Tenant is not found, and offers nothing', async () => {
    visit('/tenants');
    const base = `/api/v1/tenants/${tenantId}/memberships/${membershipId}`;
    stub(provider, (url) => {
      if (url === '/api/v1/tenants') {
        return json({ tenants: [tenant], next: null });
      }
      if (url === base) {
        return json(
          { type: 'https://problems.scnehaux.com/not-found', status: 404, detail: 'not found' },
          404,
        );
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(<App />);
    const row = (await screen.findByText('Acme')).closest('li') as HTMLElement;
    const section = await openAndRead(user, row);
    expect(
      await within(section).findByText(`No Membership ${membershipId} is in Acme`, { exact: false }),
    ).toBeInTheDocument();
    expect(
      within(section).queryByRole('button', { name: /Suspend membership|Revoke membership/ }),
    ).toBeNull();
  });

  it('shows a stale version as a conflict, and sends nothing again', async () => {
    visit('/tenants');
    const base = `/api/v1/tenants/${tenantId}/memberships/${membershipId}`;
    const fetchMock = stub(provider, (url, init) => {
      if (url === '/api/v1/tenants') {
        return json({ tenants: [tenant], next: null });
      }
      if (url === base) {
        return json(record('active', 2));
      }
      if (url === `${base}/suspend` && init?.method === 'POST') {
        return json(
          { type: 'https://problems.scnehaux.com/version-conflict', status: 409, detail: 'stale' },
          409,
        );
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(<App />);
    const row = (await screen.findByText('Acme')).closest('li') as HTMLElement;
    const section = await openAndRead(user, row);
    const shown = await within(section).findByRole('group', { name: `Membership ${membershipId}` });
    await user.click(within(shown).getByRole('button', { name: 'Suspend membership' }));
    const form = within(shown).getByRole('form', { name: 'Suspend membership' });
    expect(form).toHaveTextContent('The Tenant administrator restores it');
    await user.clear(within(form).getByLabelText('Reason'));
    await user.type(within(form).getByLabelText('Reason'), 'Contain the incident');
    await user.click(within(form).getByRole('button', { name: 'Suspend membership' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(/changed since/i);
    const posted = sent(fetchMock, `${base}/suspend`);
    expect(posted).toHaveLength(1);
    expect(bodyOf(posted[0])).toEqual({ expected_version: 2 });
    expect(headersOf(posted[0])['x-administrative-reason']).toBe('Contain the incident');
  });
});

describe('a new Idempotency-Key after each answer', () => {
  it('sends a second Replay of the same dead letter under a new key', async () => {
    visit('/projections');
    const eventId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e01';
    const replay = `/api/v1/dead-letters/${eventId}/consumers/billing/replay`;
    const fetchMock = stub(provider, (url, init) => {
      if (url === '/api/v1/projections/consumers') {
        return json({
          consumers: [
            {
              consumer_id: 'billing',
              principal_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c01',
              projection_version: '1',
              max_accepted_age_seconds: 60,
              stale_behavior: 'fail_closed',
              registered_at: '2026-10-01T00:00:00Z',
              event_types: ['membership.changed'],
              reconciliation_interval_seconds: 86_400,
              reconciliation_requested_at: null,
              state: 'active',
              stale: false,
            },
          ],
          next: null,
        });
      }
      if (url.startsWith('/api/v1/projections/consumers/billing/dead-letters')) {
        return json({
          dead_letters: [
            {
              event_id: eventId,
              consumer: 'billing',
              event_type: 'com.scnehaux.organization.membership.security.revoked',
              authority_bearing: true,
              aggregate_id: null,
              version: null,
              lane: 'priority',
              failure_class: 'rejected',
              failure_detail: null,
              attempts: 12,
              first_failed_at: '2026-10-19T00:00:00Z',
              dead_lettered_at: '2026-10-20T00:00:00Z',
              resolved_at: null,
              resolution_type: null,
              resolved_by: null,
              resolution_reference: null,
              waived_at: null,
              waived_until: null,
              waived_by: null,
              waiver_reason: null,
            },
          ],
          next: null,
        });
      }
      if (url === replay && init?.method === 'POST') {
        return json({ event_id: eventId, consumer: 'billing', resolved: false });
      }
      if (url === '/api/v1/tenant-administration-pause') {
        return json({
          paused: false,
          pause_id: null,
          reason: null,
          actor_id: null,
          correlation_id: null,
          recorded_at: null,
        });
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(<App />);
    const row = (await screen.findByText('billing')).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Dead letters' }));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await user.click(await within(row).findByRole('button', { name: 'Replay' }));
      const form = within(row).getByRole('form', { name: 'Replay' });
      await user.click(within(form).getByRole('button', { name: 'Replay' }));
      await waitFor(() => {
        expect(sent(fetchMock, replay)).toHaveLength(attempt + 1);
      });
    }
    const [first, second] = sent(fetchMock, replay);
    expect(headersOf(second)['idempotency-key']).not.toBe(headersOf(first)['idempotency-key']);
  });
});
