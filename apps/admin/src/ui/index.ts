// The one door the surfaces take the UI Platform through (TDD-organization-experience-001 §Visual
// Language). The UI Platform's packages, `@scnx/system` and `@scnx/core-ui` (vendor/ui-platform/pin.json,
// the pin identity-experience builds on), are re-exported here, so nothing outside src/ui/ imports them
// (the ESLint rule `no-restricted-imports`) and an upgrade or a replaced component changes this file
// only. It is the exit of ADR-ORG-008: the copies of identity-experience's stand-in are deleted.
//
// The map is identity-experience's (its packages/ui/src/index.ts), component for component. Three kinds
// of export:
//
//   re-exported  the platform's component as it ships
//   composed     the platform's component with a composition this application needs, in a file of
//                its own that renders it, ported from identity-experience
//   local        no platform counterpart yet; drawn from the platform's tokens
export { ButtonBase } from '@scnx/core-ui/components/button-base';
export type { AnchorModeProps, ButtonBaseProps, ButtonModeProps } from '@scnx/core-ui/components/button-base';
export { useTheme, type ResolvedMode, type ThemeMode } from '@scnx/core-ui/providers/theme-provider-base';
export { Alert } from '@scnx/system/components/alert';
export type { AlertProps, AlertScheme } from '@scnx/system/components/alert';
export { Badge } from '@scnx/system/components/badge';
export type { BadgeProps, BadgeScheme } from '@scnx/system/components/badge';

export { Button } from './system/button/Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './system/button/Button';
export { Panel } from './system/panel/Panel';
export { StatusPill } from './system/status-pill/StatusPill';
export type { StatusTone } from './system/status-pill/StatusPill';
export { Table } from './system/table/Table';

export { Icon } from './system/icon/Icon';
export type { IconName } from './system/icon/Icon';
export { fieldClasses } from './system/field/Field';
export { Notice } from './system/notice/Notice';
export type { NoticeTone } from './system/notice/Notice';
export { ThemeRoot, PLATFORM_THEME } from './preferences/ThemeRoot';
export { ThemeToggle } from './preferences/ThemeToggle';

// This application's layout, local by design: the frame, the page and the record rows.
export { AppFrame, navClasses } from './shell/AppFrame';
export { layout, Page, PageHeader, PageTitle } from './layout/Page';
export { EmptyState, Facts, Loading, Row, RowMain, Rows, RowTitle, rowClasses, toneOf } from './layout/Rows';
export type { Fact, StatusFact } from './layout/Rows';
