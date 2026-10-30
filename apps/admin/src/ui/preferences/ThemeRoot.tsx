import {
  createThemeStore,
  ThemeProvider,
  type ThemePreferenceAdapter,
  type ThemeServerHint,
} from '@scnx/core-ui/providers/theme-provider-base';
import { useState, type ReactElement, type ReactNode } from 'react';

// The document's theme root: the platform's ThemeProvider (`@scnx/core-ui`) on <html>, in the
// scnx-platform theme, as identity-experience's ThemeRoot (packages/app-core/src/preferences) sets
// it. It writes `data-scnx-theme` and `data-scnx-resolved-mode`, the only selector the platform's theme
// stylesheet answers to (STD-UIP-TKN-002 §3.4). index.html carries both, dark, so the first paint
// already has tokens: the content security policy allows no inline script that could set them sooner.
//
// The one departure from identity-experience, recorded in TDD-organization-experience-001 §Visual
// Language: until the viewer chooses, the mode follows the system's prefers-color-scheme (the store's
// `system` mode) rather than opening dark, and nothing is written to browser storage. The page then
// holds nothing in storage after a sign-in (§End to End). Once the viewer chooses dark or light, the
// choice is kept in this origin's localStorage under the key this application has always used: a
// per-viewer convenience, not a credential, the only thing STD-GLB-FE-003 §3.4 keeps out of it.

export const PLATFORM_THEME = 'scnx-platform';

export const themeStorageKey = 'scnx-org-preferences';

type Choice = 'dark' | 'light';

const isChoice = (value: unknown): value is Choice => value === 'dark' || value === 'light';

// The stored value is { "theme": "dark" | "light" }; anything else reads as no choice, which the store
// treats as untrusted and ignores in any case.
const preference: ThemePreferenceAdapter = {
  read: () => {
    try {
      const raw = window.localStorage.getItem(themeStorageKey);
      const theme = raw === null ? null : (JSON.parse(raw) as { theme?: unknown }).theme;
      return isChoice(theme) ? theme : null;
    } catch {
      return null;
    }
  },
  write: (mode) => {
    if (!isChoice(mode)) {
      return;
    }
    try {
      window.localStorage.setItem(themeStorageKey, JSON.stringify({ theme: mode }));
    } catch {
      // A private window or blocked site data keeps the choice for this page only.
    }
  },
  subscribe: (listener) => {
    const changed = (event: StorageEvent): void => {
      if (event.key === themeStorageKey) {
        listener();
      }
    };
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener('storage', changed);
    };
  },
};

// The first render's mode, read synchronously: the stored choice, or the system's. Without it the
// store renders its default first, light, and reads storage and the system only after mounting, so a
// viewer whose system is dark would see one frame of light.
function firstMode(): ThemeServerHint {
  const stored = preference.read();
  if (isChoice(stored)) {
    return { mode: stored, resolvedMode: stored };
  }
  const dark = typeof window.matchMedia === 'function' && window.matchMedia(darkQuery).matches;
  return { mode: 'system', resolvedMode: dark ? 'dark' : 'light' };
}

const darkQuery = '(prefers-color-scheme: dark)';

export function ThemeRoot({ children }: { readonly children: ReactNode }): ReactElement {
  const [store] = useState(() =>
    createThemeStore({
      themeId: PLATFORM_THEME,
      themes: [PLATFORM_THEME],
      defaultMode: 'system',
      serverHint: firstMode(),
      storage: preference,
    }),
  );
  return (
    <ThemeProvider themeId={PLATFORM_THEME} store={store} root={document.documentElement}>
      {children}
    </ThemeProvider>
  );
}
