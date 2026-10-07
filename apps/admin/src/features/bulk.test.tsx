import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { headersOf, json, sent, signedInto, stub, visit } from '../test/bff';

// ADR-ORG-004 §5.1, TDD-organization-experience-001 §Bulk Operations: a server preview, a confirmation
// naming the count and the scope, an execution of the previewed set, and each item's outcome.

const tenantA = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const batchId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e01';

const membership = (n: number, status = 'active') => ({
  membership_id: `m-${String(n)}`,
  principal_id: `p-${String(n)}`,
  subject_type: 'human',
  status,
  version: 3,
  valid_from: '2026-10-01T00:00:00Z',
  provenance: 'request',
});

const item = (n: number, overrides: Record<string, unknown> = {}) => ({
  membership_id: `m-${String(n)}`,
  principal_id: `p-${String(n)}`,
  current_status: 'active',
  version: 3,
  resulting_status: 'revoked',
  refusal: null,
  outcome: null,
  ...overrides,
});

const batch = (items: unknown[], counts: Record<string, number>, state = 'previewed') => ({
  batch_id: batchId,
  action: 'revoke',
  state,
  reason: 'Contractors whose engagement ended',
  correlation_id: 'c-1',
  continues: null,
  created_by: 'me',
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  executed_at: null,
  completed_at: null,
  fail_on_errors: null,
  counts: { would_change: 0, would_not_change: 0, succeeded: 0, failed: 0, not_attempted: 0, ...counts },
  items,
});

afterEach(() => {
  vi.unstubAllGlobals();
  visit('/');
});

describe('bulk membership actions', () => {
  it('previews on the server, names the count and the Tenant, executes the preview, and reports every outcome', async () => {
    visit('/memberships');
    const previewed = batch(
      [
        item(1),
        item(2),
        item(3, {
          resulting_status: null,
          refusal: {
            type: 'https://problems.scnehaux.com/state-transition-refused',
            title: 'refused',
            detail: 'already revoked',
          },
          current_status: 'revoked',
        }),
      ],
      { would_change: 2, would_not_change: 1 },
    );
    const executed = batch(
      [
        item(1, { outcome: { status: 'succeeded', accepted_at: new Date().toISOString(), event_id: 'e1' } }),
        item(2, {
          outcome: {
            status: 'failed',
            problem: {
              type: 'https://problems.scnehaux.com/version-conflict',
              title: 'conflict',
              detail: 'changed since the preview',
            },
          },
        }),
        item(3, {
          current_status: 'revoked',
          resulting_status: null,
          outcome: { status: 'not_attempted', reason: 'refused at preview' },
        }),
      ],
      { would_change: 2, would_not_change: 1, succeeded: 1, failed: 1, not_attempted: 1 },
      'executed',
    );
    const fetchMock = stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }), (url, init) => {
      if (url === '/api/v1/memberships') {
        return json({ memberships: [membership(1), membership(2), membership(3, 'revoked')], next: null });
      }
      if (url === '/api/v1/membership-batches' && init?.method === 'POST') {
        return json(previewed, 201);
      }
      if (url === `/api/v1/membership-batches/${batchId}/execute`) {
        return json(executed);
      }
      if (url.endsWith('/enforcement')) {
        return json({
          membership_id: 'm-1',
          event_id: 'e1',
          transition: 'revoked',
          accepted_at: new Date().toISOString(),
          published_at: null,
          budget_seconds: 10,
          consumers: [],
          state: 'accepted',
          evaluated_at: new Date().toISOString(),
        });
      }
      return undefined;
    });
    render(<App />);
    for (const n of [1, 2, 3]) {
      await userEvent.click(
        await screen.findByRole('checkbox', { name: `Select the membership of p-${String(n)}` }),
      );
    }
    await userEvent.click(screen.getByRole('button', { name: 'Act on 3 selected memberships' }));
    const form = screen.getByRole('form', { name: 'Bulk action' });
    await userEvent.selectOptions(within(form).getByLabelText('Action'), 'revoke');
    await userEvent.click(within(form).getByRole('button', { name: 'Preview' }));
    expect(sent(fetchMock, '/api/v1/membership-batches')).toHaveLength(0);

    await userEvent.type(within(form).getByLabelText('Reason'), 'Contractors whose engagement ended');
    await userEvent.click(within(form).getByRole('button', { name: 'Preview' }));
    await waitFor(() => {
      expect(sent(fetchMock, '/api/v1/membership-batches')).toHaveLength(1);
    });
    const [previewInit] = sent(fetchMock, '/api/v1/membership-batches');
    expect(JSON.parse(previewInit?.body as string)).toEqual({
      action: 'revoke',
      membership_ids: ['m-1', 'm-2', 'm-3'],
    });
    expect(headersOf(previewInit)['x-administrative-reason']).toBe('Contractors whose engagement ended');

    const table = await screen.findByRole('table', { name: '2 would change; 1 would not.' });
    expect(within(table).getAllByRole('row')[3]).toHaveTextContent(
      'Organization Control said: already revoked',
    );
    expect(screen.getByText(/This will revoke 2 memberships in Tenant/)).toHaveTextContent(tenantA);

    await userEvent.click(screen.getByRole('button', { name: 'revoke 2 memberships' }));
    await waitFor(() => {
      expect(sent(fetchMock, `/api/v1/membership-batches/${batchId}/execute`)).toHaveLength(1);
    });
    expect(
      headersOf(sent(fetchMock, `/api/v1/membership-batches/${batchId}/execute`)[0])['idempotency-key'],
    ).toMatch(/^[0-9a-f-]{36}$/);

    expect(await screen.findByText('1 succeeded, 1 failed, 1 not attempted.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Failed' }).nextElementSibling).toHaveTextContent(
      'changed since the preview',
    );
    expect(screen.getByRole('heading', { name: 'Not attempted' }).nextElementSibling).toHaveTextContent(
      'refused at preview',
    );
    // A succeeded revocation is shown by its evidence, here only accepted.
    expect(screen.getByRole('heading', { name: 'Succeeded' }).nextElementSibling).toHaveTextContent(
      'Accepted',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Preview the 1 failed again' }));
    const again = screen.getByRole('form', { name: 'Bulk action' });
    expect(again).toHaveTextContent('1 memberships selected');
    expect(again).toHaveTextContent('Resubmitting the failed memberships of the previous batch');
    await userEvent.type(within(again).getByLabelText('Reason'), 'Contractors whose engagement ended');
    await userEvent.click(within(again).getByRole('button', { name: 'Preview' }));
    await waitFor(() => {
      expect(sent(fetchMock, '/api/v1/membership-batches')).toHaveLength(2);
    });
    expect(JSON.parse(sent(fetchMock, '/api/v1/membership-batches')[1]?.body as string)).toEqual({
      action: 'revoke',
      membership_ids: ['m-2'],
      continues: batchId,
    });
  }, 15_000);
});
