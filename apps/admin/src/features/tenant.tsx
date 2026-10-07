import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { apiCommand } from '../api/client';
import { useIdempotencyKey } from '../api/idempotency';
import { messages } from '../messages';
import { useSignedIn } from '../SessionContext';
import { BulkMembershipAction } from './bulk';
import {
  Action,
  ApiErrorMessage,
  Countdown,
  facts,
  Field,
  ListState,
  LoadMore,
  usePagedList,
} from './common';
import { EnforcementStatus } from './enforcement';

// The Tenant-scope surfaces (TDD-organization-experience-002 1.2.0): Workspaces, Memberships and
// invitations in the one Tenant the session holds. No path names the Tenant: the API takes it from
// the token, and the BFF's scope guard refuses anything else before it leaves.

export interface Workspace {
  readonly workspace_id: string;
  readonly display_name: string;
  readonly type: string;
  readonly status: 'active' | 'archived' | 'retired';
  readonly version: number;
  readonly created_at: string;
}

export interface Membership {
  readonly membership_id: string;
  readonly principal_id: string;
  readonly workspace_id?: string | null;
  readonly subject_type: 'human' | 'workload';
  readonly status: 'active' | 'suspended' | 'revoked';
  readonly version: number;
  readonly valid_from: string;
  readonly valid_until?: string | null;
  readonly provenance: string;
}

interface MembershipResult {
  readonly membership: Membership;
  readonly accepted_at: string;
}

export interface Invitation {
  readonly invitation_id: string;
  readonly workspace_id?: string | null;
  readonly subject_type: string;
  readonly reason?: string | null;
  readonly state: 'pending' | 'identity_verified' | 'accepted' | 'expired' | 'revoked';
  readonly expires_at: string;
  readonly created_at: string;
  readonly accepted_at?: string | null;
  readonly revoked_at?: string | null;
}

const workspacesKey = ['workspaces'] as const;
const membershipsKey = ['memberships'] as const;
const invitationsKey = ['invitations'] as const;

function StatusFilter({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly onChange: (value: string) => void;
}): ReactElement {
  return (
    <Field label={label}>
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
              {option}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

// useCreate posts a create form under the mutation contract: one idempotency key per distinct
// request, so resubmitting the same form after an outage does not create twice.
function useCreate<T>(path: `/v1/${string}`, invalidates: readonly (readonly string[])[]) {
  const session = useSignedIn();
  const client = useQueryClient();
  const keyFor = useIdempotencyKey();
  return useMutation({
    mutationFn: (sent: { body: Record<string, unknown>; reason?: string }) =>
      apiCommand<T>(path, sent.body, {
        csrfToken: session.csrfToken,
        idempotencyKey: keyFor(sent),
        ...(sent.reason === undefined ? {} : { reason: sent.reason }),
      }),
    onSettled: async () => {
      await Promise.all(invalidates.map((queryKey) => client.invalidateQueries({ queryKey })));
    },
  });
}

export function WorkspacesPage({ tenantId }: { readonly tenantId: string }): ReactElement {
  const [status, setStatus] = useState('');
  const { query, items } = usePagedList<Workspace>('workspaces', '/v1/workspaces', 'workspaces', { status });
  const create = useCreate<Workspace>('/v1/workspaces', [workspacesKey]);
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const scopeNote = messages.inTenant(tenantId);

  return (
    <section aria-labelledby="workspaces-heading">
      <h2 id="workspaces-heading">{messages.workspaces}</h2>
      <form
        aria-label={messages.createWorkspace}
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate({ body: { display_name: name.trim(), type: type.trim() } });
        }}
      >
        <Field label={messages.displayName}>
          {(id) => (
            <input
              id={id}
              required
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={messages.workspaceType}>
          {(id) => (
            <input
              id={id}
              required
              value={type}
              onChange={(event) => {
                setType(event.target.value);
              }}
            />
          )}
        </Field>
        <button type="submit" disabled={create.isPending}>
          {messages.createWorkspace}
        </button>
        {create.isError ? <ApiErrorMessage error={create.error} /> : null}
      </form>

      <StatusFilter
        label={messages.status}
        value={status}
        options={['active', 'archived', 'retired']}
        onChange={setStatus}
      />
      <ListState query={query} empty={messages.noWorkspaces} count={items.length} />
      <ul>
        {items.map((workspace) => {
          const versioned = { expected_version: workspace.version };
          const base = `/v1/workspaces/${workspace.workspace_id}` as const;
          return (
            <li key={workspace.workspace_id}>
              <strong>{workspace.display_name}</strong>{' '}
              {facts(workspace.type, messages.state(workspace.status), messages.versionOf(workspace.version))}{' '}
              {workspace.status === 'active' ? (
                <Action
                  label={messages.archive}
                  path={`${base}/archive`}
                  body={versioned}
                  invalidates={[workspacesKey]}
                />
              ) : null}
              {workspace.status === 'archived' ? (
                <>
                  <Action
                    label={messages.restore}
                    path={`${base}/restore`}
                    body={versioned}
                    invalidates={[workspacesKey]}
                  />{' '}
                  <Action
                    label={messages.retire}
                    path={`${base}/retire`}
                    body={versioned}
                    reason="required"
                    confirm={workspace.display_name}
                    scopeNote={`${messages.irreversible} ${scopeNote}`}
                    invalidates={[workspacesKey]}
                  />
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      <LoadMore query={query} />
    </section>
  );
}

export function MembershipsPage({ tenantId }: { readonly tenantId: string }): ReactElement {
  const [status, setStatus] = useState('');
  const { query, items } = usePagedList<Membership>('memberships', '/v1/memberships', 'memberships', {
    status,
  });
  const create = useCreate<MembershipResult>('/v1/memberships', [membershipsKey]);
  const [principal, setPrincipal] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [subjectType, setSubjectType] = useState('human');
  const [provenance, setProvenance] = useState('');
  // The Memberships whose last transition here is followed until it is enforced or over budget.
  const [followed, setFollowed] = useState<ReadonlySet<string>>(new Set());
  const follow = (id: string): void => {
    setFollowed((current) => new Set([...current, id]));
  };
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const scopeNote = messages.inTenant(tenantId);

  return (
    <section aria-labelledby="memberships-heading">
      <h2 id="memberships-heading">{messages.memberships}</h2>
      <form
        aria-label={messages.grantMembership}
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate({
            body: {
              principal_id: principal.trim(),
              ...(workspace.trim() === '' ? {} : { workspace_id: workspace.trim() }),
              subject_type: subjectType,
              provenance: provenance.trim(),
              valid_from: new Date().toISOString(),
            },
          });
        }}
      >
        <Field label={messages.principalId}>
          {(id) => (
            <input
              id={id}
              required
              value={principal}
              onChange={(event) => {
                setPrincipal(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={messages.workspaceIdOptional}>
          {(id) => (
            <input
              id={id}
              value={workspace}
              onChange={(event) => {
                setWorkspace(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={messages.subjectType}>
          {(id) => (
            <select
              id={id}
              value={subjectType}
              onChange={(event) => {
                setSubjectType(event.target.value);
              }}
            >
              <option value="human">{messages.subjectHuman}</option>
              <option value="workload">{messages.subjectWorkload}</option>
            </select>
          )}
        </Field>
        <Field label={messages.provenance} hint={messages.provenanceHint}>
          {(id, hintId) => (
            <input
              id={id}
              required
              aria-describedby={hintId}
              value={provenance}
              onChange={(event) => {
                setProvenance(event.target.value);
              }}
            />
          )}
        </Field>
        <button type="submit" disabled={create.isPending}>
          {messages.grantMembership}
        </button>
        {create.isError ? <ApiErrorMessage error={create.error} /> : null}
      </form>

      <StatusFilter
        label={messages.status}
        value={status}
        options={['active', 'suspended', 'revoked']}
        onChange={setStatus}
      />
      <ListState query={query} empty={messages.noMemberships} count={items.length} />
      {selected.size === 0 ? null : bulk ? (
        <BulkMembershipAction
          selected={[...selected]}
          tenantId={tenantId}
          onClose={() => {
            setBulk(false);
            setSelected(new Set());
          }}
        />
      ) : (
        <p>
          <button
            type="button"
            onClick={() => {
              setBulk(true);
            }}
          >
            {messages.bulkActOn(selected.size)}
          </button>
        </p>
      )}
      <ul>
        {items.map((membership) => {
          const versioned = { expected_version: membership.version };
          const base = `/v1/memberships/${membership.membership_id}` as const;
          return (
            <li key={membership.membership_id}>
              <input
                type="checkbox"
                aria-label={messages.selectMembership(membership.principal_id)}
                checked={selected.has(membership.membership_id)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) {
                    next.add(membership.membership_id);
                  } else {
                    next.delete(membership.membership_id);
                  }
                  setSelected(next);
                }}
              />{' '}
              <strong>{membership.principal_id}</strong>{' '}
              {facts(
                membership.subject_type,
                messages.state(membership.status),
                messages.versionOf(membership.version),
                membership.workspace_id === undefined || membership.workspace_id === null
                  ? null
                  : messages.workspaceRef(membership.workspace_id),
              )}{' '}
              {membership.status === 'active' ? (
                <Action
                  label={messages.suspend}
                  path={`${base}/suspend`}
                  body={versioned}
                  reason="optional"
                  invalidates={[membershipsKey]}
                  onDone={() => {
                    follow(membership.membership_id);
                  }}
                />
              ) : null}
              {membership.status === 'suspended' ? (
                <Action
                  label={messages.restore}
                  path={`${base}/restore`}
                  body={versioned}
                  reason="optional"
                  invalidates={[membershipsKey]}
                />
              ) : null}{' '}
              {membership.status !== 'revoked' ? (
                <Action<MembershipResult>
                  label={messages.revoke}
                  path={`${base}/revoke`}
                  body={versioned}
                  reason="required"
                  scopeNote={`${messages.irreversible} ${scopeNote}`}
                  invalidates={[membershipsKey]}
                  onDone={() => {
                    follow(membership.membership_id);
                  }}
                />
              ) : null}
              {followed.has(membership.membership_id) ? (
                <EnforcementStatus membershipId={membership.membership_id} />
              ) : null}
            </li>
          );
        })}
      </ul>
      <LoadMore query={query} />
    </section>
  );
}

const openInvitation = (state: Invitation['state']): boolean =>
  state === 'pending' || state === 'identity_verified';

export function InvitationsPage(): ReactElement {
  const [state, setState] = useState('');
  const { query, items } = usePagedList<Invitation>('invitations', '/v1/invitations', 'invitations', {
    state,
  });
  const create = useCreate<{ invitation: Invitation; token: string }>('/v1/invitations', [invitationsKey]);
  const [target, setTarget] = useState('');
  const [subjectType, setSubjectType] = useState('human');
  const [days, setDays] = useState('7');
  const [token, setToken] = useState<string | null>(null);

  return (
    <section aria-labelledby="invitations-heading">
      <h2 id="invitations-heading">{messages.invitations}</h2>
      <form
        aria-label={messages.sendInvitation}
        onSubmit={(event) => {
          event.preventDefault();
          setToken(null);
          create.mutate(
            {
              body: {
                target_identifier: target.trim(),
                subject_type: subjectType,
                ttl_seconds: Math.round(Number(days) * 86_400),
              },
            },
            {
              onSuccess: (issued) => {
                setToken(issued.token);
              },
            },
          );
        }}
      >
        <Field label={messages.invitee} hint={messages.inviteeHint}>
          {(id, hintId) => (
            <input
              id={id}
              required
              aria-describedby={hintId}
              autoComplete="off"
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={messages.subjectType}>
          {(id) => (
            <select
              id={id}
              value={subjectType}
              onChange={(event) => {
                setSubjectType(event.target.value);
              }}
            >
              <option value="human">{messages.subjectHuman}</option>
              <option value="workload">{messages.subjectWorkload}</option>
            </select>
          )}
        </Field>
        <Field label={messages.validForDays}>
          {(id) => (
            <input
              id={id}
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={(event) => {
                setDays(event.target.value);
              }}
            />
          )}
        </Field>
        <button type="submit" disabled={create.isPending}>
          {messages.sendInvitation}
        </button>
        {create.isError ? <ApiErrorMessage error={create.error} /> : null}
      </form>
      {token === null ? null : (
        <div role="status">
          <p>{messages.invitationToken}</p>
          <code>{token}</code>
        </div>
      )}

      <StatusFilter
        label={messages.status}
        value={state}
        options={['pending', 'identity_verified', 'accepted', 'expired', 'revoked']}
        onChange={setState}
      />
      <ListState query={query} empty={messages.noInvitations} count={items.length} />
      <ul>
        {items.map((invitation) => (
          <li key={invitation.invitation_id}>
            <strong>{invitation.invitation_id}</strong>{' '}
            {facts(invitation.subject_type, messages.invitationState(invitation.state))}
            {openInvitation(invitation.state) ? (
              <>
                {messages.separator}
                {messages.expiresIn} <Countdown until={invitation.expires_at} />{' '}
                <Action
                  label={messages.revoke}
                  path={`/v1/invitations/${invitation.invitation_id}/revoke`}
                  body={{}}
                  invalidates={[invitationsKey]}
                />
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <LoadMore query={query} />
    </section>
  );
}
