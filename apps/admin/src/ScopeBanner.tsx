import { useEffect, useState, type ReactElement } from 'react';

import { messages } from './messages';
import { remaining, type Scope } from './scope';
import { useScope } from './ScopeContext';

// ScopeBanner names the active scope, the Tenants it reaches and the time left, on every view
// (TDD-organization-experience-001 §Scope Visibility). It has no control to dismiss, collapse or
// hide it, and it stays in place while the page scrolls.

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

function describe(scope: Scope, now: number): { tone: 'tenant' | 'provider' | 'idle'; text: string } {
  if (scope.scope === 'tenant') {
    return { tone: 'tenant', text: `${messages.tenantScope}: ${scope.tenantId}` };
  }
  const window = scope.window;
  if (window === null) {
    return { tone: 'idle', text: messages.providerSignedIn };
  }
  if (window.state === 'pending' || window.endsAt === null) {
    return {
      tone: 'provider',
      text: `${messages.providerPending}. ${messages.providerTargets}: ${targetsOf(window.tenants)}`,
    };
  }
  return {
    tone: 'provider',
    text: `${messages.providerActive}${window.emergency ? ` ${messages.emergencyGrant}` : ''}. ${messages.providerTargets}: ${targetsOf(window.tenants)}. ${messages.endsIn} ${remaining(window.endsAt, now)}`,
  };
}

export function ScopeBanner(): ReactElement {
  const { state } = useScope();
  const counting =
    state.status === 'ready' && state.scope.scope === 'provider' && state.scope.window?.state === 'in-force';
  const now = useNow(1000, counting);
  let tone: 'tenant' | 'provider' | 'idle' | 'warning' = 'warning';
  let text: string = messages.scopeLoading;
  if (state.status === 'ready') {
    ({ tone, text } = describe(state.scope, now));
  } else if (state.status === 'unavailable') {
    text = messages.scopeUnavailable;
  } else if (state.status === 'ambiguous') {
    text = messages.scopeAmbiguous;
  }
  return (
    <section
      aria-label={messages.scopeRegion}
      className={`scope-banner scope-banner--${tone}`}
      data-scope={tone}
    >
      <p>{text}</p>
    </section>
  );
}
