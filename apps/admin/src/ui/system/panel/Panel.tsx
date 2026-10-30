// Ported from identity-experience at f5424f0ea78dae6db7096f457b54c8894e275c67 (its pull request
// #66), packages/ui/src/system/panel/Panel.tsx. TDD-organization-experience-001 §Visual Language
// records the copy; `Panel.Title` takes a heading level here.
import { Surface } from '@scnx/system/components/surface';
import type { ComponentPropsWithRef, ReactElement } from 'react';

import styles from './Panel.module.scss';

// Panel is a section of a page on the platform's Surface, in the `panel` material: in scnx-platform
// a 1px line and no radius. It composes Surface into the compound the applications use
// (STD-GLB-FE-006): Panel.Root holds Panel.Header, Panel.Title, Panel.Description and Panel.Body, and
// each renders the element its meaning calls for. Surface is one element; the parts are this file's.

const join = (...names: readonly (string | undefined)[]): string => names.filter(Boolean).join(' ');

// raised is a section of the page; floating is what is raised above one (a confirmation, a result),
// the platform's `raised` material.
type Elevation = 'raised' | 'floating';

function Root({
  className,
  elevation = 'raised',
  ...rest
}: ComponentPropsWithRef<'section'> & { readonly elevation?: Elevation }): ReactElement {
  return (
    <Surface
      {...rest}
      as="section"
      material={elevation === 'floating' ? 'raised' : 'panel'}
      className={join(styles['root'], className)}
      data-elevation={elevation}
    />
  );
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
