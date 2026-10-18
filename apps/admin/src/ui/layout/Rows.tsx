import { Fragment, type ComponentPropsWithRef, type ReactElement, type ReactNode } from 'react';

import styles from './Rows.module.scss';
import { messages } from '../../messages';
import { Icon } from '../system/icon/Icon';
import { StatusPill, type StatusTone } from '../system/status-pill/StatusPill';

// A list of records read as the rows of a table (Rows.module.scss). Rows is the <ul>, Row an <li>,
// RowMain the head that names the record, and Facts the facts after it. Nothing here adds a word: the
// text a row reads is the text it read before its styling, so a screen reader and a test find it the
// same.

const join = (...names: readonly (string | undefined)[]): string => names.filter(Boolean).join(' ');

export const rowClasses = {
  title: styles['title'],
  select: styles['select'],
  action: styles['action'],
  note: styles['note'],
} as const;

export function Rows({ className, ...rest }: ComponentPropsWithRef<'ul'>): ReactElement {
  return <ul {...rest} className={join(styles['list'], className)} />;
}

export function Row({ className, ...rest }: ComponentPropsWithRef<'li'>): ReactElement {
  return <li {...rest} className={join(styles['row'], className)} />;
}

export function RowMain({ className, ...rest }: ComponentPropsWithRef<'div'>): ReactElement {
  return <div {...rest} className={join(styles['main'], className)} />;
}

export function RowTitle({
  mono = false,
  children,
}: {
  readonly mono?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <strong className={styles['title']} data-mono={mono || undefined}>
      {children}
    </strong>
  );
}

// A status among a row's facts: its words, shown as a pill of the tone the status calls for.
export interface StatusFact {
  readonly status: string;
  readonly label: string;
}

const tones: Readonly<Record<string, StatusTone>> = {
  active: 'success',
  accepted: 'success',
  completed: 'success',
  enforced: 'success',
  appropriate: 'success',
  realized: 'success',
  pending: 'info',
  identity_verified: 'info',
  requested: 'info',
  provisioning: 'info',
  propagating: 'info',
  suspended: 'warning',
  offboarding: 'warning',
  archived: 'neutral',
  waived: 'neutral',
  expired: 'neutral',
  retired: 'neutral',
  cancelled: 'neutral',
  revoked: 'danger',
  failed: 'danger',
  overdue: 'danger',
  over_budget: 'danger',
  escalated: 'danger',
  unresolved: 'danger',
};

export const toneOf = (status: string): StatusTone => tones[status] ?? 'neutral';

export type Fact = string | StatusFact | null | undefined;

// Facts lays out a row's facts with the catalogue's separator between them, leaving out any that are
// absent: the same words, in the same order, as the facts() string it replaces.
export function Facts({ items }: { readonly items: readonly Fact[] }): ReactElement {
  const present = items.filter(
    (item): item is string | StatusFact => item !== null && item !== undefined && item !== '',
  );
  return (
    <span className={styles['facts']}>
      {present.map((item, index) => {
        const text = typeof item === 'string' ? item : item.label;
        return (
          <Fragment key={text}>
            {index === 0 ? null : <span className={styles['separator']}>{messages.separator}</span>}
            {typeof item === 'string' ? (
              <span>{item}</span>
            ) : (
              <StatusPill tone={toneOf(item.status)}>{item.label}</StatusPill>
            )}
          </Fragment>
        );
      })}
    </span>
  );
}

export function EmptyState({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <div className={styles['state']}>
      <span className={styles['stateIcon']}>
        <Icon name="inbox" />
      </span>
      <p>{children}</p>
    </div>
  );
}

export function Loading(): ReactElement {
  return (
    <div className={styles['state']}>
      <p>{messages.loading}</p>
      <span className={styles['skeleton']} aria-hidden="true">
        <span className={styles['bar']} />
        <span className={styles['bar']} />
        <span className={styles['bar']} />
      </span>
    </div>
  );
}
