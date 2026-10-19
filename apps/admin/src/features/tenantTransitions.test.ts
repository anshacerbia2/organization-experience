import { describe, expect, it } from 'vitest';

import { tenantTransitions } from './tenantTransitions';
import design from '../../../../docs/designs/TDD-organization-experience-002-administration-surfaces.md?raw';

// TDD-organization-experience-002 1.6.0 §Operator Transitions. The edges of organization-control's
// Tenant state machine, as TDD-organization-control-003 1.15.0 §Tenant State Machine declares them,
// creation included. When that machine gains an edge, it is added here, and this test then fails
// until the console's table says what the console offers for it.
const machine: readonly (readonly [string, string])[] = [
  ['new', 'requested'],
  ['requested', 'provisioning'],
  ['provisioning', 'active'],
  ['provisioning', 'failed'],
  ['failed', 'provisioning'],
  ['active', 'suspended'],
  ['suspended', 'active'],
  ['active', 'offboarding'],
  ['suspended', 'offboarding'],
  ['offboarding', 'active'],
  ['offboarding', 'suspended'],
  ['offboarding', 'retired'],
];

const key = (from: string, to: string): string => `${from} -> ${to}`;

// The design's table: every row of the section's one table, as `from -> to` with its driver and
// whether it names an action.
function designRows(): Map<string, { driver: string; action: string | null }> {
  const section = design.split('### Operator Transitions (1.6.0)')[1]?.split('\n### ')[0] ?? '';
  const rows = new Map<string, { driver: string; action: string | null }>();
  for (const line of section.split('\n')) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const [from, to, driver, , action] = cells;
    if (cells.length !== 5 || from === undefined || !from.startsWith('`')) {
      continue;
    }
    rows.set(key(from.replaceAll('`', ''), (to ?? '').replaceAll('`', '')), {
      driver: driver ?? '',
      action: action === undefined || action.startsWith('None') ? null : action,
    });
  }
  return rows;
}

describe('every Tenant transition has an action, or a reason for none', () => {
  it('lists each transition of organization-control’s machine, and nothing else', () => {
    expect(tenantTransitions.map((row) => key(row.from, row.to)).sort()).toEqual(
      machine.map(([from, to]) => key(from, to)).sort(),
    );
  });

  it('names an action for each transition an operator drives, and a reason for each it does not', () => {
    for (const row of tenantTransitions) {
      if (row.driver === 'operator') {
        expect(row.action, key(row.from, row.to)).toMatch(/\S/);
      } else {
        expect(row.action, key(row.from, row.to)).toBeUndefined();
        expect(row.none, key(row.from, row.to)).toMatch(/\S/);
      }
    }
  });

  it('agrees with the design’s table', () => {
    const rows = designRows();
    expect([...rows.keys()].sort()).toEqual(tenantTransitions.map((row) => key(row.from, row.to)).sort());
    for (const row of tenantTransitions) {
      const declared = rows.get(key(row.from, row.to));
      expect(declared?.driver, key(row.from, row.to)).toBe(row.driver);
      expect(declared?.action ?? null, key(row.from, row.to)).toBe(row.action ?? null);
    }
  });
});
