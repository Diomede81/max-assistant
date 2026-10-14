import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';
import { APP_CONFIG, AppConfig } from '../config';
import { describeCapabilities } from '../actions/capabilities';
import { ToolRouterService } from '../actions/tool-router.service';
import { describeNow } from '../actions/clock';
import { wantsScreen } from '../actions/screen-tools.service';
import { MemoryService } from '../memory/memory.service';
import { SoulService } from '../soul/soul.service';

const MAX_TOOL_ROUNDS = 4;
const NO_HA_NOTE =
  'Home Assistant is currently NOT connected, so you cannot control or read any device. ' +
  'If asked to, say briefly that you cannot reach Home Assistant right now. ' +
  'You can still tell the date and time and manage timers and reminders.';

/**
 * Talks to any OpenAI-compatible endpoint, which covers Groq, Cerebras, Gemini,
 * OpenAI, OpenRouter and a local Ollama/llama.cpp server, so providers can be swapped
 * from .env without code changes. Streams text out as it arrives and runs Home
 * Assistant tool calls in between. Falls back to a second provider (e.g. local Ollama)
 * if the primary is down or slower than LLM_TIMEOUT_MS to start answering.
 */
@Injectable()
export class LlmService {
  private readonly log = new Logger(LlmService.name);
  private readonly primary: OpenAI;
  private readonly fallback?: OpenAI;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly tools: ToolRouterService,
    private readonly memory: MemoryService,
    private readonly soul: SoulService,
  ) {
    this.primary = new OpenAI({ baseURL: cfg.llm.baseUrl, apiKey: cfg.llm.apiKey || 'none' });
    if (cfg.llm.fallbackBaseUrl && cfg.llm.fallbackModel) {
      this.fallback = new OpenAI({ baseURL: cfg.llm.fallbackBaseUrl, apiKey: cfg.llm.fallbackApiKey });
    }
  }

  /** Yields spoken text fragments. Mutates `history` with the assistant/tool turns. */
  async *respond(history: ChatCompletionMessageParam[]): AsyncGenerator<string> {
    // Memory: the standing core, plus notes relevant to what the user just said.
    const included = new Set<string>();
    const core = this.memory.enabled ? this.memory.promptSection(included) : '';
    const lastUser = [...history].reverse().find((m) => m.role === 'user');
    const related =
      this.memory.enabled && typeof lastUser?.content === 'string' ? await this.memory.relevant(lastUser.content, included) : '';
    const messages: ChatCompletionMessageParam[] = [
      // The current time is included every turn so simple date questions need no tool call.
      { role: 'system', content: `${this.soul.systemPrompt()}\nCurrent local time: ${describeNow()}.` },
      ...(core ? [{ role: 'system' as const, content: core }] : []),
      ...(related ? [{ role: 'system' as const, content: related }] : []),
      ...(this.tools.homeAssistantConnected ? [] : [{ role: 'system' as const, content: NO_HA_NOTE }]),
      ...this.capabilities(),
      ...history,
    ];
    // A recipe, a how-to or "show me": the first move must be putting it on the screen.
    const forceScreen =
      typeof lastUser?.content === 'string' && wantsScreen(lastUser.content) && this.tools.tools.some((t) => t.type === 'function' && t.function.name === 'show_on_screen');
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const started = Date.now();
      let stream: Awaited<ReturnType<LlmService['openStream']>>;
      try {
        stream = await this.openStream(messages, round === 0 && forceScreen);
      } catch (err) {
        // Some models try to call a device action even when Home Assistant is offline
        // (no tools sent); the provider then rejects the request. Say so plainly.
        if (!this.tools.homeAssistantConnected && /tool/i.test((err as Error).message)) {
          yield "I can't reach Home Assistant right now, so I can't control your devices.";
          return;
        }
        throw err;
      }
      let text = '';
      let reasoning = '';
      let firstToken = true;
      const calls: ChatCompletionMessageToolCall[] = [];

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (firstToken && (delta.content || delta.tool_calls)) {
          this.log.debug(`first token after ${Date.now() - started} ms`);
          firstToken = false;
        }
        if (delta.content) {
          text += delta.content;
          yield delta.content;
        }
        const r = (delta as { reasoning_content?: string }).reasoning_content;
        if (r) reasoning += r;
        for (const tc of delta.tool_calls ?? []) {
          const slot = (calls[tc.index] ??= {
            id: tc.id ?? `call_${tc.index}`,
            type: 'function',
            function: { name: '', arguments: '' },
          } as ChatCompletionMessageToolCall);
          if (tc.id) slot.id = tc.id;
          if (slot.type === 'function') {
            if (tc.function?.name) slot.function.name += tc.function.name;
            if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
          }
        }
      }

      const assistant: ChatCompletionMessageParam = calls.length
        ? { role: 'assistant', content: text || null, tool_calls: calls }
        : { role: 'assistant', content: text };
      // DeepSeek's thinking mode rejects follow-up requests unless its reasoning is sent back.
      if (reasoning && calls.length) Object.assign(assistant, { reasoning_content: reasoning });
      messages.push(assistant);
      history.push(assistant);
      if (!calls.length) return;

      // Run all tool calls in parallel: they are independent actions.
      const results = await Promise.all(
        calls.map(async (c) => {
          if (c.type !== 'function') return { id: c.id, content: 'unsupported tool type' };
          try {
            const args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
            return { id: c.id, content: await this.tools.call(c.function.name, args) };
          } catch (err) {
            return { id: c.id, content: `Error: ${(err as Error).message}` };
          }
        }),
      );
      for (const r of results) {
        const msg: ChatCompletionMessageParam = { role: 'tool', tool_call_id: r.id, content: r.content };
        messages.push(msg);
        history.push(msg);
      }
    }
  }

  private capabilities(): ChatCompletionMessageParam[] {
    const text = describeCapabilities(this.tools.tools);
    return text ? [{ role: 'system', content: text }] : [];
  }

  private async openStream(messages: ChatCompletionMessageParam[], forceScreen = false) {
    const tools = this.tools.tools;
    const screen = tools.some((t) => t.type === 'function' && t.function.name === 'show_on_screen');
    const body = (model: string, reasoningEffort?: string, force = forceScreen) => ({
      model,
      messages,
      stream: true as const,
      temperature: 0.3,
      // Spoken replies are short, but a recipe sent to the screen needs room (or it's cut off and lost).
      max_tokens: force ? 1500 : screen ? 800 : 300,
      ...(tools.length ? { tools, tool_choice: force ? { type: 'function' as const, function: { name: 'show_on_screen' } } : ('auto' as const) } : {}),
      // Provider-specific values (e.g. DeepSeek's "none") aren't in the SDK's type list.
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort as 'low' } : {}),
    });
    if (forceScreen) {
      try {
        return await this.primary.chat.completions.create(body(this.cfg.llm.model, this.cfg.llm.reasoningEffort), { timeout: this.cfg.llm.timeoutMs, maxRetries: 0 });
      } catch (err) {
        // Some models don't accept a required action (e.g. in thinking mode): ask normally instead.
        this.log.warn(`could not require the screen (${(err as Error).message}); asking normally`);
      }
    }
    try {
      return await this.primary.chat.completions.create(body(this.cfg.llm.model, this.cfg.llm.reasoningEffort, false), {
        timeout: this.cfg.llm.timeoutMs,
        maxRetries: 0,
      });
    } catch (err) {
      if (!this.fallback) throw err;
      this.log.warn(`primary LLM failed (${(err as Error).message}); using fallback`);
      return this.fallback.chat.completions.create(
        body(this.cfg.llm.fallbackModel!, this.cfg.llm.fallbackReasoningEffort, false),
      );
    }
  }
}

/**
 * Turns an AI provider error into a short spoken sentence plus a log hint, so Max says
 * *why* he can't answer (rate limit, bad key, no credit...) instead of a generic apology.
 */
export function explainLlmError(err: unknown): { spoken: string; log: string } {
  const e = err as { status?: number; message?: string; name?: string };
  const msg = e.message ?? String(err);
  switch (e.status) {
    case 429:
      return {
        spoken: "I'm being rate limited by my AI service. Give me a minute and try again.",
        log: `rate limited (429): ${msg}. Wait, use a paid tier, or set LLM_FALLBACK_* in .env`,
      };
    case 401:
    case 403:
      return { spoken: 'My AI service rejected the API key.', log: `key rejected (${e.status}): ${msg}. Check LLM_API_KEY` };
    case 402:
      return { spoken: 'My AI service account has run out of credit.', log: `out of credit (402): ${msg}. Top up the account` };
    case 404:
      return { spoken: "My AI service doesn't recognise the model name.", log: `model not found (404): ${msg}. Check LLM_MODEL` };
  }
  if (e.name === 'APIConnectionTimeoutError' || /timed? ?out/i.test(msg)) {
    return { spoken: 'My AI service is taking too long to answer.', log: `timeout: ${msg}. Raise LLM_TIMEOUT_MS or pick a faster model` };
  }
  return { spoken: 'Sorry, I could not reach my brain just now.', log: msg };
}
