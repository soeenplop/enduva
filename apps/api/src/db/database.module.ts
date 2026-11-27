import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { createDatabase, type Database } from '@enduva/db';

import type { Env } from '../config/env.js';
import { DATABASE } from './database.js';
import { TransactionInterceptor } from './request-transaction.js';

export { DATABASE } from './database.js';

const logger = new Logger('Database');

@Injectable()
class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$client.end();
  }
}

/**
 * The API's database: a node-postgres pool on the transaction-pooler URL as `enduva_api_login` (ADR-0002). The
 * pool connects lazily, so the process starts (and stays live) while the database is down; readiness reports it.
 */
@Global()
@Module({})
export class DatabaseModule {
  static register(env: Env): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DATABASE,
          useFactory: (): Database => {
            const db = createDatabase({
              connectionString: env.DATABASE_URL,
              max: env.DATABASE_POOL_MAX,
              connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS,
              applicationName: 'enduva-api',
            });
            // An idle client that loses its connection (database or pooler restart) emits `error` on the pool.
            // Unhandled, that would crash the process; the pool replaces the client on the next checkout.
            db.$client.on('error', (error) => logger.warn({ err: error }, 'idle database client failed'));
            return db;
          },
        },
        DatabaseShutdown,
        { provide: APP_INTERCEPTOR, useClass: TransactionInterceptor },
      ],
      exports: [DATABASE],
    };
  }
}
