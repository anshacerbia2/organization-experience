#!/usr/bin/env node
// Makes the BFF's client key pair on this machine: keys/NAME.pem, the private key the BFF signs its
// client assertions with, and keys/NAME.jwk.json, the public half. Only the JWK leaves this machine:
// whoever operates the development server installs it on the client (ADR-IAM-001 §5.12).
//
//   node scripts/new-client-key.mjs                      # keys/organization-experience-bff.pem
//   node scripts/new-client-key.mjs organization-experience-bff-next
//
// The key is 3072-bit RSA, the floor STD-IAM-001 §3.2 sets, and its kid is its RFC 7638 thumbprint:
// the same value the BFF computes when it signs, and identity-kernel's client-key when it installs.
// An existing key is never overwritten; replacing one is a rotation (deploy/dev/README.md).
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const name = process.argv[2] ?? 'organization-experience-bff';
if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
  process.stderr.write(`new-client-key: ${name} is not a key name\n`);
  process.exit(2);
}
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'keys');
mkdirSync(dir, { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
const { n, e } = publicKey.export({ format: 'jwk' });
const kid = createHash('sha256').update(`{"e":"${e}","kty":"RSA","n":"${n}"}`).digest('base64url');

const pemPath = join(dir, `${name}.pem`);
const jwkPath = join(dir, `${name}.jwk.json`);
try {
  // 'wx': fail if it exists.
  writeFileSync(pemPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
} catch {
  process.stderr.write(
    `new-client-key: ${pemPath} exists or cannot be written; a key is never overwritten\n`,
  );
  process.exit(1);
}
writeFileSync(jwkPath, `${JSON.stringify({ kty: 'RSA', kid, use: 'sig', alg: 'PS256', n, e }, null, 2)}\n`);

for (const line of [
  `private key ${pemPath} (keep it on this machine)`,
  `public JWK  ${jwkPath} (send this to the server's operator)`,
  `kid         ${kid}`,
]) {
  process.stdout.write(`${line}\n`);
}
