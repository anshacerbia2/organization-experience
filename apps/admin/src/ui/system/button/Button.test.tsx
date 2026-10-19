// Ported from identity-experience at c723e417c0eee97db6b1d5b6dab608fe6a406ac2, packages/ui/src/system/button/Button.test.tsx
// (TDD-organization-experience-001 §Visual Language).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { Button } from './Button';

describe('Button', () => {
  it('is a button of type "button" unless told otherwise, so it never submits a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('exposes its variant and size for the stylesheet to bind to', () => {
    render(
      <Button variant="danger" size="sm">
        Revoke
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Revoke' });
    expect(button).toHaveAttribute('data-variant', 'danger');
    expect(button).toHaveAttribute('data-size', 'sm');
  });

  it('announces a toggle as pressed', () => {
    render(<Button pressed>EN</Button>);
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not act when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Relink
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Relink' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a link when given href, and a disabled link loses its destination', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button href="/registrations">Registrations</Button>);
    expect(screen.getByRole('link', { name: 'Registrations' })).toHaveAttribute('href', '/registrations');

    rerender(
      <Button href="/registrations" disabled onClick={onClick}>
        Registrations
      </Button>,
    );
    const link = screen.getByText('Registrations').closest('a');
    expect(link).not.toHaveAttribute('href');
    expect(link).toHaveAttribute('aria-disabled', 'true');
    if (link !== null) {
      await userEvent.click(link);
    }
    expect(onClick).not.toHaveBeenCalled();
  });

  it('hides a decorative icon from assistive technology', () => {
    render(<Button icon={<svg data-testid="icon" />}>Reconcile</Button>);
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Reconcile' })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button href="/x">Link</Button>
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
