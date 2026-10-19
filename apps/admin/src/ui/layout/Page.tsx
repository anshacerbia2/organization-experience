import type { ComponentPropsWithRef, ReactElement } from 'react';

import styles from './Page.module.scss';

// The shared shape of a surface: Page holds a header (its h2 and lead), then its panels. The classes
// are exported for the forms, toolbars and action rows inside it.

const join = (...names: readonly (string | undefined)[]): string => names.filter(Boolean).join(' ');

export const layout = {
  stack: styles['stack'],
  cards: styles['cards'],
  form: styles['form'],
  formWide: styles['formWide'],
  column: styles['column'],
  toolbar: styles['toolbar'],
  actions: styles['actions'],
  subtitle: styles['subtitle'],
  lead: styles['lead'],
  token: styles['token'],
  confirm: styles['confirm'],
} as const;

export function Page({ className, ...rest }: ComponentPropsWithRef<'section'>): ReactElement {
  return <section {...rest} className={join(styles['page'], className)} />;
}

export function PageHeader({ className, ...rest }: ComponentPropsWithRef<'header'>): ReactElement {
  return <header {...rest} className={join(styles['header'], className)} />;
}

export function PageTitle({ className, children, ...rest }: ComponentPropsWithRef<'h2'>): ReactElement {
  return (
    <h2 {...rest} className={join(styles['title'], className)}>
      {children}
    </h2>
  );
}
