// Copied from identity-experience at f5424f0ea78dae6db7096f457b54c8894e275c67 (its pull request
// #66), packages/ui/src/system/button/Button.test.tsx. TDD-organization-experience-001 §Visual
// Language records the copy.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { Button } from './Button';
import { Icon } from '../icon/Icon';

// The platform's Button as the applications compose it: what they rely on, held here so an upgrade of
// the pinned package that changed it fails in this repository.
describe('Button', () => {
  it('is a button of type "button" unless told otherwise, so it never submits a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('exposes its variant and size for the stylesheet to bind to', () => {
    render(
      <Button variant="danger" size="small">
        Revoke
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Revoke' });
    expect(button).toHaveAttribute('data-variant', 'danger');
    expect(button).toHaveAttribute('data-size', 'small');
  });

  it('is primary unless told otherwise', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('data-variant', 'primary');
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

  it('keeps a decorative icon out of its accessible name', () => {
    render(
      <Button>
        <Icon name="check" />
        Reconcile
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Reconcile' });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
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
