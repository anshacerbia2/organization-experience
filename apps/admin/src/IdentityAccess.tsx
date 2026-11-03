import { useId, useState, type ReactElement, type SyntheticEvent } from 'react';

import { ApiError, apiCommand, apiGet } from './api/client';
import { useIdempotencyKey } from './api/idempotency';
import { messages } from './messages';
import { maxReasonLength, minReasonLength, normalizeReason, reasonProblem, type Scope } from './scope';
import { Button, fieldClasses, Icon, layout, Notice, Panel } from './ui';

// IdentityAccess activates an eligible grant for the Identity Control API (TDD-organization-experience-001
// 1.20.0 §Activating Identity Control Access, ADR-ORG-002 §5.1). Organization Control records every
// provider grant and its activations, so the request is made here; the authority is used in
// identity-experience's Admin Portal, which this application never reaches. It opens no provider window:
// a window is this application's own authority over Organization Control. The request goes through the
// BFF's proxy, which admits the activation routes without a window, with the operator's own reason.

type ProviderScope = Extract<Scope, { scope: 'provider' }>;

export const identityControlScope = 'provider:identity-control';

interface HeldGrant {
  readonly grant_id: string;
  readonly scope: string;
  readonly kind: string;
}

interface Activation {
  readonly activation_id: string;
  readonly decision?: string;
  readonly ends_at: string | null;
  readonly in_force: boolean;
  readonly ended_at: string | null;
}

type Outcome =
  | { readonly kind: 'no-grant' }
  | { readonly kind: 'emergency' }
  | { readonly kind: 'activation'; readonly activation: Activation }
  | { readonly kind: 'gone' };

const formatTime = (value: string): string => new Date(value).toLocaleString();

function OutcomeNotice({ outcome }: { readonly outcome: Outcome }): ReactElement {
  if (outcome.kind === 'no-grant') {
    return (
      <Notice tone="warning" role="status">
        <p>{messages.noIdentityGrant}</p>
      </Notice>
    );
  }
  if (outcome.kind === 'emergency') {
    return (
      <Notice tone="info" role="status">
        <p>{messages.identityGrantEmergency}</p>
      </Notice>
    );
  }
  if (outcome.kind === 'gone') {
    return (
      <Notice tone="warning" role="status">
        <p>{messages.identityAccessGone}</p>
      </Notice>
    );
  }
  const { activation } = outcome;
  const decision = activation.decision ?? '';
  if (decision === '') {
    return (
      <Notice tone="info" role="status">
        <p>{messages.identityAccessPending(activation.activation_id)}</p>
      </Notice>
    );
  }
  if (activation.in_force && activation.ends_at !== null) {
    return (
      <Notice tone="success" role="status">
        <p>{messages.identityAccessInForce(formatTime(activation.ends_at))}</p>
      </Notice>
    );
  }
  return (
    <Notice tone="warning" role="status">
      <p>{messages.identityAccessClosed(activation.ended_at === null ? decision : 'ended')}</p>
    </Notice>
  );
}

export function IdentityAccess({
  scope,
  csrfToken,
}: {
  readonly scope: ProviderScope;
  readonly csrfToken: string;
}): ReactElement {
  const ids = { reason: useId(), reasonHint: useId(), duration: useId(), durationHint: useId() };
  const max = scope.limits.maxDurationMinutes;
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState(String(scope.limits.defaultDurationMinutes));
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  // The reason the request was made with, kept to read its status again: every read of these routes
  // carries one (TDD-organization-control-001 §Provider Activation).
  const [statusReason, setStatusReason] = useState<string | null>(null);
  const keys = useIdempotencyKey();

  const reasonError = reasonProblem(reason);
  const minutes = Number(duration);
  const durationError = !Number.isInteger(minutes) || minutes < 1 || minutes > max;

  const fail = (error: unknown): void => {
    setFailure(error instanceof ApiError ? error : new ApiError(0, null, null, null, false));
  };

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmitted(true);
    if (reasonError !== null || durationError) {
      return;
    }
    const stated = normalizeReason(reason);
    setSending(true);
    setFailure(null);
    setOutcome(null);
    void (async () => {
      try {
        const { grants } = await apiGet<{ grants: HeldGrant[] }>('/v1/provider-activations/grants', {
          reason: stated,
        });
        const grant = grants.find((candidate) => candidate.scope === identityControlScope);
        if (grant === undefined) {
          setOutcome({ kind: 'no-grant' });
          return;
        }
        if (grant.kind === 'emergency') {
          setOutcome({ kind: 'emergency' });
          return;
        }
        const request = { grant_id: grant.grant_id, duration_seconds: minutes * 60 };
        let activation: Activation;
        try {
          activation = await apiCommand<Activation>('/v1/provider-activations', request, {
            csrfToken,
            idempotencyKey: keys.keyFor({ request, reason: stated }),
            reason: stated,
          });
          keys.settle();
        } catch (error) {
          keys.settle(error);
          throw error;
        }
        setStatusReason(stated);
        setOutcome({ kind: 'activation', activation });
      } catch (error) {
        fail(error);
      } finally {
        setSending(false);
      }
    })();
  };

  const readAgain = (): void => {
    if (statusReason === null || outcome?.kind !== 'activation') {
      return;
    }
    const activationId = outcome.activation.activation_id;
    setSending(true);
    setFailure(null);
    void (async () => {
      try {
        const { activations } = await apiGet<{ activations: Activation[] }>('/v1/provider-activations', {
          reason: statusReason,
        });
        const found = activations.find((candidate) => candidate.activation_id === activationId);
        setOutcome(found === undefined ? { kind: 'gone' } : { kind: 'activation', activation: found });
      } catch (error) {
        fail(error);
      } finally {
        setSending(false);
      }
    })();
  };

  const reasonMessage =
    reasonError === 'short'
      ? messages.reasonShort(minReasonLength)
      : reasonError === 'long'
        ? messages.reasonLong(maxReasonLength)
        : reasonError === 'characters'
          ? messages.reasonCharacters
          : null;

  return (
    <Panel.Root>
      <form aria-label={messages.identityAccess} onSubmit={onSubmit} noValidate className={layout.column}>
        <Panel.Header>
          <Panel.Title>{messages.identityAccess}</Panel.Title>
          <Panel.Description>{messages.identityAccessExplained}</Panel.Description>
        </Panel.Header>

        <div className={fieldClasses.field}>
          <label htmlFor={ids.reason} className={fieldClasses.label}>
            {messages.reason}
          </label>
          <textarea
            id={ids.reason}
            className={fieldClasses.area}
            value={reason}
            required
            aria-invalid={submitted && reasonError !== null}
            aria-describedby={ids.reasonHint}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <p
            id={ids.reasonHint}
            className={submitted && reasonMessage !== null ? fieldClasses.error : fieldClasses.hint}
          >
            {submitted && reasonMessage !== null
              ? reasonMessage
              : messages.reasonHint(minReasonLength, maxReasonLength)}
          </p>
        </div>

        <div className={fieldClasses.field}>
          <label htmlFor={ids.duration} className={fieldClasses.label}>
            {messages.duration}
          </label>
          <input
            id={ids.duration}
            className={fieldClasses.input}
            type="number"
            min={1}
            max={max}
            step={1}
            value={duration}
            required
            aria-invalid={submitted && durationError}
            aria-describedby={ids.durationHint}
            onChange={(event) => {
              setDuration(event.target.value);
            }}
          />
          <p
            id={ids.durationHint}
            className={submitted && durationError ? fieldClasses.error : fieldClasses.hint}
          >
            {submitted && durationError ? messages.durationInvalid(max) : messages.durationHint(max)}
          </p>
        </div>

        {outcome === null ? null : <OutcomeNotice outcome={outcome} />}
        {failure === null ? null : (
          <Notice tone="danger" role="alert">
            <p>
              {failure.status === 0 || failure.status >= 500
                ? messages.dependencyUnavailable
                : failure.detail === null
                  ? messages.refused
                  : messages.refusedWith(failure.detail)}
              {failure.correlationId === null ? null : ` ${messages.correlation(failure.correlationId)}`}
            </p>
          </Notice>
        )}
        <div className={layout.actions}>
          <Button type="submit" disabled={sending}>
            <Icon name="shield" />
            {sending ? messages.requesting : messages.requestIdentityAccess}
          </Button>
          {outcome?.kind === 'activation' ? (
            <Button variant="secondary" disabled={sending} onClick={readAgain}>
              {messages.identityAccessRead}
            </Button>
          ) : null}
        </div>
      </form>
    </Panel.Root>
  );
}
