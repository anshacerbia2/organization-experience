import assert from 'node:assert/strict';
import test from 'node:test';

import { pinFindings } from './ui-platform.mjs';

const pin = {
  commit: 'a'.repeat(40),
  packages: [{ name: '@x/a', version: '1.0.0', tarball: 'x-a-1.0.0.tgz', sha256: 'f'.repeat(64) }],
};
const manifest = { dependencies: { '@x/a': 'file:../../vendor/ui-platform/x-a-1.0.0.tgz' } };

test('a vendored tarball that matches its pin passes', () => {
  assert.deepEqual(pinFindings(pin, { 'x-a-1.0.0.tgz': 'f'.repeat(64) }, manifest), []);
});

test('a changed, missing, or unpinned tarball fails', () => {
  assert.equal(pinFindings(pin, { 'x-a-1.0.0.tgz': 'e'.repeat(64) }, manifest).length, 1);
  assert.equal(pinFindings(pin, {}, manifest).length, 1);
  assert.equal(pinFindings(pin, { 'x-a-1.0.0.tgz': 'f'.repeat(64), 'y.tgz': '0' }, manifest).length, 1);
});

test('the manifest must install exactly the pinned file, and the pin a full commit', () => {
  assert.equal(
    pinFindings(pin, { 'x-a-1.0.0.tgz': 'f'.repeat(64) }, { dependencies: { '@x/a': '^1.0.0' } }).length,
    1,
  );
  assert.equal(
    pinFindings({ ...pin, commit: 'abc' }, { 'x-a-1.0.0.tgz': 'f'.repeat(64) }, manifest).length,
    1,
  );
});
