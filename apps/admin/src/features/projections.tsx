import { type ReactElement } from 'react';

import { messages } from '../messages';
import { facts, formatTime, ListState, LoadMore, usePagedList } from './common';

// Projection health (TDD-organization-experience-002 §Projection Health): every registered consumer,
// its declared budget and stale behaviour, and where it last reported. A consumer past its budget is
// marked stale inline, with the behaviour that applies, because use_with_marker, revalidate and
// fail_closed mean different things to an operator triaging an incident.

interface Consumer {
  readonly consumer_id: string;
  readonly state?: string;
  readonly max_accepted_age_seconds?: number;
  readonly stale_behavior?: string;
  readonly last_reported_mark?: number | null;
  readonly last_reported_at?: string | null;
  readonly event_types?: readonly string[];
  readonly stale?: boolean;
}

export function ProjectionsPage(): ReactElement {
  const { query, items } = usePagedList<Consumer>('consumers', '/v1/projections/consumers', 'consumers', {});
  return (
    <section aria-labelledby="projections-heading">
      <h2 id="projections-heading">{messages.projectionHealth}</h2>
      <ListState query={query} empty={messages.noConsumers} count={items.length} />
      <ul>
        {items.map((consumer) => (
          <li key={consumer.consumer_id} data-stale={consumer.stale === true ? 'true' : 'false'}>
            <strong>{consumer.consumer_id}</strong>{' '}
            {facts(
              consumer.state,
              consumer.max_accepted_age_seconds === undefined
                ? null
                : messages.budgetOf(consumer.max_accepted_age_seconds),
              consumer.stale_behavior === undefined ? null : messages.staleBehavior(consumer.stale_behavior),
              messages.lastReported(formatTime(consumer.last_reported_at)),
            )}
            {consumer.stale === true ? (
              <p role="status">{messages.consumerStale(consumer.stale_behavior ?? '')}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <LoadMore query={query} />
    </section>
  );
}
