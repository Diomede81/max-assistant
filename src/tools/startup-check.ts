/**
 * Checks that every part of Max can be put together (each part gets the others it needs) without
 * starting anything: run while the Docker image is built, so an update with a wiring mistake fails to
 * build and the box keeps running the Max it has, instead of being left unable to start.
 *   node dist/tools/startup-check.js
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';

async function main(): Promise<void> {
  try {
    const app = await NestFactory.createApplicationContext(AppModule, { preview: true, abortOnError: false, logger: false });
    await app.close();
    console.log('Start-up check: every part of Max fits together');
    process.exit(0);
  } catch (err) {
    console.error(`Start-up check FAILED: ${(err as Error).message.split('\n')[0]}`);
    process.exit(1);
  }
}

void main();
