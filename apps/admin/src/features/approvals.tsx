import { useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactElement } from 'react';

import { apiGet } from '../api/client';
import { messages } from '../messages';
import { normalizeReason, reasonProblem } from '../scope';
import { useScope } from '../ScopeContext';
import { useSignedIn } from '../SessionContext';
import { Action, ApiErrorMessage, facts, formatTime } from './common';

// The approval surface (TDD-organization-experience-002 1.2.0, ADR-ORG-002 §5.1): in production an
// activation is approved by another provider. It lists the requests awaiting a decision, and decides
// one with a reason of its own. The operator's own request is shown as theirs, with no decision
// control; the API refuses a self-approval regardless.

interface Activation {
  readonly activation_id: string;
  readonly principal_id: string;
  readonly scope: string;
  readonly reason: string;
  readonly duration_seconds: number;
  readonly requested_at: string;
  readonly decision?: string;
}

const activationsKey = ['provider-activations'] as const;

export function ApprovalsPage(): ReactElement {
  const session = useSignedIn();
  const { state } = useScope();
  // A provider read needs a reason. A window supplies its own through the BFF; without one the
  // operator writes one before the requests are shown.
  const windowReason =
    state.status === 'ready' && state.scope.scope === 'provider' && state.scope.window !== null;
  const [reviewReason, setReviewReason] = useState<string | null>(null);
  const reason = windowReason ? '' : reviewReason;
  const query = useQuery({
    queryKey: [...activationsKey, reason],
    enabled: reason !== null,
    queryFn: ({ signal }) =>
      apiGet<{ activations: Activation[] }>('/v1/provider-activations', {
        signal,
        ...(reason === null || reason === '' ? {} : { reason }),
      }),
  });

  if (reason === null) {
    return <ReviewReason onReason={setReviewReason} />;
  }
  const pending = (query.data?.activations ?? []).filter((activation) => (activation.decision ?? '') === '');
  return (
    <section aria-labelledby="approvals-heading">
      <h2 id="approvals-heading">{messages.approvals}</h2>
      {query.isPending ? <p>{messages.loading}</p> : null}
      {query.isError ? <ApiErrorMessage error={query.error} /> : null}
      {query.isSuccess && pending.length === 0 ? <p>{messages.noPendingActivations}</p> : null}
      <ul>
        {pending.map((activation) => (
          <li key={activation.activation_id}>
            <strong>{activation.principal_id}</strong>{' '}
            {facts(
              activation.scope,
              messages.minutes(Math.round(activation.duration_seconds / 60)),
              formatTime(activation.requested_at),
            )}
            <p>{messages.activationReason(activation.reason)}</p>
            {activation.principal_id === session.principalId ? (
              <p>{messages.yourRequest}</p>
            ) : (
              <>
                <Action
                  label={messages.approve}
                  path={`/v1/provider-activations/${activation.activation_id}/approve`}
                  body={{}}
                  reason="required"
                  invalidates={[activationsKey]}
                />{' '}
                <Action
                  label={messages.deny}
                  path={`/v1/provider-activations/${activation.activation_id}/deny`}
                  body={{}}
                  reason="required"
                  invalidates={[activationsKey]}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReviewReason({ onReason }: { readonly onReason: (reason: string) => void }): ReactElement {
  const id = useId();
  const [value, setValue] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const problem = reasonProblem(value);
  return (
    <form
      aria-label={messages.reviewRequests}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (problem === null) {
          onReason(normalizeReason(value));
        }
      }}
    >
      <h2>{messages.approvals}</h2>
      <p>{messages.reviewReasonExplained}</p>
      <label htmlFor={id}>{messages.reason}</label>
      <textarea
        id={id}
        value={value}
        aria-invalid={submitted && problem !== null}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      {submitted && problem !== null ? <p role="alert">{messages.reasonShort(10)}</p> : null}
      <button type="submit">{messages.reviewRequests}</button>
    </form>
  );
}
