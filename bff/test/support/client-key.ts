import { createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseClientKey, type ClientKey } from '../../src/auth/client-key.js';

// One client key pair for the test process: a 3072-bit RSA key is slow enough to generate that one
// per test would dominate the run. The BFF signs with the private half; the stand-in identity
// provider verifies with the public half, as the kernel does with the key registered on the client.

interface TestClientKey {
  readonly pem: string;
  readonly key: ClientKey;
  readonly publicKey: KeyObject;
  readonly file: string;
}

let cached: TestClientKey | undefined;

export function testClientKey(): TestClientKey {
  if (cached === undefined) {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const file = join(mkdtempSync(join(tmpdir(), 'bff-client-key-')), 'client.pem');
    writeFileSync(file, pem, { mode: 0o600 });
    cached = { pem, key: parseClientKey(pem), publicKey: createPublicKey(privateKey), file };
  }
  return cached;
}
