// The application's components and styles, ported from identity-experience's packages/ui and
// packages/app-core at c723e417c0eee97db6b1d5b6dab608fe6a406ac2 (TDD-organization-experience-001
// §Visual Language). The UI Platform is deferred, so this application keeps its own copy rather than
// depending on another repository; the names and the tokens are the same, so that when
// `@scnx/system` ships, a line here changes to re-export it and no surface changes.
//
// The local copy is an approved exception: ADR-ORG-008, which expires on 2027-04-20. Its exit is this
// file re-exporting `@scnx/system` and `@scnx/core-ui`, and the copies deleted (ADR-ORG-008 §5.1, §5.4).
export { ButtonBase } from './primitives/button-base/ButtonBase';
export { Button } from './system/button/Button';
export type { ButtonVariant } from './system/button/Button';
export { Icon } from './system/icon/Icon';
export type { IconName } from './system/icon/Icon';
export { Panel } from './system/panel/Panel';
export { StatusPill } from './system/status-pill/StatusPill';
export type { StatusTone } from './system/status-pill/StatusPill';
export { Table } from './system/table/Table';
export { fieldClasses } from './system/field/Field';
export { Notice } from './system/notice/Notice';
export type { NoticeTone } from './system/notice/Notice';
export { AppFrame, navClasses } from './shell/AppFrame';
export { ThemeToggle } from './preferences/ThemeToggle';
export { useTheme } from './preferences/theme';
export type { Theme } from './preferences/theme';
export { layout, Page, PageHeader, PageTitle } from './layout/Page';
export { EmptyState, Facts, Loading, Row, RowMain, Rows, RowTitle, rowClasses, toneOf } from './layout/Rows';
export type { Fact, StatusFact } from './layout/Rows';
