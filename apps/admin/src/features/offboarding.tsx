import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';

import { apiGet } from '../api/client';
import { messages } from '../messages';
import {
  Action,
  ApiErrorMessage,
  facts,
  Field,
  formatTime,
  ListState,
  LoadMore,
  usePagedList,
} from './common';

// Offboarding (TDD-organization-experience-003 1.2.0), in provider mode: staged and resumable,
// never one button. Every stage and obligation state comes from the persisted record, so the view
// is what Organization Control holds after any restart.

type Stage = 'freeze' | 'obligations' | 'release' | 'retired' | 'cancelled';

export interface Offboarding {
  readonly offboarding_id: string;
  readonly tenant_id: string;
  readonly stage: Stage;
  readonly reason?: string;
  readonly legal_hold: boolean;
  readonly started_at: string;
  readonly frozen_at?: string | null;
  readonly obligations_at?: string | null;
  readonly released_at?: string | null;
  readonly retired_at?: string | null;
  // A cancelled offboarding (ADR-ORG-006) records who cancelled it, why and when.
  readonly cancelled_at?: string | null;
  readonly cancelled_by?: string | null;
  readonly cancel_reason?: string | null;
  readonly deprovisioning: {
    readonly state: string;
    readonly detail: string | null;
    readonly requested_at: string;
    readonly resolved_at: string | null;
  } | null;
  readonly active_memberships: number;
}

export interface Obligation {
  readonly obligation_id: string;
  readonly domain: string;
  readonly type: string;
  readonly state: 'open' | 'completed' | 'waived' | 'failed';
  readonly due_at?: string | null;
  readonly completed_at?: string | null;
  readonly detail?: string;
  readonly resolved_by?: string | null;
  readonly resolved_at?: string | null;
}

export interface TenantDetail {
  readonly tenant_id: string;
  readonly display_name: string;
  readonly status: string;
  readonly version: number;
  readonly offboarding_id?: string | null;
  readonly active_memberships?: number;
  // provisioning is the Tenant's latest provisioning request, on the single read.
  readonly provisioning?: {
    readonly request_id: string;
    readonly correlation_id: string;
    readonly state: 'requested' | 'realized' | 'failed' | 'unresolved';
    readonly detail?: string | null;
  } | null;
}

const offboardingsKey = ['offboardings'] as const;
// The forward stages. `cancelled` ends an offboarding early, from freeze or obligations.
const stages: readonly Stage[] = ['freeze', 'obligations', 'release', 'retired'];

// How long a stage may run before the view calls it stalled (TDD-organization-experience-003
// §Configuration: thirty days).
const stallMs = 30 * 24 * 3_600_000;

const stageEnteredAt = (offboarding: Offboarding): string | null | undefined =>
  ({
    freeze: offboarding.started_at,
    obligations: offboarding.obligations_at,
    release: offboarding.released_at,
    retired: offboarding.retired_at,
    cancelled: offboarding.cancelled_at,
  })[offboarding.stage];

const days = (since: string, now: number): number => Math.floor((now - Date.parse(since)) / 86_400_000);

export function OffboardingsPage(): ReactElement {
  const [stage, setStage] = useState('');
  const { query, items } = usePagedList<Offboarding>('offboardings', '/v1/offboardings', 'offboardings', {
    stage,
  });
  return (
    <section aria-labelledby="offboardings-heading">
      <h2 id="offboardings-heading">{messages.offboardings}</h2>
      <Field label={messages.stage}>
        {(id) => (
          <select
            id={id}
            value={stage}
            onChange={(event) => {
              setStage(event.target.value);
            }}
          >
            <option value="">{messages.any}</option>
            {stages.map((value) => (
              <option key={value} value={value}>
                {messages.stageName(value)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <ListState query={query} empty={messages.noOffboardings} count={items.length} />
      <ul>
        {items.map((offboarding) => (
          <li key={offboarding.offboarding_id}>
            <Link to="/offboardings/$offboardingId" params={{ offboardingId: offboarding.offboarding_id }}>
              {offboarding.tenant_id}
            </Link>{' '}
            {facts(
              messages.stageName(offboarding.stage),
              offboarding.legal_hold ? messages.legalHoldSet : null,
            )}
          </li>
        ))}
      </ul>
      <LoadMore query={query} />
    </section>
  );
}

function StageTimeline({ offboarding }: { readonly offboarding: Offboarding }): ReactElement {
  // The time the view was rendered at, held for its life: the stall is judged once per view.
  const [now] = useState(() => Date.now());
  const entered = stageEnteredAt(offboarding);
  const stalled =
    entered !== null &&
    entered !== undefined &&
    offboarding.stage !== 'retired' &&
    offboarding.stage !== 'cancelled' &&
    now - Date.parse(entered) > stallMs;
  return (
    <section aria-labelledby="stages-heading">
      <h3 id="stages-heading">{messages.stages}</h3>
      <ol>
        {stages.map((stage) => (
          <li key={stage} aria-current={stage === offboarding.stage ? 'step' : undefined}>
            <strong>{messages.stageName(stage)}</strong> {messages.stageStops(stage)}
          </li>
        ))}
      </ol>
      {entered === null || entered === undefined ? null : (
        <p>
          {messages.inStageSince(
            messages.stageName(offboarding.stage),
            formatTime(entered),
            days(entered, now),
          )}
        </p>
      )}
      {stalled ? <p role="alert">{messages.stalled}</p> : null}
      {offboarding.stage === 'cancelled' ? (
        <p role="status">
          {messages.cancelledBy(
            offboarding.cancelled_by ?? '',
            formatTime(offboarding.cancelled_at),
            offboarding.cancel_reason ?? '',
          )}
        </p>
      ) : null}
    </section>
  );
}

function LegalHoldBanner({ offboarding }: { readonly offboarding: Offboarding }): ReactElement | null {
  if (!offboarding.legal_hold) {
    return null;
  }
  return (
    <section aria-label={messages.legalHoldSet} className="legal-hold">
      <p>
        <strong>{messages.legalHoldSet}</strong>
      </p>
      <ul>
        <li>{messages.holdProceeds(messages.stageName('freeze'))}</li>
        <li>{messages.holdProceeds(messages.stageName('obligations'))}</li>
        <li>{messages.holdBlocks(messages.stageName('release'))}</li>
        <li>{messages.holdBlocks(messages.retirement)}</li>
      </ul>
    </section>
  );
}

const overdue = (obligation: Obligation, now: number): boolean =>
  obligation.state === 'open' &&
  obligation.due_at !== null &&
  obligation.due_at !== undefined &&
  Date.parse(obligation.due_at) < now;

function ObligationBoard({ obligations }: { readonly obligations: readonly Obligation[] }): ReactElement {
  const [now] = useState(() => Date.now());
  return (
    <table>
      <caption>{messages.obligations}</caption>
      <thead>
        <tr>
          <th scope="col">{messages.domain}</th>
          <th scope="col">{messages.obligation}</th>
          <th scope="col">{messages.state('state')}</th>
          <th scope="col">{messages.due}</th>
          <th scope="col">{messages.detail}</th>
        </tr>
      </thead>
      <tbody>
        {obligations.map((obligation) => (
          <tr key={obligation.obligation_id} data-state={obligation.state}>
            <td>{obligation.domain}</td>
            <td>{obligation.type}</td>
            <td>
              {overdue(obligation, now) ? messages.overdue : messages.obligationState(obligation.state)}
            </td>
            <td>{formatTime(obligation.due_at)}</td>
            <td>
              {obligation.state === 'open'
                ? messages.resolvedByDomain(obligation.domain)
                : messages.resolvedBy(
                    obligation.resolved_by ?? '',
                    formatTime(obligation.resolved_at),
                    obligation.detail ?? '',
                  )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RaiseObligation({
  offboardingId,
  invalidate,
}: {
  readonly offboardingId: string;
  readonly invalidate: readonly (readonly unknown[])[];
}): ReactElement {
  const [domain, setDomain] = useState('');
  const [type, setType] = useState('');
  return (
    <div>
      <Field label={messages.domain}>
        {(id) => (
          <input
            id={id}
            value={domain}
            onChange={(event) => {
              setDomain(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={messages.obligation}>
        {(id) => (
          <input
            id={id}
            value={type}
            onChange={(event) => {
              setType(event.target.value);
            }}
          />
        )}
      </Field>
      <Action
        label={messages.raiseObligation}
        path={`/v1/offboardings/${offboardingId}/obligations`}
        body={{ domain: domain.trim(), type: type.trim() }}
        invalidates={invalidate}
      />
    </div>
  );
}

export function OffboardingDetail(): ReactElement {
  const { offboardingId } = useParams({ from: '/offboardings/$offboardingId' });
  const recordKey = ['offboarding', offboardingId] as const;
  const boardKey = ['offboarding-obligations', offboardingId] as const;
  const record = useQuery({
    queryKey: recordKey,
    queryFn: ({ signal }) => apiGet<Offboarding>(`/v1/offboardings/${offboardingId}`, { signal }),
  });
  const board = useQuery({
    queryKey: boardKey,
    queryFn: ({ signal }) =>
      apiGet<{ obligations: Obligation[]; outstanding: string[] }>(
        `/v1/offboardings/${offboardingId}/obligations`,
        { signal },
      ),
  });
  const tenantId = record.data?.tenant_id;
  const tenant = useQuery({
    queryKey: ['tenant', tenantId],
    enabled: tenantId !== undefined,
    queryFn: ({ signal }) => apiGet<TenantDetail>(`/v1/tenants/${tenantId ?? ''}`, { signal }),
  });

  if (record.isPending) {
    return <p>{messages.loading}</p>;
  }
  if (record.isError) {
    return <ApiErrorMessage error={record.error} />;
  }
  const offboarding = record.data;
  const obligations = board.data?.obligations ?? [];
  const open = obligations.filter(
    (obligation) => obligation.state === 'open' || obligation.state === 'failed',
  );
  const invalidate = [recordKey, boardKey, offboardingsKey, ['tenants']] as const;
  const base = `/v1/offboardings/${offboarding.offboarding_id}` as const;
  const name = tenant.data?.display_name ?? offboarding.tenant_id;
  const note = messages.inTenantNamed(name, offboarding.tenant_id);
  const deprovisioning = offboarding.deprovisioning;
  const realized = deprovisioning?.state === 'realized';

  return (
    <section aria-labelledby="offboarding-heading">
      <h2 id="offboarding-heading">{messages.offboardingOf(name)}</h2>
      <p>{facts(messages.startedAt(formatTime(offboarding.started_at)), offboarding.reason)}</p>
      <StageTimeline offboarding={offboarding} />
      <LegalHoldBanner offboarding={offboarding} />

      {offboarding.stage === 'freeze' ? (
        <section aria-labelledby="freeze-heading">
          <h3 id="freeze-heading">{messages.stageName('freeze')}</h3>
          <p>{messages.activeRemaining(offboarding.active_memberships)}</p>
          {offboarding.active_memberships > 0 ? (
            <Action
              label={messages.freezeNext(100)}
              path={`${base}/freeze`}
              body={{ size: 100 }}
              invalidates={invalidate}
            />
          ) : (
            <Action
              label={messages.completeFreeze}
              path={`${base}/complete-freeze`}
              body={{}}
              invalidates={invalidate}
            />
          )}
        </section>
      ) : null}

      <ObligationBoard obligations={obligations} />
      {board.isError ? <ApiErrorMessage error={board.error} /> : null}
      {offboarding.stage === 'freeze' || offboarding.stage === 'obligations' ? (
        <RaiseObligation offboardingId={offboarding.offboarding_id} invalidate={invalidate} />
      ) : null}

      {offboarding.stage === 'obligations' ? (
        <section aria-labelledby="release-heading">
          <h3 id="release-heading">{messages.stageName('release')}</h3>
          {offboarding.legal_hold ? (
            <p role="status">{messages.blockedByHold(messages.stageName('release'))}</p>
          ) : open.length > 0 ? (
            <div role="status">
              <p>{messages.blockedByObligations}</p>
              <ul>
                {open.map((obligation) => (
                  <li key={obligation.obligation_id}>
                    {facts(obligation.domain, obligation.type, messages.obligationState(obligation.state))}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {offboarding.legal_hold || open.length > 0 ? (
            <button type="button" disabled>
              {messages.release}
            </button>
          ) : (
            <Action
              label={messages.release}
              path={`${base}/release`}
              body={{}}
              reason="required"
              scopeNote={`${messages.releaseIrreversible} ${note}`}
              invalidates={invalidate}
            />
          )}
        </section>
      ) : null}

      {offboarding.stage === 'release' ? (
        <section aria-labelledby="retire-heading">
          <h3 id="retire-heading">{messages.retirement}</h3>
          <p>
            {deprovisioning === null
              ? messages.deprovisioningNone
              : realized
                ? messages.deprovisioningRealized(formatTime(deprovisioning.resolved_at))
                : deprovisioning.state === 'failed'
                  ? messages.deprovisioningFailed(deprovisioning.detail ?? '')
                  : messages.deprovisioningAwaiting(formatTime(deprovisioning.requested_at))}
          </p>
          {offboarding.legal_hold ? <p role="status">{messages.blockedByHold(messages.retirement)}</p> : null}
          {offboarding.legal_hold || !realized || tenant.data === undefined ? (
            <button type="button" disabled>
              {messages.retire}
            </button>
          ) : (
            <Action
              label={messages.retire}
              path={`${base}/retire`}
              body={{ expected_version: tenant.data.version }}
              reason="required"
              confirm={name}
              scopeNote={`${messages.irreversible} ${note}`}
              invalidates={invalidate}
            />
          )}
        </section>
      ) : null}

      {(offboarding.stage === 'freeze' || offboarding.stage === 'obligations') &&
      tenant.data !== undefined ? (
        <section aria-labelledby="cancel-heading">
          <h3 id="cancel-heading">{messages.cancelOffboarding}</h3>
          <p>{messages.cancelExplained}</p>
          <Action
            label={messages.cancelOffboarding}
            path={`${base}/cancel`}
            body={{ expected_version: tenant.data.version }}
            reason="required"
            scopeNote={`${messages.cancelWill} ${note}`}
            invalidates={invalidate}
          />
        </section>
      ) : null}

      {offboarding.stage !== 'retired' && offboarding.stage !== 'cancelled' ? (
        <p>
          <Action
            label={offboarding.legal_hold ? messages.liftHold : messages.setHold}
            path={`${base}/legal-hold`}
            body={{ hold: !offboarding.legal_hold }}
            reason="required"
            scopeNote={note}
            invalidates={invalidate}
          />
        </p>
      ) : null}
    </section>
  );
}

// BeginOffboarding starts an offboarding from a Tenant, or resumes the one it has. The count of
// Memberships it will suspend, and the version it acts on, are read from the API immediately before
// the confirmation (TDD-organization-experience-001 §Irreversible Operations).
export function BeginOffboarding({ tenantId }: { readonly tenantId: string }): ReactElement | null {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const tenant = useQuery({
    queryKey: ['tenant', tenantId],
    enabled: open,
    staleTime: 0,
    queryFn: ({ signal }) => apiGet<TenantDetail>(`/v1/tenants/${tenantId}`, { signal }),
  });
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        {messages.offboard}
      </button>
    );
  }
  if (tenant.isPending) {
    return <p>{messages.loading}</p>;
  }
  if (tenant.isError) {
    return <ApiErrorMessage error={tenant.error} />;
  }
  const detail = tenant.data;
  if (detail.offboarding_id !== null && detail.offboarding_id !== undefined) {
    return (
      <Link to="/offboardings/$offboardingId" params={{ offboardingId: detail.offboarding_id }}>
        {messages.resumeOffboarding}
      </Link>
    );
  }
  return (
    <Action<Offboarding>
      label={messages.beginOffboarding}
      path="/v1/offboardings"
      body={{ tenant_id: detail.tenant_id, expected_version: detail.version }}
      reason="required"
      confirm={detail.display_name}
      scopeNote={`${messages.beginWill(detail.active_memberships ?? 0)} ${messages.inTenantNamed(detail.display_name, detail.tenant_id)}`}
      invalidates={[['tenants'], offboardingsKey]}
      onDone={(result) => {
        void navigate({
          to: '/offboardings/$offboardingId',
          params: { offboardingId: result.offboarding_id },
        });
      }}
    />
  );
}
