import { type DynamicModule, Module, VersioningType } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { HttpLogger } from 'pino-http';

import type { Env } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { createHttpLogger, loggerParams } from './logging/logging.js';
import { ProblemFilter } from './problem/problem.filter.js';

const HTTP_LOGGER = Symbol('enduva.http-logger');

export interface AppOptions {
  /** Where logs go instead of stdout (tests). */
  readonly logDestination?: DestinationStream;
}

@Module({})
export class AppModule {
  static register(env: Env, options: AppOptions = {}): DynamicModule {
    const http = createHttpLogger(env, options.logDestination);
    return {
      module: AppModule,
      imports: [LoggerModule.forRoot(loggerParams(http)), HealthModule],
      providers: [
        { provide: APP_FILTER, useClass: ProblemFilter },
        { provide: HTTP_LOGGER, useValue: http },
      ],
    };
  }
}

/** HTTP settings shared by `main.ts` and the e2e tests. */
export function configureApp(app: NestExpressApplication, _env: Env): NestExpressApplication {
  // Before init, so it runs ahead of Nest's body parser and every response gets a request ID and a log line.
  app.use(app.get<HttpLogger>(HTTP_LOGGER));
  app.useLogger(app.get(Logger));
  // `/v1/…` through URI versioning rather than a global prefix, so unknown paths outside /v1 also get the
  // problem+json 404.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.disable('x-powered-by');
  return app;
}
