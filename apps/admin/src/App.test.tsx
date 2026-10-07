import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { App } from './App';

const signedIn = {
  authenticated: true,
  principalId: 'prn_01TEST',
  displayName: 'Ada Admin',
  acr: 'aal2',
  authTime: '2026-09-29T00:00:00.000Z',
  idleExpiresAt: '2026-09-29T00:30:00.000Z',
  absoluteExpiresAt: '2026-09-29T08:00:00.000Z',
  csrfToken: 'csrf-token-from-the-session',
};

const respond = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('App', () => {
  it('offers sign-in that returns to the current page', async () => {
    window.history.replaceState(null, '', '/tenants?page=2');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respond({ authenticated: false }))),
    );
    const { container } = render(<App />);
    const link = await screen.findByRole('link', { name: 'Sign in' });
    expect(link).toHaveAttribute('href', `/auth/login?return_to=${encodeURIComponent('/tenants?page=2')}`);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows who is signed in, and signs out with the CSRF token, then reads the session again', async () => {
    let signedOut = false;
    const fetchMock = vi.fn((input: string) => {
      if (input === '/auth/logout') {
        signedOut = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(respond(signedOut ? { authenticated: false } : signedIn));
    });
    vi.stubGlobal('fetch', fetchMock);
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
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('states an unavailable session rather than offering sign-in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respond({}, 503))),
    );
    render(<App />);
    expect(await screen.findByText('Session unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('says a sign-in did not complete, differently when the kernel did not answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respond({ authenticated: false }))),
    );
    window.history.replaceState(null, '', '/?sign-in=unavailable');
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Keycloak could not be reached');
  });
});
