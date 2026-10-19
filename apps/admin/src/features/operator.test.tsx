import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { headersOf, inForce, json, me, providerScope, sent, signedInto, stub, visit } from '../test/bff';

// TDD-organization-experience-002 1.7.0 §Testing Strategy: the operator transitions an audit found
// with no trigger, against a stubbed BFF, through the application's own router.

const provider = signedInto(null, providerScope(inForce));
const tenantId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const principal = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4ccc';
const eventId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e01';

afterEach(() => {
  vi.unstubAllGlobals();
  visit('/');
});

const tenant = (status: string) => ({
  tenant_id: tenantId,
  organization_id: 'org-1',
  display_name: 'Acme',
  status,
  isolation_profile: 'pooled',
  version: 4,
});

const grant = (overrides: Record<string, unknown> = {}) => ({
  grant_id: 'g-1',
  tenant_id: tenantId,
  principal_id: principal,
  granted_by: me,
  reason: 'First administrator after activation',
  granted_at: '2026-10-19T10:00:00Z',
  active: true,
  revoked_at: null,
  revoked_by: null,
  ...overrides,
});

describe('Tenant administrators', () => {
  it('reads nothing until opened, then grants the first administrator with the Principal, a key and the CSRF token', async () => {
    visit('/tenants');
    const fetchMock = stub(provider, (url, init) => {
      if (url === '/api/v1/tenants') {
        return json({ tenants: [tenant('active')], next: null });
      }
      if (url === `/api/v1/tenants/${tenantId}/administrators` && init?.method === 'POST') {
        return json({ ...grant(), membership_id: 'm-1', membership_created: true }, 201);
      }
      if (url === `/api/v1/tenants/${tenantId}/administrators`) {
        return json({ grants: [] });
      }
      return undefined;
    });
    render(<App />);
    const row = (await screen.findByText('Acme')).closest('li') as HTMLElement;
    expect(sent(fetchMock, `/api/v1/tenants/${tenantId}/administrators`)).toHaveLength(0);
    await userEvent.click(within(row).getByRole('button', { name: 'Administrators' }));
    const panel = await within(row).findByRole('region', { name: 'Administrators of Acme' });
    expect(await within(panel).findByText(/No administrator is granted in this Tenant/)).toBeInTheDocument();
    await userEvent.type(within(panel).getByLabelText('Principal identifier'), principal);
    const action = within(panel).getByRole('button', { name: 'Grant administrator' });
    expect(action).toHaveAttribute('data-variant', 'primary');
    await userEvent.click(action);
    const form = within(panel).getByRole('form', { name: 'Grant administrator' });
    expect(form).toHaveTextContent('gives it a Tenant-wide membership if it has none');
    expect(form).toHaveTextContent(`Tenant Acme (${tenantId})`);
    await userEvent.click(within(form).getByRole('button', { name: 'Grant administrator' }));
    expect(await within(panel).findByText(/with a new Tenant-wide membership/)).toBeInTheDocument();
    const posts = sent(fetchMock, `/api/v1/tenants/${tenantId}/administrators`).filter(
      (init) => init?.method === 'POST',
    );
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]?.body as string)).toEqual({ principal_id: principal });
    expect(headersOf(posts[0])['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(headersOf(posts[0])['x-csrf-token']).toBe('csrf-token');
  });

  it('revokes an administrator with a reason, and offers no grant in a Tenant that is not active', async () => {
    visit('/tenants');
    const fetchMock = stub(provider, (url, init) => {
      if (url === '/api/v1/tenants') {
        return json({ tenants: [tenant('suspended')], next: null });
      }
      if (url === `/api/v1/tenants/${tenantId}/administrators/g-1/revoke` && init?.method === 'POST') {
        return json(grant({ active: false }));
      }
      if (url === `/api/v1/tenants/${tenantId}/administrators`) {
        return json({
          grants: [
            grant(),
            grant({
              grant_id: 'g-0',
              active: false,
              revoked_by: me,
              revoked_at: '2026-10-01T00:00:00Z',
              revoke_reason: 'Left the company',
            }),
          ],
        });
      }
      return undefined;
    });
    render(<App />);
    const row = (await screen.findByText('Acme')).closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Administrators' }));
    const panel = await within(row).findByRole('region', { name: 'Administrators of Acme' });
    expect(await within(panel).findByText(/revoked by .*Left the company/)).toBeInTheDocument();
    expect(
      within(panel).getByText('An administrator is granted in an active Tenant only.'),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Grant administrator' })).not.toBeInTheDocument();
    const revokes = within(panel).getAllByRole('button', { name: 'Revoke administrator' });
    expect(revokes).toHaveLength(1);
    expect(revokes[0]).toHaveAttribute('data-variant', 'danger');
    await userEvent.click(revokes[0] as HTMLElement);
    const form = within(panel).getByRole('form', { name: 'Revoke administrator' });
    expect(form).toHaveTextContent('Its membership is not revoked.');
    await userEvent.type(within(form).getByLabelText('Reason'), 'Rotated to the new team lead');
    await userEvent.click(within(form).getByRole('button', { name: 'Revoke administrator' }));
    await waitFor(() => {
      expect(sent(fetchMock, `/api/v1/tenants/${tenantId}/administrators/g-1/revoke`)).toHaveLength(1);
    });
    const [init] = sent(fetchMock, `/api/v1/tenants/${tenantId}/administrators/g-1/revoke`);
    expect(headersOf(init)['x-administrative-reason']).toBe('Rotated to the new team lead');
  });

  it('is not offered before the Tenant is usable', async () => {
    visit('/tenants');
    stub(provider, (url) =>
      url === '/api/v1/tenants'
        ? json({
            tenants: ['requested', 'provisioning', 'failed'].map((status) => ({
              ...tenant(status),
              tenant_id: `t-${status}`,
              display_name: `Tenant ${status}`,
            })),
            next: null,
          })
        : undefined,
    );
    render(<App />);
    await screen.findByText('Tenant requested');
    expect(screen.queryByRole('button', { name: 'Administrators' })).not.toBeInTheDocument();
  });
});

describe('provider grants', () => {
  it('lists the grants, grants an eligible one, and draws an emergency grant as danger', async () => {
    visit('/access-review');
    const fetchMock = stub(provider, (url, init) => {
      if (url === '/api/v1/privileged-access:unreviewed') {
        return json({ review_due_days: 7, actors: [] });
      }
      if (url === '/api/v1/provider-grants' && init?.method === 'POST') {
        return json({ grant_id: 'pg-2' }, 201);
      }
      if (url === '/api/v1/provider-grants') {
        return json({
          grants: [
            {
              grant_id: 'pg-1',
              principal_id: me,
              scope: 'provider:organization-control',
              kind: 'emergency',
              granted_by: null,
              bootstrap_operator: 'ci@scnehaux.local',
              reason: 'the first provider',
              granted_at: '2026-10-01T00:00:00Z',
              active: true,
              revoked_at: null,
              revoked_by: null,
            },
          ],
        });
      }
      return undefined;
    });
    render(<App />);
    const panel = (await screen.findByRole('heading', { name: 'Provider grants' })).closest(
      'section',
    ) as HTMLElement;
    const row = (await within(panel).findByText(me)).closest('li') as HTMLElement;
    expect(row).toHaveTextContent('emergency (standing)');
    expect(row).toHaveTextContent('granted by ci@scnehaux.local');
    expect(within(row).getByRole('button', { name: 'Revoke grant' })).toHaveAttribute(
      'data-variant',
      'danger',
    );

    expect(within(panel).getByText(/Eligible: confers nothing until it is activated/)).toBeInTheDocument();
    await userEvent.type(within(panel).getByLabelText('Principal identifier'), principal);
    await userEvent.click(within(panel).getByRole('button', { name: 'Grant provider access' }));
    const form = within(panel).getByRole('form', { name: 'Grant provider access' });
    await userEvent.type(within(form).getByLabelText('Reason'), 'On-call rotation joins the providers');
    await userEvent.click(within(form).getByRole('button', { name: 'Grant provider access' }));
    await waitFor(() => {
      expect(sent(fetchMock, '/api/v1/provider-grants').filter((i) => i?.method === 'POST')).toHaveLength(1);
    });
    const [post] = sent(fetchMock, '/api/v1/provider-grants').filter((i) => i?.method === 'POST');
    expect(JSON.parse(post?.body as string)).toEqual({
      principal_id: principal,
      scope: 'provider:organization-control',
      kind: 'eligible',
    });
    expect(headersOf(post)['x-administrative-reason']).toBe('On-call rotation joins the providers');

    await userEvent.selectOptions(within(panel).getByLabelText('Kind'), 'emergency');
    expect(within(panel).getByText(/Emergency: standing authority/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Grant provider access' })).toHaveAttribute(
      'data-variant',
      'danger',
    );
  });
});

const consumer = (overrides: Record<string, unknown> = {}) => ({
  consumer_id: 'billing',
  state: 'active',
  max_accepted_age_seconds: 60,
  stale_behavior: 'use_with_marker',
  last_reported_at: '2026-10-19T10:00:00Z',
  stale: false,
  ...overrides,
});

const deadLetter = (overrides: Record<string, unknown> = {}) => ({
  event_id: eventId,
  consumer: 'billing',
  event_type: 'com.scnehaux.organization.membership.security.revoked',
  authority_bearing: true,
  aggregate_id: 'm-9',
  version: 4,
  lane: 'priority',
  failure_class: 'rejected',
  failure_detail: 'unknown tenant',
  attempts: 12,
  first_failed_at: '2026-10-18T10:00:00Z',
  dead_lettered_at: '2026-10-18T11:00:00Z',
  resolved_at: null,
  resolution_type: null,
  resolved_by: null,
  resolution_reference: null,
  waived_at: null,
  waived_until: null,
  waived_by: null,
  waiver_reason: null,
  ...overrides,
});

const pauseAnswer = {
  paused: false,
  pause_id: null,
  reason: null,
  actor_id: null,
  correlation_id: null,
  recorded_at: null,
};

describe('projection health', () => {
  it('opens an active consumer’s open dead letters, replays one and resolves one as superseded', async () => {
    visit('/projections');
    const fetchMock = stub(provider, (url, init) => {
      if (url === '/api/v1/projections/consumers') {
        return json({ consumers: [consumer()], next: null });
      }
      if (url === '/api/v1/tenant-administration-pause') {
        return json(pauseAnswer);
      }
      if (url === '/api/v1/projections/consumers/billing/dead-letters?state=open') {
        return json({ dead_letters: [deadLetter()], next: null });
      }
      if (url.endsWith('/replay') && init?.method === 'POST') {
        return json({ event_id: eventId, consumer: 'billing', resolved: false }, 202);
      }
      if (url.endsWith('/resolve') && init?.method === 'POST') {
        return json({ event_id: eventId, consumer: 'billing', resolution_type: 'SUPERSEDED' });
      }
      return undefined;
    });
    render(<App />);
    const row = (await screen.findByText('billing')).closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Dead letters' }));
    const list = await within(row).findByRole('region', { name: 'Dead letters of billing' });
    const incident = (await within(list).findByText(/membership.security.revoked/)).closest(
      'li',
    ) as HTMLElement;
    expect(incident).toHaveTextContent('bears authority');
    expect(incident).toHaveTextContent('m-9 at version 4');
    expect(incident).toHaveTextContent('rejected: unknown tenant');
    expect(within(incident).queryByRole('button', { name: 'Waive' })).not.toBeInTheDocument();

    await userEvent.click(within(incident).getByRole('button', { name: 'Replay' }));
    await userEvent.click(
      within(within(incident).getByRole('form', { name: 'Replay' })).getByRole('button', { name: 'Replay' }),
    );
    expect(
      await within(incident).findByText(/The incident stays open until it is resolved/),
    ).toBeInTheDocument();
    const base = `/api/v1/dead-letters/${eventId}/consumers/billing`;
    expect(sent(fetchMock, `${base}/replay`)).toHaveLength(1);

    await userEvent.click(within(incident).getByRole('button', { name: 'Resolve as superseded' }));
    await userEvent.click(
      within(within(incident).getByRole('form', { name: 'Resolve as superseded' })).getByRole('button', {
        name: 'Resolve as superseded',
      }),
    );
    await waitFor(() => {
      expect(sent(fetchMock, `${base}/resolve`)).toHaveLength(1);
    });
    const [resolve] = sent(fetchMock, `${base}/resolve`);
    expect(JSON.parse(resolve?.body as string)).toEqual({ resolution_type: 'SUPERSEDED' });
    expect(headersOf(resolve)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('waives a retired consumer’s incident with a reason and an expiry, and offers no replay or retirement', async () => {
    visit('/projections');
    const fetchMock = stub(provider, (url, init) => {
      if (url === '/api/v1/projections/consumers') {
        return json({ consumers: [consumer({ state: 'retired' })], next: null });
      }
      if (url === '/api/v1/tenant-administration-pause') {
        return json(pauseAnswer);
      }
      if (url.startsWith('/api/v1/projections/consumers/billing/dead-letters')) {
        return json({ dead_letters: [deadLetter()], next: null });
      }
      if (url.endsWith('/waive') && init?.method === 'POST') {
        return json({ event_id: eventId, consumer: 'billing', resolved: false });
      }
      return undefined;
    });
    render(<App />);
    const row = (await screen.findByText('billing')).closest('li') as HTMLElement;
    expect(within(row).queryByRole('button', { name: 'Retire consumer' })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Dead letters' }));
    const incident = (await within(row).findByText(/membership.security.revoked/)).closest(
      'li',
    ) as HTMLElement;
    expect(within(incident).queryByRole('button', { name: 'Replay' })).not.toBeInTheDocument();
    expect(within(incident).getByLabelText('Waived until')).toHaveValue();
    await userEvent.click(within(incident).getByRole('button', { name: 'Waive' }));
    const form = within(incident).getByRole('form', { name: 'Waive' });
    await userEvent.type(within(form).getByLabelText('Reason'), 'The billing consumer was replaced');
    await userEvent.click(within(form).getByRole('button', { name: 'Waive' }));
    const path = `/api/v1/dead-letters/${eventId}/consumers/billing/waive`;
    await waitFor(() => {
      expect(sent(fetchMock, path)).toHaveLength(1);
    });
    const [init] = sent(fetchMock, path);
    const body = JSON.parse(init?.body as string) as { reason: string; expires_at: string };
    expect(body.reason).toBe('The billing consumer was replaced');
    expect(Date.parse(body.expires_at)).toBeGreaterThan(Date.now());
    expect(body.expires_at).toMatch(/Z$/);
    expect(headersOf(init)['x-administrative-reason']).toBe('The billing consumer was replaced');
  });

  it('retires a consumer with a reason and its identifier typed', async () => {
    visit('/projections');
    const fetchMock = stub(provider, (url, init) => {
      if (url === '/api/v1/projections/consumers') {
        return json({ consumers: [consumer()], next: null });
      }
      if (url === '/api/v1/tenant-administration-pause') {
        return json(pauseAnswer);
      }
      if (url === '/api/v1/projections/consumers/billing/retire' && init?.method === 'POST') {
        return new Response(null, { status: 204 });
      }
      return undefined;
    });
    render(<App />);
    const row = (await screen.findByText('billing')).closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Retire consumer' }));
    const form = within(row).getByRole('form', { name: 'Retire consumer' });
    expect(form).toHaveTextContent('what it was still owed, which is abandoned');
    await userEvent.type(within(form).getByLabelText('Reason'), 'Billing moved to the new projection');
    await userEvent.click(within(form).getByRole('button', { name: 'Retire consumer' }));
    expect(sent(fetchMock, '/api/v1/projections/consumers/billing/retire')).toHaveLength(0);
    await userEvent.type(within(form).getByLabelText('Type billing to confirm'), 'billing');
    await userEvent.click(within(form).getByRole('button', { name: 'Retire consumer' }));
    await waitFor(() => {
      expect(sent(fetchMock, '/api/v1/projections/consumers/billing/retire')).toHaveLength(1);
    });
  });

  it('shows a pause the restore recorded and lifts it with a reason', async () => {
    visit('/projections');
    const fetchMock = stub(provider, (url, init) => {
      if (url === '/api/v1/projections/consumers') {
        return json({ consumers: [], next: null });
      }
      if (url === '/api/v1/tenant-administration-pause' && init?.method === 'POST') {
        return json({
          ...pauseAnswer,
          pause_id: 'p-2',
          actor_id: me,
          reason: 'lifted',
          recorded_at: '2026-10-19T12:00:00Z',
        });
      }
      if (url === '/api/v1/tenant-administration-pause') {
        return json({
          paused: true,
          pause_id: 'p-1',
          reason: 'INC-12 restored from the 2026-10-18 backup',
          actor_id: null,
          correlation_id: null,
          recorded_at: '2026-10-19T09:00:00Z',
        });
      }
      return undefined;
    });
    render(<App />);
    const status = await screen.findByText(/INC-12 restored from the 2026-10-18 backup/);
    expect(status).toHaveTextContent('by the restore procedure');
    expect(screen.queryByRole('button', { name: 'Pause Tenant administration' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lift the pause' }));
    const form = screen.getByRole('form', { name: 'Lift the pause' });
    await userEvent.type(within(form).getByLabelText('Reason'), 'Versions reconciled per the runbook');
    await userEvent.click(within(form).getByRole('button', { name: 'Lift the pause' }));
    await waitFor(() => {
      expect(
        sent(fetchMock, '/api/v1/tenant-administration-pause').filter((i) => i?.method === 'POST'),
      ).toHaveLength(1);
    });
    const [post] = sent(fetchMock, '/api/v1/tenant-administration-pause').filter((i) => i?.method === 'POST');
    expect(JSON.parse(post?.body as string)).toEqual({ paused: false });
    expect(headersOf(post)['x-administrative-reason']).toBe('Versions reconciled per the runbook');
  });

  it('pauses Tenant administration as a danger action', async () => {
    visit('/projections');
    stub(provider, (url) =>
      url === '/api/v1/projections/consumers'
        ? json({ consumers: [], next: null })
        : url === '/api/v1/tenant-administration-pause'
          ? json(pauseAnswer)
          : undefined,
    );
    render(<App />);
    expect(await screen.findByText(/Not paused/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause Tenant administration' })).toHaveAttribute(
      'data-variant',
      'danger',
    );
  });
});
