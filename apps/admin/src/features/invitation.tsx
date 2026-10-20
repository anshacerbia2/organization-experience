import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { ApiError, apiCommand, apiGet, listPath, type Page } from '../api/client';
import { useIdempotencyKey } from '../api/idempotency';
import { sessionQueryKey } from '../api/query';
import { Gate } from '../Gate';
import { acceptancePath, forgetInvitationToken, takeInvitationToken } from '../invitationLink';
import { messages } from '../messages';
import { navigation, signInHref, signInOutcome, tenantSignInHref } from '../session';
import { useSessionQuery } from '../SessionContext';
import { Button, Icon, layout, Loading, Notice } from '../ui';
import { ApiErrorMessage } from './common';

// The invitation acceptance page (ADR-ORG-007 §5.6, TDD-organization-experience-002 1.8.0). Any
// signed-in person reaches it, with or without a Tenant: acceptance is a self command, and the API
// creates the Membership for the caller's own Principal, after checking the caller holds the invited
// address, proven. The page names no Tenant before acceptance, because the invitation discloses
// nothing until then (SAD-004 §5.5), and it reads nothing to find out.

interface AcceptedInvitation {
  readonly invitation_id: string;
  readonly tenant_id: string;
  readonly workspace_id?: string | null;
  readonly state: string;
  readonly accepted_at?: string | null;
}

interface Accepted {
  readonly invitation: AcceptedInvitation;
  readonly membership?: unknown;
}

interface Context {
  readonly tenant_id: string;
  readonly tenant_display_name: string;
}

// The one refusal of an invitation: unknown, expired, revoked, used, or sent to an address the person
// has not proven (ADR-ORG-007 §5.4). Known by its problem type, not its status: "Consumers MUST use the
// "type" URI ... as the problem type's primary identifier" (RFC 9457 §3.1.1,
// TDD-organization-experience-002 1.10.0). A 404 of any other type is not the invitation's answer.
export const invitationNotAcceptable = 'https://problems.scnehaux.com/invitation-not-acceptable';

const notAcceptable = (error: unknown): boolean =>
  error instanceof ApiError && error.type === invitationNotAcceptable;

// A refusal the same token gets again, so the token is of no further use in this tab. A 503 or no
// answer changed nothing and is worth trying again later; a 401 needs a sign-in, then the same token;
// a 404 of another type never judged the invitation, so the token is kept.
const final = (error: unknown): boolean =>
  notAcceptable(error) || (error instanceof ApiError && [400, 409].includes(error.status));

// The pages of the person's own contexts read to name the Tenant joined, at most. The Tenant is
// named by its identifier past them.
const contextPages = 20;

// useJoinedTenant names the Tenant joined, from the person's own contexts (ADR-ORG-005).
function useJoinedTenant(principalId: string | null, tenantId: string | null) {
  return useQuery({
    queryKey: ['contexts', 'joined', principalId, tenantId],
    enabled: principalId !== null && tenantId !== null,
    retry: false,
    queryFn: async ({ signal }) => {
      const base = `/v1/principals/${encodeURIComponent(principalId ?? '')}/contexts` as const;
      let after: string | null = null;
      for (let page = 0; page < contextPages; page += 1) {
        const read: Page & { contexts?: Context[] } = await apiGet(listPath(base, {}, after), { signal });
        const found = (read.contexts ?? []).find((context) => context.tenant_id === tenantId);
        if (found !== undefined) {
          return found.tenant_display_name;
        }
        if (read.next === null) {
          break;
        }
        after = read.next;
      }
      return null;
    },
  });
}

function Joined({
  principalId,
  invitation,
}: {
  readonly principalId: string | null;
  readonly invitation: AcceptedInvitation;
}): ReactElement {
  const named = useJoinedTenant(principalId, invitation.tenant_id);
  if (named.isPending && principalId !== null) {
    return <Loading />;
  }
  const name = named.data ?? null;
  return (
    <div className={layout.stack}>
      <Notice tone="success" role="status">
        <p>{messages.acceptJoined(name ?? messages.acceptJoinedTenant)}</p>
        {name === null ? <code className={layout.token}>{invitation.tenant_id}</code> : null}
      </Notice>
      <p>{messages.acceptOpenWhy}</p>
      <div className={layout.actions}>
        {/* Opening the Tenant is a sign-in for it (ADR-IAM-006 §5.2), as the context switcher's
            entries are: the kernel issues it to a member alone. */}
        <a href={tenantSignInHref(invitation.tenant_id, '/')}>
          {messages.acceptOpenTenant(name ?? messages.acceptJoinedTenant)}
        </a>
      </div>
    </div>
  );
}

function Refused({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry: () => void;
}): ReactElement {
  const status = error instanceof ApiError ? error.status : null;
  const reference =
    error instanceof ApiError && error.correlationId !== null
      ? ` ${messages.correlation(error.correlationId)}`
      : '';
  if (notAcceptable(error)) {
    return (
      <Notice tone="danger" role="alert">
        <p>{messages.acceptNotAcceptable}</p>
        <p>{messages.acceptProveAddress}</p>
      </Notice>
    );
  }
  if (status === 409) {
    const detail = error instanceof ApiError ? error.detail : null;
    return (
      <div className={layout.stack}>
        <Notice tone="warning" role="alert">
          <p>{messages.acceptConflict}</p>
          {detail === null ? null : <p>{messages.refusedBy(detail)}</p>}
        </Notice>
        <div className={layout.actions}>
          <a href="/">{messages.yourOverview}</a>
        </div>
      </div>
    );
  }
  if (status === 400) {
    return (
      <Notice tone="danger" role="alert">
        <p>{messages.acceptMalformed}</p>
      </Notice>
    );
  }
  if (status === null || status >= 500) {
    return (
      <div className={layout.stack}>
        <Notice tone="warning" role="alert">
          <p>
            {messages.acceptUnavailable}
            {reference}
          </p>
        </Notice>
        <div className={layout.actions}>
          <Button variant="secondary" onClick={onRetry}>
            {messages.acceptTryAgain}
          </Button>
        </div>
      </div>
    );
  }
  return <ApiErrorMessage error={error} />;
}

export function AcceptInvitationPage(): ReactElement {
  // First, before anything reads the location: the token leaves the address bar.
  const [token] = useState(takeInvitationToken);
  const session = useSessionQuery();
  const client = useQueryClient();
  const keys = useIdempotencyKey();
  const outcome = signInOutcome(window.location.search);

  const signedIn = session.data?.authenticated === true ? session.data : null;
  const accept = useMutation({
    mutationFn: (sent: { token: string; csrfToken: string }) =>
      apiCommand<Accepted>(
        '/v1/invitations/accept',
        { token: sent.token },
        { csrfToken: sent.csrfToken, idempotencyKey: keys.keyFor({ token: sent.token }) },
      ),
    // Never retried here: a refused acceptance is answered once (ADR-ORG-007 §6), and Try again is the
    // person's own.
    retry: false,
    onSuccess: async () => {
      keys.settle();
      forgetInvitationToken();
      await client.invalidateQueries({ queryKey: ['contexts'] });
    },
    onError: async (error) => {
      keys.settle(error);
      if (final(error)) {
        forgetInvitationToken();
      }
      // The BFF ended the session: the page asks for a sign-in, and the token still waits.
      if (error instanceof ApiError && error.status === 401 && !error.stepUp) {
        await client.invalidateQueries({ queryKey: sessionQueryKey });
      }
    },
  });

  const send = (): void => {
    if (token !== null && signedIn !== null) {
      accept.mutate({ token, csrfToken: signedIn.csrfToken });
    }
  };

  let body: ReactElement;
  if (session.isPending) {
    body = <Loading />;
  } else if (session.isError) {
    body = (
      <Notice tone="danger" role="alert">
        <p>{messages.unavailable}</p>
      </Notice>
    );
  } else if (accept.isSuccess) {
    body = <Joined principalId={signedIn?.principalId ?? null} invitation={accept.data.invitation} />;
  } else if (token === null) {
    body = (
      <Notice tone="warning" role="status">
        <p>{messages.acceptNoToken}</p>
      </Notice>
    );
  } else if (signedIn === null) {
    body = (
      <div className={layout.stack}>
        {accept.isError ? (
          <Notice tone="warning" role="alert">
            <p>{messages.acceptSessionEnded}</p>
          </Notice>
        ) : null}
        <p>{messages.acceptInvited}</p>
        <p>{messages.acceptSignInWhy}</p>
        <div className={layout.actions}>
          {/* A sign-in with no Tenant, returning here without the fragment: the token waits in this
              tab's session storage, never in a URL the BFF sees (ADR-ORG-007 §5.6). */}
          <Button
            icon={<Icon name="arrow" />}
            onClick={() => {
              navigation.assign(signInHref(acceptancePath));
            }}
          >
            {messages.acceptSignIn}
          </Button>
        </div>
      </div>
    );
  } else if (accept.isError && final(accept.error)) {
    body = <Refused error={accept.error} onRetry={send} />;
  } else {
    body = (
      <div className={layout.stack}>
        <p>{messages.acceptInvited}</p>
        <p>{messages.acceptNamedAfter}</p>
        <p>
          {messages.acceptSignedInAs(signedIn.displayName ?? signedIn.principalId ?? messages.signedIn)}{' '}
          {messages.acceptWho}
        </p>
        {accept.isError ? (
          <Refused error={accept.error} onRetry={send} />
        ) : (
          <div className={layout.actions}>
            <Button icon={<Icon name="check" />} disabled={accept.isPending} onClick={send}>
              {accept.isPending ? messages.accepting : messages.acceptAction}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <Gate title={messages.acceptTitle}>
      {outcome === null ? null : (
        <Notice tone="danger" role="alert">
          <p>{outcome === 'failed' ? messages.signInFailed : messages.signInUnavailable}</p>
        </Notice>
      )}
      {body}
    </Gate>
  );
}
