// What the stack-level journeys need from the stack the workflow brought up: the people the seed made,
// the kernel's hosted login answered as a person answers it, the realm's one-time codes, the BFFs'
// session stores read for the instants a bound is computed from, the kernel's administrator for the
// instants the kernel applied a change, and the evidence the run leaves (STD-GLB-009 §Stack-Level
// Proofs, rules 5 and 6).
import { createHash, createHmac } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { APIResponse, BrowserContext, Page } from '@playwright/test';
import pg from 'pg';

export function required(name: string): string {
  const value = process.env[name]?.trim() ?? '';
  if (value === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

export const organizationExperience = required('ORGANIZATION_EXPERIENCE_URL').replace(/\/+$/, '');
export const identityExperience = required('IDENTITY_EXPERIENCE_URL').replace(/\/+$/, '');

// The class L0 figures this proof measures against (STD-IAM-002 §3.3): a four-minute access token and
// a five-minute revocation target, which is the 60-second propagation budget plus that lifetime
// (SAD-001 §7.7).
export const l0LifetimeSeconds = 240;
export const l0RevocationTargetSeconds = 300;

export interface Person {
  readonly username: string;
  readonly password: string;
  readonly principalId: string;
}

export interface Seed {
  readonly run: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly operator: Person;
  readonly provider: Person;
  readonly administrator: Person;
  readonly device: Person;
}

// seed reads what e2e/seed.ps1 made. The operator's password is identity-control's
// IDENTITY_CALLER_PASSWORD, read from the environment rather than written to the file.
export function seed(): Seed {
  const file = JSON.parse(readFileSync(required('STACK_SEED_FILE'), 'utf8')) as Omit<Seed, 'operator'> & {
    readonly operator: Omit<Person, 'password'>;
  };
  return { ...file, operator: { ...file.operator, password: required('IDENTITY_CALLER_PASSWORD') } };
}

// --- one-time codes ---------------------------------------------------------------------------

// The realm's policy: HmacSHA1, 30-second steps, six digits, keyed with the secret's bytes as the
// enrolment page holds them (identity-kernel's browser/tests/kernel.ts, compat/levels_test.go).
function totp(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const sum = createHmac('sha1', Buffer.from(secret)).update(counter).digest();
  const offset = (sum.at(-1) ?? 0) & 0x0f;
  return String((sum.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

// Codes gives a code for a step no earlier code used: the kernel accepts a code once.
export abstract class Codes {
  protected abstract secret(): string;
  protected abstract lastStep(): number;
  protected abstract used(step: number): void;

  async next(page: Page): Promise<string> {
    let step = Math.floor(Date.now() / 30_000);
    const last = this.lastStep();
    if (step <= last) {
      await page.waitForTimeout((last + 1) * 30_000 - Date.now() + 1_000);
      step = Math.floor(Date.now() / 30_000);
    }
    this.used(step);
    return totp(this.secret(), step);
  }
}

// EnrolledCodes holds a TOTP this run enrolled in the browser, in memory.
export class EnrolledCodes extends Codes {
  #last = 0;
  constructor(private readonly value: string) {
    super();
  }
  protected secret(): string {
    return this.value;
  }
  protected lastStep(): number {
    return this.#last;
  }
  protected used(step: number): void {
    this.#last = step;
  }
}

// FileCodes is the bootstrap operator's TOTP, which identity-control's dev-token.ps1 enrolled into
// IDENTITY_OPERATOR_TOTP_FILE. The step used is written back, as dev-token.ps1 writes it, so the two
// never present the same code.
export class FileCodes extends Codes {
  constructor(private readonly file: string) {
    super();
  }
  #read(): { secret: string; last?: number } & Record<string, unknown> {
    return JSON.parse(readFileSync(this.file, 'utf8')) as { secret: string; last?: number };
  }
  protected secret(): string {
    return this.#read().secret;
  }
  protected lastStep(): number {
    return this.#read().last ?? -1;
  }
  protected used(step: number): void {
    writeFileSync(this.file, JSON.stringify({ ...this.#read(), last: step }), { mode: 0o600 });
  }
}

// --- the kernel's hosted login ------------------------------------------------------------------

export type Surface = 'password' | 'otp' | 'configure-totp' | 'recovery-codes';

export interface Credentials {
  readonly person: Person;
  codes: Codes | null;
}

async function surface(page: Page): Promise<Surface> {
  const present = async (selector: string): Promise<boolean> => (await page.locator(selector).count()) > 0;
  if (await present('#kcRecoveryCodesConfirmationCheck')) return 'recovery-codes';
  if (await present('#totpSecret')) return 'configure-totp';
  if (await present('input[name=otp]')) return 'otp';
  if (await present('#password')) return 'password';
  throw new Error(`an unexpected page at ${page.url()}: ${await page.title()}`);
}

// submits runs an action that ends in a navigation and waits for the page it loads.
export async function submits(page: Page, action: () => Promise<void>): Promise<void> {
  const loaded = page.waitForEvent('load', { timeout: 30_000 });
  await action();
  await loaded;
}

// signIn answers each page the kernel shows until the browser is back on the BFF's origin, and returns
// the pages it answered. It starts on the first kernel page, or on the BFF when the kernel's session
// let the sign-in through without a page.
export async function signIn(page: Page, bff: string, credentials: Credentials): Promise<Surface[]> {
  const shown: Surface[] = [];
  for (let step = 0; step < 10; step++) {
    await page.waitForLoadState('load');
    const url = new URL(page.url());
    if (url.origin === bff && !url.pathname.startsWith('/auth/')) {
      const outcome = url.searchParams.get('sign-in');
      if (outcome !== null) {
        throw new Error(`the BFF landed the sign-in on ?sign-in=${outcome}`);
      }
      return shown;
    }
    const current = await surface(page);
    shown.push(current);
    switch (current) {
      case 'password':
        // On a re-authentication the kernel already knows the person and asks for the password alone.
        if (await page.locator('#username').isVisible()) {
          await page.locator('#username').fill(credentials.person.username);
        }
        await page.locator('#password').fill(credentials.person.password);
        await submits(page, () => page.locator('#password').press('Enter'));
        break;
      case 'configure-totp': {
        credentials.codes = new EnrolledCodes(await page.locator('#totpSecret').inputValue());
        await page.locator('#totp').fill(await credentials.codes.next(page));
        await page.locator('#userLabel').fill('stack-proof');
        await submits(page, () => page.locator('#saveTOTPBtn').click());
        break;
      }
      case 'recovery-codes':
        await page.locator('#kcRecoveryCodesConfirmationCheck').check();
        await submits(page, () => page.locator('#saveRecoveryAuthnCodesBtn').click());
        break;
      case 'otp': {
        if (credentials.codes === null) {
          throw new Error(
            `the kernel asked ${credentials.person.username} for a code before one was enrolled`,
          );
        }
        const code = await credentials.codes.next(page);
        await page.locator('input[name=otp]').fill(code);
        await submits(page, () => page.locator('input[name=otp]').press('Enter'));
        break;
      }
    }
  }
  throw new Error(`the sign-in did not return to ${bff}; pages ${shown.join(',')}`);
}

// --- the BFF session stores ----------------------------------------------------------------------

export const sessionCookie = '__Host-ident_session';

// sessionCookieOf reads the context's session cookie. Asked for by an http:// URL, Playwright leaves
// out a Secure cookie, and every cookie here is Secure on a loopback origin, so the context's whole jar
// is read: each context signs in to one BFF, on one host.
export async function sessionCookieOf(context: BrowserContext, origin: string): Promise<string> {
  const host = new URL(origin).hostname;
  const cookie = (await context.cookies()).find((c) => c.name === sessionCookie && c.domain === host);
  if (cookie === undefined) {
    throw new Error(`no ${sessionCookie} for ${origin}`);
  }
  return cookie.value;
}

export interface SessionRow {
  readonly accessExpiresAt: Date;
  readonly keycloakSessionId: string | null;
}

// sessionRow reads the row a cookie names, keyed by the cookie's SHA-256 as the pattern keys it
// (bff/src/session/seal.ts). access_expires_at is the expiry of the access token the session holds.
// A connection per read: a journey reads a few dozen times, and nothing is left open between files.
export async function sessionRow(schema: string, cookie: string): Promise<SessionRow | null> {
  if (!/^[a-z_]+$/.test(schema)) {
    throw new Error(`${schema} is not a schema name`);
  }
  const client = new pg.Client({ connectionString: required('BFF_DATABASE_URL') });
  await client.connect();
  try {
    const result = await client.query<{ access_expires_at: Date; keycloak_session_id: string | null }>(
      `SELECT access_expires_at, keycloak_session_id FROM ${schema}.sessions WHERE id_hash = $1`,
      [createHash('sha256').update(cookie).digest()],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { accessExpiresAt: row.access_expires_at, keycloakSessionId: row.keycloak_session_id };
  } finally {
    await client.end();
  }
}

// --- the kernel, read as its console administrator -------------------------------------------------

const kernelAdmin = required('KC_ADMIN_URL').replace(/\/+$/, '');

// The master realm's tokens live a minute and a journey waits longer, so every call asks for one.
async function adminToken(): Promise<string> {
  const response = await fetch(`${kernelAdmin}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: process.env.KC_BOOTSTRAP_ADMIN_USERNAME ?? 'admin',
      password: required('KC_BOOTSTRAP_ADMIN_PASSWORD'),
    }),
  });
  if (!response.ok) {
    throw new Error(`the console administrator's token was refused with ${response.status}`);
  }
  return ((await response.json()) as { access_token: string }).access_token;
}

export async function kernel<T>(pathAndQuery: string): Promise<T> {
  const response = await fetch(`${kernelAdmin}/admin/realms/scnehaux${pathAndQuery}`, {
    headers: { authorization: `Bearer ${await adminToken()}` },
  });
  if (!response.ok) {
    throw new Error(`the kernel answered ${response.status} to GET ${pathAndQuery}`);
  }
  return (await response.json()) as T;
}

export async function kernelUserOf(principalId: string): Promise<string> {
  const users = await kernel<{ id: string }[]>(`/users?q=scnehaux_principal_id:${principalId}&exact=true`);
  const user = users[0];
  if (users.length !== 1 || user === undefined) {
    throw new Error(`${users.length} kernel users carry ${principalId}`);
  }
  return user.id;
}

// backChannelLogoutUrl is the URL the kernel posts a logout token to for a client, or null when none
// is registered (OpenID Connect Back-Channel Logout 1.0 §2.5).
export async function backChannelLogoutUrl(clientId: string): Promise<string | null> {
  const clients = await kernel<{ attributes?: Record<string, string> }[]>(
    `/clients?clientId=${encodeURIComponent(clientId)}`,
  );
  const value = clients[0]?.attributes?.['backchannel.logout.url'] ?? '';
  return value === '' ? null : value;
}

// waitUntil polls a condition every interval until it holds, and returns the instant it was seen.
export async function waitUntil(
  label: string,
  timeoutMs: number,
  intervalMs: number,
  condition: () => Promise<boolean>,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label}: not within ${timeoutMs / 1000} s`);
}

// --- an active tab ----------------------------------------------------------------------------

export interface Sample {
  readonly sentAt: number;
  readonly at: number;
  readonly status: number;
}

// ActiveTab is a tab in use: it reads an API route through the BFF once a second with the context's
// cookie, as an open page that keeps working does. Every read is a request that presents the session's
// access token, so the BFF refreshes it near expiry (TDD-identity-experience-001 §Refresh).
export class ActiveTab {
  readonly samples: Sample[] = [];
  #running = false;
  #loop: Promise<void> = Promise.resolve();

  constructor(
    private readonly context: BrowserContext,
    private readonly url: string,
  ) {}

  start(): void {
    this.#running = true;
    this.#loop = this.#run();
  }

  async stop(): Promise<void> {
    this.#running = false;
    await this.#loop;
  }

  async #run(): Promise<void> {
    while (this.#running) {
      const sentAt = Date.now();
      let response: APIResponse | null = null;
      try {
        response = await this.context.request.get(this.url, { failOnStatusCode: false, maxRedirects: 0 });
      } catch {
        response = null;
      }
      this.samples.push({ sentAt, at: Date.now(), status: response?.status() ?? 0 });
      if (response?.status() === 401) {
        // The session is gone; a further read only repeats it.
        this.#running = false;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1_000 - (Date.now() - sentAt))));
    }
  }

  // firstAfter is the first answer to a read sent at or after the instant with the given status.
  firstAfter(instant: number, status: number): Sample | undefined {
    return this.samples.find((s) => s.sentAt >= instant && s.status === status);
  }
}

// --- evidence ---------------------------------------------------------------------------------

const evidenceDir = required('STACK_EVIDENCE_DIR');

export function refs(): Record<string, string> {
  return {
    organization_experience: process.env.GITHUB_SHA ?? 'local',
    kernel: process.env.KERNEL_REF ?? 'main',
    identity_control: process.env.IDENTITY_REF ?? 'main',
    organization_control: process.env.ORGANIZATION_REF ?? 'main',
    identity_experience: process.env.IDENTITY_EXPERIENCE_REF ?? 'main',
  };
}

export function run(): string | null {
  const server = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const id = process.env.GITHUB_RUN_ID;
  return server === undefined || repository === undefined || id === undefined
    ? null
    : `${server}/${repository}/actions/runs/${id}`;
}

export function writeEvidence(name: string, evidence: Record<string, unknown>): void {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    path.join(evidenceDir, `${name}.json`),
    `${JSON.stringify({ ...evidence, refs: refs(), run: run(), recorded_at: new Date().toISOString() }, null, 2)}\n`,
  );
}

// summarize adds lines to the job summary, when there is one.
export function summarize(lines: readonly string[]): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file !== undefined && file !== '') {
    appendFileSync(file, `${lines.join('\n')}\n`);
  }
}

export const iso = (instant: number | Date): string => new Date(instant).toISOString();
export const seconds = (ms: number): number => Math.round(ms) / 1000;

// patternMatches says whether the BFF pattern's files this repository carries byte for byte
// (bff/conformance.json) are the same as identity-experience's at the ref the run checked out, so the
// evidence states whose code was measured.
export function patternMatches(): { identical: boolean; differing: string[] } {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const source = required('IDENTITY_EXPERIENCE_DIR');
  const manifest = JSON.parse(readFileSync(path.join(root, 'bff/conformance.json'), 'utf8')) as {
    identical: string[];
  };
  const differing = manifest.identical.filter((file) => {
    try {
      return !readFileSync(path.join(root, file)).equals(readFileSync(path.join(source, file)));
    } catch {
      return true;
    }
  });
  return { identical: differing.length === 0, differing };
}
