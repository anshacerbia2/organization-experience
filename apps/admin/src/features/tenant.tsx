import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { apiCommand } from '../api/client';
import { useIdempotencyKey } from '../api/idempotency';
import { invitationLink } from '../invitationLink';
import { messages } from '../messages';
import { useSignedIn } from '../SessionContext';
import { BulkMembershipAction } from './bulk';
import { Action, ApiErrorMessage, Countdown, Field, ListState, LoadMore, usePagedList } from './common';
import { EnforcementStatus } from './enforcement';
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
  // identity_verified is gone: ADR-ORG-007 §5.4 checks the address in the acceptance itself.
  readonly state: 'pending' | 'accepted' | 'expired' | 'revoked';
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
          className={fieldClasses.select}
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
    <Page aria-labelledby="workspaces-heading">
      <PageHeader>
        <PageTitle id="workspaces-heading">{messages.workspaces}</PageTitle>
      </PageHeader>
      <Panel.Root>
        <Panel.Title level={3} id="create-workspace-heading">
          {messages.createWorkspace}
        </Panel.Title>
        <form
          aria-labelledby="create-workspace-heading"
          className={layout.form}
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ body: { display_name: name.trim(), type: type.trim() } });
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
          <Field label={messages.workspaceType}>
            {(id) => (
              <input
                id={id}
                className={fieldClasses.input}
                required
                value={type}
                onChange={(event) => {
                  setType(event.target.value);
                }}
              />
            )}
          </Field>
          <div className={layout.actions}>
            <Button type="submit" disabled={create.isPending}>
              {messages.createWorkspace}
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
        <StatusFilter
          label={messages.status}
          value={status}
          options={['active', 'archived', 'retired']}
          onChange={setStatus}
        />
      </div>
      <ListState query={query} empty={messages.noWorkspaces} count={items.length} />
      <Rows>
        {items.map((workspace) => {
          const versioned = { expected_version: workspace.version };
          const base = `/v1/workspaces/${workspace.workspace_id}` as const;
          return (
            <Row key={workspace.workspace_id}>
              <RowMain>
                <RowTitle>{workspace.display_name}</RowTitle>{' '}
                <Facts
                  items={[
                    workspace.type,
                    { status: workspace.status, label: messages.state(workspace.status) },
                    messages.versionOf(workspace.version),
                  ]}
                />
              </RowMain>{' '}
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
                    tone="danger"
                    path={`${base}/retire`}
                    body={versioned}
                    reason="required"
                    confirm={workspace.display_name}
                    scopeNote={`${messages.irreversible} ${scopeNote}`}
                    invalidates={[workspacesKey]}
                  />
                </>
              ) : null}
            </Row>
          );
        })}
      </Rows>
      <LoadMore query={query} />
    </Page>
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
    <Page aria-labelledby="memberships-heading">
      <PageHeader>
        <PageTitle id="memberships-heading">{messages.memberships}</PageTitle>
      </PageHeader>
      <Panel.Root>
        <Panel.Title level={3} id="grant-membership-heading">
          {messages.grantMembership}
        </Panel.Title>
        <form
          aria-labelledby="grant-membership-heading"
          className={layout.form}
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
                className={fieldClasses.input}
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
                className={fieldClasses.input}
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
                className={fieldClasses.select}
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
                className={fieldClasses.input}
                required
                aria-describedby={hintId}
                value={provenance}
                onChange={(event) => {
                  setProvenance(event.target.value);
                }}
              />
            )}
          </Field>
          <div className={layout.actions}>
            <Button type="submit" disabled={create.isPending}>
              {messages.grantMembership}
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
        <StatusFilter
          label={messages.status}
          value={status}
          options={['active', 'suspended', 'revoked']}
          onChange={setStatus}
        />
      </div>
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
        <div className={layout.actions}>
          <Button
            variant="secondary"
            onClick={() => {
              setBulk(true);
            }}
          >
            {messages.bulkActOn(selected.size)}
          </Button>
        </div>
      )}
      <Rows>
        {items.map((membership) => {
          const versioned = { expected_version: membership.version };
          const base = `/v1/memberships/${membership.membership_id}` as const;
          return (
            <Row key={membership.membership_id}>
              <RowMain>
                <input
                  type="checkbox"
                  className={rowClasses.select}
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
                <RowTitle mono>{membership.principal_id}</RowTitle>{' '}
                <Facts
                  items={[
                    membership.subject_type,
                    { status: membership.status, label: messages.state(membership.status) },
                    messages.versionOf(membership.version),
                    membership.workspace_id === undefined || membership.workspace_id === null
                      ? null
                      : messages.workspaceRef(membership.workspace_id),
                  ]}
                />
              </RowMain>{' '}
              {membership.status === 'active' ? (
                <Action
                  label={messages.suspend}
                  tone="danger"
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
                  tone="danger"
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
            </Row>
          );
        })}
      </Rows>
      <LoadMore query={query} />
    </Page>
  );
}

const openInvitation = (state: Invitation['state']): boolean => state === 'pending';

// IssuedLink shows the acceptance link once, as the invitation is issued (ADR-ORG-007 §5.5,
// TDD-organization-experience-002 1.8.0). The token is in the link's fragment alone. It is held in
// this component's state until Done or until the page is left, and never sent back to the BFF, stored,
// or logged; the list never shows it again.
function IssuedLink({
  token,
  onDone,
}: {
  readonly token: string;
  readonly onDone: () => void;
}): ReactElement {
  const link = invitationLink(window.location.origin, token);
  const [copied, setCopied] = useState<'not-yet' | 'copied' | 'refused'>('not-yet');
  const copy = (): void => {
    // The Clipboard API is a secure context's alone; where it is missing or refused, the link stays
    // selectable.
    const clipboard = typeof navigator.clipboard === 'undefined' ? null : navigator.clipboard;
    if (clipboard === null) {
      setCopied('refused');
      return;
    }
    clipboard.writeText(link).then(
      () => {
        setCopied('copied');
      },
      () => {
        setCopied('refused');
      },
    );
  };
  return (
    <Panel.Root aria-labelledby="invitation-link-heading">
      <Panel.Title level={3} id="invitation-link-heading">
        {messages.invitationLinkTitle}
      </Panel.Title>
      <Notice tone="success" icon="key">
        <p>{messages.invitationLinkSend}</p>
        <p>{messages.invitationLinkOnce}</p>
      </Notice>
      <p className={layout.subtitle} id="invitation-link-label">
        {messages.invitationLinkLabel}
      </p>
      <code className={layout.token}>{link}</code>
      <div className={layout.actions}>
        <Button onClick={copy}>{messages.copyLink}</Button>
        <Button variant="secondary" onClick={onDone}>
          {messages.invitationLinkDone}
        </Button>
      </div>
      <p role="status">
        {copied === 'copied' ? messages.linkCopied : copied === 'refused' ? messages.linkNotCopied : null}
      </p>
    </Panel.Root>
  );
}

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
    <Page aria-labelledby="invitations-heading">
      <PageHeader>
        <PageTitle id="invitations-heading">{messages.invitations}</PageTitle>
      </PageHeader>
      <Panel.Root>
        <Panel.Title level={3} id="send-invitation-heading">
          {messages.sendInvitation}
        </Panel.Title>
        <form
          aria-labelledby="send-invitation-heading"
          className={layout.form}
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
                  // The token is the page's to show once, not the mutation cache's to keep.
                  create.reset();
                },
              },
            );
          }}
        >
          <Field label={messages.invitee} hint={messages.inviteeHint}>
            {(id, hintId) => (
              <input
                id={id}
                className={fieldClasses.input}
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
                className={fieldClasses.select}
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
                className={fieldClasses.input}
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
          <div className={layout.actions}>
            <Button type="submit" disabled={create.isPending}>
              {messages.sendInvitation}
            </Button>
          </div>
          {create.isError ? (
            <div className={layout.formWide}>
              <ApiErrorMessage error={create.error} />
            </div>
          ) : null}
        </form>
      </Panel.Root>
      {token === null ? null : (
        <IssuedLink
          token={token}
          onDone={() => {
            setToken(null);
            create.reset();
          }}
        />
      )}

      <div className={layout.toolbar}>
        <StatusFilter
          label={messages.status}
          value={state}
          options={['pending', 'accepted', 'expired', 'revoked']}
          onChange={setState}
        />
      </div>
      <ListState query={query} empty={messages.noInvitations} count={items.length} />
      <Rows>
        {items.map((invitation) => (
          <Row key={invitation.invitation_id}>
            <RowMain>
              <RowTitle mono>{invitation.invitation_id}</RowTitle>{' '}
              <Facts
                items={[
                  invitation.subject_type,
                  { status: invitation.state, label: messages.invitationState(invitation.state) },
                ]}
              />
              {openInvitation(invitation.state) ? (
                <span className={rowClasses.note}>
                  {messages.separator}
                  {messages.expiresIn} <Countdown until={invitation.expires_at} />
                </span>
              ) : null}
            </RowMain>
            {openInvitation(invitation.state) ? (
              <>
                {' '}
                <Action
                  label={messages.revoke}
                  tone="danger"
                  path={`/v1/invitations/${invitation.invitation_id}/revoke`}
                  body={{}}
                  invalidates={[invitationsKey]}
                />
              </>
            ) : null}
          </Row>
        ))}
      </Rows>
      <LoadMore query={query} />
    </Page>
  );
}
