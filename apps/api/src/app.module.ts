import { type DynamicModule, Module, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

import type { Env } from './config/env.js';
import { HealthModule } from './health/health.module.js';

@Module({})
export class AppModule {
  static register(_env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [HealthModule],
    };
  }
}

/** HTTP settings shared by `main.ts` and the e2e tests. */
export function configureApp(app: NestExpressApplication, _env: Env): NestExpressApplication {
  // `/v1/…` through URI versioning rather than a global prefix, so Nest's 404 handler covers paths outside /v1 too.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.disable('x-powered-by');
  return app;
}
