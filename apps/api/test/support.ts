import 'reflect-metadata';

import type { Provider, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { DestinationStream } from 'pino';
import request from 'supertest';

import { AppModule, configureApp } from '../src/app.module.js';
import { type Env, loadEnv } from '../src/config/env.js';

/** Nothing listens on port 1: the pool fails fast, as with a database that is down. */
export const UNREACHABLE_DATABASE_URL = 'postgresql://enduva_api_login:unused@127.0.0.1:1/postgres';

export function testEnv(overrides: Readonly<Record<string, string>> = {}): Env {
  return loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: UNREACHABLE_DATABASE_URL, ...overrides });
}

export interface TestAppOptions {
  readonly logDestination?: DestinationStream;
  /** Extra controllers and providers, e.g. a stand-in for the 0.8b auth guard. */
  readonly controllers?: Type[];
  readonly providers?: Provider[];
}

/** Boots the real AppModule, compiled by SWC through the Vitest preset, with the same HTTP setup as `main.ts`. */
export async function createTestApp(env: Env, options: TestAppOptions = {}): Promise<NestExpressApplication> {
  const { logDestination, controllers = [], providers = [] } = options;
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(env, logDestination === undefined ? {} : { logDestination })],
    controllers,
    providers,
  }).compile();
  const app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true }), env);
  await app.init();
  return app;
}

export const http = (app: NestExpressApplication) => request(app.getHttpServer());

/** Collects log lines in memory. */
export function logCapture(): DestinationStream & {
  readonly lines: () => Record<string, unknown>[];
  text: () => string;
} {
  const chunks: string[] = [];
  return {
    write: (chunk: string) => void chunks.push(chunk),
    text: () => chunks.join(''),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
