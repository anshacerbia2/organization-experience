// Ported from identity-experience at c723e417c0eee97db6b1d5b6dab608fe6a406ac2, packages/ui/src/system/status-pill/StatusPill.test.tsx
// (TDD-organization-experience-001 §Visual Language).
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusPill } from './StatusPill';

describe('StatusPill', () => {
  it('states its status in words, with the glyph hidden, so colour is never the only signal', () => {
    render(<StatusPill tone="danger">Blocked</StatusPill>);
    const pill = screen.getByText('Blocked');
    expect(pill).toHaveAttribute('data-tone', 'danger');
    expect(pill.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives each tone its own glyph', () => {
    const { container } = render(
      <>
        <StatusPill tone="success">Converged</StatusPill>
        <StatusPill tone="warning">Drift</StatusPill>
        <StatusPill tone="neutral">Planned</StatusPill>
      </>,
    );
    const glyphs = [...container.querySelectorAll('path')].map((path) => path.getAttribute('d'));
    expect(new Set(glyphs).size).toBe(3);
  });
});
