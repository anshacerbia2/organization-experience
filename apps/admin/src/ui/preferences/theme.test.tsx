import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { themeStorageKey, useTheme } from './theme';
import { ThemeToggle } from './ThemeToggle';

function Harness() {
  const { theme, choose } = useTheme();
  return <ThemeToggle theme={theme} onChoose={choose} />;
}

const system = (light: boolean): void => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: light, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
};

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset['theme'];
  vi.unstubAllGlobals();
});

describe('the theme', () => {
  it('follows the system until the viewer chooses, and stores nothing until then', () => {
    system(true);
    render(<Harness />);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(screen.getByRole('button', { name: 'Switch to the dark theme' })).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
  });

  it('opens dark where the system states no preference', () => {
    render(<Harness />);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('keeps the viewer’s choice, and reads it before the system', async () => {
    system(false);
    const { unmount } = render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch to the light theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(JSON.parse(window.localStorage.getItem(themeStorageKey) ?? '{}')).toEqual({ theme: 'light' });
    unmount();

    render(<Harness />);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });
});
