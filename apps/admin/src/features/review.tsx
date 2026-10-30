import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { apiGet } from '../api/client';
import { messages } from '../messages';
import { useSignedIn } from '../SessionContext';
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
  rowClasses,
  StatusPill,
} from '../ui';
import { Action, Field, formatTime, ListState, LoadMore, usePagedList } from './common';
import { ProviderGrants } from './grants';

// The provider-access review (TDD-organization-experience-002 1.5.0, ADR-ORG-002 §5.6). A provider in
// force reads who has provider access no review covers, reads one Principal's accesses over a period,
// and records a review of them: an outcome and a statement, by a provider other than the one reviewed.
// A Tenant administrator reads the provider access that named its Tenant. The record is Organization
// Control's; this experience holds none of it.

// The authorities a record names (TDD-organization-control-001 1.21.0 §Privileged Access Review).
export type Authority = 'emergency' | 'activation' | 'eligible' | 'consumer';

export interface PrivilegedAccess {
  readonly access_id: string;
  readonly actor_id: string;
  readonly authority: Authority;
  readonly activation_id: string | null;
  readonly tenant_id: string | null;
  readonly operation: string | null;
  readonly correlation_id: string;
  readonly reason: string;
  readonly occurred_at: string;
}

export interface UnreviewedPrincipal {
  readonly actor_id: string;
  readonly unreviewed: number;
  readonly emergency: number;
  readonly oldest_at: string;
  readonly due_at: string;
  readonly overdue: boolean;
}

export interface AccessReview {
  readonly review_id: string;
  readonly actor_id: string;
  readonly from: string;
  readonly to: string;
  readonly outcome: 'appropriate' | 'escalated';
  readonly statement: string;
  readonly accesses: number;
  readonly emergency_accesses: number;
  readonly reviewed_by: string;
  readonly reviewed_at: string;
}

const unreviewedKey = ['privileged-access-unreviewed'] as const;
const accessesKey = ['privileged-access'] as const;
const reviewsKey = ['privileged-access-reviews'] as const;

const providerAuthorities: readonly Authority[] = ['emergency', 'activation', 'eligible', 'consumer'];
const tenantAuthorities: readonly Authority[] = ['emergency', 'activation', 'eligible'];

// A past review's outcome leads its row, as a pill of its tone: escalated reads as a warning.
function StatusTitle({ outcome }: { readonly outcome: AccessReview['outcome'] }): ReactElement {
  return (
    <RowTitle>
      <StatusPill tone={outcome === 'escalated' ? 'danger' : 'success'}>
        {messages.outcomeName(outcome)}
      </StatusPill>
    </RowTitle>
  );
}

// The period is entered in the operator's zone, to the minute, and sent as an RFC 3339 instant in UTC:
// the API refuses an instant without its offset (STD-GLB-001 1.6.0).
const pad = (value: number): string => String(value).padStart(2, '0');
export const toLocalInput = (instant: Date): string =>
  `${String(instant.getFullYear())}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}T${pad(
    instant.getHours(),
  )}:${pad(instant.getMinutes())}`;
export const toInstant = (local: string): string => {
  if (local === '') {
    return '';
  }
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
};

function AuthoritySelect({
  value,
  options,
  onChange,
}: {
  readonly value: string;
  readonly options: readonly Authority[];
  readonly onChange: (value: string) => void;
}): ReactElement {
  return (
    <Field label={messages.authority}>
      {(id) => (
        <select
          id={id}
          className={fieldClasses.select}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          <option value="">{messages.any}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {messages.authorityName(option)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function Instant({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}): ReactElement {
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          className={fieldClasses.input}
          type="datetime-local"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

// AccessRow is one access as a reviewer or a Tenant reads it: when, on what authority, which
// operation, which Tenant, why, and the correlation that joins it to the request.
function AccessRow({ access }: { readonly access: PrivilegedAccess }): ReactElement {
  return (
    <Row data-authority={access.authority}>
      <RowMain>
        <RowTitle>{formatTime(access.occurred_at)}</RowTitle>{' '}
        <Facts
          items={[
            access.authority === 'activation' && access.activation_id !== null
              ? messages.activationNamed(access.activation_id)
              : access.authority === 'emergency'
                ? { status: 'failed', label: messages.authorityName(access.authority) }
                : messages.authorityName(access.authority),
            access.operation ?? messages.noOperation,
            access.tenant_id === null ? messages.acrossTenants : messages.inTenantId(access.tenant_id),
            messages.correlation(access.correlation_id),
          ]}
        />
      </RowMain>
      <p>{messages.activationReason(access.reason)}</p>
    </Row>
  );
}

const initialActor = (): string | null => new URLSearchParams(window.location.search).get('actor_id');

export function AccessReviewPage(): ReactElement {
  const session = useSignedIn();
  const [selected, setSelected] = useState<string | null>(initialActor);
  const unreviewed = useQuery({
    queryKey: unreviewedKey,
    queryFn: ({ signal }) =>
      apiGet<{ review_due_days: number; actors: UnreviewedPrincipal[] }>('/v1/privileged-access:unreviewed', {
        signal,
      }),
  });
  const actors = unreviewed.data?.actors ?? [];
  const chosen = actors.find((actor) => actor.actor_id === selected);

  return (
    <Page aria-labelledby="access-review-heading">
      <PageHeader>
        <PageTitle id="access-review-heading">{messages.accessReview}</PageTitle>
        <p className={layout.lead}>{messages.accessReviewExplained}</p>
      </PageHeader>
      <h3 className={layout.subtitle}>{messages.unreviewedAccess}</h3>
      <ListState query={unreviewed} empty={messages.nothingUnreviewed} count={actors.length} />
      <Rows>
        {actors.map((actor) => {
          const own = actor.actor_id === session.principalId;
          return (
            <Row key={actor.actor_id} data-overdue={actor.overdue ? 'true' : 'false'}>
              <RowMain>
                <RowTitle mono>{actor.actor_id}</RowTitle>{' '}
                <Facts
                  items={[
                    messages.unreviewedCount(actor.unreviewed),
                    actor.emergency > 0
                      ? { status: 'failed', label: messages.emergencyCount(actor.emergency) }
                      : null,
                    messages.oldestAt(formatTime(actor.oldest_at)),
                    actor.overdue
                      ? { status: 'overdue', label: messages.dueAt(formatTime(actor.due_at)) }
                      : messages.dueAt(formatTime(actor.due_at)),
                  ]}
                />
              </RowMain>
              {actor.overdue ? (
                <Notice tone="danger" icon="clock" role="status">
                  <p>{messages.reviewOverdue}</p>
                </Notice>
              ) : null}
              {own ? (
                <p className={rowClasses.note}>{messages.yourOwnAccess}</p>
              ) : (
                <Button
                  variant="secondary"
                  size="small"
                  pressed={selected === actor.actor_id}
                  onClick={() => {
                    setSelected(actor.actor_id);
                  }}
                >
                  {messages.reviewThis}
                </Button>
              )}
            </Row>
          );
        })}
      </Rows>
      {selected === null ? null : (
        <PrincipalReview
          key={selected}
          actorId={selected}
          oldestAt={chosen?.oldest_at ?? null}
          own={selected === session.principalId}
        />
      )}
      <ProviderGrants />
    </Page>
  );
}

// PrincipalReview is one Principal's accesses over a period, the review recorded for it, and its past
// reviews. The period starts at the oldest unreviewed access, or a week ago, and ends when the page
// opened it.
function PrincipalReview({
  actorId,
  oldestAt,
  own,
}: {
  readonly actorId: string;
  readonly oldestAt: string | null;
  readonly own: boolean;
}): ReactElement {
  const [opened] = useState(() => new Date());
  const [from, setFrom] = useState(() =>
    toLocalInput(oldestAt === null ? new Date(opened.getTime() - 7 * 86_400_000) : new Date(oldestAt)),
  );
  // To the next minute, so the oldest access and everything up to the page opening are inside it.
  const [to, setTo] = useState(() => toLocalInput(new Date(opened.getTime() + 60_000)));
  const [authority, setAuthority] = useState('');
  const [tenant, setTenant] = useState('');
  const [correlation, setCorrelation] = useState('');
  const [outcome, setOutcome] = useState<'appropriate' | 'escalated'>('appropriate');
  const [recorded, setRecorded] = useState<AccessReview | null>(null);

  const period = { from: toInstant(from), to: toInstant(to) };
  const { query, items } = usePagedList<PrivilegedAccess>(
    accessesKey[0],
    '/v1/privileged-access',
    'accesses',
    {
      actor_id: actorId,
      ...period,
      authority,
      tenant_id: tenant,
      correlation_id: correlation,
    },
  );
  const reviews = usePagedList<AccessReview>(reviewsKey[0], '/v1/privileged-access/reviews', 'reviews', {
    actor_id: actorId,
  });

  return (
    <Panel.Root aria-labelledby="principal-review-heading">
      <Panel.Header>
        <Panel.Title level={3} id="principal-review-heading">
          {messages.accessOf(actorId)}
        </Panel.Title>
      </Panel.Header>
      <div className={layout.toolbar}>
        <Instant label={messages.periodFrom} value={from} onChange={setFrom} />
        <Instant label={messages.periodTo} value={to} onChange={setTo} />
        <AuthoritySelect value={authority} options={providerAuthorities} onChange={setAuthority} />
        <Field label={messages.tenantIdentifier}>
          {(id) => (
            <input
              id={id}
              className={fieldClasses.input}
              value={tenant}
              onChange={(event) => {
                setTenant(event.target.value.trim());
              }}
            />
          )}
        </Field>
        <Field label={messages.correlationId}>
          {(id) => (
            <input
              id={id}
              className={fieldClasses.input}
              value={correlation}
              onChange={(event) => {
                setCorrelation(event.target.value.trim());
              }}
            />
          )}
        </Field>
      </div>
      <ListState query={query} empty={messages.noAccessInPeriod} count={items.length} />
      <Rows aria-label={messages.accessesInPeriod}>
        {items.map((access) => (
          <AccessRow key={access.access_id} access={access} />
        ))}
      </Rows>
      <LoadMore query={query} />

      {own ? (
        <p className={rowClasses.note}>{messages.yourOwnAccess}</p>
      ) : (
        <div className={layout.stack}>
          <h4 className={layout.subtitle}>{messages.recordReview}</h4>
          <p className={layout.lead}>{messages.recordReviewExplained}</p>
          <div className={layout.toolbar}>
            <Field label={messages.outcome}>
              {(id) => (
                <select
                  id={id}
                  className={fieldClasses.select}
                  value={outcome}
                  onChange={(event) => {
                    setOutcome(event.target.value === 'escalated' ? 'escalated' : 'appropriate');
                  }}
                >
                  <option value="appropriate">{messages.outcomeName('appropriate')}</option>
                  <option value="escalated">{messages.outcomeName('escalated')}</option>
                </select>
              )}
            </Field>
          </div>
          <Action<AccessReview>
            label={messages.recordReview}
            tone="primary"
            path="/v1/privileged-access/reviews"
            body={{ actor_id: actorId, from: period.from, to: period.to, outcome }}
            reason="required"
            scopeNote={messages.reviewScopeNote(actorId)}
            invalidates={[unreviewedKey, reviewsKey]}
            onDone={setRecorded}
          />
          {recorded === null ? null : (
            <Notice tone="success" role="status">
              <p>
                {messages.reviewRecorded(
                  recorded.accesses,
                  recorded.emergency_accesses,
                  formatTime(recorded.reviewed_at),
                )}
              </p>
            </Notice>
          )}
        </div>
      )}

      <h4 className={layout.subtitle}>{messages.pastReviews}</h4>
      <ListState query={reviews.query} empty={messages.noReviews} count={reviews.items.length} />
      <Rows aria-label={messages.pastReviews}>
        {reviews.items.map((review) => (
          <Row key={review.review_id}>
            <RowMain>
              <StatusTitle outcome={review.outcome} />{' '}
              <Facts
                items={[
                  messages.periodOf(formatTime(review.from), formatTime(review.to)),
                  messages.unreviewedCount(review.accesses),
                  review.emergency_accesses > 0 ? messages.emergencyCount(review.emergency_accesses) : null,
                  messages.reviewedBy(review.reviewed_by, formatTime(review.reviewed_at)),
                ]}
              />
            </RowMain>
            <p>{messages.statementGiven(review.statement)}</p>
          </Row>
        ))}
      </Rows>
      <LoadMore query={reviews.query} />
    </Panel.Root>
  );
}

// TenantProviderAccessPage is a Tenant administrator's read of the provider access that named its
// Tenant. It offers no review: the review is the providers'. It says what it leaves out.
export function TenantProviderAccessPage(): ReactElement {
  const [authority, setAuthority] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { query, items } = usePagedList<PrivilegedAccess>(
    'provider-access',
    '/v1/provider-access',
    'accesses',
    {
      authority,
      from: toInstant(from),
      to: toInstant(to),
    },
  );
  return (
    <Page aria-labelledby="provider-access-heading">
      <PageHeader>
        <PageTitle id="provider-access-heading">{messages.providerAccess}</PageTitle>
        <p className={layout.lead}>{messages.providerAccessExplained}</p>
      </PageHeader>
      <div className={layout.toolbar}>
        <AuthoritySelect value={authority} options={tenantAuthorities} onChange={setAuthority} />
        <Instant label={messages.periodFrom} value={from} onChange={setFrom} />
        <Instant label={messages.periodTo} value={to} onChange={setTo} />
      </div>
      <ListState query={query} empty={messages.noProviderAccess} count={items.length} />
      <Rows aria-label={messages.providerAccess}>
        {items.map((access) => (
          <AccessRow key={access.access_id} access={access} />
        ))}
      </Rows>
      <LoadMore query={query} />
      {query.isError ? null : (
        <Notice tone="info">
          <p>{messages.providerAccessLeavesOut}</p>
        </Notice>
      )}
    </Page>
  );
}
