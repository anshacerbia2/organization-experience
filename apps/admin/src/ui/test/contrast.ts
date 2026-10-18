// Contrast measured the way WCAG 2.2 measures it, from the tokens the compiled stylesheet declares
// (TDD-identity-experience-003 §Contrast and Focus). The surfaces are translucent over a gradient
// canvas, so no pair can be read off the stylesheet: the colour behind a word is a surface composited
// over whatever part of the canvas it sits on. STD-GLB-FE-009 §3.3: "Tests use actual
// foreground/background pairs after alpha composition in each supported theme and state."
//
// The same computation as identity-kernel's internal/themecontrast, which measures the login theme
// that copies these tokens, so the two report the same ratio for the same pair.

// An sRGB colour with straight alpha, each channel in [0, 1].
export interface Colour {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

// One theme's custom properties, by name: '--ds-color-neutral-canvas-default'.
export type Scheme = ReadonlyMap<string, string>;

const varRef = /^var\((--[A-Za-z0-9-]+)\)$/;
const oklchFn = /^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*(?:\/\s*([0-9.]+)\s*)?\)$/;

// stripMedia removes every @media block, whose nesting the rule pattern cannot follow: a media
// query (prefers-contrast) is a further rendering this module does not measure.
function stripMedia(css: string): string {
  let out = '';
  for (let i = 0; i < css.length; i++) {
    if (!css.startsWith('@media', i)) {
      out += css.charAt(i);
      continue;
    }
    let depth = 0;
    let j = css.indexOf('{', i);
    for (; j < css.length; j++) {
      if (css[j] === '{') {
        depth++;
      } else if (css[j] === '}') {
        depth--;
        if (depth === 0) {
          break;
        }
      }
    }
    i = j;
  }
  return out;
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const declaration of body.split(';')) {
    const colon = declaration.indexOf(':');
    const name = declaration.slice(0, colon).trim();
    if (colon < 0 || !name.startsWith('--')) {
      continue;
    }
    out.set(
      name,
      declaration
        .slice(colon + 1)
        .trim()
        .split(/\s+/)
        .join(' '),
    );
  }
  return out;
}

// schemes reads each theme's custom properties as the cascade resolves them on <html>: the rules on
// :root, then the rules on :root[data-theme=<theme>]. Rules inside @media are not read.
export function schemes(css: string): { readonly light: Scheme; readonly dark: Scheme } {
  const flat = stripMedia(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  const base = new Map<string, string>();
  const light = new Map<string, string>();
  const dark = new Map<string, string>();
  for (const match of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? '').trim().replace(/['"]/g, '');
    const target =
      selector === ':root'
        ? base
        : selector === ':root[data-theme=light]'
          ? light
          : selector === ':root[data-theme=dark]'
            ? dark
            : undefined;
    for (const [name, value] of declarations(match[2] ?? '')) {
      target?.set(name, value);
    }
  }
  return { light: new Map([...base, ...light]), dark: new Map([...base, ...dark]) };
}

// colour resolves a custom property to a colour, following var() references.
export function colour(scheme: Scheme, name: string): Colour {
  let current = name;
  const seen = new Set<string>();
  for (;;) {
    const value = scheme.get(current);
    if (value === undefined) {
      throw new Error(`${current} is not declared`);
    }
    const reference = varRef.exec(value);
    if (reference === null) {
      return parseOKLCH(value);
    }
    const next = reference[1] ?? '';
    if (seen.has(next)) {
      throw new Error(`${name} refers to itself`);
    }
    seen.add(next);
    current = next;
  }
}

function parseOKLCH(value: string): Colour {
  const match = oklchFn.exec(value);
  if (match === null) {
    throw new Error(`${JSON.stringify(value)} is not an oklch() colour`);
  }
  const [, l = '0', c = '0', h = '0', a] = match;
  return oklch(Number(l), Number(c), Number(h), a === undefined ? 1 : Number(a));
}

function encode(x: number): number {
  const v = Math.min(Math.max(x, 0), 1);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

// oklch converts an OKLCH colour to sRGB (Björn Ottosson's OKLab matrices, as CSS Color 4 cites
// them), clipping each channel to the gamut.
export function oklch(l: number, c: number, h: number, alpha = 1): Colour {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: encode(4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1),
    g: encode(-1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1),
    b: encode(-0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1),
    a: alpha,
  };
}

// over composites top over an opaque bottom.
export function over(top: Colour, bottom: Colour): Colour {
  const { a } = top;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

function luminance({ r, g, b }: Colour): number {
  const linear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

// ratio is the WCAG 2.2 contrast ratio of two opaque colours.
export function ratio(x: Colour, y: Colour): number {
  const [high, low] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

// hex writes an opaque colour as #rrggbb, for messages.
export function hex({ r, g, b }: Colour): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
