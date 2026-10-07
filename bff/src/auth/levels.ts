// The authentication levels ADR-IAM-004 names, in STD-IAM-002 §3.2's order. A level is met by itself
// or a higher one; any other acr, the kernel's unmapped 0 and 1 included, is below aal1.

export type Level = 'aal1' | 'aal2';

const order: Readonly<Record<string, number>> = { aal1: 1, aal2: 2, phr: 3 };

export const levelOf = (acr: string | null | undefined): number =>
  acr === null || acr === undefined ? 0 : (order[acr] ?? 0);

export const meets = (acr: string | null | undefined, level: Level): boolean =>
  levelOf(acr) >= levelOf(level);

// requestedLevel reads a sign-in's acr_values: aal1 or aal2, and nothing else.
export function requestedLevel(value: unknown): Level | null {
  return value === 'aal1' || value === 'aal2' ? value : null;
}
