// Ported from identity-experience at f5424f0ea78dae6db7096f457b54c8894e275c67 (its pull request
// #66), packages/ui/src/system/icon/Icon.tsx. TDD-organization-experience-001 §Visual Language
// records the copy; the paths after `arrow` are this repository's.
import type { ReactElement } from 'react';

// Icon renders one of a small, fixed set of line icons as inline SVG, in the brand's icon grammar:
// a 24-unit grid, a 1.8 stroke, round caps and joins, currentColor (scnehaux-design brand/Brand.html,
// Icons). The platform publishes no icon set yet, so this one is local (TDD-organization-experience-001
// §Visual Language). Inline, so nothing is fetched and the content security policy needs no image
// source; fixed, so an icon name is a type, not a string someone mistypes.
//
// Icons are decorative by default and hidden from assistive technology. The label that sits
// beside an icon carries its meaning, which is what STD-GLB-FE-009 asks of anything that conveys
// state.

const paths = {
  shield: 'M12 3 5 6v5c0 4.4 3 8.4 7 9.5 4-1.1 7-5.1 7-9.5V6l-7-3Z',
  key: 'M14.5 4a5.5 5.5 0 0 0-5.2 7.3L4 16.6V20h3.4l.6-.6V18h1.5l.6-.6V16h1.5l1.1-1.1A5.5 5.5 0 1 0 14.5 4Zm1.5 5.2a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z',
  pulse: 'M3 12h4l2.5-6 5 12 2.5-6H21',
  users:
    'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm10 8v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  alert:
    'M12 8v5m0 3.5v.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z',
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2-1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  globe:
    'M12 21a9 9 0 1 0 0-18m0 18a9 9 0 0 1 0-18m0 18c2.5-2.4 3.8-5.4 3.8-9S14.5 5.4 12 3m0 18c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3M3.5 9h17m-17 6h17',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  building: 'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16m0-12h2a2 2 0 0 1 2 2v10M3 21h18M8 7h4m-4 4h4m-4 4h4',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  mail: 'M4 6h16v12H4V6Zm0 1 8 6 8-6',
  eye: 'M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  archive: 'M3 4h18v4H3V4Zm2 4v12h14V8m-9 4h4',
  inbox: 'M3 13h5l1.5 3h5l1.5-3h5M5.5 5h13L21 13v6H3v-6l2.5-8Z',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3m-5-3 5-5-5-5m5 5H4',
  review: 'M9 3h6v3H9V3Zm0 1.5H6V21h12V4.5h-3M9 13l2 2 4-4',
  info: 'M12 11v6m0-9.5v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, label }: { readonly name: IconName; readonly label?: string }): ReactElement {
  const labelled = label !== undefined;
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={labelled ? undefined : true}
      role={labelled ? 'img' : undefined}
      aria-label={label}
    >
      <path d={paths[name]} />
    </svg>
  );
}
