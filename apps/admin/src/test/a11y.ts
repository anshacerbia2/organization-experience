import { axe } from 'vitest-axe';

// The automated WCAG check (SAD-012 §9.3.2: an accessibility regression is a CI hard block for the
// defined automated checks). It runs axe-core's rules for WCAG 2.0, 2.1 and 2.2 at levels A and AA,
// and nothing else, so a failure is a conformance failure rather than a best-practice preference.
//
// jsdom lays nothing out. The rules that need rendering, colour contrast and WCAG 2.2's target size
// among them, come back incomplete here rather than passing, which is why this is not conformance
// evidence on its own (TDD-organization-experience-001 1.4.0 §Accessibility).
export const wcagAA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export const checkWcag = (container: Element) => axe(container, { runOnly: { type: 'tag', values: wcagAA } });
