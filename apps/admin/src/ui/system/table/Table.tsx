// Ported from identity-experience at f5424f0ea78dae6db7096f457b54c8894e275c67 (its pull request
// #66), packages/ui/src/system/table/Table.tsx. TDD-organization-experience-001 §Visual Language
// records the copy; the hidden caption takes `scnx-org-visually-hidden`.
import { Table as SystemTable, type TableCellProps } from '@scnx/system/components/table';
import { useId, type ComponentPropsWithRef, type ReactElement, type ReactNode } from 'react';

import styles from './Table.module.scss';

// Table is the platform's Table, composed into a named, keyboard-reachable region. A compound
// component (STD-GLB-FE-006): Table.Root holds Table.Head and Table.Body, which hold Table.Row, which
// holds Table.HeaderCell and Table.Cell. The platform's parts are used as they ship, with two
// compositions:
//
// - Root requires a caption and wraps the table in a region that scrolls a table wider than the
//   screen, takes focus and is named by the caption. A region that scrolls must be reachable by
//   keyboard (WCAG 2.1.1); the platform's frame scrolls but takes no focus and no name.
// - Cell takes `mono`, which sets an identifier or a figure in the mono face on one line, so it
//   aligns and reads as one value.

const join = (...names: readonly (string | false | undefined)[]): string => names.filter(Boolean).join(' ');

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
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be keyboard-focusable
    <div className={styles['scroll']} role="region" aria-labelledby={captionId} tabIndex={0}>
      <SystemTable {...rest} className={className}>
        <SystemTable.Caption
          id={captionId}
          className={captionHidden ? 'scnx-org-visually-hidden' : undefined}
        >
          {caption}
        </SystemTable.Caption>
        {children}
      </SystemTable>
    </div>
  );
}

function Cell({
  className,
  mono = false,
  ...rest
}: TableCellProps & {
  // mono sets identifiers and figures in the mono face, so they align and read unambiguously.
  readonly mono?: boolean;
}): ReactElement {
  return (
    <SystemTable.Cell
      {...rest}
      className={join(mono && styles['mono'], className)}
      data-mono={mono || undefined}
    />
  );
}

export const Table = {
  Root,
  Head: SystemTable.Head,
  Body: SystemTable.Body,
  Row: SystemTable.Row,
  HeaderCell: SystemTable.HeaderCell,
  Cell,
};
