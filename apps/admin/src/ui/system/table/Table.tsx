// Ported from identity-experience at c723e417c0eee97db6b1d5b6dab608fe6a406ac2, packages/ui/src/system/table/Table.tsx
// (TDD-organization-experience-001 §Visual Language).
import { useId, type ComponentPropsWithRef, type ReactElement, type ReactNode } from 'react';

import styles from './Table.module.scss';

// Table is a data table: a real <table>, with a caption that names it, header cells scoped to their
// column, and a container that scrolls sideways on a narrow screen rather than squeezing columns.
// A compound component (STD-GLB-FE-006): Table.Root holds Table.Head and Table.Body, which hold
// Table.Row, which holds Table.HeaderCell and Table.Cell.

const join = (...names: readonly (string | undefined)[]): string => names.filter(Boolean).join(' ');

type Align = 'start' | 'end';

function Root({
  caption,
  captionHidden = false,
  className,
  children,
  ...rest
}: ComponentPropsWithRef<'table'> & {
  // caption names the table for assistive technology. It is required: an unnamed table is a grid
  // of values with no subject.
  readonly caption: ReactNode;
  // captionHidden keeps the caption for assistive technology when a visible heading already names
  // the table.
  readonly captionHidden?: boolean;
}): ReactElement {
  const captionId = useId();
  return (
    // The container scrolls when the table is wider than the screen. A region that scrolls must be
    // reachable by keyboard (WCAG 2.1.1), so it takes focus and is named by the caption.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be keyboard-focusable
    <div className={styles['scroll']} role="region" aria-labelledby={captionId} tabIndex={0}>
      <table {...rest} className={join(styles['table'], className)}>
        <caption id={captionId} className={captionHidden ? 'scnx-org-visually-hidden' : styles['caption']}>
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

function Head({ className, ...rest }: ComponentPropsWithRef<'thead'>): ReactElement {
  return <thead {...rest} className={join(styles['head'], className)} />;
}

function Body({ className, ...rest }: ComponentPropsWithRef<'tbody'>): ReactElement {
  return <tbody {...rest} className={join(styles['body'], className)} />;
}

function Row({ className, ...rest }: ComponentPropsWithRef<'tr'>): ReactElement {
  return <tr {...rest} className={join(styles['row'], className)} />;
}

function HeaderCell({
  className,
  align = 'start',
  children,
  ...rest
}: Omit<ComponentPropsWithRef<'th'>, 'align'> & { readonly align?: Align }): ReactElement {
  return (
    <th scope="col" {...rest} className={join(styles['headerCell'], className)} data-align={align}>
      {children}
    </th>
  );
}

function Cell({
  className,
  align = 'start',
  mono = false,
  ...rest
}: Omit<ComponentPropsWithRef<'td'>, 'align'> & {
  // align replaces HTML's obsolete align attribute with a logical one: end is right in English and
  // left in a right-to-left language.
  readonly align?: Align;
  // mono sets identifiers and figures in the monospace face, so they align and read unambiguously.
  readonly mono?: boolean;
}): ReactElement {
  return (
    <td
      {...rest}
      className={join(styles['cell'], className)}
      data-align={align}
      data-mono={mono || undefined}
    />
  );
}

export const Table = { Root, Head, Body, Row, HeaderCell, Cell };
