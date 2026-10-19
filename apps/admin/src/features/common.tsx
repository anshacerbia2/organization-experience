import { useInfiniteQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';

import { ApiError, apiCommand, apiGet, listPath, type Page } from '../api/client';
import { useIdempotencyKey } from '../api/idempotency';
import { messages } from '../messages';
import { maxReasonLength, minReasonLength, normalizeReason, reasonProblem, remaining } from '../scope';
import { providerSignInHref } from '../session';
import { useSignedIn } from '../SessionContext';
import {
  Button,
  EmptyState,
  fieldClasses,
  layout,
  Loading,
  Notice,
  rowClasses,
  type ButtonVariant,
} from '../ui';

// What every administration surface shares (TDD-organization-experience-002 1.2.0): keyset lists, the
// mutation contract, and how a refusal is shown.

type ApiPath = `/v1/${string}`;

// usePagedList reads a list in the estate's list form (STD-GLB-001 1.3.0 §Pagination). A keyset has
// no page numbers, so the list grows by its next page; a filter is part of the key, so a changed
// filter starts again from the first page.
export function usePagedList<T>(
  key: string,
  base: ApiPath,
  field: string,
  filters: Readonly<Record<string, string>>,
  enabled = true,
) {
  const query = useInfiniteQuery({
    queryKey: [key, filters] as QueryKey,
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const page = await apiGet<Page & Record<string, unknown>>(listPath(base, filters, pageParam), {
        signal,
      });
      const items = page[field];
      return { items: Array.isArray(items) ? (items as T[]) : [], next: page.next };
    },
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return { query, items };
}

export function LoadMore({
  query,
}: {
  readonly query: ReturnType<typeof usePagedList>['query'];
}): ReactElement | null {
  if (!query.hasNextPage) {
    return null;
  }
  return (
    <div className={layout.actions}>
      <Button
        variant="secondary"
        size="sm"
        disabled={query.isFetchingNextPage}
        onClick={() => {
          void query.fetchNextPage();
        }}
      >
        {query.isFetchingNextPage ? messages.loading : messages.loadMore}
      </Button>
    </div>
  );
}

// ApiErrorMessage says why a request did not do what was asked, in the API's own words where it
// gave any. A version conflict says so plainly: the record changed since it was shown.
export function ApiErrorMessage({ error }: { readonly error: unknown }): ReactElement {
  if (!(error instanceof ApiError)) {
    return (
      <Notice tone="danger" role="alert">
        <p>{messages.dependencyUnavailable}</p>
      </Notice>
    );
  }
  if (error.stepUp) {
    return (
      <Notice tone="warning" icon="shield" role="alert">
        <p>
          {messages.stepUpNeeded}{' '}
          <a href={providerSignInHref(window.location.pathname)}>{messages.stepUpAction}</a>
        </p>
      </Notice>
    );
  }
  const reference = error.correlationId === null ? '' : ` ${messages.correlation(error.correlationId)}`;
  if (error.isVersionConflict) {
    return (
      <Notice tone="warning" role="alert">
        <p>
          {messages.versionConflict}
          {reference}
        </p>
      </Notice>
    );
  }
  if (error.status >= 500) {
    return (
      <Notice tone="danger" role="alert">
        <p>
          {messages.dependencyUnavailable}
          {reference}
        </p>
      </Notice>
    );
  }
  return (
    <Notice tone="danger" role="alert">
      <p>
        {error.detail === null ? messages.refused : messages.refusedBy(error.detail)}
        {reference}
      </p>
    </Notice>
  );
}

export function ListState({
  query,
  empty,
  count,
}: {
  readonly query: { isPending: boolean; isError: boolean; error: unknown };
  readonly empty: string;
  readonly count: number;
}): ReactElement | null {
  if (query.isPending) {
    return <Loading />;
  }
  if (query.isError) {
    return <ApiErrorMessage error={query.error} />;
  }
  return count === 0 ? <EmptyState>{empty}</EmptyState> : null;
}

// Countdown shows the time left until an instant, every second.
export function Countdown({ until }: { readonly until: string }): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return <span>{remaining(until, now)}</span>;
}

// facts joins a row's facts with the catalogue's separator, leaving out any that are absent.
export const facts = (...parts: readonly (string | null | undefined)[]): string =>
  parts
    .filter((part): part is string => part !== null && part !== undefined && part !== '')
    .join(messages.separator);

export const formatTime = (value: string | null | undefined): string =>
  value === null || value === undefined ? '' : new Date(value).toLocaleString();

export interface ActionProps<T> {
  readonly label: string;
  readonly path: ApiPath;
  // body is sent as is; a transition adds the version the operator was shown.
  readonly body: Readonly<Record<string, unknown>>;
  // reason: 'required' asks for one before sending; 'optional' offers the field.
  readonly reason?: 'required' | 'optional';
  // confirm is text the operator types to confirm an irreversible action, such as the record's name.
  readonly confirm?: string;
  // scopeNote names the scope and target in the confirmation text, not only in the banner
  // (TDD-organization-experience-001 §Irreversible Operations).
  readonly scopeNote?: string;
  readonly invalidates: readonly QueryKey[];
  readonly onDone?: (result: T) => void;
  // tone is how the action is drawn: danger for one that takes access or a record away, primary for
  // the one a page is for, secondary otherwise (TDD-organization-experience-001 §Visual Language).
  readonly tone?: ButtonVariant;
  // reasonField, when set, also sends the operator's reason in the body under this name, for a command
  // whose record keeps a reason of its own, such as a dead letter's waiver (TDD-organization-experience-002
  // 1.7.0). The header carries it too, as the access record's.
  readonly reasonField?: string;
}

// Action runs one command under the mutation contract: an idempotency key per distinct request, the
// version from the record shown, and the operator's reason where one is asked for. It is never
// retried; a version conflict is shown, and the list is read again so the current state is beside it.
export function Action<T>({
  label,
  path,
  body,
  reason: reasonMode,
  confirm,
  scopeNote,
  invalidates,
  onDone,
  tone = 'secondary',
  reasonField,
}: ActionProps<T>): ReactElement {
  const session = useSignedIn();
  const client = useQueryClient();
  const keyFor = useIdempotencyKey();
  const ids = { reason: useId(), confirm: useId() };
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const mutation = useMutation({
    mutationFn: (sent: { reason: string }) =>
      apiCommand<T>(path, reasonField === undefined ? body : { ...body, [reasonField]: sent.reason }, {
        csrfToken: session.csrfToken,
        idempotencyKey: keyFor({ path, body, reason: sent.reason }),
        reason: sent.reason,
      }),
    onSuccess: (result) => {
      setOpen(false);
      onDone?.(result);
    },
    onSettled: async () => {
      await Promise.all(invalidates.map((queryKey) => client.invalidateQueries({ queryKey })));
    },
  });

  const needsForm = reasonMode !== undefined || confirm !== undefined;
  const problem = reason === '' && reasonMode !== 'required' ? null : reasonProblem(reason);
  const confirmed = confirm === undefined || typed === confirm;

  const send = (): void => {
    setSubmitted(true);
    if (problem !== null || !confirmed) {
      return;
    }
    mutation.mutate({ reason: normalizeReason(reason) });
  };

  if (!needsForm || !open) {
    return (
      <span className={rowClasses.action}>
        <Button
          variant={tone}
          size="sm"
          disabled={mutation.isPending}
          onClick={() => {
            if (needsForm) {
              setOpen(true);
            } else {
              send();
            }
          }}
        >
          {label}
        </Button>
        {mutation.isError ? <ApiErrorMessage error={mutation.error} /> : null}
      </span>
    );
  }
  return (
    <form
      aria-label={label}
      noValidate
      className={layout.confirm}
      data-tone={tone}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {scopeNote === undefined ? null : (
        <Notice tone={tone === 'danger' ? 'danger' : 'info'}>
          <p>{scopeNote}</p>
        </Notice>
      )}
      {reasonMode === undefined ? null : (
        <div className={fieldClasses.field}>
          <label htmlFor={ids.reason} className={fieldClasses.label}>
            {reasonMode === 'required' ? messages.reason : messages.reasonOptional}
          </label>
          <textarea
            id={ids.reason}
            className={fieldClasses.area}
            value={reason}
            aria-invalid={submitted && problem !== null}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          {submitted && problem !== null ? (
            <p role="alert" className={fieldClasses.error}>
              {problem === 'short'
                ? messages.reasonShort(minReasonLength)
                : problem === 'long'
                  ? messages.reasonLong(maxReasonLength)
                  : messages.reasonCharacters}
            </p>
          ) : null}
        </div>
      )}
      {confirm === undefined ? null : (
        <div className={fieldClasses.field}>
          <label htmlFor={ids.confirm} className={fieldClasses.label}>
            {messages.typeToConfirm(confirm)}
          </label>
          <input
            id={ids.confirm}
            className={fieldClasses.input}
            value={typed}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={submitted && !confirmed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        </div>
      )}
      <div className={layout.actions}>
        <Button
          type="submit"
          variant={tone === 'secondary' ? 'primary' : tone}
          size="sm"
          disabled={mutation.isPending}
        >
          {label}
        </Button>{' '}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
          }}
        >
          {messages.cancel}
        </Button>
      </div>
      {mutation.isError ? <ApiErrorMessage error={mutation.error} /> : null}
    </form>
  );
}

// Field is a labelled input for the create forms. Its control takes fieldClasses' input, area or
// select.
export function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: (id: string, hintId: string | undefined) => ReactNode;
}): ReactElement {
  const id = useId();
  const hintId = useId();
  return (
    <div className={fieldClasses.field}>
      <label htmlFor={id} className={fieldClasses.label}>
        {label}
      </label>
      {children(id, hint === undefined ? undefined : hintId)}
      {hint === undefined ? null : (
        <span id={hintId} className={fieldClasses.hint}>
          {hint}
        </span>
      )}
    </div>
  );
}
