// Asserts the vendored Organization Control API specification is organization-control's published one
// at the pinned commit, byte for byte (TDD-organization-experience-001 1.12.0 §API / Interface,
// ADR-GLB-010 §5.1). The contract test in contracts/test checks the client against the vendored file;
// this check makes sure that file is what organization-control published, and not an edit made here.
//
//   node scripts/check-api-contract.mjs
//
// No dependencies: Node's own fetch and file system, as check-bff-conformance.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pinPath = 'contracts/organization-control/pin.json';
const pin = JSON.parse(readFileSync(path.join(root, pinPath), 'utf8'));
const failures = [];

// The commit is a full SHA, never a branch: a branch moves, and the contract would move with it.
if (typeof pin.source !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(pin.source)) {
  failures.push(`${pinPath}: source must be owner/repository`);
}
if (typeof pin.commit !== 'string' || !/^[0-9a-f]{40}$/.test(pin.commit)) {
  failures.push(`${pinPath}: commit must be a full 40-character SHA`);
}
if (typeof pin.path !== 'string' || typeof pin.vendored !== 'string') {
  failures.push(`${pinPath}: path and vendored are required`);
}

if (failures.length === 0) {
  const url = `https://raw.githubusercontent.com/${pin.source}/${pin.commit}/${pin.path}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      failures.push(`the source answered ${response.status} for ${url}`);
    } else {
      const source = Buffer.from(await response.arrayBuffer());
      const vendored = readFileSync(path.join(root, pin.vendored));
      if (!source.equals(vendored)) {
        failures.push(`${pin.vendored} differs from ${pin.source}@${pin.commit.slice(0, 12)}:${pin.path}`);
      }
      const version = /^\s+version:\s*(\S+)/m.exec(vendored.toString('utf8'))?.[1];
      if (version !== pin.version) {
        failures.push(`${pinPath}: version ${pin.version} is not the document's info.version ${version}`);
      }
    }
  } catch (error) {
    failures.push(
      `the source could not be fetched (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

if (failures.length > 0) {
  process.stderr.write(`api contract check failed:\n  ${failures.join('\n  ')}\n`);
  process.exit(1);
}
process.stdout.write(
  `api contract check passed: ${pin.vendored} is ${pin.source}@${pin.commit.slice(0, 12)}:${pin.path}, version ${pin.version}\n`,
);
