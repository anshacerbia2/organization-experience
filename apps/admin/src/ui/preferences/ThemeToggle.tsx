import type { ReactElement } from 'react';

import type { Theme } from './theme';
import { messages } from '../../messages';
import { Button } from '../system/button/Button';
import { Icon } from '../system/icon/Icon';

// identity-experience's ThemeToggle (packages/app-core/src/preferences): one button that names the
// theme it moves to, with its glyph.
export function ThemeToggle({
  theme,
  onChoose,
}: {
  readonly theme: Theme;
  readonly onChoose: (theme: Theme) => void;
}): ReactElement {
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? messages.themeToDark : messages.themeToLight;
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      onClick={() => {
        onChoose(next);
      }}
    >
      <Icon name={next === 'dark' ? 'moon' : 'sun'} />
    </Button>
  );
}
