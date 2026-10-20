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
  // The one-line summary on a small viewport: the scope's kind and what it reaches, short.
  readonly kind: string;
  readonly target?: string;
}

const countOf = (tenants: 'all' | readonly string[]): string =>
  tenants === 'all' ? messages.everyTenant : messages.lineTenantCount(tenants.length);

function describe(scope: Scope, now: number): Said {
  if (scope.scope === 'tenant') {
    return {
      tone: 'tenant',
      lead: messages.tenantScope,
      rest: `: ${scope.tenantId}`,
      kind: messages.tenantScope,
      target: scope.tenantId,
    };
  }
  const window = scope.window;
  if (window === null) {
    return { tone: 'idle', lead: messages.providerSignedIn, kind: messages.lineNoTenant };
  }
  if (window.state === 'pending' || window.endsAt === null) {
    return {
      tone: 'provider',
      lead: messages.providerPending,
      rest: `. ${messages.providerTargets}: ${targetsOf(window.tenants)}`,
      kind: messages.lineProviderPending,
      target: countOf(window.tenants),
    };
  }
  return {
    tone: 'provider',
    lead: `${messages.providerActive}${window.emergency ? ` ${messages.emergencyGrant}` : ''}`,
    rest: `. ${messages.providerTargets}: ${targetsOf(window.tenants)}. `,
    endsIn: remaining(window.endsAt, now),
    kind: messages.providerActive,
    target: countOf(window.tenants),
  };
}

const glyphs: Readonly<Record<Tone, IconName>> = {
  tenant: 'building',
  provider: 'shield',
  idle: 'key',
  warning: 'alert',
};

function useSaid(): Said {
  const { state } = useScope();
  const counting =
    state.status === 'ready' && state.scope.scope === 'provider' && state.scope.window?.state === 'in-force';
  const now = useNow(1000, counting);
  if (state.status === 'ready') {
    return describe(state.scope, now);
  }
  if (state.status === 'unavailable') {
    return { tone: 'warning', lead: messages.scopeUnavailable, kind: messages.lineScopeUnknown };
  }
  if (state.status === 'ambiguous') {
    return { tone: 'warning', lead: messages.scopeAmbiguous, kind: messages.lineScopeUnknown };
  }
  return { tone: 'warning', lead: messages.scopeLoading, kind: messages.lineScopeUnknown };
}

// ScopeLine is the scope on one line, sticky on a small viewport, where the bar and the banner scroll
// with the page (TDD-organization-experience-001 1.12.0, SAD-012 1.4.0 §8.4, STD-GLB-FE-005 2.2.0
// §3.10): the kind, the Tenant or how many a window reaches, and the time left. Nothing in it wraps; the
// kind and the target end in an ellipsis, and the time left never shrinks. It repeats the banner, which
// stays in the page with every word, so it is hidden from assistive technology and the scope is read
// once, from the banner's region.
export function ScopeLine(): ReactElement {
  const said = useSaid();
  return (
    <div className={styles['line']} data-scope={said.tone} aria-hidden="true">
      <span className={styles['glyph']}>
        <Icon name={glyphs[said.tone]} />
      </span>
      <span className={styles['lineText']}>
        <strong className={styles['lead']}>{said.kind}</strong>
        {said.target === undefined ? null : `${messages.separator}${said.target}`}
      </span>
      {said.endsIn === undefined ? null : <span className={styles['countdown']}>{said.endsIn}</span>}
    </div>
  );
}

export function ScopeBanner(): ReactElement {
  const said = useSaid();
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
