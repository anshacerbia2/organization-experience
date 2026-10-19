import { describe, expect, it } from 'vitest';

import { machines } from './transitions';
import administration from '../../../../docs/designs/TDD-organization-experience-002-administration-surfaces.md?raw';
import offboarding from '../../../../docs/designs/TDD-organization-experience-003-offboarding-views.md?raw';

// TDD-organization-experience-002 1.7.0 §Operator Transitions of the Other Machines and
// TDD-organization-experience-003 1.5.0 §Operator Transitions. The edges of each machine as its
// organization-control design declares it, creation included. When a machine gains an edge, it is
// added here, and this test then fails until the console's table says what the console offers for it.
const edges: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  // TDD-organization-control-004 §Offboarding Stages, §Cancellation.
  'offboarding stage': [
    ['new', 'freeze'],
    ['freeze', 'obligations'],
    ['obligations', 'release'],
    ['release', 'retired'],
    ['freeze', 'cancelled'],
    ['obligations', 'cancelled'],
  ],
  // TDD-organization-control-004 §Where the deprovisioning outcome is recorded, §Sending a Failed
  // Deprovisioning Again; TDD-organization-control-003 §Scheduled Sweeps ages both directions.
  'deprovisioning request': [
    ['new', 'requested'],
    ['requested', 'realized'],
    ['requested', 'failed'],
    ['requested', 'unresolved'],
    ['unresolved', 'realized'],
    ['unresolved', 'failed'],
    ['failed', 'requested'],
  ],
  // TDD-organization-control-004 §Offboarding Stages and internal/offboarding: a failed obligation
  // may still be completed or waived; a resolved one is final; a cancellation closes an open one.
  obligation: [
    ['new', 'open'],
    ['open', 'completed'],
    ['open', 'waived'],
    ['open', 'failed'],
    ['failed', 'completed'],
    ['failed', 'waived'],
    ['open', 'cancelled'],
  ],
  // TDD-organization-control-001 §The Tenant Administration Grant.
  'tenant administration grant': [
    ['new', 'active'],
    ['active', 'revoked'],
  ],
  // TDD-organization-control-001 §Caller Authority, ADR-ORG-002 §5.2.
  'provider grant': [
    ['new', 'eligible'],
    ['new', 'emergency'],
    ['eligible', 'revoked'],
    ['emergency', 'revoked'],
  ],
  // TDD-organization-control-002 §Consumer Registry.
  'projection consumer': [
    ['new', 'active'],
    ['active', 'retired'],
  ],
  // TDD-organization-control-005 §API / Interface, §WAIVED.
  'dead letter': [
    ['new', 'open'],
    ['open', 'open'],
    ['open', 'resolved'],
    ['open', 'waived'],
    ['waived', 'resolved'],
    ['waived', 'open'],
  ],
  // ADR-ORG-003 §5.5, TDD-organization-control-001 §Pausing Tenant Administration.
  'tenant-administration pause': [
    ['new', 'paused'],
    ['unpaused', 'paused'],
    ['paused', 'unpaused'],
  ],
};

const designs = {
  'TDD-organization-experience-002': administration,
  'TDD-organization-experience-003': offboarding,
} as const;

const key = (from: string, to: string): string => `${from} -> ${to}`;

// A design's table under `#### heading`: every row, as `from -> to` with its driver and whether it
// names an action.
function designRows(design: string, heading: string): Map<string, { driver: string; action: string | null }> {
  const section = design.split(`\n#### ${heading}\n`)[1]?.split(/\n#{2,4} /)[0] ?? '';
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

describe.each(machines)('every $name transition has an action, or a reason for none', (machine) => {
  it('lists each transition of organization-control’s machine, and nothing else', () => {
    expect(machine.transitions.map((row) => key(row.from, row.to)).sort()).toEqual(
      (edges[machine.name] ?? []).map(([from, to]) => key(from, to)).sort(),
    );
  });

  it('names an action for each transition an operator drives, and a reason for each it does not', () => {
    for (const row of machine.transitions) {
      if (row.driver === 'operator') {
        expect(row.action, key(row.from, row.to)).toMatch(/\S/);
        expect(row.none, key(row.from, row.to)).toBeUndefined();
      } else {
        expect(row.action, key(row.from, row.to)).toBeUndefined();
        expect(row.none, key(row.from, row.to)).toMatch(/\S/);
      }
    }
  });

  it('agrees with the design’s table', () => {
    const rows = designRows(designs[machine.design], machine.heading);
    expect([...rows.keys()].sort()).toEqual(machine.transitions.map((row) => key(row.from, row.to)).sort());
    for (const row of machine.transitions) {
      const declared = rows.get(key(row.from, row.to));
      expect(declared?.driver, key(row.from, row.to)).toBe(row.driver);
      expect(declared?.action ?? null, key(row.from, row.to)).toBe(row.action ?? null);
    }
  });
});

describe('the machines', () => {
  it('are each declared once, and each has its edges here', () => {
    expect(machines.map((machine) => machine.name).sort()).toEqual(Object.keys(edges).sort());
  });
});
