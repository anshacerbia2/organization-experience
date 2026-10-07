import { useRef } from 'react';

// useIdempotencyKey keeps one key per distinct request (TDD-organization-experience-002 1.2.0).
// Resubmitting the same values after an outage reuses it, so the API answers with what the first
// attempt did instead of acting twice; a changed value is a new request and takes a new key, which
// the API would otherwise refuse as a key reused for something else.
export function useIdempotencyKey(): (request: unknown) => string {
  const last = useRef<{ digest: string; key: string } | null>(null);
  return (request) => {
    const digest = JSON.stringify(request);
    if (last.current?.digest !== digest) {
      last.current = { digest, key: crypto.randomUUID() };
    }
    return last.current.key;
  };
}
