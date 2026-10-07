import { useId, useState, type ReactElement, type SyntheticEvent } from 'react';

import { messages } from './messages';
import {
  leaveProviderMode,
  maxReasonLength,
  minReasonLength,
  normalizeReason,
  openProviderMode,
  reasonProblem,
  type Refusal,
  type Scope,
} from './scope';
import { useScope } from './ScopeContext';
import { providerSignInHref, tenantPattern } from './session';

// ProviderModeGate is the entry ceremony (TDD-organization-experience-001 1.2.0 §Provider Mode
// Entry): the reason, the duration and the Tenants are stated before anything opens, and the BFF
// asks for a fresh sign-in first when the last one is not recent. Once a window exists it offers
// the one action that applies: withdraw it while it awaits approval, or leave it.

type ProviderScope = Extract<Scope, { scope: 'provider' }>;

const tenantLine = new RegExp(`^${tenantPattern}$`);

function RefusalMessage({
  refusal,
  returnTo,
}: {
  readonly refusal: Refusal;
  readonly returnTo: string;
}): ReactElement {
  if (refusal.kind === 'step-up') {
    return (
      <p role="alert">
        {messages.stepUpNeeded} <a href={providerSignInHref(returnTo)}>{messages.stepUpAction}</a>
      </p>
    );
  }
  if (refusal.kind === 'unavailable') {
    return <p role="alert">{messages.dependencyUnavailable}</p>;
  }
  return (
    <p role="alert">
      {refusal.detail === null ? messages.refused : messages.refusedWith(refusal.detail)}
      {refusal.correlationId === null ? null : ` ${messages.correlation(refusal.correlationId)}`}
    </p>
  );
}

function ProviderModeForm({
  scope,
  csrfToken,
  returnTo,
}: {
  readonly scope: ProviderScope;
  readonly csrfToken: string;
  readonly returnTo: string;
}): ReactElement {
  const { reload } = useScope();
  const ids = {
    reason: useId(),
    reasonHint: useId(),
    duration: useId(),
    durationHint: useId(),
    list: useId(),
  };
  const max = scope.limits.maxDurationMinutes;
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState(String(scope.limits.defaultDurationMinutes));
  const [targets, setTargets] = useState<'named' | 'all'>('named');
  const [list, setList] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const reasonError = reasonProblem(reason);
  const minutes = Number(duration);
  const durationError = !Number.isInteger(minutes) || minutes < 1 || minutes > max;
  const named = list.split(/\s+/).filter((line) => line !== '');
  const targetsError =
    targets === 'named' && (named.length === 0 || !named.every((line) => tenantLine.test(line)));

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmitted(true);
    if (reasonError !== null || durationError || targetsError) {
      return;
    }
    setSending(true);
    setRefusal(null);
    openProviderMode(csrfToken, {
      reason: normalizeReason(reason),
      durationMinutes: minutes,
      tenants: targets === 'all' ? 'all' : named,
    })
      .then((result) => {
        if (result === null) {
          reload();
        } else {
          setRefusal(result);
        }
      })
      .catch(() => {
        setRefusal({ kind: 'unavailable' });
      })
      .finally(() => {
        setSending(false);
      });
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
    <form aria-label={messages.enterProviderMode} onSubmit={onSubmit} noValidate>
      <h2>{messages.enterProviderMode}</h2>
      <p>{messages.providerModeExplained}</p>

      <label htmlFor={ids.reason}>{messages.reason}</label>
      <textarea
        id={ids.reason}
        value={reason}
        required
        aria-invalid={submitted && reasonError !== null}
        aria-describedby={ids.reasonHint}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      <p id={ids.reasonHint}>
        {submitted && reasonMessage !== null
          ? reasonMessage
          : messages.reasonHint(minReasonLength, maxReasonLength)}
      </p>

      <label htmlFor={ids.duration}>{messages.duration}</label>
      <input
        id={ids.duration}
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
      <p id={ids.durationHint}>
        {submitted && durationError ? messages.durationInvalid(max) : messages.durationHint(max)}
      </p>

      <fieldset>
        <legend>{messages.targets}</legend>
        <label>
          <input
            type="radio"
            name="targets"
            checked={targets === 'named'}
            onChange={() => {
              setTargets('named');
            }}
          />
          {messages.targetsNamed}
        </label>
        <label>
          <input
            type="radio"
            name="targets"
            checked={targets === 'all'}
            onChange={() => {
              setTargets('all');
            }}
          />
          {messages.targetsAll}
        </label>
        {targets === 'named' ? (
          <>
            <label htmlFor={ids.list}>{messages.targetsList}</label>
            <textarea
              id={ids.list}
              value={list}
              spellCheck={false}
              aria-invalid={submitted && targetsError}
              onChange={(event) => {
                setList(event.target.value);
              }}
            />
            {submitted && targetsError ? <p role="alert">{messages.targetsInvalid}</p> : null}
          </>
        ) : null}
      </fieldset>

      {refusal === null ? null : <RefusalMessage refusal={refusal} returnTo={returnTo} />}
      <button type="submit" disabled={sending}>
        {sending ? messages.requesting : messages.requestProviderMode}
      </button>
    </form>
  );
}

function LeaveProviderMode({
  pending,
  csrfToken,
}: {
  readonly pending: boolean;
  readonly csrfToken: string;
}): ReactElement {
  const { reload } = useScope();
  const [leaving, setLeaving] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const onLeave = (): void => {
    setLeaving(true);
    leaveProviderMode(csrfToken)
      .then((refusal) => {
        setUnconfirmed(refusal !== null);
      })
      .catch(() => {
        setUnconfirmed(true);
      })
      .finally(() => {
        setLeaving(false);
        reload();
      });
  };
  return (
    <p>
      <button type="button" disabled={leaving} onClick={onLeave}>
        {pending ? messages.withdrawRequest : messages.leaveProviderMode}
      </button>
      {unconfirmed ? <span role="alert"> {messages.leaveUnconfirmed}</span> : null}
    </p>
  );
}

export function ProviderModeGate({
  scope,
  csrfToken,
  returnTo,
}: {
  readonly scope: ProviderScope;
  readonly csrfToken: string;
  readonly returnTo: string;
}): ReactElement {
  return (
    <>
      {scope.closed === undefined ? null : <p role="status">{messages.providerClosed[scope.closed]}</p>}
      {scope.window === null ? (
        <ProviderModeForm scope={scope} csrfToken={csrfToken} returnTo={returnTo} />
      ) : (
        <LeaveProviderMode pending={scope.window.state === 'pending'} csrfToken={csrfToken} />
      )}
    </>
  );
}
