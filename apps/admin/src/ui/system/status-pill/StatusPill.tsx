// Copied from identity-experience at f5424f0ea78dae6db7096f457b54c8894e275c67 (its pull request
// #66), packages/ui/src/system/status-pill/StatusPill.tsx. TDD-organization-experience-001 §Visual
// Language records the copy.
import { Badge, type BadgeScheme } from '@scnx/system/components/badge';
import type { ReactElement, ReactNode } from 'react';

import styles from './StatusPill.module.scss';
import { Icon, type IconName } from '../icon/Icon';

// StatusPill is the platform's Badge with a glyph before the word. STD-GLB-FE-009 forbids
// colour-only meaning, and in this product a status is often a security fact: "blocked" must read as
// blocked to someone who cannot tell one colour from another. The Badge's own dot is the same for
// every scheme, so the glyph, one per tone, stays.

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const glyphs: Record<StatusTone, IconName> = {
  neutral: 'clock',
  info: 'pulse',
  success: 'check',
  warning: 'alert',
  danger: 'alert',
};

const schemes: Record<StatusTone, BadgeScheme> = {
  neutral: 'neutral',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

export function StatusPill({
  tone,
  children,
}: {
  readonly tone: StatusTone;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Badge scheme={schemes[tone]} className={styles['root'] ?? ''} data-tone={tone}>
      <span className={styles['glyph']}>
        <Icon name={glyphs[tone]} />
      </span>
      {children}
    </Badge>
  );
}
