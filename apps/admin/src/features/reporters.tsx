import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { apiGet } from '../api/client';
import { messages } from '../messages';
import {
  Button,
  Facts,
  fieldClasses,
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
  RowTitle,
} from '../ui';
import { Action, ApiErrorMessage, Field, formatTime, ListState, LoadMore, usePagedList } from './common';

// The reporter registry (TDD-organization-experience-002 1.10.0, ADR-ORG-001 §5.11): the workloads
// Organization Control admits to report provisioning outcomes, or one domain's offboarding obligations,
// each on its own report routes alone. A provider registers and retires them, in provider mode. The
// workload itself, and its key, are identity-control's; this registers an existing workload Principal.

export interface Reporter {
  readonly reporter_id: string;
  readonly principal_id: string;
  readonly reports: string;
  readonly purpose: string;
  readonly state: 'active' | 'retired';
  readonly version: number;
  readonly registered_at: string;
  readonly registered_by: string;
  readonly retired_at: string | null;
  readonly retired_by: string | null;
}

const reportersKey = ['reporters'] as const;

// The API's patterns (organization-control api/openapi.yaml, ReporterReports and UUID), checked before
// anything is sent so the operator reads why here rather than in a 400.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const domainPattern = /^[a-z0-9-]{1,63}$/;
const reportsPattern = /^(provisioning|obligation:[a-z0-9-]{1,63})$/;

// A second registration of a workload, active or retired, is refused as a transition (TDD-organization-
// control-001 1.27.0 §Reporters).
const duplicate = (error: { status: number; type: string | null }): string | null =>
  error.status === 409 && (error.type ?? '').endsWith('/state-transition-refused')
    ? messages.reporterAlreadyRegistered
    : null;

export function ReportersPage(): ReactElement {
  const [state, setState] = useState('');
  const [reportsFilter, setReportsFilter] = useState('');
  // The API takes a whole reports value as its filter; one still being typed filters nothing yet.
  const { query, items } = usePagedList<Reporter>('reporters', '/v1/reporters', 'reporters', {
    state,
    reports: reportsPattern.test(reportsFilter) ? reportsFilter : '',
  });
  const [principal, setPrincipal] = useState('');
  const [kind, setKind] = useState<'provisioning' | 'obligation'>('provisioning');
  const [domain, setDomain] = useState('');
  const [purpose, setPurpose] = useState('');
  const [registered, setRegistered] = useState<Reporter | null>(null);

  const reports = kind === 'provisioning' ? 'provisioning' : `obligation:${domain.trim()}`;
  const problem = !uuid.test(principal.trim())
    ? messages.reporterPrincipalInvalid
    : kind === 'obligation' && !domainPattern.test(domain.trim())
      ? messages.reporterDomainInvalid
      : purpose.trim() === '' || purpose.trim().length > 500
        ? messages.reporterPurposeInvalid
        : null;

  return (
    <Page aria-labelledby="reporters-heading">
      <PageHeader>
        <PageTitle id="reporters-heading">{messages.reporters}</PageTitle>
      </PageHeader>
      <p className={layout.lead}>{messages.reportersLead}</p>
      <Panel.Root aria-labelledby="register-reporter-heading">
        <Panel.Title level={3} id="register-reporter-heading">
          {messages.registerReporter}
        </Panel.Title>
        <div className={layout.form}>
          <Field label={messages.reporterPrincipal} hint={messages.reporterPrincipalHint}>
            {(id, hintId) => (
              <input
                id={id}
                className={fieldClasses.input}
                value={principal}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={hintId}
                onChange={(event) => {
                  setPrincipal(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label={messages.reporterReports}>
            {(id) => (
              <select
                id={id}
                className={fieldClasses.select}
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value === 'obligation' ? 'obligation' : 'provisioning');
                }}
              >
                <option value="provisioning">{messages.reportsProvisioning}</option>
                <option value="obligation">{messages.reportsObligation}</option>
              </select>
            )}
          </Field>
          {kind === 'obligation' ? (
            <Field label={messages.reporterDomain} hint={messages.reporterDomainHint}>
              {(id, hintId) => (
                <input
                  id={id}
                  className={fieldClasses.input}
                  value={domain}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={hintId}
                  onChange={(event) => {
                    setDomain(event.target.value);
                  }}
                />
              )}
            </Field>
          ) : null}
          <Field label={messages.reporterPurpose} hint={messages.reporterPurposeHint}>
            {(id, hintId) => (
              <textarea
                id={id}
                className={fieldClasses.area}
                value={purpose}
                maxLength={500}
                aria-describedby={hintId}
                onChange={(event) => {
                  setPurpose(event.target.value);
                }}
              />
            )}
          </Field>
          <p className={`${layout.formWide} ${layout.lead}`}>{messages.reporterRegisteredOnce}</p>
          <div className={layout.actions}>
            <Action<Reporter>
              label={messages.registerReporter}
              tone="primary"
              path="/v1/reporters"
              body={{ principal_id: principal.trim(), reports, purpose: purpose.trim() }}
              reason="required"
              problem={problem}
              refusal={duplicate}
              scopeNote={messages.registerReporterWill(principal.trim(), reports)}
              invalidates={[reportersKey]}
              onDone={(result) => {
                setRegistered(result);
                setPrincipal('');
                setDomain('');
                setPurpose('');
              }}
            />
          </div>
          {registered === null ? null : (
            <Notice tone="success" role="status">
              <p>{messages.reporterRegistered(registered.reports)}</p>
            </Notice>
          )}
        </div>
      </Panel.Root>

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
              <option value="">{messages.any}</option>
              <option value="active">{messages.state('active')}</option>
              <option value="retired">{messages.state('retired')}</option>
            </select>
          )}
        </Field>
        <Field label={messages.reporterReports}>
          {(id) => (
            <input
              id={id}
              className={fieldClasses.input}
              value={reportsFilter}
              spellCheck={false}
              onChange={(event) => {
                setReportsFilter(event.target.value.trim());
              }}
            />
          )}
        </Field>
      </div>
      <ListState query={query} empty={messages.noReporters} count={items.length} />
      <Rows aria-label={messages.reporters}>
        {items.map((reporter) => (
          <Row key={reporter.reporter_id}>
            <RowMain>
              <RowTitle mono>{reporter.principal_id}</RowTitle>{' '}
              <Facts
                items={[
                  reporter.reports,
                  { status: reporter.state, label: messages.state(reporter.state) },
                  messages.versionOf(reporter.version),
                  messages.reporterRegisteredBy(reporter.registered_by, formatTime(reporter.registered_at)),
                  reporter.retired_at === null
                    ? null
                    : messages.reporterRetiredBy(reporter.retired_by ?? '', formatTime(reporter.retired_at)),
                ]}
              />
            </RowMain>
            <p>{reporter.purpose}</p>
            {reporter.state === 'active' ? <RetireReporter reporterId={reporter.reporter_id} /> : null}
          </Row>
        ))}
      </Rows>
      <LoadMore query={query} />
    </Page>
  );
}

// RetireReporter reads the reporter again before it asks, and sends the version it read: retiring is
// irreversible for that workload (TDD-organization-experience-001 §Irreversible Operations).
function RetireReporter({ reporterId }: { readonly reporterId: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const fresh = useQuery({
    queryKey: ['reporter', reporterId],
    enabled: open,
    staleTime: 0,
    queryFn: ({ signal }) => apiGet<Reporter>(`/v1/reporters/${reporterId}`, { signal }),
  });
  if (!open) {
    return (
      <Button
        variant="danger"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        {messages.retireReporter}
      </Button>
    );
  }
  if (fresh.isPending) {
    return <Loading />;
  }
  if (fresh.isError) {
    return <ApiErrorMessage error={fresh.error} />;
  }
  const reporter = fresh.data;
  if (reporter.state !== 'active') {
    return (
      <Notice tone="info" role="status">
        <p>{messages.reporterRetiredBy(reporter.retired_by ?? '', formatTime(reporter.retired_at))}</p>
      </Notice>
    );
  }
  return (
    <Action
      label={messages.retireReporter}
      tone="danger"
      path={`/v1/reporters/${reporter.reporter_id}/retire`}
      body={{ expected_version: reporter.version }}
      reason="required"
      confirm={reporter.reports}
      startOpen
      scopeNote={messages.retireReporterWill(reporter.principal_id, reporter.reports)}
      invalidates={[reportersKey, ['reporter', reporterId]]}
    />
  );
}
