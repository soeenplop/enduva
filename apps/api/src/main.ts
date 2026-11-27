import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule, configureApp } from './app.module.js';
import { type Env, InvalidEnvError, loadEnv } from './config/env.js';

function envOrExit(): Env {
  try {
    return loadEnv(process.env);
  } catch (error) {
    if (!(error instanceof InvalidEnvError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return process.exit(1);
  }
}

const env = envOrExit();
const app = await NestFactory.create<NestExpressApplication>(AppModule.register(env), { bufferLogs: true });
configureApp(app, env);
// SIGTERM/SIGINT close the app gracefully.
app.enableShutdownHooks();
await app.listen(env.PORT, env.HOST);
