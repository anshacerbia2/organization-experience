// Asserts the BFF is identity-experience's pattern without variation (TDD-organization-experience-001
// §Technical Context): every file bff/conformance.json lists as identical is byte for byte the
// source's file at the pinned commit, fetched from the public repository, and every file under bff/
// is listed exactly once, as identical or as adapted with why. A divergence here is a defect, not a
// local decision, so a file that drifts, or one added without saying why, fails the check.
//
//   node scripts/check-bff-conformance.mjs
//
// No dependencies: Node's own fetch and file system, so the check runs before an install would.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = 'bff/conformance.json';
const manifest = JSON.parse(readFileSync(path.join(root, manifestPath), 'utf8'));
const failures = [];

// The commit is a full SHA, never a branch: a branch moves, and the comparison would move with it.
if (typeof manifest.source !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(manifest.source)) {
  failures.push(`${manifestPath}: source must be owner/repository`);
}
if (typeof manifest.commit !== 'string' || !/^[0-9a-f]{40}$/.test(manifest.commit)) {
  failures.push(`${manifestPath}: commit must be a full 40-character SHA`);
}
const identical = Array.isArray(manifest.identical) ? manifest.identical : [];
const adapted = Array.isArray(manifest.adapted) ? manifest.adapted : [];
for (const entry of adapted) {
  if (typeof entry?.path !== 'string' || typeof entry.why !== 'string' || entry.why.trim() === '') {
    failures.push(`${manifestPath}: every adapted entry needs a path and a why`);
  }
}

// Installed dependencies and build output are not the BFF's source, and are never compared. Coverage
// is git-ignored output too.
const skipped = new Set(['node_modules', 'dist', 'coverage']);
const walk = (dir) =>
  readdirSync(path.join(root, dir)).flatMap((name) => {
    if (skipped.has(name)) {
      return [];
    }
    const relative = `${dir}/${name}`;
    return statSync(path.join(root, relative)).isDirectory() ? walk(relative) : [relative];
  });
const present = new Set(walk('bff'));

// Every file listed exactly once, and every listed file present.
const listed = new Map();
for (const file of [...identical, ...adapted.map((entry) => entry?.path)]) {
  if (typeof file !== 'string') {
    continue;
  }
  listed.set(file, (listed.get(file) ?? 0) + 1);
}
for (const [file, count] of listed) {
  if (count > 1) {
    failures.push(`${file} is listed ${count} times`);
  }
  if (!present.has(file)) {
    failures.push(`${file} is listed but missing`);
  }
}
for (const file of present) {
  if (!listed.has(file)) {
    failures.push(`${file} is in neither list: add it to identical, or to adapted with why`);
  }
}

// Each identical file against the source at the pinned commit. The bytes are compared, not the text:
// a line ending or a trailing space is a difference.
const differing = [];
if (failures.length === 0) {
  await Promise.all(
    identical.map(async (file) => {
      const url = `https://raw.githubusercontent.com/${manifest.source}/${manifest.commit}/${file}`;
      let response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      } catch (error) {
        failures.push(
          `${file}: the source could not be fetched (${error instanceof Error ? error.message : String(error)})`,
        );
        return;
      }
      if (!response.ok) {
        failures.push(`${file}: the source answered ${response.status} for ${url}`);
        return;
      }
      const source = Buffer.from(await response.arrayBuffer());
      if (!source.equals(readFileSync(path.join(root, file)))) {
        differing.push(file);
      }
    }),
  );
}
for (const file of differing.sort()) {
  failures.push(`${file} differs from ${manifest.source}@${manifest.commit.slice(0, 12)}`);
}

if (failures.length > 0) {
  process.stderr.write(`bff conformance check failed:\n  ${failures.join('\n  ')}\n`);
  process.exit(1);
}
process.stdout.write(
  `bff conformance check passed: ${identical.length} identical to ${manifest.source}@${manifest.commit.slice(0, 12)}, ${adapted.length} adapted\n`,
);
