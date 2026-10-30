import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';

import { apiGet } from '../api/client';
import { messages } from '../messages';
import {
  Button,
  Facts,
  fieldClasses,
  Icon,
  layout,
  Loading,
  Notice,
  Page,
  PageHeader,
  PageTitle,
  Panel,
  Row,
  RowMain,
  Rows,
  StatusPill,
  Table,
  toneOf,
} from '../ui';
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
import styles from './offboarding.module.scss';

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
  // restore_pending counts the Memberships the freeze suspended that a cancellation has yet to restore;
  // sending the cancellation again finishes it.
  readonly restore_pending?: number | null;
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

// The tone each stage is drawn in: the freeze and the release stop access and take infrastructure away,
// the obligations wait on other domains, and a finished offboarding is past.
const stageStatus: Readonly<Record<Stage, string>> = {
  freeze: 'suspended',
  obligations: 'pending',
  release: 'offboarding',
  retired: 'retired',
  cancelled: 'cancelled',
};

const days = (since: string, now: number): number => Math.floor((now - Date.parse(since)) / 86_400_000);

export function OffboardingsPage(): ReactElement {
  const [stage, setStage] = useState('');
  const { query, items } = usePagedList<Offboarding>('offboardings', '/v1/offboardings', 'offboardings', {
    stage,
  });
  return (
    <Page aria-labelledby="offboardings-heading">
      <PageHeader>
        <PageTitle id="offboardings-heading">{messages.offboardings}</PageTitle>
      </PageHeader>
      <div className={layout.toolbar}>
        <Field label={messages.stage}>
          {(id) => (
            <select
              id={id}
              className={fieldClasses.select}
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
      </div>
      <ListState query={query} empty={messages.noOffboardings} count={items.length} />
      <Rows>
        {items.map((offboarding) => (
          <Row key={offboarding.offboarding_id}>
            <RowMain>
              <Link
                to="/offboardings/$offboardingId"
                params={{ offboardingId: offboarding.offboarding_id }}
                className={styles['recordLink']}
              >
                {offboarding.tenant_id}
              </Link>{' '}
              <Facts
                items={[
                  { status: stageStatus[offboarding.stage], label: messages.stageName(offboarding.stage) },
                  offboarding.legal_hold ? { status: 'suspended', label: messages.legalHoldSet } : null,
                ]}
              />
            </RowMain>
          </Row>
        ))}
      </Rows>
      <LoadMore query={query} />
    </Page>
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
    <Panel.Root aria-labelledby="stages-heading">
      <Panel.Header>
        <Panel.Title level={3} id="stages-heading">
          {messages.stages}
        </Panel.Title>
      </Panel.Header>
      <ol className={styles['stages']}>
        {stages.map((stage, index) => (
          <li
            key={stage}
            className={styles['stage']}
            aria-current={stage === offboarding.stage ? 'step' : undefined}
            data-passed={index < stages.indexOf(offboarding.stage) || undefined}
          >
            <span className={styles['marker']} aria-hidden="true">
              {index < stages.indexOf(offboarding.stage) ? <Icon name="check" /> : null}
            </span>
            <strong>{messages.stageName(stage)}</strong> {messages.stageStops(stage)}
          </li>
        ))}
      </ol>
      {entered === null || entered === undefined ? null : (
        <p className={layout.lead}>
          {messages.inStageSince(
            messages.stageName(offboarding.stage),
            formatTime(entered),
            days(entered, now),
          )}
        </p>
      )}
      {stalled ? (
        <Notice tone="warning" icon="clock" role="alert">
          <p>{messages.stalled}</p>
        </Notice>
      ) : null}
      {offboarding.stage === 'cancelled' ? (
        <Notice tone="info" role="status">
          <p>
            {messages.cancelledBy(
              offboarding.cancelled_by ?? '',
              formatTime(offboarding.cancelled_at),
              offboarding.cancel_reason ?? '',
            )}
          </p>
        </Notice>
      ) : null}
    </Panel.Root>
  );
}

function LegalHoldBanner({ offboarding }: { readonly offboarding: Offboarding }): ReactElement | null {
  if (!offboarding.legal_hold) {
    return null;
  }
  return (
    <section aria-label={messages.legalHoldSet}>
      <Notice tone="warning" icon="shield">
        <p>
          <strong>{messages.legalHoldSet}</strong>
        </p>
        <ul className={styles['holdList']}>
          <li data-blocks="false">{messages.holdProceeds(messages.stageName('freeze'))}</li>
          <li data-blocks="false">{messages.holdProceeds(messages.stageName('obligations'))}</li>
          <li data-blocks="true">{messages.holdBlocks(messages.stageName('release'))}</li>
          <li data-blocks="true">{messages.holdBlocks(messages.retirement)}</li>
        </ul>
      </Notice>
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
    <Table.Root caption={messages.obligations}>
      <Table.Head>
        <Table.Row>
          <Table.HeaderCell>{messages.domain}</Table.HeaderCell>
          <Table.HeaderCell>{messages.obligation}</Table.HeaderCell>
          <Table.HeaderCell>{messages.state('state')}</Table.HeaderCell>
          <Table.HeaderCell>{messages.due}</Table.HeaderCell>
          <Table.HeaderCell>{messages.detail}</Table.HeaderCell>
          <Table.HeaderCell>{messages.obligationIdentifier}</Table.HeaderCell>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {obligations.map((obligation) => (
          <Table.Row key={obligation.obligation_id} data-state={obligation.state}>
            <Table.Cell mono>{obligation.domain}</Table.Cell>
            <Table.Cell mono>{obligation.type}</Table.Cell>
            <Table.Cell>
              {overdue(obligation, now) ? (
                <StatusPill tone="danger">{messages.overdue}</StatusPill>
              ) : (
                <StatusPill tone={obligation.state === 'open' ? 'info' : toneOf(obligation.state)}>
                  {messages.obligationState(obligation.state)}
                </StatusPill>
              )}
            </Table.Cell>
            <Table.Cell className={styles['when']}>{formatTime(obligation.due_at)}</Table.Cell>
            <Table.Cell>
              {obligation.state === 'open'
                ? messages.resolvedByDomain(obligation.domain)
                : messages.resolvedBy(
                    obligation.resolved_by ?? '',
                    formatTime(obligation.resolved_at),
                    obligation.detail ?? '',
                  )}
            </Table.Cell>
            <Table.Cell mono>{obligation.obligation_id}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
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
    <Panel.Root aria-labelledby="raise-obligation-heading">
      <Panel.Title level={3} id="raise-obligation-heading">
        {messages.raiseObligation}
      </Panel.Title>
      <div className={layout.form}>
        <Field label={messages.domain}>
          {(id) => (
            <input
              id={id}
              className={fieldClasses.input}
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
              className={fieldClasses.input}
              value={type}
              onChange={(event) => {
                setType(event.target.value);
              }}
            />
          )}
        </Field>
        <div className={layout.actions}>
          <Action
            label={messages.raiseObligation}
            path={`/v1/offboardings/${offboardingId}/obligations`}
            body={{ domain: domain.trim(), type: type.trim() }}
            invalidates={invalidate}
          />
        </div>
      </div>
    </Panel.Root>
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
    return <Loading />;
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
    <Page aria-labelledby="offboarding-heading">
      <PageHeader>
        <PageTitle id="offboarding-heading">{messages.offboardingOf(name)}</PageTitle>
        <p className={layout.lead}>
          {facts(
            messages.startedAt(formatTime(offboarding.started_at)),
            offboarding.reason,
            messages.offboardingIdentifier(offboarding.offboarding_id),
          )}
        </p>
      </PageHeader>
      <StageTimeline offboarding={offboarding} />
      {offboarding.stage === 'cancelled' &&
      (offboarding.restore_pending ?? 0) > 0 &&
      tenant.data !== undefined ? (
        <Notice tone="warning" role="alert">
          <p>{messages.restorePending(offboarding.restore_pending ?? 0)}</p>
          <Action
            tone="primary"
            label={messages.finishRestoring}
            path={`${base}/cancel`}
            body={{ expected_version: tenant.data.version }}
            reason="required"
            scopeNote={note}
            invalidates={invalidate}
          />
        </Notice>
      ) : null}
      <LegalHoldBanner offboarding={offboarding} />

      {offboarding.stage === 'freeze' ? (
        <Panel.Root aria-labelledby="freeze-heading">
          <Panel.Title level={3} id="freeze-heading">
            {messages.stageName('freeze')}
          </Panel.Title>
          <p>{messages.activeRemaining(offboarding.active_memberships)}</p>
          {offboarding.active_memberships > 0 ? (
            <Action
              tone="danger"
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
        </Panel.Root>
      ) : null}

      <ObligationBoard obligations={obligations} />
      {obligations.length > 0 ? <p className={layout.lead}>{messages.obligationsDevNote}</p> : null}
      {board.isError ? <ApiErrorMessage error={board.error} /> : null}
      {offboarding.stage === 'freeze' || offboarding.stage === 'obligations' ? (
        <RaiseObligation offboardingId={offboarding.offboarding_id} invalidate={invalidate} />
      ) : null}

      {offboarding.stage === 'obligations' ? (
        <Panel.Root aria-labelledby="release-heading">
          <Panel.Title level={3} id="release-heading">
            {messages.stageName('release')}
          </Panel.Title>
          {offboarding.legal_hold ? (
            <Notice tone="warning" icon="shield" role="status">
              <p>{messages.blockedByHold(messages.stageName('release'))}</p>
            </Notice>
          ) : open.length > 0 ? (
            <Notice tone="warning" role="status">
              <p>{messages.blockedByObligations}</p>
              <ul className={styles['holdList']}>
                {open.map((obligation) => (
                  <li key={obligation.obligation_id}>
                    {facts(obligation.domain, obligation.type, messages.obligationState(obligation.state))}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {offboarding.legal_hold || open.length > 0 ? (
            <div className={layout.actions}>
              <Button variant="danger" size="small" disabled>
                {messages.release}
              </Button>
            </div>
          ) : (
            <Action
              tone="danger"
              label={messages.release}
              path={`${base}/release`}
              body={{}}
              reason="required"
              scopeNote={`${messages.releaseIrreversible} ${note}`}
              invalidates={invalidate}
            />
          )}
        </Panel.Root>
      ) : null}

      {offboarding.stage === 'release' ? (
        <Panel.Root aria-labelledby="retire-heading">
          <Panel.Title level={3} id="retire-heading">
            {messages.retirement}
          </Panel.Title>
          <p>
            {deprovisioning === null
              ? messages.deprovisioningNone
              : realized
                ? messages.deprovisioningRealized(formatTime(deprovisioning.resolved_at))
                : deprovisioning.state === 'failed'
                  ? messages.deprovisioningFailed(deprovisioning.detail ?? '')
                  : deprovisioning.state === 'unresolved'
                    ? messages.deprovisioningUnresolved(formatTime(deprovisioning.requested_at))
                    : messages.deprovisioningAwaiting(formatTime(deprovisioning.requested_at))}
          </p>
          {deprovisioning?.state === 'failed' ? (
            <div className={layout.actions}>
              <Action
                tone="danger"
                label={messages.resendDeprovisioning}
                path={`${base}/deprovisioning/resend`}
                body={{}}
                reason="required"
                scopeNote={`${messages.resendWill} ${note}`}
                invalidates={invalidate}
              />
            </div>
          ) : null}
          {offboarding.legal_hold ? (
            <Notice tone="warning" icon="shield" role="status">
              <p>{messages.blockedByHold(messages.retirement)}</p>
            </Notice>
          ) : null}
          {offboarding.legal_hold || !realized || tenant.data === undefined ? (
            <div className={layout.actions}>
              <Button variant="danger" size="small" disabled>
                {messages.retire}
              </Button>
            </div>
          ) : (
            <Action
              tone="danger"
              label={messages.retire}
              path={`${base}/retire`}
              body={{ expected_version: tenant.data.version }}
              reason="required"
              confirm={name}
              scopeNote={`${messages.irreversible} ${note}`}
              invalidates={invalidate}
            />
          )}
        </Panel.Root>
      ) : null}

      {(offboarding.stage === 'freeze' || offboarding.stage === 'obligations') &&
      tenant.data !== undefined ? (
        <Panel.Root aria-labelledby="cancel-heading">
          <Panel.Title level={3} id="cancel-heading">
            {messages.cancelOffboarding}
          </Panel.Title>
          <Panel.Description>{messages.cancelExplained}</Panel.Description>
          <Action
            label={messages.cancelOffboarding}
            path={`${base}/cancel`}
            body={{ expected_version: tenant.data.version }}
            reason="required"
            scopeNote={`${messages.cancelWill} ${note}`}
            invalidates={invalidate}
          />
        </Panel.Root>
      ) : null}

      {offboarding.stage !== 'retired' && offboarding.stage !== 'cancelled' ? (
        <div className={layout.actions}>
          <Action
            label={offboarding.legal_hold ? messages.liftHold : messages.setHold}
            path={`${base}/legal-hold`}
            body={{ hold: !offboarding.legal_hold }}
            reason="required"
            scopeNote={note}
            invalidates={invalidate}
          />
        </div>
      ) : null}
    </Page>
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
      <Button
        variant="danger"
        size="small"
        onClick={() => {
          setOpen(true);
        }}
      >
        {messages.offboard}
      </Button>
    );
  }
  if (tenant.isPending) {
    return <Loading />;
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
      tone="danger"
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
