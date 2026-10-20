import { useRef } from 'react';

import { ApiError } from './client';

// useIdempotencyKey keeps one key per distinct request (TDD-organization-experience-002 1.2.0, 1.10.0).
//
// - Resubmitting the same values while the first attempt's outcome is unknown reuses the key, so the
//   API answers with what that attempt did instead of acting twice: no answer, a 5xx, or a
//   `409 request-in-progress`, the cases a resend must be recognised as the same command.
// - A changed value is a new request and takes a new key, which the API would otherwise refuse as a
//   key reused for something else.
// - Once the API has answered, success or refusal, the next submission is a new request with a new
//   key, even with the same values. The draft standard's key is what the resource uses "to recognize
//   subsequent retries of the same request"; a second invitation to the same address, or a second
//   Replay, is not a retry. Until 1.10.0 the key followed the values alone, so an identical second
//   issue was answered with the first invitation, once with its token.
export interface IdempotencyKeys {
  // keyFor is the key for a request with these values.
  readonly keyFor: (request: unknown) => string;
  // settle records how the request ended: undefined for an answer that succeeded, the error otherwise.
  readonly settle: (error?: unknown) => void;
}

// unknownOutcome: the command may or may not have been applied, so it is sent again as the same one.
export const unknownOutcome = (error: unknown): boolean =>
  !(error instanceof ApiError) ||
  error.status >= 500 ||
  (error.status === 409 && (error.type ?? '').endsWith('/request-in-progress'));

export function useIdempotencyKey(): IdempotencyKeys {
  const last = useRef<{ digest: string; key: string } | null>(null);
  return {
    keyFor: (request) => {
      const digest = JSON.stringify(request);
      if (last.current?.digest !== digest) {
        last.current = { digest, key: crypto.randomUUID() };
      }
      return last.current.key;
    },
    settle: (error) => {
      if (error === undefined || !unknownOutcome(error)) {
        last.current = null;
      }
    },
  };
}
