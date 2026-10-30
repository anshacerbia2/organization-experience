import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { themeStorageKey, ThemeRoot } from './ThemeRoot';
import { ThemeToggle } from './ThemeToggle';

function Harness() {
  return (
    <ThemeRoot>
      <ThemeToggle />
    </ThemeRoot>
  );
}

// The system's colour scheme, as matchMedia answers a prefers-color-scheme query for it.
const system = (light: boolean): void => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('dark') ? !light : light,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
};

const html = document.documentElement;

afterEach(() => {
  window.localStorage.clear();
  html.removeAttribute('data-scnx-theme');
  html.removeAttribute('data-scnx-resolved-mode');
  vi.unstubAllGlobals();
});

describe('the theme', () => {
  it('is the platform theme on the document root', () => {
    render(<Harness />);
    expect(html).toHaveAttribute('data-scnx-theme', 'scnx-platform');
  });

  it('follows the system until the viewer chooses, and stores nothing until then', () => {
    system(true);
    render(<Harness />);
    expect(html).toHaveAttribute('data-scnx-resolved-mode', 'light');
    expect(screen.getByRole('button', { name: 'Switch to the dark theme' })).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
  });

  it('opens dark where the system is dark', () => {
    system(false);
    render(<Harness />);
    expect(html).toHaveAttribute('data-scnx-resolved-mode', 'dark');
    expect(window.localStorage.length).toBe(0);
  });

  it('keeps the viewer’s choice, and reads it before the system', async () => {
    system(false);
    const { unmount } = render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch to the light theme' }));
    expect(html).toHaveAttribute('data-scnx-resolved-mode', 'light');
    expect(JSON.parse(window.localStorage.getItem(themeStorageKey) ?? '{}')).toEqual({ theme: 'light' });
    unmount();

    render(<Harness />);
    expect(html).toHaveAttribute('data-scnx-resolved-mode', 'light');
  });

  it('reads a stored value it does not know as no choice', () => {
    system(true);
    window.localStorage.setItem(themeStorageKey, JSON.stringify({ theme: 'sepia' }));
    render(<Harness />);
    expect(html).toHaveAttribute('data-scnx-resolved-mode', 'light');
  });
});
