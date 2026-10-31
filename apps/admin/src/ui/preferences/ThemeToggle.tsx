import { ButtonBase } from '@scnx/core-ui/components/button-base';
import { useTheme } from '@scnx/core-ui/providers/theme-provider-base';
import type { ReactElement } from 'react';

import styles from './ThemeToggle.module.scss';
import { messages } from '../../messages';
import { Icon } from '../system/icon/Icon';

// identity-experience's ThemeToggle (packages/app-core/src/preferences): one button that names the
// mode it moves to, with its glyph, drawn as a square cell as tall as the frame's bar. The theme root
// (ThemeRoot) keeps the choice.
export function ThemeToggle(): ReactElement {
  const theme = useTheme();
  const next = theme.resolvedMode === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? messages.themeToDark : messages.themeToLight;
  return (
    <ButtonBase
      className={styles['toggle'] ?? ''}
      aria-label={label}
      title={label}
      onClick={() => {
        theme.setMode(next);
      }}
    >
      <Icon name={next === 'dark' ? 'moon' : 'sun'} />
    </ButtonBase>
  );
}
