import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { headersOf, json, me, providerScope, sent, signedInto, stub, visit } from '../test/bff';

// TDD-organization-experience-001 1.20.0 §Activating Identity Control Access: an eligible holder of
// provider:identity-control asks for its activation from the provider mode page, with a reason and a
// duration, and no provider window opens. Against a stubbed BFF, through the application's router.

const idle = signedInto(null, providerScope(null));
const reason = 'Reviewing the bootstrap ceremony record';
const grantId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b01';
const activationId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b02';

const held = (kind: string, scope = 'provider:identity-control') => ({
  grant_id: grantId,
  scope,
  kind,
  granted_at: '2026-11-01T00:00:00Z',
});

const activation = (overrides: Record<string, unknown> = {}) => ({
  activation_id: activationId,
  grant_id: grantId,
  principal_id: me,
  scope: 'provider:identity-control',
  reason,
  duration_seconds: 1_200,
  approval_required: true,
  requested_at: '2026-11-03T00:00:00Z',
  decided_by: null,
  decided_at: null,
  ends_at: null,
  in_force: false,
  ended_by: null,
  ended_at: null,
  ...overrides,
});

const form = async (): Promise<HTMLElement> =>
  screen.findByRole('form', { name: 'Identity Control provider access' });

const ask = async (panel: HTMLElement, minutes = '20'): Promise<void> => {
  await userEvent.type(within(panel).getByLabelText('Reason'), reason);
  await userEvent.clear(within(panel).getByLabelText('Duration in minutes'));
  await userEvent.type(within(panel).getByLabelText('Duration in minutes'), minutes);
  await userEvent.click(within(panel).getByRole('button', { name: 'Request Identity Control access' }));
};

afterEach(() => {
  vi.unstubAllGlobals();
  visit('/');
});

describe('Identity Control access', () => {
  it('asks to activate the eligible grant with the reason and the duration, and shows it awaiting approval', async () => {
    visit('/provider-mode');
    let approved = false;
    const fetchMock = stub(idle, (url, init) => {
      if (url === '/api/v1/provider-activations/grants') {
        return json({ grants: [held('emergency', 'provider:organization-control'), held('eligible')] });
      }
      if (url === '/api/v1/provider-activations' && init?.method === 'POST') {
        return json(activation(), 201);
      }
      if (url === '/api/v1/provider-activations') {
        return json({
          activations: [
            approved
              ? activation({
                  decision: 'approved',
                  in_force: true,
                  ends_at: new Date(Date.now() + 20 * 60_000).toISOString(),
                })
              : activation(),
          ],
        });
      }
      return undefined;
    });
    render(<App />);
    const panel = await form();
    await ask(panel);

    await waitFor(() => {
      expect(within(panel).getByRole('status')).toHaveTextContent(
        `awaiting approval by another provider in Activation requests. Activation ${activationId}.`,
      );
    });
    const [grants] = sent(fetchMock, '/api/v1/provider-activations/grants');
    expect(headersOf(grants)['x-administrative-reason']).toBe(reason);
    const [post] = sent(fetchMock, '/api/v1/provider-activations').filter((i) => i?.method === 'POST');
    expect(JSON.parse(post?.body as string)).toEqual({ grant_id: grantId, duration_seconds: 1_200 });
    expect(headersOf(post)['x-administrative-reason']).toBe(reason);
    expect(headersOf(post)['x-csrf-token']).toBe('csrf-token');
    expect(headersOf(post)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    // No provider window: the provider mode request is never sent.
    expect(sent(fetchMock, '/auth/scope/provider')).toHaveLength(0);

    approved = true;
    await userEvent.click(within(panel).getByRole('button', { name: 'Read the status again' }));
    await waitFor(() => {
      expect(within(panel).getByRole('status')).toHaveTextContent(
        /^In force until .+ Use it in the Admin Portal\.$/,
      );
    });
    const [read] = sent(fetchMock, '/api/v1/provider-activations').filter((i) => i?.method !== 'POST');
    expect(headersOf(read)['x-administrative-reason']).toBe(reason);
  });

  it('says so when the operator holds no Identity Control grant, and asks for nothing', async () => {
    visit('/provider-mode');
    const fetchMock = stub(idle, (url) =>
      url === '/api/v1/provider-activations/grants'
        ? json({ grants: [held('eligible', 'provider:organization-control')] })
        : undefined,
    );
    render(<App />);
    const panel = await form();
    await ask(panel);
    await waitFor(() => {
      expect(within(panel).getByRole('status')).toHaveTextContent(
        'You hold no Identity Control provider grant.',
      );
    });
    expect(sent(fetchMock, '/api/v1/provider-activations')).toHaveLength(0);
  });

  it('asks for no activation of an emergency grant, which is in force already', async () => {
    visit('/provider-mode');
    const fetchMock = stub(idle, (url) =>
      url === '/api/v1/provider-activations/grants' ? json({ grants: [held('emergency')] }) : undefined,
    );
    render(<App />);
    const panel = await form();
    await ask(panel);
    await waitFor(() => {
      expect(within(panel).getByRole('status')).toHaveTextContent('is an emergency grant');
    });
    expect(sent(fetchMock, '/api/v1/provider-activations')).toHaveLength(0);
  });

  it('cannot be requested without a reason, and shows the API’s refusal in its own words', async () => {
    visit('/provider-mode');
    const fetchMock = stub(idle, (url, init) => {
      if (url === '/api/v1/provider-activations/grants') {
        return json({ grants: [held('eligible')] });
      }
      if (url === '/api/v1/provider-activations' && init?.method === 'POST') {
        return json({ detail: 'the grant already has an activation pending' }, 409);
      }
      return undefined;
    });
    render(<App />);
    const panel = await form();
    await userEvent.click(within(panel).getByRole('button', { name: 'Request Identity Control access' }));
    expect(within(panel).getByLabelText('Reason')).toHaveAttribute('aria-invalid', 'true');
    expect(sent(fetchMock, '/api/v1/provider-activations/grants')).toHaveLength(0);

    await ask(panel);
    await waitFor(() => {
      expect(within(panel).getByRole('alert')).toHaveTextContent(
        'Organization Control said: the grant already has an activation pending',
      );
    });
  });
});
