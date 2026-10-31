import type { ReactElement, ReactNode } from 'react';

import { messages } from './messages';
import shellStyles from './Shell.module.scss';
import { BrandMark, Panel, ThemeToggle } from './ui';

// Gate is the canvas a page stands on alone, outside the administration frame: one floating panel,
// the brand above it, as identity-kernel's hosted login draws its card in the same tokens
// (TDD-identity-kernel-004 §Visual Language). The signed-out entry stands on it, and so does the
// invitation acceptance page, whose visitor is often no administrator (TDD-organization-experience-002
// 1.8.0).
export function Gate({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div className={shellStyles['gate']}>
      <div className={shellStyles['gateTheme']}>
        <ThemeToggle />
      </div>
      <main className={shellStyles['gateMain']}>
        <div className={shellStyles['gateBrand']}>
          <BrandMark className={shellStyles['gateMark']} />
          <span className={shellStyles['gateBrandName']}>{messages.brand}</span>
        </div>
        <Panel.Root elevation="floating">
          <Panel.Header>
            <h1 className={shellStyles['gateTitle']}>{title}</h1>
            {description === undefined ? null : <Panel.Description>{description}</Panel.Description>}
          </Panel.Header>
          {children}
        </Panel.Root>
      </main>
    </div>
  );
}

export const gateClasses = {
  body: shellStyles['gateBody'],
  entry: shellStyles['gateEntry'],
  lead: shellStyles['gateLead'],
  provider: shellStyles['gateProvider'],
} as const;
