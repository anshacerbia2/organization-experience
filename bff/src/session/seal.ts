import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// randomToken is 256 bits from the operating system's generator, base64url: a session cookie, a
// login binding, a CSRF token.
export const randomToken = (): string => randomBytes(32).toString('base64url');

// digest is what a row is keyed by, so the table never holds a value a browser presents.
export const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

// equalSecrets compares in constant time. Digesting first makes the inputs equal-length, which
// timingSafeEqual requires, without leaking the length of either.
export const equalSecrets = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b));

const version = 1;
const ivLength = 12;
const tagLength = 16;

// Sealer encrypts what a session row holds with AES-256-GCM. The associated data binds a sealed
// value to its row: a sealed token set copied into another session's row does not open.
export class Sealer {
  readonly #key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) {
      throw new Error('a sealing key is 32 bytes');
    }
    this.#key = key;
  }

  seal(plaintext: string, binding: Buffer): Buffer {
    const iv = randomBytes(ivLength);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv, { authTagLength: tagLength });
    cipher.setAAD(binding);
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.of(version), iv, cipher.getAuthTag(), body]);
  }

  // open throws on a value that was altered, sealed under another key, or bound to another row.
  open(sealed: Buffer, binding: Buffer): string {
    if (sealed.length < 1 + ivLength + tagLength || sealed[0] !== version) {
      throw new Error('not a sealed value');
    }
    const iv = sealed.subarray(1, 1 + ivLength);
    const tag = sealed.subarray(1 + ivLength, 1 + ivLength + tagLength);
    const decipher = createDecipheriv('aes-256-gcm', this.#key, iv, { authTagLength: tagLength });
    decipher.setAAD(binding);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(sealed.subarray(1 + ivLength + tagLength)),
      decipher.final(),
    ]).toString('utf8');
  }
}
