import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';
import { APP_CONFIG, AppConfig } from '../config';
import { HaMcpService } from '../ha-mcp/ha-mcp.service';

const MAX_TOOL_ROUNDS = 4;
const NO_TOOLS_NOTE =
  'Home Assistant is currently NOT connected, so you have no tools and cannot control or read any device. ' +
  'If asked to, say briefly that you cannot reach Home Assistant right now. Do not attempt any tool call.';

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
    private readonly ha: HaMcpService,
  ) {
    this.primary = new OpenAI({ baseURL: cfg.llm.baseUrl, apiKey: cfg.llm.apiKey || 'none' });
    if (cfg.llm.fallbackBaseUrl && cfg.llm.fallbackModel) {
      this.fallback = new OpenAI({ baseURL: cfg.llm.fallbackBaseUrl, apiKey: cfg.llm.fallbackApiKey });
    }
  }

  /** Yields spoken text fragments. Mutates `history` with the assistant/tool turns. */
  async *respond(history: ChatCompletionMessageParam[]): AsyncGenerator<string> {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: this.cfg.llm.systemPrompt },
      ...(this.ha.openAiTools.length
        ? []
        : [{ role: 'system' as const, content: NO_TOOLS_NOTE }]),
      ...history,
    ];
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const started = Date.now();
      let stream: Awaited<ReturnType<LlmService['openStream']>>;
      try {
        stream = await this.openStream(messages);
      } catch (err) {
        // Some models try to call a device action even when Home Assistant is offline
        // (no tools sent); the provider then rejects the request. Say so plainly.
        if (!this.ha.openAiTools.length && /tool/i.test((err as Error).message)) {
          yield "I can't reach Home Assistant right now, so I can't control your devices.";
          return;
        }
        throw err;
      }
      let text = '';
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
      messages.push(assistant);
      history.push(assistant);
      if (!calls.length) return;

      // Run all tool calls in parallel: they are independent Home Assistant actions.
      const results = await Promise.all(
        calls.map(async (c) => {
          if (c.type !== 'function') return { id: c.id, content: 'unsupported tool type' };
          try {
            const args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
            this.log.log(`tool ${c.function.name} ${JSON.stringify(args)}`);
            return { id: c.id, content: await this.ha.call(c.function.name, args) };
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

  private async openStream(messages: ChatCompletionMessageParam[]) {
    const tools = this.ha.openAiTools;
    const body = (model: string) => ({
      model,
      messages,
      stream: true as const,
      temperature: 0.3,
      max_tokens: 300,
      ...(tools.length ? { tools, tool_choice: 'auto' as const } : {}),
    });
    try {
      return await this.primary.chat.completions.create(body(this.cfg.llm.model), {
        timeout: this.cfg.llm.timeoutMs,
        maxRetries: 0,
      });
    } catch (err) {
      if (!this.fallback) throw err;
      this.log.warn(`primary LLM failed (${(err as Error).message}); using fallback`);
      return this.fallback.chat.completions.create(body(this.cfg.llm.fallbackModel!));
    }
  }
}
