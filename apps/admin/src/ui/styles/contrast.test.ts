// @vitest-environment node
import { fileURLToPath } from 'node:url';

import { compile } from 'sass-embedded';
import { describe, expect, it } from 'vitest';

import { colour, hex, oklch, over, ratio, schemes, type Colour, type Scheme } from '../test/contrast';

// Every colour pair the components draw, held to WCAG 2.2 AA in both themes after alpha composition
// (TDD-organization-experience-001 §Visual Language, STD-GLB-FE-009 §3.3). Ported from
// identity-experience at c723e417c0eee97db6b1d5b6dab608fe6a406ac2 (packages/ui/src/styles/
// contrast.test.ts, TDD-identity-experience-003 §Contrast and Focus): its pairs unchanged, then the
// pairs this application's own components draw. The tokens are read from the stylesheet the
// application imports, compiled, so what is measured is what ships.

// SC 1.4.3 for text at the sizes these components use (none is large-scale), SC 1.4.11 for the edge
// that identifies a field, a state, and the focus indicator.
const text = 4.5;
const ui = 3;

// A surface is the stack of translucent layers between the canvas and the foreground, bottom first.
const panel = ['--ds-color-neutral-surface-raised-default'];
const rail = ['--ds-color-neutral-surface-sunken-default'];
const field = [...panel, '--ds-color-neutral-surface-sunken-default'];

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
    what: 'hint, description, column header',
    foreground: '--ds-color-neutral-text-subtle-default',
    surface: panel,
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
    surface: [...panel, '--ds-color-neutral-surface-default-hover'],
    minimum: text,
  },
  // Fields.
  { what: 'typed text', foreground: '--ds-color-neutral-text-strong-default', surface: field, minimum: text },
  {
    what: 'placeholder in a field',
    foreground: '--ds-color-neutral-text-subtle-default',
    surface: field,
    minimum: text,
  },
  // Buttons. The primary solid is opaque; the panel beneath it is stated for completeness.
  ...(['default', 'hover', 'pressed'] as const).map((state) => ({
    what: `primary button label, ${state}`,
    foreground: '--ds-color-primary-text-contrast-default',
    surface: [...panel, `--ds-color-primary-solid-default-${state}`],
    minimum: text,
  })),
  {
    what: 'skip link',
    foreground: '--ds-color-primary-text-contrast-default',
    surface: ['--ds-color-primary-solid-default-default'],
    minimum: text,
  },
  {
    what: 'secondary button label',
    foreground: '--ds-color-neutral-text-strong-default',
    surface: [...panel, '--ds-color-neutral-surface-subtle-default'],
    minimum: text,
  },
  {
    what: 'secondary button label, hover',
    foreground: '--ds-color-neutral-text-strong-default',
    surface: [...panel, '--ds-color-neutral-surface-default-hover'],
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
    surface: [...rail, '--ds-color-neutral-surface-default-hover'],
    minimum: text,
  },
  {
    what: 'pressed toggle label in the bar',
    foreground: '--ds-color-neutral-text-strong-default',
    surface: [...rail, '--ds-color-neutral-surface-default-selected'],
    minimum: text,
  },
  {
    what: 'danger button label',
    foreground: '--ds-color-danger-text-default-default',
    surface: [...panel, '--ds-color-danger-surface-default-default'],
    minimum: text,
  },
  {
    what: 'danger button label, hover',
    foreground: '--ds-color-danger-text-default-default',
    surface: [...panel, '--ds-color-danger-surface-default-hover'],
    minimum: text,
  },
  // Status pills and messages.
  {
    what: 'neutral pill',
    foreground: '--ds-color-neutral-text-default-default',
    surface: [...panel, '--ds-color-neutral-surface-subtle-default'],
    minimum: text,
  },
  ...(['info', 'success', 'warning', 'danger'] as const).map((tone) => ({
    what: `${tone} pill and message`,
    foreground: `--ds-color-${tone}-text-default-default`,
    surface: [...panel, `--ds-color-${tone}-surface-subtle-default`],
    minimum: text,
  })),
  {
    what: 'environment pill in the bar',
    foreground: '--ds-color-warning-text-default-default',
    surface: [...rail, '--ds-color-warning-surface-subtle-default'],
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
    what: 'field edge, hover',
    foreground: '--ds-color-neutral-border-strong-hover',
    surface: panel,
    minimum: ui,
  },
  {
    what: 'invalid field edge',
    foreground: '--ds-color-danger-solid-default-default',
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
    foreground: '--ds-color-neutral-border-default-focus',
    surface: panel,
    minimum: ui,
  },
  {
    what: 'focus indicator on the canvas',
    foreground: '--ds-color-neutral-border-default-focus',
    surface: [],
    minimum: ui,
  },
  {
    what: 'focus indicator in the rail',
    foreground: '--ds-color-neutral-border-default-focus',
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
    foreground: '--ds-color-success-text-default-default',
    surface: [...rail, '--ds-color-success-surface-subtle-default'],
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
    foreground: '--ds-color-warning-text-default-default',
    surface: [
      ...panel,
      '--ds-color-neutral-surface-default-selected',
      '--ds-color-warning-surface-subtle-default',
    ],
    minimum: text,
  },
  // A confirmation is a sunken surface in a row; its scope note a danger notice inside it.
  {
    what: 'danger notice in a confirmation',
    foreground: '--ds-color-danger-text-default-default',
    surface: [...field, '--ds-color-danger-surface-subtle-default'],
    minimum: text,
  },
  {
    what: 'reason label in a confirmation',
    foreground: '--ds-color-neutral-text-strong-default',
    surface: field,
    minimum: text,
  },
  {
    what: 'field edge in a confirmation',
    foreground: '--ds-color-neutral-border-strong-default',
    surface: field,
    minimum: ui,
  },
  // The offboarding stages: each a sunken card, the current one tinted and edged in the primary solid.
  {
    what: 'stage text',
    foreground: '--ds-color-neutral-text-subtle-default',
    surface: field,
    minimum: text,
  },
  {
    what: 'current stage text',
    foreground: '--ds-color-neutral-text-default-default',
    surface: [...field, '--ds-color-primary-surface-subtle-default'],
    minimum: text,
  },
  {
    what: 'current stage edge',
    foreground: '--ds-color-primary-solid-default-default',
    surface: field,
    minimum: ui,
  },
  {
    what: 'passed stage check',
    foreground: '--ds-color-success-icon-default-default',
    surface: field,
    minimum: ui,
  },
];

// The canvas a surface can sit over: the plain canvas, and the canvas under each aurora at full
// strength, where it differs most from the plain one. The 5%-opaque grid lines are left out.
const backdrops: readonly { readonly name: string; readonly layers: readonly string[] }[] = [
  { name: 'canvas', layers: [] },
  { name: 'canvas under the first aurora', layers: ['--ds-color-neutral-canvas-glow-a'] },
  {
    name: 'canvas under both auroras',
    layers: ['--ds-color-neutral-canvas-glow-a', '--ds-color-neutral-canvas-glow-b'],
  },
];

const stylesheet = fileURLToPath(new URL('./index.scss', import.meta.url));

interface Measure {
  readonly worst: number;
  readonly where: string;
}

function measure(tokens: Scheme, pair: Pair): Measure {
  let worst = Infinity;
  let where = '';
  for (const backdrop of backdrops) {
    const layered = (base: Colour, layers: readonly string[]): Colour =>
      layers.reduce((under, layer) => over(colour(tokens, layer), under), base);
    const canvas = layered(colour(tokens, '--ds-color-neutral-canvas-default'), backdrop.layers);
    const background = layered(canvas, pair.surface);
    const foreground = over(colour(tokens, pair.foreground), background);
    const r = ratio(foreground, background);
    if (r < worst) {
      worst = r;
      where = `${hex(foreground)} on ${hex(background)} over the ${backdrop.name}`;
    }
  }
  return { worst, where };
}

describe('the colour pairs', () => {
  const { light, dark } = schemes(compile(stylesheet).css);

  for (const [name, tokens] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it(`meet WCAG 2.2 AA in the ${name} theme, at their worst over the canvas`, () => {
      const report = pairs.map((pair) => ({ pair, ...measure(tokens, pair) }));
      // The worst case of each pair, printed (vitest --silent=false) as the record TDD-003 quotes.
      // eslint-disable-next-line no-console -- the report is the test's output, not a leftover
      console.info(
        report
          .map(
            ({ pair, worst, where }) =>
              `${name.padEnd(6)}${pair.what.padEnd(40)}${worst.toFixed(2)}:1 (${where})`,
          )
          .join('\n'),
      );
      const failing = report
        .filter(({ pair, worst }) => worst < pair.minimum)
        .map(
          ({ pair, worst, where }) => `${pair.what}: ${worst.toFixed(2)}:1 under ${pair.minimum}:1, ${where}`,
        );
      expect(failing).toEqual([]);
    });
  }
});

describe('the measurement', () => {
  it('reads each theme as the cascade resolves it, and nothing inside @media', () => {
    const { light, dark } = schemes(`
@layer tokens {
  :root { --b: var(--a); }
  :root[data-theme='dark'] { --a: oklch(0.9 0 0); }
  :root[data-theme='light'] { --a: oklch(0.5 0 0); }
  @media (prefers-contrast: more) { :root[data-theme='dark'] { --a: oklch(1 0 0); } }
}`);
    expect(hex(colour(light, '--b'))).not.toBe(hex(colour(dark, '--b')));
    expect(hex(colour(dark, '--b'))).not.toBe(hex(oklch(1, 0, 0)));
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
