import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config.js';
import helmet from 'helmet';
import { requestIdMiddleware } from './common/request-id.middleware.js';

export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config), { logger: ['error', 'warn'] });
  app.use(helmet());
  app.use(requestIdMiddleware);
  app.enableShutdownHooks();
  return app;
}
