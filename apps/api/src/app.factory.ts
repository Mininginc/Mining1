import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config.js';
import helmet from 'helmet';
import { requestIdMiddleware } from './common/request-id.middleware.js';

export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), { logger: ['error', 'warn'], bodyParser: false });
  // Spreadsheet uploads arrive as JSON text; the car sheet is about 300 KB today.
  app.useBodyParser('json', { limit: '15mb' });
  app.use(helmet());
  app.use(requestIdMiddleware);
  app.enableShutdownHooks();
  return app;
}
