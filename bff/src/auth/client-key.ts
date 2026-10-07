import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';

// The BFF is a confidential client that authenticates with its own key pair, never a shared secret
// (ADR-IAM-001 §5.12, STD-IAM-001 §3.2). This is the private half it signs client assertions with.
// The kernel holds only the public half, registered on the client.
//
// The key identifier is the key's RFC 7638 thumbprint, computed from the key itself, so the
// deployable is configured with one file and nothing that has to agree with it. identity-kernel's
// client-key tool and scripts/new-client-key.mjs compute the same value when they register the key.

// The smallest RSA modulus a client key may have: STD-IAM-001 §3.2, the floor STD-IAM-002 §3.2.2
// sets for signing keys.
export const minClientKeyBits = 3072;

export interface ClientKey {
  readonly kid: string;
  readonly privateKey: KeyObject;
}

export class ClientKeyError extends Error {}

// thumbprint is the RFC 7638 SHA-256 thumbprint of an RSA public JWK: its required members in
// lexicographic order, with no whitespace.
export function thumbprint(jwk: { readonly e: string; readonly n: string }): string {
  return createHash('sha256').update(`{"e":"${jwk.e}","kty":"RSA","n":"${jwk.n}"}`).digest('base64url');
}

// parseClientKey reads an RSA private key in PEM and refuses anything else, or one below
// minClientKeyBits. The message never carries the key.
export function parseClientKey(pem: string): ClientKey {
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(pem);
  } catch {
    throw new ClientKeyError('the client key is not a PEM private key');
  }
  if (privateKey.asymmetricKeyType !== 'rsa') {
    throw new ClientKeyError('the client key is not an RSA key');
  }
  const bits = privateKey.asymmetricKeyDetails?.modulusLength ?? 0;
  if (bits < minClientKeyBits) {
    throw new ClientKeyError(`the client key is ${bits} bits; at least ${minClientKeyBits} are required`);
  }
  const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' });
  if (typeof publicJwk.n !== 'string' || typeof publicJwk.e !== 'string') {
    throw new ClientKeyError('the client key has no RSA public members');
  }
  return { kid: thumbprint({ n: publicJwk.n, e: publicJwk.e }), privateKey };
}
