import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // No HTTP server needed: Max is a long-running voice loop.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: process.env.LOG_LEVEL === 'debug'
      ? ['error', 'warn', 'log', 'debug']
      : ['error', 'warn', 'log'],
  });
  app.enableShutdownHooks();
}

void bootstrap();
