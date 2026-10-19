// Ported from identity-experience at c723e417c0eee97db6b1d5b6dab608fe6a406ac2, packages/ui/src/primitives/button-base/ButtonBase.tsx
// (TDD-organization-experience-001 §Visual Language).
import type { ComponentPropsWithRef, MouseEvent, ReactElement } from 'react';

// ButtonBase is a headless button: behaviour and semantics, no styling. It mirrors
// `@scnx/core-ui/components/button-base` (a <button>, or an <a> when `href` is given) so that
// replacing it is changing one import.
//
// A disabled link keeps its element but loses its href and cancels activation, because an <a>
// has no disabled state of its own and a link that still navigates is not disabled.

interface CommonProps {
  readonly disabled?: boolean;
}

export type ButtonBaseButtonProps = CommonProps &
  Omit<ComponentPropsWithRef<'button'>, 'disabled'> & {
    readonly href?: undefined;
    // pressed makes the button a toggle, announced as aria-pressed. Buttons only: a link has no
    // pressed state, and aria-pressed on one is announced as nothing or as a lie.
    readonly pressed?: boolean;
  };

export type ButtonBaseAnchorProps = CommonProps &
  Omit<ComponentPropsWithRef<'a'>, 'href'> & { readonly href: string; readonly pressed?: undefined };

export type ButtonBaseProps = ButtonBaseButtonProps | ButtonBaseAnchorProps;

const isAnchor = (props: ButtonBaseProps): props is ButtonBaseAnchorProps => typeof props.href === 'string';

export function ButtonBase(props: ButtonBaseProps): ReactElement {
  if (isAnchor(props)) {
    const { disabled = false, pressed: _pressed, href, onClick, children, ...rest } = props;
    const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
      if (disabled) {
        event.preventDefault();
        return;
      }
      onClick?.(event);
    };
    return (
      <a
        {...rest}
        href={disabled ? undefined : href}
        aria-disabled={disabled || undefined}
        data-disabled={disabled || undefined}
        onClick={handleClick}
      >
        {children}
      </a>
    );
  }
  const { disabled = false, pressed, type = 'button', children, ...rest } = props;
  return (
    <button
      {...rest}
      // eslint-disable-next-line react/button-has-type -- the type is a prop, defaulted to "button" above
      type={type}
      disabled={disabled}
      aria-pressed={pressed}
      data-disabled={disabled || undefined}
    >
      {children}
    </button>
  );
}
