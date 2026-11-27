import 'reflect-metadata';

import type { Provider, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule, configureApp } from '../src/app.module.js';
import { type Env, loadEnv } from '../src/config/env.js';

export function testEnv(overrides: Readonly<Record<string, string>> = {}): Env {
  return loadEnv({ NODE_ENV: 'test', ...overrides });
}

export interface TestAppOptions {
  /** Extra controllers and providers for a test. */
  readonly controllers?: Type[];
  readonly providers?: Provider[];
}

/** Boots the real AppModule, compiled by SWC through the Vitest preset, with the same HTTP setup as `main.ts`. */
export async function createTestApp(env: Env, options: TestAppOptions = {}): Promise<NestExpressApplication> {
  const { controllers = [], providers = [] } = options;
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(env)],
    controllers,
    providers,
  }).compile();
  const app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ logger: false }), env);
  await app.init();
  return app;
}

export const http = (app: NestExpressApplication) => request(app.getHttpServer());
