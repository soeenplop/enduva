// @expect-lint typescript(no-floating-promises) at 6:3
import type { INestApplication } from '@nestjs/common';

// Closing the app ends the database pool; a forgotten await must not pass the linter.
export function shutdown(app: INestApplication): void {
  app.close();
}
