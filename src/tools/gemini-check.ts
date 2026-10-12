/**
 * Finds out exactly what Gemini Live rejects ("Request contains an invalid argument").
 *   docker compose run --rm max node dist/tools/gemini-check.js
 * Uses your real .env settings and Gemini key. Each test opens a short session, sends a
 * typed "say hello" (Gemini only validates everything when it starts answering) and
 * reports OK or Google's reason. If actions are the problem, it narrows it down to the
 * individual action(s) and prints what was sent, so the fix can be targeted.
 */
import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import WebSocket from 'ws';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { APP_CONFIG, AppConfig, loadConfig } from '../config';
import { ActionsModule } from '../actions/actions.module';
import { MusicModule } from '../music/music.module';
import { ToolRouterService } from '../actions/tool-router.service';
import { BuiltinActionsService } from '../actions/builtin-actions.service';
import { HaMcpService } from '../ha-mcp/ha-mcp.service';
import { buildGeminiSetup, geminiDeclarations, GeminiSetupParts } from '../realtime/gemini-live-client';
import type { VoiceClientOptions } from '../realtime/voice-client';
import { matchesAny } from '../mcp/glob';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env: use the environment
}

@Global()
@Module({ imports: [ActionsModule, MusicModule], providers: [{ provide: APP_CONFIG, useFactory: loadConfig }], exports: [APP_CONFIG] })
class CheckModule {}

type Result = { ok: boolean; detail: string };

function trySession(cfg: AppConfig, tools: ChatCompletionTool[], parts: GeminiSetupParts = {}): Promise<Result> {
  const rt = cfg.realtime;
  const opts: VoiceClientOptions = {
    url: rt.url, apiKey: rt.apiKey, model: rt.model, voice: rt.voice, instructions: 'You are Max, a helpful assistant.',
    tools, silenceMs: rt.silenceMs, interruptResponse: false, language: rt.language,
  };
  return new Promise((resolve) => {
    const ws = new WebSocket(`${rt.url}?key=${encodeURIComponent(rt.apiKey)}`);
    let done = false;
    const finish = (r: Result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, detail: 'no answer within 20 s' }), 20000);
    ws.on('open', () => ws.send(JSON.stringify({ setup: buildGeminiSetup(opts, parts) })));
    ws.on('message', (raw) => {
      let m: Record<string, any>;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.setupComplete) {
        ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'Say hello in one word.' }] }], turnComplete: true } }));
      }
      const sc = m.serverContent;
      if (sc?.modelTurn || sc?.turnComplete || m.toolCall) finish({ ok: true, detail: 'answered' });
    });
    ws.on('unexpected-response', (_q, res) => finish({ ok: false, detail: `HTTP ${res.statusCode}` }));
    ws.on('error', (e) => finish({ ok: false, detail: e.message }));
    ws.on('close', (code, reason) => finish({ ok: false, detail: reason.toString() || `closed (code ${code})` }));
  });
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(CheckModule, { logger: ['error', 'warn'] });
  const cfg = app.get<AppConfig>(APP_CONFIG);
  const rt = cfg.realtime;
  if (!rt.apiKey) throw new Error('No Gemini key: set GEMINI_API_KEY in .env');
  console.log(`Model ${rt.model}, voice ${rt.voice}${rt.language ? `, language ${rt.language}` : ''}`);
  console.log('Waiting for Home Assistant and apps to connect…');
  await app.get(HaMcpService).status(15000);
  await new Promise((r) => setTimeout(r, 4000)); // Composio session start

  const all = app.get(ToolRouterService).tools.filter((t) => !(t.type === 'function' && matchesAny(t.function.name, rt.excludeTools)));
  if (rt.excludeTools.length) console.log(`Leaving out (REALTIME_EXCLUDE_TOOLS): ${rt.excludeTools.join(', ')}`);
  const builtinNames = new Set(app.get(BuiltinActionsService).tools.map((t) => (t.type === 'function' ? t.function.name : '')));
  const haNames = new Set(app.get(HaMcpService).openAiTools.map((t) => (t.type === 'function' ? t.function.name : '')));
  const nameOf = (t: ChatCompletionTool) => (t.type === 'function' ? t.function.name : '');
  const groups: Record<string, ChatCompletionTool[]> = {
    'built-in (time, timers, memory)': all.filter((t) => builtinNames.has(nameOf(t))),
    'Home Assistant': all.filter((t) => haNames.has(nameOf(t))),
    'apps (Composio / MCP servers)': all.filter((t) => !builtinNames.has(nameOf(t)) && !haNames.has(nameOf(t))),
  };
  console.log(`Actions: ${Object.entries(groups).map(([k, v]) => `${k} ${v.length}`).join(', ')}\n`);

  const step = async (label: string, tools: ChatCompletionTool[], parts?: GeminiSetupParts) => {
    const r = await trySession(cfg, tools, parts);
    console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${label}${r.ok ? '' : `  ->  ${r.detail}`}`);
    return r.ok;
  };

  // 1. The basics: model, key, voice, options.
  const bare = await step('connection only (no voice setting, no options, no actions)', [], { voice: false, language: false, transcription: false, vad: false });
  if (!bare) {
    console.log('\n=> Model name, key or billing problem. Check REALTIME_MODEL and GEMINI_API_KEY in AI Studio.');
    return void (await app.close());
  }
  await step(`+ voice "${rt.voice}"`, [], { language: false, transcription: false, vad: false });
  if (rt.language) await step(`+ language ${rt.language}`, [], { transcription: false, vad: false });
  await step('+ transcription', [], { language: false, vad: false });
  await step('+ speech detection setting', [], { language: false, transcription: false });
  const optionsOk = await step('all voice options together', []);

  // 2. Actions, by group, then individually for any failing group.
  const culprits: ChatCompletionTool[] = [];
  for (const [label, tools] of Object.entries(groups)) {
    if (!tools.length) continue;
    if (await step(`actions: ${label} (${tools.length})`, tools)) continue;
    for (const t of tools) {
      if (!(await step(`   action ${nameOf(t)}`, [t]))) culprits.push(t);
    }
  }
  if (all.length) await step(`all ${all.length} actions together`, all);

  console.log('');
  if (!optionsOk) console.log('=> One of the voice options above is rejected; see which line failed.');
  if (culprits.length) {
    console.log(`=> Gemini rejects ${culprits.length} action(s). Quick fix: add this line to .env and restart Max:`);
    console.log(`   REALTIME_EXCLUDE_TOOLS=${culprits.map(nameOf).join(',')}`);
    console.log('   Please also send this whole output so the action can be fixed properly. What was sent for them:');
    for (const d of geminiDeclarations(culprits)) console.log(JSON.stringify(d));
  } else if (optionsOk) {
    console.log('=> No problem found in this test. If live conversations still fail, send this output plus the "Realtime" log lines.');
  }
  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`Check failed: ${(err as Error).message}`);
  process.exit(1);
});
