import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { apiGet } from '../api/client';
import { messages } from '../messages';
import {
  Button,
  Facts,
  fieldClasses,
  layout,
  Notice,
  Page,
  PageHeader,
  PageTitle,
  Panel,
  Row,
  RowMain,
  Rows,
  RowTitle,
} from '../ui';
import { Action, Field, formatTime, ListState, LoadMore, usePagedList } from './common';
import { toInstant, toLocalInput } from './review';

// Projection health (TDD-organization-experience-002 §Projection Health): every registered consumer,
// its declared budget and stale behaviour, and where it last reported. A consumer past its budget is
// marked stale inline, with the behaviour that applies, because use_with_marker, revalidate and
// fail_closed mean different things to an operator triaging an incident.
//
// From 1.4.0 each consumer also shows its last reconciliation: when Organization Control last compared
// the consumer's report against authority, how long ago, and how many findings the run produced. The
// age is the service's reconciliation_age_seconds, computed when the response was built, so the page
// reads no clock of its own. The fields are absent until a first run, and the page says so.
//
// From 1.7.0 the page also carries what an operator does about it: a consumer's dead letters, replayed,
// resolved or waived (TDD-organization-control-005); a consumer's retirement; and the
// Tenant-administration pause a restore is reconciled under (ADR-ORG-003 §5.5).

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
  // From TDD-organization-experience-002 1.10.0: the interval the consumer declared at registration,
  // and a reconciliation a restore requested that no run has cleared yet.
  readonly reconciliation_interval_seconds?: number;
  readonly reconciliation_requested_at?: string | null;
}

// One incident: one event at one consumer (TDD-organization-control-005 2.5.0 §Listing a consumer's
// dead letters).
export interface DeadLetter {
  readonly event_id: string;
  readonly consumer: string;
  readonly event_type: string;
  readonly authority_bearing: boolean;
  readonly aggregate_id: string | null;
  readonly version: number | null;
  readonly lane: string;
  readonly failure_class: string;
  readonly failure_detail: string | null;
  readonly attempts: number;
  readonly first_failed_at: string;
  readonly dead_lettered_at: string;
  readonly resolved_at: string | null;
  readonly resolution_type: string | null;
  readonly resolved_by: string | null;
  readonly resolution_reference: string | null;
  readonly waived_at: string | null;
  readonly waived_until: string | null;
  readonly waived_by: string | null;
  readonly waiver_reason: string | null;
}

interface Pause {
  readonly paused: boolean;
  readonly pause_id: string | null;
  readonly reason: string | null;
  readonly actor_id: string | null;
  readonly correlation_id: string | null;
  readonly recorded_at: string | null;
}

const consumersKey = ['consumers'] as const;
const pauseKey = ['tenant-administration-pause'] as const;
const deadLettersKey = 'dead-letters';

// How late a consumer's reconciliation is against its own interval: past one interval a warning, past
// two critical, as organization-control's ReconciliationOverdueWarning and ReconciliationOverdueCritical
// fire. The age is the service's; a consumer never reconciled has none, and is not judged here.
function Overdue({ consumer }: { readonly consumer: Consumer }): ReactElement | null {
  const age = consumer.reconciliation_age_seconds;
  const interval = consumer.reconciliation_interval_seconds;
  if (consumer.state === 'retired' || age === undefined || interval === undefined || age <= interval) {
    return null;
  }
  const critical = age > 2 * interval;
  return (
    <Notice
      tone={critical ? 'danger' : 'warning'}
      icon="clock"
      role="status"
      data-overdue={critical ? 'critical' : 'warning'}
    >
      <p>
        {critical
          ? messages.reconciliationOverdueCritical(age, interval)
          : messages.reconciliationOverdue(age, interval)}
      </p>
    </Notice>
  );
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
                  consumer.reconciliation_interval_seconds === undefined
                    ? null
                    : messages.reconcilesEvery(consumer.reconciliation_interval_seconds),
                ]}
              />
            </RowMain>
            <Overdue consumer={consumer} />
            {consumer.reconciliation_requested_at === undefined ||
            consumer.reconciliation_requested_at === null ? null : (
              <Notice tone="warning" icon="pulse" role="status">
                <p>{messages.reconciliationRequested(formatTime(consumer.reconciliation_requested_at))}</p>
              </Notice>
            )}
            {consumer.stale === true ? (
              <Notice tone="warning" icon="clock" role="status">
                <p>{messages.consumerStale(consumer.stale_behavior ?? '')}</p>
              </Notice>
            ) : null}
            <DeadLetters consumer={consumer.consumer_id} active={consumer.state !== 'retired'} />{' '}
            {consumer.state === 'retired' ? null : (
              <Action
                label={messages.retireConsumer}
                tone="danger"
                path={`/v1/projections/consumers/${encodeURIComponent(consumer.consumer_id)}/retire`}
                body={{}}
                reason="required"
                confirm={consumer.consumer_id}
                scopeNote={`${messages.retireConsumerWill(consumer.consumer_id)} ${messages.irreversible}`}
                invalidates={[consumersKey]}
              />
            )}
          </Row>
        ))}
      </Rows>
      <LoadMore query={query} />
      <TenantAdministrationPause />
    </Page>
  );
}

// DeadLetters opens a consumer's incidents on request: the read is a provider access, recorded.
function DeadLetters({
  consumer,
  active,
}: {
  readonly consumer: string;
  readonly active: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        pressed={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {open ? messages.hideDeadLetters : messages.deadLetters}
      </Button>
      {open ? <DeadLetterList consumer={consumer} active={active} /> : null}
    </>
  );
}

function DeadLetterList({
  consumer,
  active,
}: {
  readonly consumer: string;
  readonly active: boolean;
}): ReactElement {
  const [state, setState] = useState('open');
  const { query, items } = usePagedList<DeadLetter>(
    deadLettersKey,
    `/v1/projections/consumers/${encodeURIComponent(consumer)}/dead-letters`,
    'dead_letters',
    { state },
  );
  return (
    <section aria-label={messages.deadLettersOf(consumer)} className={layout.stack}>
      <div className={layout.toolbar}>
        <Field label={messages.status}>
          {(id) => (
            <select
              id={id}
              className={fieldClasses.select}
              value={state}
              onChange={(event) => {
                setState(event.target.value);
              }}
            >
              <option value="open">{messages.deadLetterState('open')}</option>
              <option value="resolved">{messages.deadLetterState('resolved')}</option>
              <option value="">{messages.any}</option>
            </select>
          )}
        </Field>
      </div>
      <ListState query={query} empty={messages.noDeadLetters} count={items.length} />
      <Rows aria-label={messages.deadLettersOf(consumer)}>
        {items.map((letter) => (
          <DeadLetterRow key={letter.event_id} letter={letter} active={active} />
        ))}
      </Rows>
      <LoadMore query={query} />
    </section>
  );
}

const waived = (letter: DeadLetter, now: number): boolean =>
  letter.waived_until !== null && Date.parse(letter.waived_until) > now;

function DeadLetterRow({
  letter,
  active,
}: {
  readonly letter: DeadLetter;
  readonly active: boolean;
}): ReactElement {
  const [now] = useState(() => Date.now());
  const [until, setUntil] = useState(() => toLocalInput(new Date(now + 30 * 86_400_000)));
  const [replayed, setReplayed] = useState(false);
  const base =
    `/v1/dead-letters/${letter.event_id}/consumers/${encodeURIComponent(letter.consumer)}` as const;
  const invalidates = [[deadLettersKey]] as const;
  const note = messages.deadLetterWill(letter.event_id, letter.consumer);
  const resolved = letter.resolved_at !== null;
  const underWaiver = waived(letter, now);
  const status = resolved ? 'resolved' : underWaiver ? 'waived' : 'open';
  return (
    <Row data-state={status}>
      <RowMain>
        <RowTitle mono>{letter.event_type}</RowTitle>{' '}
        <Facts
          items={[
            {
              status: resolved ? 'completed' : underWaiver ? 'waived' : 'failed',
              label: messages.deadLetterState(status),
            },
            letter.authority_bearing ? { status: 'suspended', label: messages.authorityBearing } : null,
            letter.aggregate_id === null ? null : messages.aggregateOf(letter.aggregate_id, letter.version),
            messages.laneOf(letter.lane),
            messages.attemptsOf(letter.attempts, formatTime(letter.dead_lettered_at)),
          ]}
        />
      </RowMain>
      <p>{messages.failureOf(letter.failure_class, letter.failure_detail ?? '')}</p>
      {underWaiver ? (
        <p>
          {messages.waivedUntil(
            formatTime(letter.waived_until),
            letter.waived_by ?? '',
            letter.waiver_reason ?? '',
          )}
        </p>
      ) : null}
      {resolved ? (
        <p>
          {messages.resolvedAs(
            letter.resolution_type ?? '',
            letter.resolved_by ?? '',
            formatTime(letter.resolved_at),
          )}
        </p>
      ) : null}
      {replayed ? (
        <Notice tone="info" role="status">
          <p>{messages.replayed}</p>
        </Notice>
      ) : null}
      {!resolved && active ? (
        <Action
          label={messages.replay}
          path={`${base}/replay`}
          body={{}}
          reason="optional"
          scopeNote={note}
          invalidates={invalidates}
          onDone={() => {
            setReplayed(true);
          }}
        />
      ) : null}{' '}
      {resolved ? null : (
        <>
          <Action
            label={messages.resolveReplayed}
            tone="primary"
            path={`${base}/resolve`}
            body={{ resolution_type: 'REPLAYED' }}
            reason="optional"
            scopeNote={note}
            invalidates={invalidates}
          />{' '}
          <Action
            label={messages.resolveSuperseded}
            path={`${base}/resolve`}
            body={{ resolution_type: 'SUPERSEDED' }}
            reason="optional"
            scopeNote={note}
            invalidates={invalidates}
          />
        </>
      )}{' '}
      {!resolved && !active && !underWaiver ? (
        <div className={layout.form}>
          <Field label={messages.waiveExpiry} hint={messages.waiveExplained}>
            {(id, hintId) => (
              <input
                id={id}
                className={fieldClasses.input}
                type="datetime-local"
                value={until}
                aria-describedby={hintId}
                onChange={(event) => {
                  setUntil(event.target.value);
                }}
              />
            )}
          </Field>
          <div className={layout.actions}>
            <Action
              label={messages.waive}
              tone="danger"
              path={`${base}/waive`}
              body={{ expires_at: toInstant(until) }}
              reason="required"
              reasonField="reason"
              scopeNote={note}
              invalidates={invalidates}
            />
          </div>
        </div>
      ) : null}
    </Row>
  );
}

// TenantAdministrationPause shows the latest decision and offers its opposite (ADR-ORG-003 §5.5): a
// pause refuses every Tenant administrator's commands until a provider lifts it, by name.
function TenantAdministrationPause(): ReactElement {
  const pause = useQuery({
    queryKey: pauseKey,
    queryFn: ({ signal }) => apiGet<Pause>('/v1/tenant-administration-pause', { signal }),
  });
  return (
    <Panel.Root aria-labelledby="pause-heading">
      <Panel.Header>
        <Panel.Title level={3} id="pause-heading">
          {messages.tenantAdministration}
        </Panel.Title>
      </Panel.Header>
      <ListState query={pause} empty="" count={1} />
      {pause.data === undefined ? null : pause.data.paused ? (
        <>
          <Notice tone="warning" icon="shield" role="status">
            <p>
              {messages.paused(
                pause.data.actor_id,
                formatTime(pause.data.recorded_at),
                pause.data.reason ?? '',
                pause.data.correlation_id,
              )}
            </p>
          </Notice>
          <div className={layout.actions}>
            <Action
              label={messages.liftPause}
              tone="primary"
              path="/v1/tenant-administration-pause"
              body={{ paused: false }}
              reason="required"
              scopeNote={messages.liftWill}
              invalidates={[pauseKey]}
            />
          </div>
        </>
      ) : (
        <>
          <p>{messages.notPaused}</p>
          <div className={layout.actions}>
            <Action
              label={messages.pauseAdministration}
              tone="danger"
              path="/v1/tenant-administration-pause"
              body={{ paused: true }}
              reason="required"
              scopeNote={messages.pauseWill}
              invalidates={[pauseKey]}
            />
          </div>
        </>
      )}
    </Panel.Root>
  );
}
