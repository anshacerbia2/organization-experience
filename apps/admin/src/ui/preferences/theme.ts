import { useCallback, useEffect, useState } from 'react';

// The theme: dark or light, an attribute on <html>, which is where the token layer scopes its themes
// (STD-GLB-FE-005 §3.5), as identity-experience's preferences store sets it.
//
// The one departure from it: until the viewer chooses, the theme follows the system's
// prefers-color-scheme rather than opening dark, and nothing is written to browser storage. The page
// then holds nothing in storage after a sign-in (TDD-organization-experience-001 §End to End). Once
// the viewer chooses, the choice is kept in this origin's localStorage: a per-viewer convenience, not
// a credential, the only thing STD-GLB-FE-003 §3.4 keeps out of it.

export type Theme = 'dark' | 'light';

export const themeStorageKey = 'scnx-org-preferences';

function storedTheme(): Theme | null {
  try {
    const raw = window.localStorage.getItem(themeStorageKey);
    const theme = raw === null ? null : (JSON.parse(raw) as { theme?: unknown }).theme;
    return theme === 'dark' || theme === 'light' ? theme : null;
  } catch {
    return null;
  }
}

const systemQuery = '(prefers-color-scheme: light)';

function systemTheme(): Theme {
  return typeof window.matchMedia === 'function' && window.matchMedia(systemQuery).matches ? 'light' : 'dark';
}

function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(themeStorageKey, JSON.stringify({ theme }));
  } catch {
    // A private window or blocked site data keeps the choice for this page only.
  }
}

export function useTheme(): { readonly theme: Theme; readonly choose: (theme: Theme) => void } {
  const [chosen, setChosen] = useState<Theme | null>(storedTheme);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme = chosen ?? system;

  // Without a choice, the page follows the system as it changes.
  useEffect(() => {
    if (chosen !== null || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const query = window.matchMedia(systemQuery);
    const follow = (): void => {
      setSystem(query.matches ? 'light' : 'dark');
    };
    query.addEventListener('change', follow);
    return () => {
      query.removeEventListener('change', follow);
    };
  }, [chosen]);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  const choose = useCallback((next: Theme) => {
    storeTheme(next);
    setChosen(next);
  }, []);
  return { theme, choose };
}
