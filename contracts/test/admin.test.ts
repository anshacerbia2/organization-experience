import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { organizationControl as contract } from '../src/load.ts';

// Every Organization Control path the application writes (apps/admin/src, its tests aside) is one the
// published specification serves (TDD-organization-experience-001 1.12.0 §API / Interface). What each
// request sends is checked as the application's own tests send it: apps/admin/src/test/bff.ts holds
// every /api/v1/ request against the same specification.
const root = fileURLToPath(new URL('../../apps/admin/src/', import.meta.url));

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === 'test' ? [] : sources(full);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });

// A path literal: '/v1/…' or `/v1/…`, its interpolations standing for one segment each, its query
// left off.
const written = sources(root).flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/['`](\/v1\/[^'`\s]*)['`]/g)].map((found) => ({
    file: path.relative(root, file),
    path: (found[1] ?? '').replace(/\$\{[^}]+\}/g, 'x').split('?')[0] ?? '',
  })),
);

// served: some path of the specification has these segments, an interpolation standing for any one,
// and a {parameter} of the specification for any one. A path the source extends with an action
// (`${base}/archive`) is the stem of one, so a longer path of the specification serves it too.
const served = (written: string): boolean => {
  const segments = written.split('/');
  return contract.paths.some((template) => {
    const parts = template.split('/');
    return (
      parts.length >= segments.length &&
      segments.every(
        (segment, index) =>
          segment === 'x' || /^\{[^}]+\}$/.test(parts[index] ?? '') || segment === parts[index],
      )
    );
  });
};

describe('the application’s Organization Control paths', () => {
  it('are found', () => {
    expect(written.length).toBeGreaterThan(20);
  });

  it.each(written.map((entry) => [entry.path, entry.file] as const))(
    '%s, in %s, is served by organization-control',
    (written) => {
      expect(served(written), written).toBe(true);
    },
  );
});
