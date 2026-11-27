import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database } from '@enduva/db';
import { sql } from 'drizzle-orm';

import { API_LOGIN } from '../config/env.js';
import { DATABASE } from '../db/database.js';
import { loggableError } from '../db/errors.js';
import { ProblemException } from '../problem/problem.js';

const READINESS_TIMEOUT_MS = 2_000;

export interface Status {
  readonly status: 'ok';
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Liveness: the process serves requests. Touches nothing else, so a database outage doesn't restart it. */
  live(): Status {
    return { status: 'ok' };
  }

  /**
   * Readiness: the database answers through the API's own pool, as `enduva_api_login`. The login is checked again
   * here because the env check only sees the URL: whatever node-postgres or the pooler made of it, a pool logged in
   * as anything else is not ready. `current_user` needs no table privilege.
   */
  async ready(): Promise<Status> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('database ping timed out')), READINESS_TIMEOUT_MS);
    });
    let login: unknown;
    try {
      const result = await Promise.race([
        this.db.execute<{ login: string }>(sql`select current_user as login`),
        timeout,
      ]);
      login = result.rows[0]?.login;
    } catch (error) {
      this.logger.warn({ err: loggableError(error) }, 'readiness check failed');
      throw new ProblemException('database_unavailable');
    } finally {
      clearTimeout(timer);
    }
    if (login !== API_LOGIN) {
      // The name itself is not logged: it comes from the operator's URL.
      this.logger.error(`database login is not ${API_LOGIN}`);
      throw new ProblemException('database_unavailable');
    }
    return { status: 'ok' };
  }
}
