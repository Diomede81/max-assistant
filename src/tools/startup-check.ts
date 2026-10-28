/**
 * Checks that every part of Max can be put together (each part gets the others it needs) without
 * starting anything: run while the Docker image is built, so an update with a wiring mistake fails to
 * build and the box keeps running the Max it has, instead of being left unable to start.
 *   node dist/tools/startup-check.js
 */
import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';

/**
 * Two services keeping their data under the same store name would overwrite each other (the Journal
 * once shared 'journal' with Max's own notes, and the dashboard stopped loading): caught here instead.
 */
function storeNamesClash(dir: string, seen = new Map<string, string>()): string | undefined {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      const clash = storeNamesClash(path, seen);
      if (clash) return clash;
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.js')) continue;
    // Only stores a service keeps (this.x = new SealedStore(...)): a one-off read of an old store to migrate it is fine.
    for (const m of readFileSync(path, 'utf8').matchAll(/this\.\w+ = new SealedStore(?:<[^>]*>)?\([^,]+,\s*'([^']+)'/g)) {
      const owner = seen.get(m[1]);
      if (owner && owner !== path) return `the store '${m[1]}' is used by both ${owner} and ${path}`;
      seen.set(m[1], path);
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const clash = storeNamesClash(join(__dirname, '..'));
  if (clash) {
    console.error(`Start-up check FAILED: ${clash}`);
    process.exit(1);
  }
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
