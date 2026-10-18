import { useEffect, useState, type ReactElement } from 'react';

import { messages } from './messages';
import { remaining, type Scope } from './scope';
import styles from './ScopeBanner.module.scss';
import { useScope } from './ScopeContext';
import { Icon, type IconName } from './ui';

// ScopeBanner names the active scope, the Tenants it reaches and the time left, on every view
// (TDD-organization-experience-001 §Scope Visibility). It has no control to dismiss, collapse or
// hide it, and it stays in place while the page scrolls. It is drawn in the scheme of the scope it
// names: info for a Tenant, danger for provider mode, warning for a provider sign-in without it and
// for a scope that could not be read, each with its own glyph and words as well as its colour.

function useNow(intervalMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs, active]);
  return now;
}

const targetsOf = (tenants: 'all' | readonly string[]): string =>
  tenants === 'all' ? messages.everyTenant : tenants.join(', ');

type Tone = 'tenant' | 'provider' | 'idle' | 'warning';

// What the banner says, in parts: the scope (the words that lead), what it reaches, and the time
// left. Joined, they are the one sentence the banner has always read, word for word.
interface Said {
  readonly tone: Tone;
  readonly lead: string;
  readonly rest?: string;
  readonly endsIn?: string;
}

function describe(scope: Scope, now: number): Said {
  if (scope.scope === 'tenant') {
    return { tone: 'tenant', lead: messages.tenantScope, rest: `: ${scope.tenantId}` };
  }
  const window = scope.window;
  if (window === null) {
    return { tone: 'idle', lead: messages.providerSignedIn };
  }
  if (window.state === 'pending' || window.endsAt === null) {
    return {
      tone: 'provider',
      lead: messages.providerPending,
      rest: `. ${messages.providerTargets}: ${targetsOf(window.tenants)}`,
    };
  }
  return {
    tone: 'provider',
    lead: `${messages.providerActive}${window.emergency ? ` ${messages.emergencyGrant}` : ''}`,
    rest: `. ${messages.providerTargets}: ${targetsOf(window.tenants)}. `,
    endsIn: remaining(window.endsAt, now),
  };
}

const glyphs: Readonly<Record<Tone, IconName>> = {
  tenant: 'building',
  provider: 'shield',
  idle: 'key',
  warning: 'alert',
};

export function ScopeBanner(): ReactElement {
  const { state } = useScope();
  const counting =
    state.status === 'ready' && state.scope.scope === 'provider' && state.scope.window?.state === 'in-force';
  const now = useNow(1000, counting);
  let said: Said = { tone: 'warning', lead: messages.scopeLoading };
  if (state.status === 'ready') {
    said = describe(state.scope, now);
  } else if (state.status === 'unavailable') {
    said = { tone: 'warning', lead: messages.scopeUnavailable };
  } else if (state.status === 'ambiguous') {
    said = { tone: 'warning', lead: messages.scopeAmbiguous };
  }
  return (
    <section aria-label={messages.scopeRegion} className={styles['banner']} data-scope={said.tone}>
      <span className={styles['glyph']}>
        <Icon name={glyphs[said.tone]} />
      </span>
      <p className={styles['text']}>
        <strong className={styles['lead']}>{said.lead}</strong>
        {said.rest}
      </p>
      {said.endsIn === undefined ? null : (
        <p className={styles['ends']}>
          {messages.endsIn} <span className={styles['countdown']}>{said.endsIn}</span>
        </p>
      )}
    </section>
  );
}
