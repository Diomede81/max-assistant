/**
 * Type to Max instead of talking: same AI model, same Home Assistant tools, no audio.
 *   npm run chat              (or: docker compose run --rm max chat)
 * Ideal for testing the Home Assistant connection and choosing an LLM before the
 * microphone/speaker setup is done. Add --speak to also hear the replies through Piper.
 */
import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createInterface } from 'node:readline';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { APP_CONFIG, loadConfig } from '../config';
import { LlmModule } from '../llm/llm.module';
import { LlmService, explainLlmError } from '../llm/llm.service';
import { HaMcpService } from '../ha-mcp/ha-mcp.service';
import { TimerService, announcement } from '../actions/timer.service';
import { TtsModule } from '../tts/tts.module';
import { TtsService } from '../tts/tts.service';
import { SentenceSplitter } from '../conversation/sentence-splitter';
import { MusicModule } from '../music/music.module';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env: use defaults / shell environment
}

@Global()
@Module({
  imports: [LlmModule, TtsModule, MusicModule],
  providers: [{ provide: APP_CONFIG, useFactory: loadConfig }],
  exports: [APP_CONFIG],
})
class ChatModule {}

async function main(): Promise<void> {
  const speak = process.argv.includes('--speak');
  const app = await NestFactory.createApplicationContext(ChatModule, { logger: ['error', 'warn', 'log'] });
  const llm = app.get(LlmService);
  const tts = app.get(TtsService);
  const history: ChatCompletionMessageParam[] = [];
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Start buffering input immediately, so lines typed/pasted during start-up are not lost.
  const lines = rl[Symbol.asyncIterator]();

  app.get(TimerService).on('fired', (t) => {
    const text = announcement(t);
    process.stdout.write(`\n*** ${text} ***\nYou: `);
    if (speak) {
      const s = tts.session();
      s.say(text);
      void s.done();
    }
  });
  const ha = await app.get(HaMcpService).status();
  console.log(
    ha.connected
      ? `\nHome Assistant: connected (${ha.tools} tools)`
      : `\n!! Home Assistant: NOT connected - ${ha.error}\n!! Max can chat but cannot control devices. Fix .env and run again.`,
  );
  console.log('\nType a request for Max (e.g. "turn on the kitchen lights"). Empty line or Ctrl+C to quit.\n');

  rl.setPrompt('You: ');
  rl.prompt();
  for (;;) {
    const next = await lines.next();
    if (next.done) break;
    const text = String(next.value).trim();
    if (!text) break;
    history.push({ role: 'user', content: text });
    const started = Date.now();
    let first = 0;
    const speech = speak ? tts.session() : undefined;
    const splitter = new SentenceSplitter();
    process.stdout.write('Max: ');
    try {
      for await (const fragment of llm.respond(history)) {
        if (!first) first = Date.now();
        process.stdout.write(fragment);
        for (const s of splitter.push(fragment)) speech?.say(s);
      }
    } catch (err) {
      const why = explainLlmError(err);
      process.stdout.write(`${why.spoken}\n      [${why.log}]`);
    }
    for (const s of splitter.flush()) speech?.say(s);
    console.log(`\n      (first words after ${first ? first - started : '-'} ms, total ${Date.now() - started} ms)\n`);
    await speech?.done();
    rl.prompt();
  }
  rl.close();
  await app.close();
  process.exit(0);
}

void main();
