import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { apiGet } from '../api/client';
import { messages } from '../messages';
import { useSignedIn } from '../SessionContext';
import { Action, facts, Field, formatTime, ListState, LoadMore, usePagedList } from './common';

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
    <li data-authority={access.authority}>
      <strong>{formatTime(access.occurred_at)}</strong>{' '}
      {facts(
        access.authority === 'activation' && access.activation_id !== null
          ? messages.activationNamed(access.activation_id)
          : messages.authorityName(access.authority),
        access.operation ?? messages.noOperation,
        access.tenant_id === null ? messages.acrossTenants : messages.inTenantId(access.tenant_id),
        messages.correlation(access.correlation_id),
      )}
      <p>{messages.activationReason(access.reason)}</p>
    </li>
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
    <section aria-labelledby="access-review-heading">
      <h2 id="access-review-heading">{messages.accessReview}</h2>
      <p>{messages.accessReviewExplained}</p>
      <h3>{messages.unreviewedAccess}</h3>
      <ListState query={unreviewed} empty={messages.nothingUnreviewed} count={actors.length} />
      <ul>
        {actors.map((actor) => {
          const own = actor.actor_id === session.principalId;
          return (
            <li key={actor.actor_id} data-overdue={actor.overdue ? 'true' : 'false'}>
              <strong>{actor.actor_id}</strong>{' '}
              {facts(
                messages.unreviewedCount(actor.unreviewed),
                actor.emergency > 0 ? messages.emergencyCount(actor.emergency) : null,
                messages.oldestAt(formatTime(actor.oldest_at)),
                messages.dueAt(formatTime(actor.due_at)),
              )}
              {actor.overdue ? <p role="status">{messages.reviewOverdue}</p> : null}
              {own ? (
                <p>{messages.yourOwnAccess}</p>
              ) : (
                <button
                  type="button"
                  aria-pressed={selected === actor.actor_id}
                  onClick={() => {
                    setSelected(actor.actor_id);
                  }}
                >
                  {messages.reviewThis}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {selected === null ? null : (
        <PrincipalReview
          key={selected}
          actorId={selected}
          oldestAt={chosen?.oldest_at ?? null}
          own={selected === session.principalId}
        />
      )}
    </section>
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
    <section aria-labelledby="principal-review-heading">
      <h3 id="principal-review-heading">{messages.accessOf(actorId)}</h3>
      <Instant label={messages.periodFrom} value={from} onChange={setFrom} />
      <Instant label={messages.periodTo} value={to} onChange={setTo} />
      <AuthoritySelect value={authority} options={providerAuthorities} onChange={setAuthority} />
      <Field label={messages.tenantIdentifier}>
        {(id) => (
          <input
            id={id}
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
            value={correlation}
            onChange={(event) => {
              setCorrelation(event.target.value.trim());
            }}
          />
        )}
      </Field>
      <ListState query={query} empty={messages.noAccessInPeriod} count={items.length} />
      <ul aria-label={messages.accessesInPeriod}>
        {items.map((access) => (
          <AccessRow key={access.access_id} access={access} />
        ))}
      </ul>
      <LoadMore query={query} />

      {own ? (
        <p>{messages.yourOwnAccess}</p>
      ) : (
        <>
          <h4>{messages.recordReview}</h4>
          <p>{messages.recordReviewExplained}</p>
          <Field label={messages.outcome}>
            {(id) => (
              <select
                id={id}
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
          <Action<AccessReview>
            label={messages.recordReview}
            path="/v1/privileged-access/reviews"
            body={{ actor_id: actorId, from: period.from, to: period.to, outcome }}
            reason="required"
            scopeNote={messages.reviewScopeNote(actorId)}
            invalidates={[unreviewedKey, reviewsKey]}
            onDone={setRecorded}
          />
          {recorded === null ? null : (
            <p role="status">
              {messages.reviewRecorded(
                recorded.accesses,
                recorded.emergency_accesses,
                formatTime(recorded.reviewed_at),
              )}
            </p>
          )}
        </>
      )}

      <h4>{messages.pastReviews}</h4>
      <ListState query={reviews.query} empty={messages.noReviews} count={reviews.items.length} />
      <ul aria-label={messages.pastReviews}>
        {reviews.items.map((review) => (
          <li key={review.review_id}>
            <strong>{messages.outcomeName(review.outcome)}</strong>{' '}
            {facts(
              messages.periodOf(formatTime(review.from), formatTime(review.to)),
              messages.unreviewedCount(review.accesses),
              review.emergency_accesses > 0 ? messages.emergencyCount(review.emergency_accesses) : null,
              messages.reviewedBy(review.reviewed_by, formatTime(review.reviewed_at)),
            )}
            <p>{messages.statementGiven(review.statement)}</p>
          </li>
        ))}
      </ul>
      <LoadMore query={reviews.query} />
    </section>
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
    <section aria-labelledby="provider-access-heading">
      <h2 id="provider-access-heading">{messages.providerAccess}</h2>
      <p>{messages.providerAccessExplained}</p>
      <AuthoritySelect value={authority} options={tenantAuthorities} onChange={setAuthority} />
      <Instant label={messages.periodFrom} value={from} onChange={setFrom} />
      <Instant label={messages.periodTo} value={to} onChange={setTo} />
      <ListState query={query} empty={messages.noProviderAccess} count={items.length} />
      <ul aria-label={messages.providerAccess}>
        {items.map((access) => (
          <AccessRow key={access.access_id} access={access} />
        ))}
      </ul>
      <LoadMore query={query} />
      {query.isError ? null : <p>{messages.providerAccessLeavesOut}</p>}
    </section>
  );
}
