import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { apiCommand, apiGet } from '../api/client';
import { useIdempotencyKey } from '../api/idempotency';
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
} from '../ui';
import { Action, ApiErrorMessage, Field, ListState, LoadMore, usePagedList } from './common';
import { BeginOffboarding, type TenantDetail } from './offboarding';

// The provider-mode surfaces (TDD-organization-experience-002 1.2.0): the Organization registry and
// the Tenant lifecycle, across Tenants, reachable only while a provider window is in force. Every
// request carries the window's correlation, and the window's reason unless the operator gives one
// for the action (TDD-organization-experience-001 1.2.0).

export interface Organization {
  readonly organization_id: string;
  readonly display_name: string;
  readonly classification: string;
  readonly status: 'active' | 'suspended' | 'retired';
  readonly parent_id?: string | null;
  readonly version: number;
}

export interface Tenant {
  readonly tenant_id: string;
  readonly organization_id: string;
  readonly display_name: string;
  readonly status:
    'requested' | 'provisioning' | 'active' | 'failed' | 'suspended' | 'offboarding' | 'retired';
  readonly isolation_profile: string;
  readonly version: number;
}

const organizationsKey = ['organizations'] as const;
const tenantsKey = ['tenants'] as const;

function useCreate<T>(path: `/v1/${string}`, key: readonly string[]) {
  const session = useSignedIn();
  const client = useQueryClient();
  const keyFor = useIdempotencyKey();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiCommand<T>(path, body, { csrfToken: session.csrfToken, idempotencyKey: keyFor(body) }),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: key });
    },
  });
}

function Select({
  label,
  value,
  options,
  onChange,
  any = true,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly onChange: (value: string) => void;
  readonly any?: boolean;
}): ReactElement {
  return (
    <Field label={label}>
      {(id) => (
        <select
          id={id}
          className={fieldClasses.select}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {any ? <option value="">{messages.any}</option> : null}
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

const classifications = ['customer', 'partner', 'publisher', 'provider'] as const;

export function OrganizationsPage(): ReactElement {
  const [status, setStatus] = useState('');
  const [classification, setClassification] = useState('');
  const { query, items } = usePagedList<Organization>('organizations', '/v1/organizations', 'organizations', {
    status,
    classification,
  });
  const create = useCreate<Organization>('/v1/organizations', organizationsKey);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string>('customer');

  return (
    <Page aria-labelledby="organizations-heading">
      <PageHeader>
        <PageTitle id="organizations-heading">{messages.organizations}</PageTitle>
      </PageHeader>
      <Panel.Root>
        <Panel.Title level={3} id="create-organization-heading">
          {messages.createOrganization}
        </Panel.Title>
        <form
          aria-labelledby="create-organization-heading"
          className={layout.form}
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ display_name: name.trim(), classification: kind });
          }}
        >
          <Field label={messages.displayName}>
            {(id) => (
              <input
                id={id}
                className={fieldClasses.input}
                required
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </Field>
          <Select
            label={messages.classification}
            value={kind}
            options={classifications}
            onChange={setKind}
            any={false}
          />
          <div className={layout.actions}>
            <Button type="submit" disabled={create.isPending}>
              {messages.createOrganization}
            </Button>
          </div>
          {create.isError ? (
            <div className={layout.formWide}>
              <ApiErrorMessage error={create.error} />
            </div>
          ) : null}
        </form>
      </Panel.Root>

      <div className={layout.toolbar}>
        <Select
          label={messages.status}
          value={status}
          options={['active', 'suspended', 'retired']}
          onChange={setStatus}
        />
        <Select
          label={messages.classification}
          value={classification}
          options={classifications}
          onChange={setClassification}
        />
      </div>
      <ListState query={query} empty={messages.noOrganizations} count={items.length} />
      <Rows>
        {items.map((organization) => {
          const versioned = { expected_version: organization.version };
          const base = `/v1/organizations/${organization.organization_id}` as const;
          const note = messages.inOrganization(organization.display_name);
          return (
            <Row key={organization.organization_id}>
              <RowMain>
                <RowTitle>{organization.display_name}</RowTitle>{' '}
                <Facts
                  items={[
                    organization.classification,
                    { status: organization.status, label: messages.state(organization.status) },
                    messages.versionOf(organization.version),
                  ]}
                />{' '}
                <a href={`/tenants?organization_id=${organization.organization_id}`}>{messages.itsTenants}</a>
              </RowMain>{' '}
              {organization.status === 'active' ? (
                <Action
                  label={messages.suspend}
                  tone="danger"
                  path={`${base}/suspend`}
                  body={versioned}
                  reason="required"
                  scopeNote={note}
                  invalidates={[organizationsKey]}
                />
              ) : null}
              {organization.status === 'suspended' ? (
                <Action
                  label={messages.restore}
                  path={`${base}/restore`}
                  body={versioned}
                  reason="optional"
                  invalidates={[organizationsKey]}
                />
              ) : null}{' '}
              {organization.status !== 'retired' ? (
                <Action
                  label={messages.retire}
                  tone="danger"
                  path={`${base}/retire`}
                  body={versioned}
                  reason="required"
                  confirm={organization.display_name}
                  scopeNote={`${messages.irreversible} ${note}`}
                  invalidates={[organizationsKey]}
                />
              ) : null}
            </Row>
          );
        })}
      </Rows>
      <LoadMore query={query} />
    </Page>
  );
}

// What each Tenant state means for the operator (TDD-organization-experience-002 §Tenant States Are
// Rendered Individually): each its own sentence, so nothing in progress reads as finished.
const tenantStateNote: Readonly<Record<Tenant['status'], string>> = {
  requested: messages.tenantRequested,
  provisioning: messages.tenantProvisioning,
  active: messages.tenantActive,
  failed: messages.tenantFailed,
  suspended: messages.tenantSuspended,
  offboarding: messages.tenantOffboarding,
  retired: messages.tenantRetired,
};

const initialOrganization = (): string =>
  new URLSearchParams(window.location.search).get('organization_id') ?? '';

export function TenantsPage(): ReactElement {
  const [status, setStatus] = useState('');
  const [organization, setOrganization] = useState(initialOrganization);
  const { query, items } = usePagedList<Tenant>('tenants', '/v1/tenants', 'tenants', {
    status,
    organization_id: organization,
  });
  const create = useCreate<{ tenant: Tenant }>('/v1/tenants', tenantsKey);
  const [owner, setOwner] = useState(initialOrganization);
  const [name, setName] = useState('');
  const [profile, setProfile] = useState('pooled');

  return (
    <Page aria-labelledby="tenants-heading">
      <PageHeader>
        <PageTitle id="tenants-heading">{messages.tenants}</PageTitle>
      </PageHeader>
      <Panel.Root>
        <Panel.Title level={3} id="request-tenant-heading">
          {messages.requestTenant}
        </Panel.Title>
        <form
          aria-labelledby="request-tenant-heading"
          className={layout.form}
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({
              organization_id: owner.trim(),
              display_name: name.trim(),
              isolation_profile: profile,
            });
          }}
        >
          <Field label={messages.organizationId}>
            {(id) => (
              <input
                id={id}
                className={fieldClasses.input}
                required
                value={owner}
                onChange={(event) => {
                  setOwner(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label={messages.displayName}>
            {(id) => (
              <input
                id={id}
                className={fieldClasses.input}
                required
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </Field>
          <Select
            label={messages.isolationProfile}
            value={profile}
            options={['pooled', 'bridge', 'silo', 'regional']}
            onChange={setProfile}
            any={false}
          />
          <div className={layout.actions}>
            <Button type="submit" disabled={create.isPending}>
              {messages.requestTenant}
            </Button>
          </div>
          {create.isError ? (
            <div className={layout.formWide}>
              <ApiErrorMessage error={create.error} />
            </div>
          ) : null}
        </form>
      </Panel.Root>

      <div className={layout.toolbar}>
        <Select
          label={messages.status}
          value={status}
          options={['requested', 'provisioning', 'active', 'failed', 'suspended', 'offboarding', 'retired']}
          onChange={setStatus}
        />
        <Field label={messages.organizationId}>
          {(id) => (
            <input
              id={id}
              className={fieldClasses.input}
              value={organization}
              onChange={(event) => {
                setOrganization(event.target.value.trim());
              }}
            />
          )}
        </Field>
      </div>
      <ListState query={query} empty={messages.noTenants} count={items.length} />
      <Rows>
        {items.map((tenant) => {
          const versioned = { expected_version: tenant.version };
          const base = `/v1/tenants/${tenant.tenant_id}` as const;
          const note = messages.inTenantNamed(tenant.display_name, tenant.tenant_id);
          return (
            <Row key={tenant.tenant_id}>
              <RowMain>
                <RowTitle>{tenant.display_name}</RowTitle>{' '}
                <Facts
                  items={[
                    tenant.tenant_id,
                    tenant.isolation_profile,
                    { status: tenant.status, label: messages.state(tenant.status) },
                    messages.versionOf(tenant.version),
                  ]}
                />
              </RowMain>
              <p className={rowClasses.note}>{tenantStateNote[tenant.status]}</p>
              {tenant.status === 'requested' ||
              tenant.status === 'provisioning' ||
              tenant.status === 'failed' ? (
                <ProvisioningStatus tenantId={tenant.tenant_id} />
              ) : null}
              {tenant.status === 'requested' || tenant.status === 'failed' ? (
                <Action
                  label={
                    tenant.status === 'requested' ? messages.startProvisioning : messages.retryProvisioning
                  }
                  tone="primary"
                  path={`${base}/provisioning`}
                  body={versioned}
                  reason="optional"
                  scopeNote={note}
                  invalidates={[tenantsKey, ['tenant', tenant.tenant_id]]}
                />
              ) : null}
              {tenant.status === 'provisioning' ? (
                <Action
                  label={messages.activate}
                  tone="primary"
                  path={`${base}/activate`}
                  body={versioned}
                  reason="optional"
                  scopeNote={note}
                  invalidates={[tenantsKey]}
                />
              ) : null}
              {tenant.status === 'active' ? (
                <Action
                  label={messages.suspend}
                  tone="danger"
                  path={`${base}/suspend`}
                  body={versioned}
                  reason="required"
                  scopeNote={note}
                  invalidates={[tenantsKey]}
                />
              ) : null}
              {tenant.status === 'active' ||
              tenant.status === 'suspended' ||
              tenant.status === 'offboarding' ? (
                <BeginOffboarding tenantId={tenant.tenant_id} />
              ) : null}{' '}
              {tenant.status === 'suspended' ? (
                <Action
                  label={messages.restore}
                  path={`${base}/restore`}
                  body={versioned}
                  reason="optional"
                  scopeNote={note}
                  invalidates={[tenantsKey]}
                />
              ) : null}
            </Row>
          );
        })}
      </Rows>
      <LoadMore query={query} />
    </Page>
  );
}

// ProvisioningStatus reads the Tenant's latest provisioning request (TDD-organization-experience-002
// §Tenant States Are Rendered Individually), with its correlation identifier, the handle the operator
// and the provisioning system's owner share. `unresolved` is its own state: the outcome is unknown,
// and retrying could provision the Tenant twice, so nothing here retries it, and its sentence says
// how it is resolved instead (1.6.0). Start provisioning and Retry provisioning are the row's
// (TenantsPage): a `requested` Tenant may be dispatched whatever its request reads, and only a
// `failed` one is retried.
function ProvisioningStatus({ tenantId }: { readonly tenantId: string }): ReactElement | null {
  const detail = useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: ({ signal }) => apiGet<TenantDetail>(`/v1/tenants/${tenantId}`, { signal }),
  });
  const provisioning = detail.data?.provisioning;
  if (provisioning === undefined || provisioning === null) {
    return null;
  }
  const tone =
    provisioning.state === 'realized' ? 'success' : provisioning.state === 'requested' ? 'info' : 'danger';
  return (
    <Notice tone={tone} role="status" data-provisioning={provisioning.state}>
      <p>
        {messages.provisioningState(
          provisioning.state,
          provisioning.correlation_id,
          provisioning.detail ?? '',
        )}
      </p>
    </Notice>
  );
}
