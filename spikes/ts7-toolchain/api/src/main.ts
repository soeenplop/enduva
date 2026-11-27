import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule);
app.enableCors({ origin: true });
await app.listen(Number(process.env.PORT ?? 3001));
console.log(`api listening on ${await app.getUrl()}`);
