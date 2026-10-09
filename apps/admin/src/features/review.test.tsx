import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { csrfHeader } from '../session';
import { toInstant, toLocalInput } from './review';
import { checkWcag } from '../test/a11y';
import { headersOf, inForce, json, me, providerScope, sent, signedInto, stub, visit } from '../test/bff';

// TDD-organization-experience-002 1.5.0 §Testing Strategy, Provider-Access Review: the review against
// a stubbed BFF, through the application's own router.

const tenantA = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const other = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4bbb';
const activationId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c01';

afterEach(() => {
  vi.unstubAllGlobals();
  visit('/');
});

const unreviewed = {
  review_due_days: 7,
  actors: [
    {
      actor_id: other,
      unreviewed: 3,
      emergency: 1,
      oldest_at: '2026-09-28T09:00:00Z',
      due_at: '2026-10-05T09:00:00Z',
      overdue: true,
    },
    {
      actor_id: me,
      unreviewed: 2,
      emergency: 0,
      oldest_at: '2026-10-06T09:00:00Z',
      due_at: '2026-10-13T09:00:00Z',
      overdue: false,
    },
  ],
};

const access = (id: string, authority: string, tenant: string | null) => ({
  access_id: id,
  actor_id: other,
  authority,
  activation_id: authority === 'activation' ? activationId : null,
  tenant_id: tenant,
  operation: tenant === null ? 'GET /v1/tenants' : 'POST /v1/tenants/{tenant_id}/suspend',
  correlation_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aff',
  reason: 'Investigating a stuck offboarding, OPS-12',
  occurred_at: '2026-10-01T10:00:00Z',
});

const path = (url: string): string => url.split('?')[0] ?? url;
const query = (url: string): URLSearchParams => new URLSearchParams(url.split('?')[1] ?? '');

describe('the provider-access review', () => {
  it('lists who is unreviewed, never offers the operator their own, and records a review of another', async () => {
    visit('/access-review');
    const fetchMock = stub(signedInto(null, providerScope(inForce)), (url, init) => {
      if (url === '/api/v1/privileged-access:unreviewed') {
        return json(unreviewed);
      }
      if (path(url) === '/api/v1/privileged-access') {
        return json({
          accesses: [access('acc-1', 'emergency', null), access('acc-2', 'activation', tenantA)],
          next: null,
        });
      }
      if (path(url) === '/api/v1/privileged-access/reviews' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as Record<string, string>;
        return json(
          {
            review_id: 'rev-1',
            actor_id: body.actor_id,
            from: body.from,
            to: body.to,
            outcome: body.outcome,
            statement: headersOf(init)['x-administrative-reason'],
            accesses: 2,
            emergency_accesses: 1,
            reviewed_by: me,
            reviewed_at: '2026-10-08T12:00:00Z',
          },
          201,
        );
      }
      if (path(url) === '/api/v1/privileged-access/reviews') {
        return json({ reviews: [], next: null });
      }
      return undefined;
    });
    const { container } = render(<App />);

    const own = (await screen.findAllByText(me))[0]?.closest('li') as HTMLElement;
    expect(own).toHaveTextContent('Your own access. Another provider reviews it.');
    expect(within(own).queryByRole('button')).not.toBeInTheDocument();

    const theirs = screen.getByText(other).closest('li') as HTMLElement;
    expect(theirs).toHaveTextContent('3 accesses');
    expect(theirs).toHaveTextContent('1 emergency uses');
    expect(within(theirs).getByRole('status')).toHaveTextContent('overdue');
    await userEvent.click(within(theirs).getByRole('button', { name: 'Review' }));

    const accesses = await screen.findByRole('list', { name: 'Accesses in the period' });
    expect(await within(accesses).findByText(/emergency use/)).toBeInTheDocument();
    expect(within(accesses).getByText(/across Tenants/)).toBeInTheDocument();
    expect(within(accesses).getByText(new RegExp(`activation ${activationId}`))).toBeInTheDocument();
    expect(within(accesses).getByText(new RegExp(`in Tenant ${tenantA}`))).toBeInTheDocument();

    // The list is read for that Principal, from its oldest unreviewed access, with offsets.
    const read = fetchMock.mock.calls
      .map(([url]) => url)
      .find((url) => path(url) === '/api/v1/privileged-access');
    const params = query(read ?? '');
    expect(params.get('actor_id')).toBe(other);
    expect(params.get('from')).toBe(toInstant(toLocalInput(new Date('2026-09-28T09:00:00Z'))));
    expect(params.get('to')).toMatch(/Z$/);

    await userEvent.selectOptions(screen.getByLabelText('Outcome'), 'escalated');
    await userEvent.click(screen.getByRole('button', { name: 'Record review' }));
    const form = screen.getByRole('form', { name: 'Record review' });
    // A statement is required before anything is sent.
    await userEvent.click(within(form).getByRole('button', { name: 'Record review' }));
    expect(
      sent(fetchMock, '/api/v1/privileged-access/reviews').filter((init) => init?.method === 'POST'),
    ).toHaveLength(0);

    await userEvent.type(
      within(form).getByLabelText('Reason'),
      'Emergency use not explained by any incident',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Record review' }));
    await waitFor(() => {
      expect(
        sent(fetchMock, '/api/v1/privileged-access/reviews').filter((init) => init?.method === 'POST'),
      ).toHaveLength(1);
    });
    const [command] = sent(fetchMock, '/api/v1/privileged-access/reviews').filter(
      (init) => init?.method === 'POST',
    );
    const headers = headersOf(command);
    expect(headers['x-administrative-reason']).toBe('Emergency use not explained by any incident');
    expect(headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers[csrfHeader]).toBe('csrf-token');
    const body = JSON.parse(command?.body as string) as Record<string, string>;
    expect(body).toMatchObject({ actor_id: other, outcome: 'escalated' });
    expect(body.from).toMatch(/Z$/);
    expect(body.to).toMatch(/Z$/);

    expect(
      await screen.findByText(/the period held 2 accesses, 1 of them emergency uses/),
    ).toBeInTheDocument();
    expect(await checkWcag(container)).toHaveNoViolations();
  });

  it('shows the API refusing a self-review in its own words', async () => {
    visit(`/access-review?actor_id=${other}`);
    stub(signedInto(null, providerScope(inForce)), (url, init) => {
      if (url === '/api/v1/privileged-access:unreviewed') {
        return json({ review_due_days: 7, actors: [] });
      }
      if (path(url) === '/api/v1/privileged-access') {
        return json({ accesses: [], next: null });
      }
      if (path(url) === '/api/v1/privileged-access/reviews' && init?.method === 'POST') {
        return json(
          {
            type: 'https://errors.scnehaux.dev/forbidden',
            detail: 'a provider does not review its own access; another provider records the review',
          },
          403,
        );
      }
      if (path(url) === '/api/v1/privileged-access/reviews') {
        return json({ reviews: [], next: null });
      }
      return undefined;
    });
    render(<App />);
    expect(await screen.findByText('No access in this period matches.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Record review' }));
    const form = screen.getByRole('form', { name: 'Record review' });
    await userEvent.type(within(form).getByLabelText('Reason'), 'Nothing happened this week');
    await userEvent.click(within(form).getByRole('button', { name: 'Record review' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('another provider records the review');
  });

  it('is a provider-mode surface', async () => {
    visit('/access-review');
    stub(signedInto(null, providerScope(null)));
    render(<App />);
    expect(await screen.findByRole('status')).toHaveTextContent(/provider mode/i);
  });
});

describe('a Tenant reading the provider access to it', () => {
  it('lists it with the authority filter, says what it leaves out, and offers no review', async () => {
    visit('/provider-access');
    const fetchMock = stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }), (url) =>
      path(url) === '/api/v1/provider-access'
        ? json({ accesses: [access('acc-2', 'activation', tenantA)], next: null })
        : url.startsWith('/api/v1/principals/')
          ? json({ contexts: [], next: null })
          : undefined,
    );
    const { container } = render(<App />);
    const list = await screen.findByRole('list', { name: 'Provider access' });
    expect(await within(list).findByText(/Investigating a stuck offboarding/)).toBeInTheDocument();
    expect(screen.getByText(/names no Tenant/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record review' })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Authority'), 'emergency');
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => query(url).get('authority') === 'emergency')).toBe(true);
    });
    // The Tenant is the session's: the request names none.
    for (const [url] of fetchMock.mock.calls.filter(([url]) => path(url) === '/api/v1/provider-access')) {
      expect(query(url).has('tenant_id')).toBe(false);
    }
    // A Tenant's read is not a provider access: it carries no reason.
    for (const init of sent(fetchMock, '/api/v1/provider-access')) {
      expect(headersOf(init)['x-administrative-reason']).toBeUndefined();
    }
    expect(await checkWcag(container)).toHaveNoViolations();
  });
});

describe('the period', () => {
  it('round-trips the operator’s zone to an RFC 3339 instant with its offset', () => {
    const instant = new Date('2026-10-01T09:30:00Z');
    expect(toInstant(toLocalInput(instant))).toBe('2026-10-01T09:30:00.000Z');
    expect(toInstant('')).toBe('');
    expect(toInstant('not a time')).toBe('');
  });
});
