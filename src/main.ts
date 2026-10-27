import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BufferLogger } from './log-buffer';

async function bootstrap(): Promise<void> {
  // No HTTP server needed: Max is a long-running voice loop.
  // the log is printed as before, and its last lines kept for the control panel (Settings → Log)
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: new BufferLogger(process.env.LOG_LEVEL === 'debug' ? ['error', 'warn', 'log', 'debug'] : ['error', 'warn', 'log']),
  });
  app.enableShutdownHooks();
}

void bootstrap();
