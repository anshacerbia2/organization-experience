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
import { Button, fieldClasses, Icon, layout, Notice, Panel } from './ui';

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
      <Notice tone="warning" icon="shield" role="alert">
        <p>
          {messages.stepUpNeeded} <a href={providerSignInHref(returnTo)}>{messages.stepUpAction}</a>
        </p>
      </Notice>
    );
  }
  if (refusal.kind === 'unavailable') {
    return (
      <Notice tone="danger" role="alert">
        <p>{messages.dependencyUnavailable}</p>
      </Notice>
    );
  }
  return (
    <Notice tone="danger" role="alert">
      <p>
        {refusal.detail === null ? messages.refused : messages.refusedWith(refusal.detail)}
        {refusal.correlationId === null ? null : ` ${messages.correlation(refusal.correlationId)}`}
      </p>
    </Notice>
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
    <Panel.Root>
      <form aria-label={messages.enterProviderMode} onSubmit={onSubmit} noValidate className={layout.column}>
        <Panel.Header>
          <Panel.Title>{messages.enterProviderMode}</Panel.Title>
          <Panel.Description>{messages.providerModeExplained}</Panel.Description>
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

        <fieldset className={fieldClasses.fieldset}>
          <legend className={fieldClasses.legend}>{messages.targets}</legend>
          <label className={fieldClasses.choice}>
            <input
              type="radio"
              name="targets"
              className={fieldClasses.choiceInput}
              checked={targets === 'named'}
              onChange={() => {
                setTargets('named');
              }}
            />
            {messages.targetsNamed}
          </label>
          <label className={fieldClasses.choice}>
            <input
              type="radio"
              name="targets"
              className={fieldClasses.choiceInput}
              checked={targets === 'all'}
              onChange={() => {
                setTargets('all');
              }}
            />
            {messages.targetsAll}
          </label>
          {targets === 'named' ? (
            <div className={fieldClasses.field}>
              <label htmlFor={ids.list} className={fieldClasses.label}>
                {messages.targetsList}
              </label>
              <textarea
                id={ids.list}
                className={fieldClasses.area}
                value={list}
                spellCheck={false}
                aria-invalid={submitted && targetsError}
                onChange={(event) => {
                  setList(event.target.value);
                }}
              />
              {submitted && targetsError ? (
                <p role="alert" className={fieldClasses.error}>
                  {messages.targetsInvalid}
                </p>
              ) : null}
            </div>
          ) : null}
        </fieldset>

        {refusal === null ? null : <RefusalMessage refusal={refusal} returnTo={returnTo} />}
        <div className={layout.actions}>
          <Button type="submit" disabled={sending}>
            <Icon name="shield" />
            {sending ? messages.requesting : messages.requestProviderMode}
          </Button>
        </div>
      </form>
    </Panel.Root>
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
    <div className={layout.stack}>
      <div className={layout.actions}>
        <Button variant="secondary" disabled={leaving} onClick={onLeave}>
          <Icon name="logout" />
          {pending ? messages.withdrawRequest : messages.leaveProviderMode}
        </Button>
      </div>
      {unconfirmed ? (
        <Notice tone="warning" role="alert">
          <p>{messages.leaveUnconfirmed}</p>
        </Notice>
      ) : null}
    </div>
  );
}

// ProviderClosed says once why a window closed without the operator leaving it. The overview shows it
// too, since the window may close while the operator is there.
export function ProviderClosed({ scope }: { readonly scope: ProviderScope }): ReactElement | null {
  if (scope.closed === undefined) {
    return null;
  }
  return (
    <Notice tone={scope.closed === 'ended' ? 'info' : 'warning'} role="status">
      <p>{messages.providerClosed[scope.closed]}</p>
    </Notice>
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
      <ProviderClosed scope={scope} />
      {scope.window === null ? (
        <ProviderModeForm scope={scope} csrfToken={csrfToken} returnTo={returnTo} />
      ) : (
        <LeaveProviderMode pending={scope.window.state === 'pending'} csrfToken={csrfToken} />
      )}
    </>
  );
}
