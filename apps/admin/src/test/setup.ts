import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

import { contractProblems } from './contract';

expect.extend(axeMatchers);

afterEach(() => {
  cleanup();
  // A request the test made that Organization Control's specification does not take fails the test
  // (TDD-organization-experience-001 1.12.0 §API / Interface).
  expect(contractProblems()).toEqual([]);
});
