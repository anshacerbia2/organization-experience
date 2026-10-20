import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { navigation } from '../session';
import { checkWcag } from '../test/a11y';
import { headersOf, json, me, providerScope, sent, signedInto, stub, visit, type Handler } from '../test/bff';
import { toneOf } from '../ui';

// TDD-organization-experience-002 1.8.0 §Testing Strategy, Invitation (ADR-ORG-007): the link shown
// once on issue, and the page where the invited person accepts, signed in as themselves.

const tenantA = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const joined = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const token = 'aW52aXRhdGlvbi10b2tlbi0yNTYtYml0cy1vZi1yYW5kb20';
const storageKey = 'scnx-org-invitation';

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

const signedOut: Handler = (url) => (url === '/auth/session' ? json({ authenticated: false }) : undefined);
const noTenant = signedInto(null, providerScope(null));

const contexts: Handler = (url) =>
  url === `/api/v1/principals/${me}/contexts`
    ? json({
        contexts: [
          {
            membership_id: 'm-1',
            tenant_id: joined,
            tenant_display_name: 'Beta Logistics',
            tenant_status: 'active',
            workspace_id: null,
            administers: false,
          },
        ],
        next: null,
      })
    : undefined;

const acceptAnswers =
  (response: () => Response): Handler =>
  (url, init) =>
    url === '/api/v1/invitations/accept' && init?.method === 'POST' ? response() : undefined;

const accepted = acceptAnswers(() =>
  json({
    invitation: {
      invitation_id: 'inv-1',
      tenant_id: joined,
      subject_type: 'human',
      invited_by: 'someone',
      state: 'accepted',
      correlation_id: 'c-1',
      principal_id: me,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      created_at: new Date().toISOString(),
      accepted_at: new Date().toISOString(),
    },
    membership: { membership: { membership_id: 'm-1' }, accepted_at: new Date().toISOString() },
  }),
);

const problem = (status: number, type: string, detail: string) =>
  acceptAnswers(() => json({ type: `https://problems.scnehaux.com/${type}`, status, detail }, status));

// The application sends every command body as a JSON string.
const bodyOf = (init: RequestInit | undefined): string => (typeof init?.body === 'string' ? init.body : '');

// No request the page makes carries the token in its URL.
const noTokenInAnyUrl = (fetchMock: ReturnType<typeof stub>): void => {
  for (const [url] of fetchMock.mock.calls) {
    expect(url).not.toContain(token);
  }
};

describe('the link shown once on issue', () => {
  const issued: Handler = (url, init) =>
    url === '/api/v1/invitations' && init?.method === 'POST'
      ? json({ invitation: { invitation_id: 'inv-9', state: 'pending' }, token }, 201)
      : url.startsWith('/api/v1/invitations')
        ? json({ invitations: [], next: null })
        : undefined;

  it('shows the acceptance link with the token in the fragment, copies it, and is gone after Done', async () => {
    visit('/invitations');
    const fetchMock = stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }), issued);
    // user-event puts a clipboard of its own on the navigator.
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    const { container } = render(<App />);

    await user.type(await screen.findByLabelText(/Invitee/), 'person@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));

    const link = `${window.location.origin}/invitations/accept#${token}`;
    const panel = await screen.findByRole('region', { name: 'The acceptance link, shown this once' });
    expect(panel).toHaveTextContent(link);
    expect(panel).toHaveTextContent('Send it to them yourself');
    expect(panel).toHaveTextContent('revoke this invitation and send a new one');
    expect(await checkWcag(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(link);
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done, I have sent it' }));
    expect(screen.queryByText(link)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(token);
    // The token never went back to the BFF, and nothing stored it.
    expect(sent(fetchMock, '/api/v1/invitations').filter((init) => init?.method === 'POST')).toHaveLength(1);
    for (const init of fetchMock.mock.calls.map(([, init]) => init)) {
      expect(bodyOf(init)).not.toContain(token);
    }
    noTokenInAnyUrl(fetchMock);
    expect(window.sessionStorage.length).toBe(0);
    expect(JSON.stringify(window.localStorage)).not.toContain(token);
  });

  // TDD-organization-experience-002 1.10.0 (ADR-ORG-007 §5.5, STD-GLB-001 1.7.0): a 201 without its
  // token is a replay, and each answered issue takes a new Idempotency-Key.
  it('shows a replay as already issued, with no link, and takes a new key after each answer', async () => {
    visit('/invitations');
    let replay = false;
    const fetchMock = stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }), (url, init) =>
      url === '/api/v1/invitations' && init?.method === 'POST'
        ? json(
            replay
              ? { invitation: { invitation_id: 'inv-9', state: 'pending' } }
              : { invitation: { invitation_id: 'inv-9', state: 'pending' }, token },
            201,
          )
        : url.startsWith('/api/v1/invitations')
          ? json({ invitations: [], next: null })
          : undefined,
    );
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.type(await screen.findByLabelText(/Invitee/), 'person@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    await screen.findByRole('region', { name: 'The acceptance link, shown this once' });
    await user.click(screen.getByRole('button', { name: 'Done, I have sent it' }));

    // The same values again, after an answer: a new request, with a new key.
    replay = true;
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText(/This invitation was already issued, as inv-9/)).toBeInTheDocument();
    expect(screen.getByText(/revoke this invitation below and send a new one/)).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'The acceptance link, shown this once' }),
    ).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(token);
    // The live defect this fixes: a replayed issue rendered the link as …/invitations/accept#undefined.
    expect(document.body).not.toHaveTextContent('#undefined');
    const [first, second] = sent(fetchMock, '/api/v1/invitations').filter((init) => init?.method === 'POST');
    expect(bodyOf(second)).toBe(bodyOf(first));
    expect(headersOf(second)['idempotency-key']).not.toBe(headersOf(first)['idempotency-key']);
    expect(await checkWcag(container)).toHaveNoViolations();
  });

  it('resends the same key after an answer that left the outcome unknown', async () => {
    visit('/invitations');
    let unavailable = true;
    const fetchMock = stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }), (url, init) =>
      url === '/api/v1/invitations' && init?.method === 'POST'
        ? unavailable
          ? json({ type: 'https://problems.scnehaux.com/dependency-unavailable', status: 503 }, 503)
          : json({ invitation: { invitation_id: 'inv-9', state: 'pending' }, token }, 201)
        : url.startsWith('/api/v1/invitations')
          ? json({ invitations: [], next: null })
          : undefined,
    );
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/Invitee/), 'person@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    await screen.findByRole('alert');
    unavailable = false;
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    await screen.findByRole('region', { name: 'The acceptance link, shown this once' });
    const [first, second] = sent(fetchMock, '/api/v1/invitations').filter((init) => init?.method === 'POST');
    expect(headersOf(second)['idempotency-key']).toBe(headersOf(first)['idempotency-key']);
  });

  it('says so when the browser does not allow copying, and the link stays on the page', async () => {
    visit('/invitations');
    stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }), issued);
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('not allowed'));
    render(<App />);
    await user.type(await screen.findByLabelText(/Invitee/), 'person@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    await user.click(await screen.findByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText(/did not allow copying/)).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/invitations/accept#${token}`)).toBeInTheDocument();
  });

  it('offers no identity_verified state in the filter', async () => {
    visit('/invitations');
    stub(signedInto(tenantA, { scope: 'tenant', tenantId: tenantA }), issued);
    render(<App />);
    const filter = await screen.findByLabelText('Status');
    expect(filter).not.toHaveTextContent('identity_verified');
    expect(filter).toHaveTextContent('pending');
  });

  it('has no tone for identity_verified, which Organization Control no longer serves', () => {
    expect(toneOf('identity_verified')).toBe(toneOf('no-such-state'));
    expect(toneOf('pending')).not.toBe(toneOf('no-such-state'));
  });
});

describe('the acceptance page', () => {
  it('takes the token from the fragment, clears the address bar, and sends it only in the body', async () => {
    visit(`/invitations/accept#${token}`);
    const fetchMock = stub(noTenant, accepted, contexts);
    const user = userEvent.setup();
    const { container } = render(<App />);

    expect(await screen.findByText('You have been invited to join a Tenant.')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/invitations/accept');
    expect(window.sessionStorage.getItem(storageKey)).toBe(token);
    expect(screen.getByText(/signed in as Ada Admin/)).toBeInTheDocument();
    expect(await checkWcag(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByText('You joined Beta Logistics.')).toBeInTheDocument();
    const [init] = sent(fetchMock, '/api/v1/invitations/accept');
    expect(JSON.parse(bodyOf(init))).toEqual({ token });
    expect(headersOf(init)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(headersOf(init)['x-csrf-token']).toBe('csrf-token');
    noTokenInAnyUrl(fetchMock);

    // Opening the Tenant joined is a sign-in for it (ADR-IAM-006 §5.2).
    expect(screen.getByRole('link', { name: 'Open Beta Logistics' })).toHaveAttribute(
      'href',
      `/auth/login?tenant=${joined}&return_to=%2F`,
    );
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    expect(await checkWcag(container)).toHaveNoViolations();
  });

  it('keeps the token across a sign-in with no Tenant, never in a URL, and resumes after it', async () => {
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => undefined);
    visit(`/invitations/accept#${token}`);
    const before = stub(signedOut);
    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Sign in to accept' }));
    expect(assign).toHaveBeenCalledWith('/auth/login?return_to=%2Finvitations%2Faccept');
    expect(window.location.hash).toBe('');
    expect(window.sessionStorage.getItem(storageKey)).toBe(token);
    noTokenInAnyUrl(before);
    expect(String(assign.mock.calls[0]?.[0])).not.toContain(token);
    first.unmount();

    // Back from the sign-in, at the same path without a fragment.
    visit('/invitations/accept');
    const after = stub(noTenant, accepted, contexts);
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByText('You joined Beta Logistics.')).toBeInTheDocument();
    expect(JSON.parse(bodyOf(sent(after, '/api/v1/invitations/accept')[0]))).toEqual({ token });
  });

  // TDD-organization-experience-002 1.10.0: the refusal is known by its problem type (RFC 9457 §3.1.1).
  it('answers the invitation-not-acceptable type with one sentence, forgets the token, and sends nothing again', async () => {
    visit(`/invitations/accept#${token}`);
    const fetchMock = stub(
      noTenant,
      problem(404, 'invitation-not-acceptable', 'The invitation cannot be accepted'),
    );
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This invitation cannot be accepted.');
    expect(alert).toHaveTextContent('Ask whoever invited you.');
    expect(alert).toHaveTextContent('prove that address first');
    expect(screen.queryByRole('button', { name: /Accept invitation|Try again/ })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    expect(sent(fetchMock, '/api/v1/invitations/accept')).toHaveLength(1);
    expect(await checkWcag(container)).toHaveNoViolations();
  });

  it('does not read a 404 of another type as the invitation’s refusal, and keeps the token', async () => {
    visit(`/invitations/accept#${token}`);
    stub(noTenant, problem(404, 'not-found', 'no route'));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('This invitation cannot be accepted.');
    expect(alert).toHaveTextContent('no route');
    expect(window.sessionStorage.getItem(storageKey)).toBe(token);
  });

  it('says why a 409 could not join, with the API’s sentence', async () => {
    visit(`/invitations/accept#${token}`);
    stub(noTenant, problem(409, 'state-transition-refused', 'the Tenant is suspended'));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The Tenant is not active, or you already hold this Membership.');
    expect(alert).toHaveTextContent('the Tenant is suspended');
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('says a 400 link is incomplete', async () => {
    visit(`/invitations/accept#${token}`);
    stub(noTenant, problem(400, 'validation-failed', 'token is malformed'));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This link is incomplete.');
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('keeps the token after a 503, and Try again is the person’s, with the same key', async () => {
    visit(`/invitations/accept#${token}`);
    let unavailable = true;
    const fetchMock = stub(
      noTenant,
      (url, init) =>
        unavailable && url === '/api/v1/invitations/accept' && init?.method === 'POST'
          ? json({ type: 'https://problems.scnehaux.com/dependency-unavailable', status: 503 }, 503)
          : undefined,
      accepted,
      contexts,
    );
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing changed. Try again later.');
    expect(window.sessionStorage.getItem(storageKey)).toBe(token);
    expect(sent(fetchMock, '/api/v1/invitations/accept')).toHaveLength(1);
    expect(await checkWcag(container)).toHaveNoViolations();

    unavailable = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('You joined Beta Logistics.')).toBeInTheDocument();
    const [first, second] = sent(fetchMock, '/api/v1/invitations/accept');
    expect(headersOf(second)['idempotency-key']).toBe(headersOf(first)['idempotency-key']);
  });

  it('says where the link is needed when there is no token', async () => {
    visit('/invitations/accept');
    stub(noTenant);
    render(<App />);
    expect(await screen.findByText(/Open that link again/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).not.toBeInTheDocument();
  });

  it('is offered from anywhere else while a token waits in the tab', async () => {
    window.sessionStorage.setItem(storageKey, token);
    visit('/');
    stub(signedOut);
    render(<App />);
    expect(await screen.findByRole('link', { name: 'Continue to your invitation' })).toHaveAttribute(
      'href',
      '/invitations/accept',
    );
    await waitFor(() => {
      expect(screen.getByText('Not signed in')).toBeInTheDocument();
    });
  });
});
