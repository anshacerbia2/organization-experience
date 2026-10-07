// vitest-axe registers toHaveNoViolations at runtime (src/test/setup.ts) but types it for an older
// Vitest. This declares it for the Vitest in use.
import 'vitest';

declare module 'vitest' {
  interface Matchers<T = unknown> {
    toHaveNoViolations(): T;
  }
}
