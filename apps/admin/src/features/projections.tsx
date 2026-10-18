import { type ReactElement } from 'react';

import { messages } from '../messages';
import { Facts, Notice, Page, PageHeader, PageTitle, Row, RowMain, Rows, RowTitle } from '../ui';
import { formatTime, ListState, LoadMore, usePagedList } from './common';

// Projection health (TDD-organization-experience-002 §Projection Health): every registered consumer,
// its declared budget and stale behaviour, and where it last reported. A consumer past its budget is
// marked stale inline, with the behaviour that applies, because use_with_marker, revalidate and
// fail_closed mean different things to an operator triaging an incident.
//
// From 1.4.0 each consumer also shows its last reconciliation: when Organization Control last compared
// the consumer's report against authority, how long ago, and how many findings the run produced. The
// age is the service's reconciliation_age_seconds, computed when the response was built, so the page
// reads no clock of its own. The fields are absent until a first run, and the page says so.

interface Consumer {
  readonly consumer_id: string;
  readonly state?: string;
  readonly max_accepted_age_seconds?: number;
  readonly stale_behavior?: string;
  readonly last_reported_mark?: number | null;
  readonly last_reported_at?: string | null;
  readonly event_types?: readonly string[];
  readonly stale?: boolean;
  readonly last_reconciled_at?: string;
  readonly last_reconciled_mark?: number;
  readonly last_reconciled_findings?: number;
  readonly reconciliation_age_seconds?: number;
}

const lastReconciliation = (consumer: Consumer): string =>
  consumer.last_reconciled_at === undefined
    ? messages.neverReconciled
    : messages.lastReconciled(
        formatTime(consumer.last_reconciled_at),
        consumer.reconciliation_age_seconds,
        consumer.last_reconciled_findings,
      );

export function ProjectionsPage(): ReactElement {
  const { query, items } = usePagedList<Consumer>('consumers', '/v1/projections/consumers', 'consumers', {});
  return (
    <Page aria-labelledby="projections-heading">
      <PageHeader>
        <PageTitle id="projections-heading">{messages.projectionHealth}</PageTitle>
      </PageHeader>
      <ListState query={query} empty={messages.noConsumers} count={items.length} />
      <Rows>
        {items.map((consumer) => (
          <Row key={consumer.consumer_id} data-stale={consumer.stale === true ? 'true' : 'false'}>
            <RowMain>
              <RowTitle>{consumer.consumer_id}</RowTitle>{' '}
              <Facts
                items={[
                  consumer.state === undefined ? null : { status: consumer.state, label: consumer.state },
                  consumer.max_accepted_age_seconds === undefined
                    ? null
                    : messages.budgetOf(consumer.max_accepted_age_seconds),
                  consumer.stale_behavior === undefined
                    ? null
                    : messages.staleBehavior(consumer.stale_behavior),
                  messages.lastReported(formatTime(consumer.last_reported_at)),
                  lastReconciliation(consumer),
                ]}
              />
            </RowMain>
            {consumer.stale === true ? (
              <Notice tone="warning" icon="clock" role="status">
                <p>{messages.consumerStale(consumer.stale_behavior ?? '')}</p>
              </Notice>
            ) : null}
          </Row>
        ))}
      </Rows>
      <LoadMore query={query} />
    </Page>
  );
}
