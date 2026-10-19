import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Notice } from './Notice';

describe('Notice', () => {
  it('states its message in words, with the glyph hidden, and takes the role it is given', () => {
    render(
      <Notice tone="danger" role="alert">
        <p>Not done.</p>
      </Notice>,
    );
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent('Not done.');
    expect(notice).toHaveAttribute('data-tone', 'danger');
    expect(notice.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
