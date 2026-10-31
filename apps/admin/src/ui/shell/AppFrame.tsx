import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useMemo, useRef, type ReactElement, type ReactNode } from 'react';

import styles from './AppFrame.module.scss';
import { messages } from '../../messages';
import { PLATFORM_THEME } from '../preferences/ThemeRoot';

// The Scnehaux mark: two slanted bars, the upper one set right, in its own 21 × 9 box (scnehaux-design
// brand/Brand.html), in the ink role, so it is light on the dark mode and dark on the light one.
export function BrandMark({ className }: { readonly className?: string | undefined }): ReactElement {
  return (
    <svg className={className} viewBox="2 8 21 9" aria-hidden="true" focusable="false">
      <path d="M23 8L20 12L9 12L12 8ZM16 13L13 17L2 17L5 13Z" />
    </svg>
  );
}

// The classes the application's navigation uses inside the frame's rail: a group, its label, its list,
// and an item whose aria-current marks the page.
export const navClasses = {
  nav: styles['nav'],
  group: styles['navGroup'],
  section: styles['navSection'],
  list: styles['navList'],
  item: styles['navItem'],
} as const;

// The classes the session's cells take in the frame's bar: a cell around a control, who is signed in,
// and an action.
export const barClasses = {
  cell: styles['cell'],
  who: styles['who'],
  action: styles['action'],
} as const;

// AppFrame is identity-experience's frame (packages/app-core/src/shell/AppFrame.tsx at
// c723e417c0eee97db6b1d5b6dab608fe6a406ac2): a navigation rail, a top bar, and the page. This
// repository's changes: the bar holds the application's heading and the session, and the scope banner
// sits under it, the two sticking together so the banner never scrolls away
// (TDD-organization-experience-001 §Scope Visibility).
// useStickyInset sets the root's scroll-padding-top to the height of whichever region is sticky now,
// the bar with the banner, or the scope line on a small viewport, so an element scrolled into view by
// focus lands below it (WCAG technique C43, SC 2.4.11; TDD-organization-experience-001 1.12.0). It is
// measured as either changes size, and as the viewport moves between the two layouts.
function useStickyInset(regions: readonly { readonly current: HTMLElement | null }[]): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const update = (): void => {
      const sticky = regions
        .map((region) => region.current)
        .find((element) => element !== null && getComputedStyle(element).position === 'sticky');
      const height = sticky === undefined || sticky === null ? 0 : sticky.getBoundingClientRect().height;
      root.style.setProperty('scroll-padding-top', `${String(Math.ceil(height))}px`);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    for (const region of regions) {
      if (region.current !== null) {
        observer?.observe(region.current);
      }
    }
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      root.style.removeProperty('scroll-padding-top');
    };
  }, [regions]);
}

export function AppFrame({
  title,
  nav,
  session,
  banner,
  line,
  children,
}: {
  readonly title: ReactNode;
  readonly nav: ReactNode;
  readonly session: ReactNode;
  readonly banner: ReactNode;
  // line is the scope on one line, sticky in place of the bar and the banner on a small viewport.
  readonly line: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  const top = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const regions = useMemo(() => [top, lineRef], []);
  useStickyInset(regions);
  return (
    <div className={styles['root']}>
      <a className={styles['skip']} href="#main">
        {messages.skipToContent}
      </a>

      {/* The scope line is the frame's first row, so it is in view from the top of the page, above the
          rail, and sticks across the whole page on a small viewport (SAD-012 1.4.0 §8.4). */}
      <div className={styles['line']} ref={lineRef} data-sticky-region="line">
        {line}
      </div>

      <aside className={styles['rail']}>
        <div className={styles['railInner']}>
          <Link to="/" className={styles['brand']} activeProps={{ 'aria-current': undefined }}>
            <BrandMark className={styles['brandMark']} />
            <span className={styles['brandName']}>{messages.brand}</span>
          </Link>
          {nav}
        </div>
      </aside>

      <div className={styles['column']}>
        <div className={styles['top']} ref={top} data-sticky-region="top">
          <header className={styles['bar']}>
            <h1 className={styles['title']}>{title}</h1>
            <div className={styles['barEnd']}>{session}</div>
          </header>
          {banner}
        </div>

        <main id="main" className={styles['main']} tabIndex={-1}>
          {children}
        </main>

        {/* The page's title block, as a drawing's: what this console is and what holds it to account. */}
        <footer className={styles['titleBlock']}>
          <dl className={styles['titleCells']}>
            <div>
              <dt>{messages.titleBlockApplication}</dt>
              <dd>{messages.brand}</dd>
            </div>
            <div>
              <dt>{messages.titleBlockAuthority}</dt>
              <dd>{messages.titleBlockAuthorityValue}</dd>
            </div>
            <div>
              <dt>{messages.titleBlockSession}</dt>
              <dd>{messages.titleBlockSessionValue}</dd>
            </div>
            <div>
              <dt>{messages.titleBlockDrawing}</dt>
              <dd>{PLATFORM_THEME}</dd>
            </div>
          </dl>
        </footer>
      </div>
    </div>
  );
}
