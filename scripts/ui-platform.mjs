#!/usr/bin/env node
// The pinned ui-platform release this repository builds on (TDD-organization-experience-001
// §Visual Language, "Intake"). Ported from ui-platform-docs' scripts/ui-platform.mjs
// (TDD-ui-platform-docs-001 D2), as identity-experience ports it, so the consumers pin, check and
// verify the packages the same way.
//
//   node scripts/ui-platform.mjs pin --packs <dir> --commit <sha> --run <url>
//        copy the tarballs of a ui-platform CI run on main (its `packed-packages` artifact; ui-platform
//        builds reproducibly, so they are byte-identical to that run's attested tarballs), update
//        apps/admin/package.json and vendor/ui-platform/pin.json
//   node scripts/ui-platform.mjs check
//        every vendored tarball matches the pin, and apps/admin installs exactly them
//   node scripts/ui-platform.mjs verify
//        check, then verify each tarball's SLSA provenance with the GitHub CLI: signed by
//        ui-platform's CI workflow, built from the pinned commit on main

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(root, 'vendor/ui-platform');
const PIN = path.join(VENDOR, 'pin.json');
// The one package that depends on ui-platform: the application reaches it only through src/ui/index.ts
// (its ESLint rule, TDD-organization-experience-001 §Visual Language).
const CONSUMER = path.join(root, 'apps/admin/package.json');
const SPEC_PREFIX = 'file:../../vendor/ui-platform/';
const REPOSITORY = 'anshacerbia2/ui-platform';
const SIGNER = `${REPOSITORY}/.github/workflows/ci.yml`;

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : undefined;
};
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const say = (line) => process.stdout.write(`${line}\n`);
const fail = (line) => process.stderr.write(`${line}\n`);

/** Findings for a pin, the vendored files, and the manifest, independent of the file system. */
export function pinFindings(pin, files, manifest, prefix = SPEC_PREFIX) {
  const findings = [];
  if (!/^[0-9a-f]{40}$/.test(pin.commit ?? '')) findings.push('pin.commit must be a full commit SHA');
  for (const pkg of pin.packages ?? []) {
    const actual = files[pkg.tarball];
    if (actual === undefined) findings.push(`${pkg.tarball} is pinned but not vendored`);
    else if (actual !== pkg.sha256)
      findings.push(`${pkg.tarball} has sha256 ${actual}, pinned ${pkg.sha256}`);
    const spec = manifest.dependencies?.[pkg.name];
    if (spec !== `${prefix}${pkg.tarball}`)
      findings.push(`${pkg.name} must be installed from ${prefix}${pkg.tarball}, not ${spec}`);
  }
  for (const file of Object.keys(files))
    if (!(pin.packages ?? []).some((p) => p.tarball === file))
      findings.push(`${file} is vendored but not pinned`);
  return findings;
}

function vendoredFiles() {
  return Object.fromEntries(
    fs
      .readdirSync(VENDOR)
      .filter((f) => f.endsWith('.tgz'))
      .map((f) => [f, sha256(path.join(VENDOR, f))]),
  );
}

function check() {
  const pin = readJson(PIN);
  const findings = pinFindings(pin, vendoredFiles(), readJson(CONSUMER));
  if (findings.length) {
    fail(findings.join('\n'));
    process.exit(1);
  }
  say(
    `Pinned ui-platform ${pin.commit.slice(0, 7)}: ${pin.packages.map((p) => `${p.name}@${p.version}`).join(', ')} match`,
  );
  return pin;
}

function verify() {
  const pin = check();
  for (const pkg of pin.packages) {
    execFileSync(
      'gh',
      [
        'attestation',
        'verify',
        path.join(VENDOR, pkg.tarball),
        '--repo',
        REPOSITORY,
        '--signer-workflow',
        SIGNER,
        '--source-ref',
        'refs/heads/main',
        '--source-digest',
        pin.commit,
        '--deny-self-hosted-runners',
      ],
      { stdio: 'inherit' },
    );
  }
  say(`Provenance verified: every tarball was built by ${SIGNER} from ${pin.commit.slice(0, 7)} on main`);
}

function pinFrom() {
  const packs = path.resolve(arg('--packs') ?? '');
  const commit = arg('--commit');
  const run = arg('--run');
  if (!fs.existsSync(path.join(packs, 'pack-report.json')) || !commit || !run) {
    fail(
      'usage: node scripts/ui-platform.mjs pin --packs <packed-packages artifact> --commit <sha> --run <CI run URL>',
    );
    process.exit(2);
  }
  const report = readJson(path.join(packs, 'pack-report.json'));
  fs.mkdirSync(VENDOR, { recursive: true });
  for (const file of fs.readdirSync(VENDOR).filter((f) => f.endsWith('.tgz')))
    fs.rmSync(path.join(VENDOR, file));
  const manifest = readJson(CONSUMER);
  const packages = report.packages.map((pkg) => {
    fs.copyFileSync(path.join(packs, pkg.tarball), path.join(VENDOR, pkg.tarball));
    const digest = sha256(path.join(VENDOR, pkg.tarball));
    if (digest !== pkg.tarballSha256)
      throw new Error(`${pkg.tarball}: copied sha256 ${digest} differs from the pack report`);
    manifest.dependencies[pkg.name] = `${SPEC_PREFIX}${pkg.tarball}`;
    return { name: pkg.name, version: pkg.version, tarball: pkg.tarball, sha256: digest };
  });
  writeJson(CONSUMER, manifest);
  writeJson(PIN, {
    $comment:
      'The ui-platform release organization-experience builds on (TDD-organization-experience-001 §Visual Language, Intake). Written by scripts/ui-platform.mjs pin; verified in CI by scripts/ui-platform.mjs verify.',
    repository: REPOSITORY,
    commit,
    ref: 'refs/heads/main',
    run,
    signerWorkflow: SIGNER,
    packages,
  });
  say(
    `Pinned ${packages.map((p) => `${p.name}@${p.version}`).join(', ')} from ${commit.slice(0, 7)}; run pnpm install`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  if (command === 'check') check();
  else if (command === 'verify') verify();
  else if (command === 'pin') pinFrom();
  else {
    fail('usage: node scripts/ui-platform.mjs <pin|check|verify>');
    process.exit(2);
  }
}
