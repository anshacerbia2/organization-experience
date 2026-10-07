// The calls this BFF makes to the Organization Control API on its own account, to open and close a
// provider window (TDD-organization-experience-001 1.2.0 §Provider Mode Entry). Each carries the
// session's access token, the operator's reason and the window's correlation identifier, as every
// provider request must (TDD-organization-control-001 §Provider Activation). The API decides; this
// only asks.

// The provider scope this application administers under (TDD-organization-control-001).
export const organizationControlScope = 'provider:organization-control';

export interface Grant {
  readonly grantId: string;
  readonly scope: string;
  readonly kind: 'eligible' | 'emergency';
}

export interface Activation {
  readonly activationId: string;
  // decision is null while the activation awaits approval; approved, denied or lapsed after.
  readonly decision: string | null;
  readonly endsAt: Date | null;
  readonly inForce: boolean;
  readonly endedAt: Date | null;
}

// ControlRefused is the API's answer to a request it refused, with the problem document it wrote,
// which the BFF passes on unchanged: the API's own sentence names the rule.
export class ControlRefused extends Error {
  override readonly name = 'ControlRefused';

  constructor(
    readonly status: number,
    readonly contentType: string | null,
    readonly body: Buffer,
  ) {
    super(`organization-control refused: ${String(status)}`);
  }
}

// ControlUnavailable is an API that did not answer, or answered with a server error.
export class ControlUnavailable extends Error {
  override readonly name = 'ControlUnavailable';
}

interface ActivationView {
  readonly activation_id?: unknown;
  readonly decision?: unknown;
  readonly ends_at?: unknown;
  readonly in_force?: unknown;
  readonly ended_at?: unknown;
}

const time = (value: unknown): Date | null => (typeof value === 'string' ? new Date(value) : null);

function activationOf(view: ActivationView): Activation {
  if (typeof view.activation_id !== 'string') {
    throw new ControlUnavailable('organization-control answered an activation without an identifier');
  }
  return {
    activationId: view.activation_id,
    decision: typeof view.decision === 'string' && view.decision !== '' ? view.decision : null,
    endsAt: time(view.ends_at),
    inForce: view.in_force === true,
    endedAt: time(view.ended_at),
  };
}

export interface Call {
  readonly accessToken: string;
  // reason travels in X-Administrative-Reason: visible US-ASCII, which the API requires.
  readonly reason: string;
  readonly correlationId: string;
}

export class OrganizationControl {
  readonly #root: string;
  readonly #timeoutMs: number;

  constructor(baseUrl: string, timeoutMs: number) {
    this.#root = `${baseUrl}/v1`;
    this.#timeoutMs = timeoutMs;
  }

  // ownGrants are the operator's own unrevoked provider grants, which an eligible holder reads
  // before asking to activate one.
  async ownGrants(call: Call): Promise<Grant[]> {
    const body = (await this.#send('GET', '/provider-activations/grants', call)) as { grants?: unknown };
    const grants = Array.isArray(body.grants) ? (body.grants as Record<string, unknown>[]) : [];
    return grants.flatMap((grant) =>
      typeof grant.grant_id === 'string' &&
      typeof grant.scope === 'string' &&
      (grant.kind === 'eligible' || grant.kind === 'emergency')
        ? [{ grantId: grant.grant_id, scope: grant.scope, kind: grant.kind }]
        : [],
    );
  }

  async requestActivation(call: Call, grantId: string, durationSeconds: number): Promise<Activation> {
    return activationOf(
      (await this.#send('POST', '/provider-activations', call, {
        grant_id: grantId,
        duration_seconds: durationSeconds,
      })) as ActivationView,
    );
  }

  // activation reads one activation from the list the API keeps of pending, in-force and recent
  // ones; null when it is no longer among them.
  async activation(call: Call, activationId: string): Promise<Activation | null> {
    const body = (await this.#send('GET', '/provider-activations', call)) as { activations?: unknown };
    const views = Array.isArray(body.activations) ? (body.activations as ActivationView[]) : [];
    const view = views.find((candidate) => candidate.activation_id === activationId);
    return view === undefined ? null : activationOf(view);
  }

  async endActivation(call: Call, activationId: string): Promise<void> {
    await this.#send('POST', `/provider-activations/${encodeURIComponent(activationId)}/end`, call, {});
  }

  async #send(method: 'GET' | 'POST', path: string, call: Call, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.#root}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${call.accessToken}`,
          'x-administrative-reason': call.reason,
          'x-correlation-id': call.correlationId,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new ControlUnavailable('organization-control could not be reached', { cause: error });
    }
    if (response.status >= 500) {
      await response.body?.cancel();
      throw new ControlUnavailable(`organization-control answered ${String(response.status)}`);
    }
    if (!response.ok) {
      throw new ControlRefused(
        response.status,
        response.headers.get('content-type'),
        Buffer.from(await response.arrayBuffer()),
      );
    }
    const text = await response.text();
    return text === '' ? {} : (JSON.parse(text) as unknown);
  }
}
