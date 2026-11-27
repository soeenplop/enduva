import { type DynamicModule, Module, VersioningType } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import type { Env } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { ProblemFilter } from './problem/problem.filter.js';

@Module({})
export class AppModule {
  static register(_env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [HealthModule],
      providers: [{ provide: APP_FILTER, useClass: ProblemFilter }],
    };
  }
}

/** HTTP settings shared by `main.ts` and the e2e tests. */
export function configureApp(app: NestExpressApplication, _env: Env): NestExpressApplication {
  // `/v1/…` through URI versioning rather than a global prefix, so unknown paths outside /v1 also get the
  // problem+json 404.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.disable('x-powered-by');
  return app;
}
