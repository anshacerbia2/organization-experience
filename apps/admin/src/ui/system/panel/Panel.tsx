// Ported from identity-experience at c723e417c0eee97db6b1d5b6dab608fe6a406ac2, packages/ui/src/system/panel/Panel.tsx
// (TDD-organization-experience-001 §Visual Language).
import type { ComponentPropsWithRef, ReactElement } from 'react';

import styles from './Panel.module.scss';

// Panel is the application's surface: a translucent card over the canvas. It is a compound
// component (STD-GLB-FE-006): Panel.Root holds Panel.Header, Panel.Title, Panel.Description and
// Panel.Body, and each renders the element its meaning calls for.

const join = (...names: readonly (string | undefined)[]): string => names.filter(Boolean).join(' ');

type Elevation = 'raised' | 'floating';

function Root({
  className,
  elevation = 'raised',
  ...rest
}: ComponentPropsWithRef<'section'> & { readonly elevation?: Elevation }): ReactElement {
  return <section {...rest} className={join(styles['root'], className)} data-elevation={elevation} />;
}

function Header({ className, ...rest }: ComponentPropsWithRef<'header'>): ReactElement {
  return <header {...rest} className={join(styles['header'], className)} />;
}

// level is this repository's addition: a page here is headed by an h2 under the application's h1, so
// a panel inside it is headed by an h3.
function Title({
  className,
  children,
  level = 2,
  ...rest
}: ComponentPropsWithRef<'h2'> & { readonly level?: 2 | 3 | 4 }): ReactElement {
  const Heading = level === 2 ? 'h2' : level === 3 ? 'h3' : 'h4';
  return (
    <Heading {...rest} className={join(styles['title'], className)}>
      {children}
    </Heading>
  );
}

function Description({ className, ...rest }: ComponentPropsWithRef<'p'>): ReactElement {
  return <p {...rest} className={join(styles['description'], className)} />;
}

function Body({ className, ...rest }: ComponentPropsWithRef<'div'>): ReactElement {
  return <div {...rest} className={join(styles['body'], className)} />;
}

export const Panel = { Root, Header, Title, Description, Body };
