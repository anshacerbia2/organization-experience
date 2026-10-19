import { Link } from '@tanstack/react-router';
import type { ReactElement, ReactNode } from 'react';

import styles from './AppFrame.module.scss';
import { messages } from '../../messages';
import { Icon } from '../system/icon/Icon';

// The classes the application's navigation uses inside the frame's rail: a group, its label, its list,
// and an item whose aria-current marks the page.
export const navClasses = {
  nav: styles['nav'],
  group: styles['navGroup'],
  section: styles['navSection'],
  list: styles['navList'],
  item: styles['navItem'],
  icon: styles['navIcon'],
} as const;

// AppFrame is identity-experience's frame (packages/app-core/src/shell/AppFrame.tsx at
// c723e417c0eee97db6b1d5b6dab608fe6a406ac2): a navigation rail, a top bar, and the page. This
// repository's changes: the bar holds the application's heading and the session, and the scope banner
// sits under it, the two sticking together so the banner never scrolls away
// (TDD-organization-experience-001 §Scope Visibility).
export function AppFrame({
  title,
  nav,
  session,
  banner,
  children,
}: {
  readonly title: ReactNode;
  readonly nav: ReactNode;
  readonly session: ReactNode;
  readonly banner: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className={styles['root']}>
      <a className={styles['skip']} href="#main">
        {messages.skipToContent}
      </a>

      <aside className={styles['rail']}>
        <div className={styles['railInner']}>
          <Link to="/" className={styles['brand']} activeProps={{ 'aria-current': undefined }}>
            <span className={styles['brandMark']} aria-hidden="true">
              <Icon name="shield" />
            </span>
            <span className={styles['brandName']}>{messages.brand}</span>
          </Link>
          {nav}
        </div>
      </aside>

      <div className={styles['column']}>
        <div className={styles['top']}>
          <header className={styles['bar']}>
            <h1 className={styles['title']}>{title}</h1>
            <div className={styles['barEnd']}>{session}</div>
          </header>
          {banner}
        </div>

        <main id="main" className={styles['main']} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
