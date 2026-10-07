import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { App } from './App';

const tenantA = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const tenantB = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

const signedIn = (tenantId: string | null) => ({
  authenticated: true,
  principalId: 'prn_01TEST',
  displayName: 'Ada Admin',
  acr: 'aal2',
  authTime: '2026-09-29T00:00:00.000Z',
  tenantId,
  idleExpiresAt: '2026-09-29T00:30:00.000Z',
  absoluteExpiresAt: '2026-09-29T08:00:00.000Z',
  csrfToken: 'csrf-token-from-the-session',
});

const providerScope = (window: unknown = null, extra: Record<string, unknown> = {}) => ({
  scope: 'provider',
  acr: 'aal2',
  authTime: '2026-09-29T00:00:00.000Z',
  limits: { maxDurationMinutes: 60, defaultDurationMinutes: 15 },
  window,
  ...extra,
});

const providerWindow = (overrides: Record<string, unknown> = {}) => ({
  state: 'in-force',
  emergency: false,
  reason: 'Investigating a stuck offboarding',
  correlationId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aff',
  tenants: [tenantA],
  durationMinutes: 15,
  requestedAt: new Date().toISOString(),
  endsAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  ...overrides,
});

const respond = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

// stubBff answers each BFF endpoint from a table the test can change as it goes.
function stubBff(table: Record<string, () => Response>) {
  const fetchMock = vi.fn((input: string) => {
    const answer = table[input];
    return Promise.resolve(answer === undefined ? respond({}, 404) : answer());
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('App', () => {
  it('offers a Tenant sign-in and a provider sign-in, each returning to the current page', async () => {
    window.history.replaceState(null, '', '/tenants?page=2');
    stubBff({ '/auth/session': () => respond({ authenticated: false }) });
    const { container } = render(<App />);
    const tenantForm = await screen.findByRole('form', { name: 'Sign in to a Tenant' });
    expect(tenantForm).toHaveAttribute('action', '/auth/login');
    expect(tenantForm).toHaveAttribute('method', 'get');
    expect(within(tenantForm).getByLabelText('Tenant identifier')).toHaveAttribute('name', 'tenant');
    expect(screen.getByRole('link', { name: 'Sign in as a provider' })).toHaveAttribute(
      'href',
      `/auth/login?acr_values=aal2&max_age=0&return_to=${encodeURIComponent('/tenants?page=2')}`,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('signs out with the CSRF token, then reads the session again', async () => {
    let signedOut = false;
    const fetchMock = stubBff({
      '/auth/session': () => respond(signedOut ? { authenticated: false } : signedIn(tenantA)),
      '/auth/scope': () => respond({ scope: 'tenant', tenantId: tenantA }),
      '/auth/logout': () => {
        signedOut = true;
        return new Response(null, { status: 204 });
      },
    });
    render(<App />);
    expect(await screen.findByText('Ada Admin')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/auth/logout',
        expect.objectContaining({
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'x-csrf-token': 'csrf-token-from-the-session' },
        }),
      );
    });
    expect(await screen.findByRole('link', { name: 'Sign in as a provider' })).toBeInTheDocument();
  });

  it('states an unavailable session rather than offering sign-in', async () => {
    stubBff({ '/auth/session': () => respond({}, 503) });
    render(<App />);
    expect(await screen.findByText('Session unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in as a provider' })).not.toBeInTheDocument();
  });

  it('says a sign-in did not complete, differently when the kernel did not answer', async () => {
    stubBff({ '/auth/session': () => respond({ authenticated: false }) });
    window.history.replaceState(null, '', '/?sign-in=unavailable');
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Keycloak could not be reached');
  });
});

describe('scope banner', () => {
  it('names the Tenant scope, with nothing that dismisses it', async () => {
    stubBff({
      '/auth/session': () => respond(signedIn(tenantA)),
      '/auth/scope': () => respond({ scope: 'tenant', tenantId: tenantA }),
    });
    const { container } = render(<App />);
    const banner = await screen.findByRole('region', { name: 'Active scope' });
    await waitFor(() => {
      expect(banner).toHaveTextContent(`Tenant scope: ${tenantA}`);
    });
    expect(within(banner).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Switch to another Tenant' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Switch to provider administration' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('refuses an ambiguous scope: the session and the scope disagree about the Tenant', async () => {
    stubBff({
      '/auth/session': () => respond(signedIn(tenantA)),
      '/auth/scope': () => respond({ scope: 'tenant', tenantId: tenantB }),
    });
    render(<App />);
    const banner = await screen.findByRole('region', { name: 'Active scope' });
    await waitFor(() => {
      expect(banner).toHaveTextContent('disagree about the Tenant');
    });
    expect(screen.queryByRole('form', { name: 'Switch to another Tenant' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Enter provider mode' })).not.toBeInTheDocument();
  });

  it('names provider mode, its Tenants and the time left', async () => {
    stubBff({
      '/auth/session': () => respond(signedIn(null)),
      '/auth/scope': () => respond(providerScope(providerWindow())),
    });
    render(<App />);
    const banner = await screen.findByRole('region', { name: 'Active scope' });
    await waitFor(() => {
      expect(banner).toHaveTextContent(`Provider mode. Tenants: ${tenantA}. ends in 1`);
    });
    expect(screen.getByRole('button', { name: 'Leave provider mode' })).toBeInTheDocument();
    // A window open in provider mode is left before switching to a Tenant.
    expect(screen.queryByRole('form', { name: 'Sign in to a Tenant' })).not.toBeInTheDocument();
  });
});

describe('provider mode', () => {
  it('cannot be requested without a reason', async () => {
    const fetchMock = stubBff({
      '/auth/session': () => respond(signedIn(null)),
      '/auth/scope': () => respond(providerScope()),
    });
    render(<App />);
    const form = await screen.findByRole('form', { name: 'Enter provider mode' });
    await userEvent.type(within(form).getByLabelText('Tenant identifiers, one per line'), tenantA);
    await userEvent.click(within(form).getByRole('button', { name: 'Request provider mode' }));
    expect(within(form).getByLabelText('Reason')).toHaveAttribute('aria-invalid', 'true');
    expect(form).toHaveTextContent('Write at least 10 characters.');
    expect(fetchMock).not.toHaveBeenCalledWith('/auth/scope/provider', expect.anything());
  });

  it('requests it with the reason, duration and Tenants, then shows it awaiting approval', async () => {
    let requested = false;
    const fetchMock = stubBff({
      '/auth/session': () => respond(signedIn(null)),
      '/auth/scope': () =>
        respond(providerScope(requested ? providerWindow({ state: 'pending', endsAt: null }) : null)),
      '/auth/scope/provider': () => {
        requested = true;
        return respond({}, 201);
      },
    });
    const { container } = render(<App />);
    const form = await screen.findByRole('form', { name: 'Enter provider mode' });
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.type(within(form).getByLabelText('Reason'), '  Investigating a stuck\noffboarding ');
    await userEvent.clear(within(form).getByLabelText('Duration in minutes'));
    await userEvent.type(within(form).getByLabelText('Duration in minutes'), '20');
    await userEvent.type(
      within(form).getByLabelText('Tenant identifiers, one per line'),
      `${tenantA}\n${tenantB}`,
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Request provider mode' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/auth/scope/provider',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token-from-the-session' }) as unknown,
          body: JSON.stringify({
            reason: 'Investigating a stuck offboarding',
            duration_minutes: 20,
            tenants: [tenantA, tenantB],
          }),
        }),
      );
    });
    const banner = screen.getByRole('region', { name: 'Active scope' });
    await waitFor(() => {
      expect(banner).toHaveTextContent('awaiting approval by another provider');
    });
    expect(screen.getByRole('button', { name: 'Withdraw the request' })).toBeInTheDocument();
  });

  it('can be requested for every Tenant', async () => {
    const fetchMock = stubBff({
      '/auth/session': () => respond(signedIn(null)),
      '/auth/scope': () => respond(providerScope()),
      '/auth/scope/provider': () => respond({}, 201),
    });
    render(<App />);
    const form = await screen.findByRole('form', { name: 'Enter provider mode' });
    await userEvent.type(within(form).getByLabelText('Reason'), 'Rotating a compromised administrator');
    await userEvent.click(within(form).getByRole('radio', { name: 'Every Tenant' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Request provider mode' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/auth/scope/provider',
        expect.objectContaining({ body: expect.stringContaining('"tenants":"all"') as unknown }),
      );
    });
  });

  it('asks for a fresh sign-in when the BFF answers with a step-up challenge', async () => {
    stubBff({
      '/auth/session': () => respond(signedIn(null)),
      '/auth/scope': () => respond(providerScope()),
      '/auth/scope/provider': () =>
        respond({ detail: 'fresh sign-in' }, 401, {
          'www-authenticate':
            'Bearer error="insufficient_user_authentication", acr_values="aal2", max_age="0"',
        }),
    });
    render(<App />);
    const form = await screen.findByRole('form', { name: 'Enter provider mode' });
    await userEvent.type(within(form).getByLabelText('Reason'), 'Investigating a stuck offboarding');
    await userEvent.type(within(form).getByLabelText('Tenant identifiers, one per line'), tenantA);
    await userEvent.click(within(form).getByRole('button', { name: 'Request provider mode' }));
    const alert = await within(form).findByRole('alert');
    expect(within(alert).getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      `/auth/login?acr_values=aal2&max_age=0&return_to=${encodeURIComponent('/')}`,
    );
  });

  it('shows the API’s refusal with its reference', async () => {
    stubBff({
      '/auth/session': () => respond(signedIn(null)),
      '/auth/scope': () => respond(providerScope()),
      '/auth/scope/provider': () =>
        respond({ detail: 'another request for the grant is pending', correlation_id: 'corr-1' }, 409),
    });
    render(<App />);
    const form = await screen.findByRole('form', { name: 'Enter provider mode' });
    await userEvent.type(within(form).getByLabelText('Reason'), 'Investigating a stuck offboarding');
    await userEvent.type(within(form).getByLabelText('Tenant identifiers, one per line'), tenantA);
    await userEvent.click(within(form).getByRole('button', { name: 'Request provider mode' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Organization Control said: another request for the grant is pending Reference corr-1',
    );
  });

  it('is left with the CSRF token, and the scope read again', async () => {
    let left = false;
    const fetchMock = stubBff({
      '/auth/session': () => respond(signedIn(null)),
      '/auth/scope': () => respond(providerScope(left ? null : providerWindow())),
      '/auth/scope/provider/end': () => {
        left = true;
        return new Response(null, { status: 204 });
      },
    });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Leave provider mode' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/auth/scope/provider/end',
        expect.objectContaining({
          method: 'POST',
          headers: { 'x-csrf-token': 'csrf-token-from-the-session' },
        }),
      );
    });
    expect(await screen.findByRole('form', { name: 'Enter provider mode' })).toBeInTheDocument();
  });

  it('says once why a window closed without being left', async () => {
    stubBff({
      '/auth/session': () => respond(signedIn(null)),
      '/auth/scope': () => respond(providerScope(null, { closed: 'denied' })),
    });
    render(<App />);
    expect(await screen.findByRole('status')).toHaveTextContent('Provider mode was denied by the approver.');
  });
});
