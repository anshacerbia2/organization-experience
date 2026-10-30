// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { PLATFORM_THEME } from '../preferences/ThemeRoot';
import { colour, hex, oklch, over, ratio, schemes, type Scheme } from '../test/contrast';

// Every colour pair the components and the frame draw, held to WCAG 2.2 AA in both modes after alpha
// composition (TDD-organization-experience-001 §Visual Language, STD-GLB-FE-009 §3.3). Ported from
// identity-experience's packages/ui/src/styles/contrast.test.ts (TDD-identity-experience-003 §Contrast
// and Focus): its pairs unchanged, then the pairs this application's own components draw. The tokens
// are read from the platform's theme stylesheet the application imports, as the pinned package ships
// it, so what is measured is what renders. A pair names the tokens the platform's component binds
// (@scnx/system/specs/<component>.json) or the tokens this repository's stylesheets read.

// SC 1.4.3 for text at the sizes these components use (none is large-scale), SC 1.4.11 for the edge
// that identifies a field, a state, and the focus indicator.
const text = 4.5;
const ui = 3;

// A surface is the stack of layers between the canvas and the foreground, bottom first. In
// scnx-platform every surface is opaque, and the stack still says what each sits on.
const panel = ['--ds-color-neutral-surface-raised-default'];
const rail = ['--ds-color-neutral-surface-sunken-default'];
const field = [...panel, '--ds-color-neutral-surface-raised-default'];
// A confirmation, a stage of an offboarding: a sunken surface inside a panel.
const sunken = [...panel, '--ds-color-neutral-surface-sunken-default'];

interface Pair {
  readonly what: string;
  readonly foreground: string;
  readonly surface: readonly string[];
  readonly minimum: number;
}

const pairs: readonly Pair[] = [
  // Text in a panel or a table.
  {
    what: 'heading and label',
    foreground: '--ds-color-neutral-text-strong-default',
    surface: panel,
    minimum: text,
  },
  { what: 'body text', foreground: '--ds-color-neutral-text-default-default', surface: panel, minimum: text },
  {
    what: 'description, caption, muted cell',
    foreground: '--ds-color-neutral-text-subtle-default',
    surface: panel,
    minimum: text,
  },
  {
    what: 'column header',
    foreground: '--ds-color-neutral-text-subtle-default',
    surface: [...panel, '--ds-color-neutral-surface-subtle-default'],
    minimum: text,
  },
  { what: 'link', foreground: '--ds-color-primary-text-default-default', surface: panel, minimum: text },
  {
    what: 'link on the canvas',
    foreground: '--ds-color-primary-text-default-default',
    surface: [],
    minimum: text,
  },
  {
    what: 'success text',
    foreground: '--ds-color-success-text-default-default',
    surface: panel,
    minimum: text,
  },
  {
    what: 'field error message',
    foreground: '--ds-color-danger-text-default-default',
    surface: panel,
    minimum: text,
  },
  {
    what: 'table row, hover',
    foreground: '--ds-color-neutral-text-default-default',
    surface: [...panel, '--ds-color-neutral-surface-subtle-hover'],
    minimum: text,
  },
  // Fields.
  {
    what: 'typed text',
    foreground: '--ds-color-neutral-text-default-default',
    surface: field,
    minimum: text,
  },
  {
    what: 'placeholder, description in a field',
    foreground: '--ds-color-neutral-text-subtle-default',
    surface: field,
    minimum: text,
  },
  // Buttons. Primary is ink: the neutral solid under its contrast label.
  ...(['default', 'hover', 'pressed'] as const).map((state) => ({
    what: `primary button label, ${state}`,
    foreground: '--ds-color-neutral-text-contrast-default',
    surface: [...panel, `--ds-color-neutral-surface-solid-${state}`],
    minimum: text,
  })),
  {
    what: 'skip link',
    foreground: '--ds-color-primary-text-contrast-default',
    surface: ['--ds-color-primary-surface-solid-default'],
    minimum: text,
  },
  {
    what: 'secondary button label',
    foreground: '--ds-color-neutral-text-default-default',
    surface: [...panel, '--ds-color-neutral-surface-raised-default'],
    minimum: text,
  },
  {
    what: 'secondary button label, hover',
    foreground: '--ds-color-neutral-text-default-default',
    surface: [...panel, '--ds-color-neutral-surface-subtle-hover'],
    minimum: text,
  },
  {
    what: 'ghost button label in the bar',
    foreground: '--ds-color-neutral-text-default-default',
    surface: rail,
    minimum: text,
  },
  {
    what: 'ghost button label in the bar, hover',
    foreground: '--ds-color-neutral-text-default-default',
    surface: [...rail, '--ds-color-neutral-surface-subtle-hover'],
    minimum: text,
  },
  {
    what: 'pressed toggle label in the bar',
    foreground: '--ds-color-neutral-text-strong-default',
    surface: [...rail, '--ds-color-neutral-surface-default-selected'],
    minimum: text,
  },
  ...(['default', 'hover', 'pressed'] as const).map((state) => ({
    what: `danger button label, ${state}`,
    foreground: '--ds-color-danger-text-contrast-default',
    surface: [...panel, `--ds-color-danger-surface-solid-${state}`],
    minimum: text,
  })),
  // Status pills (Badge, subtle) and messages (Alert).
  ...(['neutral', 'info', 'success', 'warning', 'danger'] as const).map((tone) => ({
    what: `${tone} pill`,
    foreground: `--ds-color-${tone}-text-subtle-default`,
    surface: [...panel, `--ds-color-${tone}-surface-default-default`],
    minimum: text,
  })),
  ...(['neutral', 'info', 'success', 'warning', 'danger'] as const).map((tone) => ({
    what: `${tone} message`,
    foreground: `--ds-color-${tone}-text-subtle-default`,
    surface: [...panel, `--ds-color-${tone}-surface-subtle-default`],
    minimum: text,
  })),
  {
    what: 'environment pill in the bar',
    foreground: '--ds-color-warning-text-subtle-default',
    surface: [...rail, '--ds-color-warning-surface-default-default'],
    minimum: text,
  },
  {
    what: 'step-up link in a danger message',
    foreground: '--ds-color-primary-text-default-default',
    surface: [...panel, '--ds-color-danger-surface-subtle-default'],
    minimum: text,
  },
  {
    what: 'sign-in notice on the canvas',
    foreground: '--ds-color-danger-text-default-default',
    surface: ['--ds-color-danger-surface-subtle-default'],
    minimum: text,
  },
  // The scope line, on the opaque canvas colour (TDD-identity-experience-003 1.32.0 §Layout).
  {
    what: 'scope line',
    foreground: '--ds-color-neutral-text-strong-default',
    surface: [],
    minimum: text,
  },
  // The navigation rail.
  { what: 'brand name', foreground: '--ds-color-neutral-text-strong-default', surface: rail, minimum: text },
  {
    what: 'navigation section',
    foreground: '--ds-color-neutral-text-subtle-default',
    surface: rail,
    minimum: text,
  },
  {
    what: 'navigation item',
    foreground: '--ds-color-neutral-text-default-default',
    surface: rail,
    minimum: text,
  },
  {
    what: 'navigation item, hover',
    foreground: '--ds-color-neutral-text-default-default',
    surface: [...rail, '--ds-color-neutral-surface-default-hover'],
    minimum: text,
  },
  {
    what: 'navigation item, current',
    foreground: '--ds-color-neutral-text-strong-default',
    surface: [...rail, '--ds-color-neutral-surface-default-selected'],
    minimum: text,
  },
  // Non-text: what identifies a component or its state, and the focus indicator.
  {
    what: 'field edge against the panel',
    foreground: '--ds-color-neutral-border-strong-default',
    surface: panel,
    minimum: ui,
  },
  {
    what: 'field edge against its fill',
    foreground: '--ds-color-neutral-border-strong-default',
    surface: field,
    minimum: ui,
  },
  {
    // The platform's own invalid edge, danger.border.strong.default, is 2.38:1 here in light: a finding
    // reported to ui-platform. The field classes draw the selected danger edge instead, as
    // identity-experience's TextField does.
    what: 'invalid field edge',
    foreground: '--ds-color-danger-border-strong-selected',
    surface: panel,
    minimum: ui,
  },
  {
    what: 'pressed toggle edge',
    foreground: '--ds-color-neutral-border-strong-default',
    surface: rail,
    minimum: ui,
  },
  {
    what: 'focus indicator on a panel',
    foreground: '--ds-color-primary-border-default-focus',
    surface: panel,
    minimum: ui,
  },
  {
    what: 'focus indicator on the canvas',
    foreground: '--ds-color-primary-border-default-focus',
    surface: [],
    minimum: ui,
  },
  {
    what: 'focus indicator in the rail',
    foreground: '--ds-color-primary-border-default-focus',
    surface: rail,
    minimum: ui,
  },

  // This application's own (TDD-organization-experience-001 §Visual Language). The scope banner is
  // the canvas with the scope's tint over it: its lead and countdown in the scheme's text, the rest in
  // strong text.
  ...(
    [
      ['Tenant', 'info', 'subtle'],
      ['provider mode', 'danger', 'default'],
      ['provider sign-in', 'warning', 'default'],
    ] as const
  ).flatMap(([scope, tone, tint]) => [
    {
      what: `scope banner lead, ${scope}`,
      foreground: `--ds-color-${tone}-text-default-default`,
      surface: [`--ds-color-${tone}-surface-${tint}-default`],
      minimum: text,
    },
    {
      what: `scope banner text, ${scope}`,
      foreground: '--ds-color-neutral-text-strong-default',
      surface: [`--ds-color-${tone}-surface-${tint}-default`],
      minimum: text,
    },
    {
      what: `scope banner glyph, ${scope}`,
      foreground: `--ds-color-${tone}-icon-default-default`,
      surface: [`--ds-color-${tone}-surface-${tint}-default`],
      minimum: ui,
    },
  ]),
  {
    what: 'session pill in the bar',
    foreground: '--ds-color-success-text-subtle-default',
    surface: [...rail, '--ds-color-success-surface-default-default'],
    minimum: text,
  },
  // A record row: its facts in subtle text, at rest, under the pointer and selected.
  {
    what: 'row facts, hover',
    foreground: '--ds-color-neutral-text-subtle-default',
    surface: [...panel, '--ds-color-neutral-surface-default-hover'],
    minimum: text,
  },
  {
    what: 'row facts, selected',
    foreground: '--ds-color-neutral-text-subtle-default',
    surface: [...panel, '--ds-color-neutral-surface-default-selected'],
    minimum: text,
  },
  {
    what: 'status pill in a selected row',
    foreground: '--ds-color-warning-text-subtle-default',
    surface: [
      ...panel,
      '--ds-color-neutral-surface-default-selected',
      '--ds-color-warning-surface-default-default',
    ],
    minimum: text,
  },
  // A confirmation is a sunken surface in a row; its scope note a danger notice inside it.
  {
    what: 'danger notice in a confirmation',
    foreground: '--ds-color-danger-text-subtle-default',
    surface: [...sunken, '--ds-color-danger-surface-subtle-default'],
    minimum: text,
  },
  {
    what: 'reason label in a confirmation',
    foreground: '--ds-color-neutral-text-default-default',
    surface: sunken,
    minimum: text,
  },
  {
    what: 'field edge in a confirmation',
    foreground: '--ds-color-neutral-border-strong-default',
    surface: sunken,
    minimum: ui,
  },
  // The offboarding stages: each a sunken card, the current one tinted and edged in the primary solid.
  {
    what: 'stage text',
    foreground: '--ds-color-neutral-text-subtle-default',
    surface: sunken,
    minimum: text,
  },
  {
    what: 'current stage text',
    foreground: '--ds-color-neutral-text-default-default',
    surface: [...sunken, '--ds-color-primary-surface-subtle-default'],
    minimum: text,
  },
  {
    what: 'current stage edge',
    foreground: '--ds-color-primary-surface-solid-default',
    surface: sunken,
    minimum: ui,
  },
  {
    what: 'passed stage check',
    foreground: '--ds-color-success-icon-default-default',
    surface: sunken,
    minimum: ui,
  },
];
const stylesheet = createRequire(import.meta.url).resolve('@scnx/system/tokens/css/scnx-platform.css');

interface Measure {
  readonly ratio: number;
  readonly where: string;
}

function measure(tokens: Scheme, pair: Pair): Measure {
  const canvas = colour(tokens, '--ds-color-neutral-surface-canvas-default');
  const background = pair.surface.reduce((under, layer) => over(colour(tokens, layer), under), canvas);
  const foreground = over(colour(tokens, pair.foreground), background);
  return { ratio: ratio(foreground, background), where: `${hex(foreground)} on ${hex(background)}` };
}

describe('the colour pairs', () => {
  const { light, dark } = schemes(readFileSync(stylesheet, 'utf8'), PLATFORM_THEME);

  for (const [name, tokens] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it(`meet WCAG 2.2 AA in the ${name} mode`, () => {
      const report = pairs.map((pair) => ({ pair, ...measure(tokens, pair) }));
      // Each pair's ratio, printed (vitest --silent=false) as the record TDD-003 quotes.
      // eslint-disable-next-line no-console -- the report is the test's output, not a leftover
      console.info(
        report
          .map(
            ({ pair, ratio: r, where }) =>
              `${name.padEnd(6)}${pair.what.padEnd(40)}${r.toFixed(2)}:1 (${where})`,
          )
          .join('\n'),
      );
      const failing = report
        .filter(({ pair, ratio: r }) => r < pair.minimum)
        .map(
          ({ pair, ratio: r, where }) => `${pair.what}: ${r.toFixed(2)}:1 under ${pair.minimum}:1, ${where}`,
        );
      expect(failing).toEqual([]);
    });
  }
});

describe('the measurement', () => {
  it('reads each mode of the one theme, through layers, and nothing inside @media', () => {
    const { light, dark } = schemes(
      `
@layer tokens {
  [data-scnx-theme="t"][data-scnx-resolved-mode="dark"] { --b: var(--a); --a: oklch(0.9 0 0); }
  [data-scnx-theme="t"][data-scnx-resolved-mode="light"] { --b: var(--a); --a: oklch(0.5 0 0); }
  [data-scnx-theme="other"][data-scnx-resolved-mode="light"] { --a: oklch(0.1 0 0); }
  @media (prefers-contrast: more) { [data-scnx-theme="t"][data-scnx-resolved-mode="dark"] { --a: oklch(1 0 0); } }
}`,
      't',
    );
    expect(hex(colour(light, '--b'))).toBe(hex(oklch(0.5, 0, 0)));
    expect(hex(colour(dark, '--b'))).toBe(hex(oklch(0.9, 0, 0)));
  });

  it('finds the platform theme in the pinned stylesheet', () => {
    const { light, dark } = schemes(readFileSync(stylesheet, 'utf8'), PLATFORM_THEME);
    expect(light.size).toBeGreaterThan(100);
    expect(dark.size).toBe(light.size);
  });

  it("matches WCAG's worked values", () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 1, g: 1, b: 1, a: 1 };
    expect(ratio(black, white)).toBeCloseTo(21, 2);
    // #767676 on white is the grey WCAG's Understanding documents give as passing 4.5:1.
    const grey = { r: 0x76 / 255, g: 0x76 / 255, b: 0x76 / 255, a: 1 };
    expect(ratio(grey, white)).toBeCloseTo(4.54, 2);
  });

  it('converts OKLCH as CSS Color 4 does', () => {
    expect(hex(oklch(1, 0, 0))).toBe('#ffffff');
    expect(hex(oklch(0, 0, 0))).toBe('#000000');
    // oklch(0.628 0.2577 29.23) is sRGB red in CSS Color 4's examples.
    expect(hex(oklch(0.628, 0.2577, 29.23))).toBe('#ff0000');
  });
});
