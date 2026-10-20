import { readFileSync } from 'node:fs';

import { createContract, type Contract } from './organization-control.ts';

// The vendored specification, read from disk for the contract package's own tests. The application's
// tests import the same file as text through Vite (apps/admin/src/test/contract.ts).
export const organizationControl: Contract = createContract(
  readFileSync(new URL('../organization-control/openapi.yaml', import.meta.url), 'utf8'),
);
