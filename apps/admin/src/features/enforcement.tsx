import { useQuery } from '@tanstack/react-query';
import { type ReactElement } from 'react';

import { apiGet } from '../api/client';
import { messages } from '../messages';
import { ApiErrorMessage, formatTime } from './common';

// A Membership transition shown by its evidence (ADR-ORG-004 §5.2, TDD-organization-experience-001
// 1.3.0): accepted, propagating, enforced or over budget, never "revoked" on the API's answer. The
// state is read again until it is settled, enforced or over budget.

export interface Enforcement {
  readonly membership_id: string;
  readonly event_id: string;
  readonly transition: string;
  readonly accepted_at: string;
  readonly published_at: string | null;
  readonly budget_seconds: number;
  readonly consumers: readonly {
    readonly consumer_id: string;
    readonly evidence: 'consumer_applied' | 'transport_accepted' | 'pending' | 'dead_lettered';
    readonly recorded_at: string | null;
  }[];
  readonly state: 'accepted' | 'propagating' | 'enforced' | 'over_budget';
  readonly evaluated_at: string;
}

// How often an unsettled transition is read again: well inside the ten-second budget, so the
// operator watches it settle rather than waiting for a page reload.
const pollMs = 2_000;

const settled = (state: Enforcement['state'] | undefined): boolean =>
  state === 'enforced' || state === 'over_budget';

export function EnforcementStatus({ membershipId }: { readonly membershipId: string }): ReactElement {
  const query = useQuery({
    queryKey: ['enforcement', membershipId],
    queryFn: ({ signal }) => apiGet<Enforcement>(`/v1/memberships/${membershipId}/enforcement`, { signal }),
    staleTime: 0,
    refetchInterval: (current) => (settled(current.state.data?.state) ? false : pollMs),
  });
  if (query.isPending) {
    return <p role="status">{messages.loading}</p>;
  }
  if (query.isError) {
    return <ApiErrorMessage error={query.error} />;
  }
  const enforcement = query.data;
  const elapsed = Math.max(
    0,
    Math.round((Date.parse(enforcement.evaluated_at) - Date.parse(enforcement.accepted_at)) / 1000),
  );
  const pending = enforcement.consumers.filter((consumer) => consumer.evidence !== 'consumer_applied');
  return (
    <div role="status" data-enforcement={enforcement.state}>
      <p>
        <strong>{messages.enforcementState(enforcement.state)}</strong>{' '}
        {messages.enforcementTiming(
          enforcement.transition,
          formatTime(enforcement.accepted_at),
          elapsed,
          enforcement.budget_seconds,
        )}
      </p>
      {pending.length === 0 ? null : (
        <ul aria-label={messages.pendingConsumers}>
          {pending.map((consumer) => (
            <li key={consumer.consumer_id}>
              {messages.consumerEvidence(consumer.consumer_id, messages.evidence(consumer.evidence))}
            </li>
          ))}
        </ul>
      )}
      {enforcement.state === 'over_budget' ? <p>{messages.overBudgetEscalation}</p> : null}
    </div>
  );
}
