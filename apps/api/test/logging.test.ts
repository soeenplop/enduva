import { pinoHttp } from 'pino-http';
import { describe, expect, it } from 'vitest';

import { createHttpLogger, loggerParams } from '../src/logging/logging.js';
import { logCapture, testEnv } from './support.js';

describe('loggerParams', () => {
  it('keeps the safe serializers on the logger nestjs-pino uses outside requests', () => {
    const logs = logCapture();
    const http = createHttpLogger(testEnv({ LOG_LEVEL: 'info' }), logs);
    // What nestjs-pino does with the params for its root logger (rootLogger.ts).
    const root = pinoHttp(loggerParams(http).pinoHttp as Parameters<typeof pinoHttp>[0]).logger;

    const cause = new Error('cause-secret');
    root.warn({ err: Object.assign(new Error('message-secret', { cause }), { token: 'prop-secret' }) }, 'failed');

    expect(logs.lines()).toEqual([expect.objectContaining({ err: { type: 'Error' }, msg: 'failed' })]);
    expect(logs.text()).not.toMatch(/secret|"stack"/);
  });
});
