import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Facts } from './Rows';
import { facts } from '../../features/common';

describe('Facts', () => {
  it('reads the same words, in the same order, as the facts() string, a status among them', () => {
    const { container } = render(
      <Facts items={['human', { status: 'suspended', label: 'suspended' }, null, 'version 5', '']} />,
    );
    expect(container.textContent).toBe(facts('human', 'suspended', null, 'version 5', ''));
    expect(container.querySelector('[data-tone="warning"]')).toHaveTextContent('suspended');
  });
});
