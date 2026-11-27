import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database } from '@enduva/db';

import { API_LOGIN } from '../config/env.js';
import { DATABASE } from '../db/database.js';
import { loggableError } from '../db/errors.js';
import { ProblemException } from '../problem/problem.js';

/** Bound of the readiness response, and of the readiness query (node-postgres `query_timeout`). */
export const READINESS_TIMEOUT_MS = 2_000;

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

  /** The probe in flight. Concurrent readiness requests share it, so probes never pile up in the pool's queue. */
  private probe: Promise<unknown> | undefined;

  /**
   * Readiness: the database answers through the API's own pool, as `enduva_api_login`. The login is checked again
   * here because the env check only sees the URL: whatever node-postgres or the pooler made of it, a pool logged in
   * as anything else is not ready. `current_user` needs no table privilege.
   *
   * The response is bounded by `READINESS_TIMEOUT_MS`; the probe behind it is bounded by the database layer, so it
   * always ends and gives its client back: the pool's `connectionTimeoutMillis` ends a stalled checkout and the
   * query's `query_timeout` a stalled query, whose client is then destroyed rather than returned to the pool.
   */
  async ready(): Promise<Status> {
    this.probe ??= this.currentLogin().finally(() => {
      this.probe = undefined;
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('database ping timed out')), READINESS_TIMEOUT_MS);
    });
    let login: unknown;
    try {
      login = await Promise.race([this.probe, timeout]);
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

  private async currentLogin(): Promise<unknown> {
    const client = await this.db.$client.connect();
    // A connection error while the client is checked out must not crash the process; the query then fails too.
    const onError = (): void => {};
    client.on('error', onError);
    let failed = false;
    try {
      // `query_timeout` per query is supported by node-postgres but missing from @types/pg's QueryConfig.
      const query = { text: 'select current_user as login', query_timeout: READINESS_TIMEOUT_MS };
      const result = await client.query<{ login: string }>(query);
      return result.rows[0]?.login;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      client.off('error', onError);
      // A failed or timed-out client may still have the query running: destroy it instead of reusing it.
      client.release(failed);
    }
  }
}
