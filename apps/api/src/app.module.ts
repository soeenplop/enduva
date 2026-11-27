import { type DynamicModule, Module, VersioningType } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Logger, LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { HttpLogger } from 'pino-http';

import type { Env } from './config/env.js';
import { DatabaseModule } from './db/database.module.js';
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
      imports: [
        LoggerModule.forRoot(loggerParams(http)),
        // Per client IP; per-user limits follow with auth (0.8b).
        ThrottlerModule.forRoot({
          throttlers: [{ ttl: seconds(env.THROTTLE_TTL_SECONDS), limit: env.THROTTLE_LIMIT }],
        }),
        DatabaseModule.register(env),
        HealthModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemFilter },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: HTTP_LOGGER, useValue: http },
      ],
    };
  }
}

/** HTTP settings shared by `main.ts` and the e2e tests. */
export function configureApp(app: NestExpressApplication, env: Env): NestExpressApplication {
  // Before init, so it runs ahead of Nest's body parser and every response gets a request ID and a log line.
  app.use(app.get<HttpLogger>(HTTP_LOGGER));
  app.useLogger(app.get(Logger));
  // `/v1/…` through URI versioning rather than a global prefix, so unknown paths outside /v1 also get the
  // problem+json 404.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // Client IPs (throttling) come from X-Forwarded-For only behind this many trusted proxies.
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  return app;
}
