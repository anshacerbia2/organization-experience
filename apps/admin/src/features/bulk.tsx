import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactElement } from 'react';

import { apiCommand } from '../api/client';
import { useIdempotencyKey } from '../api/idempotency';
import { messages } from '../messages';
import { maxReasonLength, minReasonLength, normalizeReason, reasonProblem } from '../scope';
import { useSignedIn } from '../SessionContext';
import { ApiErrorMessage, facts } from './common';
import { EnforcementStatus } from './enforcement';

// A bulk Membership action (ADR-ORG-004 §5.1, TDD-organization-experience-001 §Bulk Operations): the
// server previews it through the single command's own checks, the operator confirms the count and
// the scope, and the execution commits the set that was previewed. Each item's outcome is shown under
// its own heading; the batch is never one aggregate success.

type BulkAction = 'suspend' | 'restore' | 'revoke';

interface Problem {
  readonly type: string;
  readonly title: string;
  readonly detail?: string;
}

interface BatchItem {
  readonly membership_id: string;
  readonly principal_id: string | null;
  readonly current_status: string | null;
  readonly version: number | null;
  readonly resulting_status: string | null;
  readonly refusal: Problem | null;
  readonly outcome: {
    readonly status: 'succeeded' | 'failed' | 'not_attempted';
    readonly accepted_at?: string;
    readonly problem?: Problem;
    readonly reason?: string;
  } | null;
}

export interface Batch {
  readonly batch_id: string;
  readonly action: BulkAction;
  readonly state: string;
  readonly expires_at: string;
  readonly counts: {
    readonly would_change: number;
    readonly would_not_change: number;
    readonly succeeded: number;
    readonly failed: number;
    readonly not_attempted: number;
  };
  readonly items: readonly BatchItem[];
}

const problemText = (problem: Problem | null | undefined): string => problem?.detail ?? problem?.title ?? '';

export function BulkMembershipAction({
  selected,
  tenantId,
  onClose,
}: {
  readonly selected: readonly string[];
  readonly tenantId: string;
  readonly onClose: () => void;
}): ReactElement {
  const session = useSignedIn();
  const client = useQueryClient();
  const previewKey = useIdempotencyKey();
  const executeKey = useIdempotencyKey();
  const ids = { action: useId(), reason: useId() };
  const [action, setAction] = useState<BulkAction>('suspend');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [continues, setContinues] = useState<{ batchId: string; ids: readonly string[] } | null>(null);
  const items = continues?.ids ?? selected;

  const preview = useMutation({
    mutationFn: (sent: {
      action: BulkAction;
      ids: readonly string[];
      continues: string | null;
      reason: string;
    }) =>
      apiCommand<Batch>(
        '/v1/membership-batches',
        {
          action: sent.action,
          membership_ids: sent.ids,
          ...(sent.continues === null ? {} : { continues: sent.continues }),
        },
        { csrfToken: session.csrfToken, idempotencyKey: previewKey(sent), reason: sent.reason },
      ),
  });
  const execute = useMutation({
    mutationFn: (batch: Batch) =>
      apiCommand<Batch>(
        `/v1/membership-batches/${batch.batch_id}/execute`,
        {},
        { csrfToken: session.csrfToken, idempotencyKey: executeKey(batch.batch_id) },
      ),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ['memberships'] });
    },
  });

  const problem = reason === '' && action !== 'revoke' ? null : reasonProblem(reason);
  const previewed = preview.data;
  const executed = execute.data;

  const requestPreview = (): void => {
    setSubmitted(true);
    if (problem !== null) {
      return;
    }
    execute.reset();
    preview.mutate({
      action,
      ids: items,
      continues: continues?.batchId ?? null,
      reason: normalizeReason(reason),
    });
  };

  if (executed !== undefined) {
    const by = (status: 'succeeded' | 'failed' | 'not_attempted') =>
      executed.items.filter((item) => item.outcome?.status === status);
    const failed = by('failed');
    return (
      <section aria-labelledby="bulk-outcome-heading">
        <h3 id="bulk-outcome-heading">{messages.bulkOutcome}</h3>
        <p>
          {messages.bulkCounts(
            executed.counts.succeeded,
            executed.counts.failed,
            executed.counts.not_attempted,
          )}
        </p>
        <h4>{messages.outcomeHeading('succeeded')}</h4>
        <ul>
          {by('succeeded').map((item) => (
            <li key={item.membership_id}>
              {facts(item.principal_id, item.resulting_status)}
              {executed.action === 'restore' ? null : <EnforcementStatus membershipId={item.membership_id} />}
            </li>
          ))}
        </ul>
        <h4>{messages.outcomeHeading('failed')}</h4>
        <ul>
          {failed.map((item) => (
            <li key={item.membership_id}>{facts(item.principal_id, problemText(item.outcome?.problem))}</li>
          ))}
        </ul>
        <h4>{messages.outcomeHeading('not_attempted')}</h4>
        <ul>
          {by('not_attempted').map((item) => (
            <li key={item.membership_id}>
              {facts(item.principal_id, item.outcome?.reason ?? problemText(item.refusal))}
            </li>
          ))}
        </ul>
        {failed.length === 0 ? null : (
          <button
            type="button"
            onClick={() => {
              setContinues({ batchId: executed.batch_id, ids: failed.map((item) => item.membership_id) });
              setAction(executed.action);
              preview.reset();
              execute.reset();
            }}
          >
            {messages.resubmitFailed(failed.length)}
          </button>
        )}{' '}
        <button type="button" onClick={onClose}>
          {messages.close}
        </button>
      </section>
    );
  }

  if (previewed !== undefined) {
    return (
      <section aria-labelledby="bulk-preview-heading">
        <h3 id="bulk-preview-heading">{messages.bulkPreview}</h3>
        <table>
          <caption>
            {messages.bulkPreviewCaption(previewed.counts.would_change, previewed.counts.would_not_change)}
          </caption>
          <thead>
            <tr>
              <th scope="col">{messages.principalId}</th>
              <th scope="col">{messages.currentState}</th>
              <th scope="col">{messages.resultingState}</th>
            </tr>
          </thead>
          <tbody>
            {previewed.items.map((item) => (
              <tr key={item.membership_id}>
                <td>{item.principal_id ?? item.membership_id}</td>
                <td>{item.current_status ?? ''}</td>
                <td>
                  {item.refusal === null
                    ? (item.resulting_status ?? '')
                    : messages.refusedBy(problemText(item.refusal))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>{messages.bulkConfirm(previewed.action, previewed.counts.would_change, tenantId)}</p>
        <button
          type="button"
          disabled={execute.isPending || previewed.counts.would_change === 0}
          onClick={() => {
            execute.mutate(previewed);
          }}
        >
          {messages.bulkExecute(previewed.action, previewed.counts.would_change)}
        </button>{' '}
        <button type="button" onClick={onClose}>
          {messages.cancel}
        </button>
        {execute.isError ? <ApiErrorMessage error={execute.error} /> : null}
      </section>
    );
  }

  return (
    <form
      aria-label={messages.bulkAction}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        requestPreview();
      }}
    >
      <h3>{messages.bulkSelected(items.length)}</h3>
      {continues === null ? null : <p>{messages.bulkContinues}</p>}
      <label htmlFor={ids.action}>{messages.bulkActionLabel}</label>
      <select
        id={ids.action}
        value={action}
        onChange={(event) => {
          setAction(event.target.value as BulkAction);
        }}
      >
        <option value="suspend">{messages.suspend}</option>
        <option value="restore">{messages.restore}</option>
        <option value="revoke">{messages.revoke}</option>
      </select>
      <label htmlFor={ids.reason}>{action === 'revoke' ? messages.reason : messages.reasonOptional}</label>
      <textarea
        id={ids.reason}
        value={reason}
        aria-invalid={submitted && problem !== null}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      {submitted && problem !== null ? (
        <p role="alert">
          {problem === 'short'
            ? messages.reasonShort(minReasonLength)
            : problem === 'long'
              ? messages.reasonLong(maxReasonLength)
              : messages.reasonCharacters}
        </p>
      ) : null}
      <button type="submit" disabled={preview.isPending}>
        {messages.bulkPreviewAction}
      </button>{' '}
      <button type="button" onClick={onClose}>
        {messages.cancel}
      </button>
      {preview.isError ? <ApiErrorMessage error={preview.error} /> : null}
    </form>
  );
}
