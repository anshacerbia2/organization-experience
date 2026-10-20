import specification from '../../../../contracts/organization-control/openapi.yaml?raw';
import { createContract } from '../../../../contracts/src/organization-control';

// Organization Control's published specification, at the commit contracts/organization-control/pin.json
// names (ADR-GLB-010 §5.1, TDD-organization-experience-001 1.12.0 §API / Interface). The stand-in BFF
// (bff.ts) checks every /api/v1/ request a test makes against it, and setup.ts fails the test on any
// request the API would not take.
export const organizationControl = createContract(specification);

const problems: string[] = [];

export function checkSent(url: string, init: RequestInit | undefined): void {
  if (!url.startsWith('/api/v1/')) {
    return;
  }
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
  problems.push(
    ...organizationControl.checkRequest({
      method: init?.method ?? 'GET',
      path: url.replace(/^\/api/, ''),
      headers,
      body,
    }),
  );
}

// contractProblems hands over what was found since the last call, and forgets it.
export function contractProblems(): string[] {
  return problems.splice(0);
}
