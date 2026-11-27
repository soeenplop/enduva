import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database } from '@enduva/db';
import { sql } from 'drizzle-orm';

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

  /** Readiness: the database answers through the API's own pool. `select 1` needs no table privilege. */
  async ready(): Promise<Status> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('database ping timed out')), READINESS_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.db.execute(sql`select 1`), timeout]);
    } catch (error) {
      this.logger.warn({ err: loggableError(error) }, 'readiness check failed');
      throw new ProblemException('database_unavailable');
    } finally {
      clearTimeout(timer);
    }
    return { status: 'ok' };
  }
}
