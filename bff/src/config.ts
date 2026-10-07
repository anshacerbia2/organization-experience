// Process configuration, read from the environment and nowhere else (STD-GLB-009). Every
// problem is reported at once: an operator fixing a deployment wants the whole list, not one
// variable per restart.

import { readFileSync } from 'node:fs';

import { ClientKeyError, parseClientKey, type ClientKey } from './auth/client-key.js';

export interface Config {
  readonly listenHost: string;
  readonly listenPort: number;

  // webRoot is the built browser application this process serves. The BFF and the application
  // share one origin, so the session cookie, the content security policy and the API proxy all
  // apply to the same pages (TDD-identity-experience-001 §Runtime).
  readonly webRoot: string;

  // publicOrigin is the exact origin the browser uses. It is what the Origin check compares a
  // state-changing request against, so a value with a trailing slash would refuse every one.
  readonly publicOrigin: string;

  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

  readonly oidc: OidcConfig;
  readonly session: SessionConfig;

  // organizationControlBaseUrl is the Organization Control API the proxy forwards to.
  readonly organizationControlBaseUrl: string;
  readonly upstreamTimeoutMs: number;

  // tenantSignIn lets a sign-in ask for one Tenant (ADR-IAM-008): this BFF's client is registered
  // for the per-sign-in form, so Tenant administration and provider administration share it.
  readonly tenantSignIn: boolean;

  readonly provider: ProviderModeConfig;

  readonly databaseUrl: string;
}

// ProviderModeConfig bounds a provider window (TDD-organization-experience-001 §Configuration).
export interface ProviderModeConfig {
  // maxDurationMs is the longest window an operator may ask for; the API has a ceiling of its own.
  readonly maxDurationMs: number;
  // defaultDurationMs is the duration the entry form offers.
  readonly defaultDurationMs: number;
  // stepUpAgeMs is how recent the provider sign-in must be for a window to be requested.
  readonly stepUpAgeMs: number;
}

export interface OidcConfig {
  // issuer is the expected `iss`, exactly as Keycloak's discovery document states it. Every ID
  // token and logout token is validated against it.
  readonly issuer: string;

  // internalBaseUrl is where this process reaches the same realm server to server, when that is
  // not the public issuer: the token and key endpoints are called there, and only the browser is
  // sent to the public one. Keycloak fixes `iss` to its public hostname whatever address it is
  // reached on, so the issuer is still validated as the public one.
  readonly internalBaseUrl: string;

  readonly clientId: string;

  // clientKey is the private key the BFF authenticates to the kernel with, by signed JWT
  // (private_key_jwt). The client has no secret (ADR-IAM-001 §5.12).
  readonly clientKey: ClientKey;

  // redirectUri is the callback registered for this client, exactly, with no wildcard.
  readonly redirectUri: string;
}

export interface SessionConfig {
  readonly idleMs: number;
  readonly absoluteMs: number;
  readonly refreshSkewMs: number;

  // key seals the tokens a session row holds (AES-256-GCM), so a copy of the session table is not
  // a copy of anyone's tokens. 32 bytes, base64.
  readonly key: Buffer;
}

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`configuration: ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

const logLevels = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

const durationPattern = /^(\d+)(ms|s|m|h)$/;
const durationUnits: Readonly<Record<string, number>> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];

  const optional = (name: string): string => env[name]?.trim() ?? '';
  const required = (name: string): string => {
    const value = optional(name);
    if (value === '') {
      problems.push(`${name} is required`);
    }
    return value;
  };

  const origin = (name: string, value: string): void => {
    if (value === '') {
      return;
    }
    try {
      if (new URL(value).origin !== value) {
        problems.push(`${name} must be an exact origin such as https://id.example.com, got ${value}`);
      }
    } catch {
      problems.push(`${name} is not a URL`);
    }
  };

  const url = (name: string, value: string): void => {
    if (value === '') {
      return;
    }
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        problems.push(`${name} must be http or https`);
      }
    } catch {
      problems.push(`${name} is not a URL`);
    }
  };

  const duration = (name: string, fallback: string): number => {
    const raw = optional(name) || fallback;
    const match = durationPattern.exec(raw);
    const unit = match?.[2];
    if (match === null || unit === undefined || Number(match[1]) <= 0) {
      problems.push(`${name}: ${raw} is not a positive duration such as 30m`);
      return 0;
    }
    return Number(match[1]) * (durationUnits[unit] ?? 0);
  };

  // clientKeyFrom reads the client's private key from the file the environment names. The path is
  // configuration; the key is not, so it is read from a file the secret manager mounts and never
  // from a variable. No message carries the key.
  const clientKeyFrom = (path: string): ClientKey | undefined => {
    if (path === '') {
      return undefined;
    }
    try {
      return parseClientKey(readFileSync(path, 'utf8'));
    } catch (error) {
      problems.push(
        `ORGANIZATION_EXPERIENCE_CLIENT_KEY_FILE: ${error instanceof ClientKeyError ? error.message : `${path} could not be read`}`,
      );
      return undefined;
    }
  };

  const publicOrigin = required('ORGANIZATION_EXPERIENCE_PUBLIC_ORIGIN');
  origin('ORGANIZATION_EXPERIENCE_PUBLIC_ORIGIN', publicOrigin);

  const webRoot = required('ORGANIZATION_EXPERIENCE_WEB_ROOT');

  const rawPort = optional('ORGANIZATION_EXPERIENCE_LISTEN_PORT') || '8080';
  const listenPort = Number.parseInt(rawPort, 10);
  if (
    !Number.isInteger(listenPort) ||
    listenPort <= 0 ||
    listenPort > 65535 ||
    String(listenPort) !== rawPort
  ) {
    problems.push(`ORGANIZATION_EXPERIENCE_LISTEN_PORT: ${rawPort} is not a port`);
  }

  const logLevel = optional('LOG_LEVEL') || 'info';
  if (!logLevels.has(logLevel)) {
    problems.push(`LOG_LEVEL: ${logLevel} is not one of ${[...logLevels].join(', ')}`);
  }

  const issuer = required('ORGANIZATION_EXPERIENCE_ISSUER');
  url('ORGANIZATION_EXPERIENCE_ISSUER', issuer);
  const internalBaseUrl = optional('ORGANIZATION_EXPERIENCE_KEYCLOAK_INTERNAL_URL') || issuer;
  url('ORGANIZATION_EXPERIENCE_KEYCLOAK_INTERNAL_URL', internalBaseUrl);
  const clientId = required('ORGANIZATION_EXPERIENCE_CLIENT_ID');
  const clientKey = clientKeyFrom(required('ORGANIZATION_EXPERIENCE_CLIENT_KEY_FILE'));
  const redirectUri = required('ORGANIZATION_EXPERIENCE_REDIRECT_URI');
  url('ORGANIZATION_EXPERIENCE_REDIRECT_URI', redirectUri);
  // The callback is this process's /auth/callback on the public origin, where the session cookie
  // is set. Any other value is a misconfiguration that would fail at the first sign-in.
  if (redirectUri !== '' && publicOrigin !== '' && redirectUri !== `${publicOrigin}/auth/callback`) {
    problems.push(`ORGANIZATION_EXPERIENCE_REDIRECT_URI must be ${publicOrigin}/auth/callback`);
  }
  // The browser is sent to the issuer, so it is TLS everywhere but a developer's own machine. The
  // internal address may be plain HTTP inside a private network: the ID token's signature is
  // verified regardless (see auth/oidc.ts).
  if (issuer !== '' && URL.canParse(issuer)) {
    const parsed = new URL(issuer);
    if (parsed.protocol !== 'https:' && !loopbackHosts.has(parsed.hostname)) {
      problems.push('ORGANIZATION_EXPERIENCE_ISSUER must be https unless it is on this machine');
    }
  }

  const idleMs = duration('ORGANIZATION_EXPERIENCE_SESSION_IDLE', '30m');
  const absoluteMs = duration('ORGANIZATION_EXPERIENCE_SESSION_ABSOLUTE', '8h');
  const refreshSkewMs = duration('ORGANIZATION_EXPERIENCE_REFRESH_SKEW', '30s');
  if (idleMs > 0 && absoluteMs > 0 && idleMs > absoluteMs) {
    problems.push(
      'ORGANIZATION_EXPERIENCE_SESSION_IDLE must not exceed ORGANIZATION_EXPERIENCE_SESSION_ABSOLUTE',
    );
  }

  const rawKey = required('ORGANIZATION_EXPERIENCE_SESSION_KEY');
  const key = Buffer.from(rawKey, 'base64');
  if (rawKey !== '' && key.length !== 32) {
    problems.push('ORGANIZATION_EXPERIENCE_SESSION_KEY must be 32 bytes, base64-encoded');
  }

  const organizationControlBaseUrl = required('ORGANIZATION_EXPERIENCE_ORGANIZATION_CONTROL_URL');
  url('ORGANIZATION_EXPERIENCE_ORGANIZATION_CONTROL_URL', organizationControlBaseUrl);
  const upstreamTimeoutMs = duration('ORGANIZATION_EXPERIENCE_UPSTREAM_TIMEOUT', '10s');

  const maxDurationMs = duration('ORGANIZATION_EXPERIENCE_PROVIDER_MAX_DURATION', '60m');
  const defaultDurationMs = duration('ORGANIZATION_EXPERIENCE_PROVIDER_DEFAULT_DURATION', '15m');
  const stepUpAgeMs = duration('ORGANIZATION_EXPERIENCE_PROVIDER_STEP_UP_AGE', '5m');
  if (defaultDurationMs > maxDurationMs) {
    problems.push(
      'ORGANIZATION_EXPERIENCE_PROVIDER_DEFAULT_DURATION must not exceed ORGANIZATION_EXPERIENCE_PROVIDER_MAX_DURATION',
    );
  }
  // A window is asked for in whole minutes, so the bounds are too.
  for (const [name, value] of [
    ['ORGANIZATION_EXPERIENCE_PROVIDER_MAX_DURATION', maxDurationMs],
    ['ORGANIZATION_EXPERIENCE_PROVIDER_DEFAULT_DURATION', defaultDurationMs],
  ] as const) {
    if (value > 0 && value % 60_000 !== 0) {
      problems.push(`${name} must be a whole number of minutes`);
    }
  }

  const databaseUrl = required('ORGANIZATION_EXPERIENCE_DATABASE_URL');

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return {
    listenHost: optional('ORGANIZATION_EXPERIENCE_LISTEN_HOST') || '0.0.0.0',
    listenPort,
    webRoot,
    publicOrigin,
    logLevel: logLevel as Config['logLevel'],
    // clientKey is set whenever problems is empty: clientKeyFrom reports every other outcome.
    oidc: { issuer, internalBaseUrl, clientId, clientKey: clientKey as ClientKey, redirectUri },
    session: { idleMs, absoluteMs, refreshSkewMs, key },
    organizationControlBaseUrl: organizationControlBaseUrl.replace(/\/+$/, ''),
    upstreamTimeoutMs,
    tenantSignIn: true,
    provider: { maxDurationMs, defaultDurationMs, stepUpAgeMs },
    databaseUrl,
  };
}
