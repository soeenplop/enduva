// Worker entrypoint (`node dist/worker.js`, same image as the API): pg-boss jobs over the session pooler as
// `enduva_worker_login` (ADR-0002, 06-deployment → Connections). The `pgboss` schema comes from a migration; the
// worker only reads and writes jobs. Jobs that touch app data run in `withWorkerTx`.
//
// For now it handles one queue, `smoke`: at every start it enqueues one job and consumes it, which proves that
// enqueue and consume work over the pooler. The deploy smoke test looks for that completed job.
import { PgBoss } from 'pg-boss';
import pg from 'pg';
import { pino } from 'pino';

import { InvalidEnvError, loadWorkerEnv, type WorkerEnv } from './config/env.js';
import { safeError } from './logging/safe-error.js';

export const SMOKE_QUEUE = 'smoke';

function envOrExit(): WorkerEnv {
  try {
    return loadWorkerEnv(process.env);
  } catch (error) {
    if (!(error instanceof InvalidEnvError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return process.exit(1);
  }
}

const env = envOrExit();
const logger = pino({ level: env.LOG_LEVEL, base: { service: 'worker' } });

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  application_name: 'enduva-worker',
});
pool.on('error', (error) => logger.error({ err: safeError(error) }, 'idle database client failed'));

// The login has no privileges of its own (NOINHERIT). The session pooler keeps one session per client connection,
// so each connection switches to `enduva_worker` once, before its first query.
const switched = new WeakSet<pg.PoolClient>();
async function executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> {
  const client = await pool.connect();
  try {
    if (!switched.has(client)) {
      await client.query('set role enduva_worker');
      switched.add(client);
    }
    const result = await client.query(text, values);
    client.release();
    return result;
  } catch (error) {
    // A failed connection is destroyed, not reused.
    client.release(error instanceof Error ? error : true);
    throw error;
  }
}

const boss = new PgBoss({
  db: { executeSql },
  migrate: false,
  createSchema: false,
  schedule: false,
});
boss.on('error', (error) => logger.error({ err: safeError(error) }, 'pg-boss error'));

await boss.start();
await boss.work(SMOKE_QUEUE, async ([job]) => {
  logger.info({ jobId: job?.id }, 'smoke job consumed');
});
logger.info({ jobId: await boss.send(SMOKE_QUEUE, {}) }, 'smoke job enqueued');

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'stopping');
    void boss
      .stop()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
}
