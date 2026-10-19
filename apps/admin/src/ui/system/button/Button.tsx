// Ported from identity-experience at c723e417c0eee97db6b1d5b6dab608fe6a406ac2, packages/ui/src/system/button/Button.tsx
// (TDD-organization-experience-001 §Visual Language).
import type { ReactElement, ReactNode } from 'react';

import styles from './Button.module.scss';
import { ButtonBase, type ButtonBaseProps } from '../../primitives/button-base/ButtonBase';

// Button is the styled button, mirroring `@scnx/system/button`: it wraps ButtonBase and exposes
// its variant as data-variant, which the stylesheet binds to.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export type ButtonProps = ButtonBaseProps & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  // icon is decorative: the label carries the meaning, so the icon is hidden from assistive
  // technology.
  readonly icon?: ReactNode;
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: ButtonProps): ReactElement {
  const classes = [styles['root'], className].filter(Boolean).join(' ');
  const content = (
    <>
      {icon === undefined ? null : (
        <span className={styles['icon']} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={styles['label']}>{children}</span>
    </>
  );
  return (
    <ButtonBase {...rest} className={classes} data-variant={variant} data-size={size}>
      {content}
    </ButtonBase>
  );
}
