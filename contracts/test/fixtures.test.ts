import { describe, expect, it } from 'vitest';

import { answer, answeredPaths } from '../../e2e/browser/fixtures.ts';
import { organizationControl as contract } from '../src/load.ts';

// Every answer the browser tests' stand-in gives (e2e/browser/fixtures.ts) is one Organization Control
// could give: each route the screenshots, axe and the layout test render is rendered from data in the
// shape the specification declares (TDD-organization-experience-001 1.12.0 §API / Interface).
describe('the browser fixtures against organization-control’s specification', () => {
  it.each(answeredPaths())('GET %s answers what the specification declares', (path) => {
    expect(contract.checkResponse('GET', path, 200, answer(path), { closed: true })).toEqual([]);
  });
});
