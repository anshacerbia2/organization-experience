import type { ComponentPropsWithRef, ReactElement } from 'react';

import styles from './Notice.module.scss';
import { Icon, type IconName } from '../icon/Icon';

// Notice states a message beside the work it is about: a glyph and words on a tinted surface, never
// colour alone (STD-GLB-FE-009). It is identity-experience's sign-in notice and mutation error, one
// component here because this application states refusals, gates and states the same way. The role
// is the caller's: `alert` for what went wrong just now, `status` for a state to know about, none for
// standing guidance.

export type NoticeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const glyphs: Record<NoticeTone, IconName> = {
  neutral: 'info',
  info: 'info',
  success: 'check',
  warning: 'alert',
  danger: 'alert',
};

const join = (...names: readonly (string | undefined)[]): string => names.filter(Boolean).join(' ');

export function Notice({
  tone,
  icon,
  className,
  children,
  ...rest
}: ComponentPropsWithRef<'div'> & { readonly tone: NoticeTone; readonly icon?: IconName }): ReactElement {
  return (
    <div {...rest} className={join(styles['root'], className)} data-tone={tone}>
      <span className={styles['glyph']}>
        <Icon name={icon ?? glyphs[tone]} />
      </span>
      <div className={styles['text']}>{children}</div>
    </div>
  );
}
