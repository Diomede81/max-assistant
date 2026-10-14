import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import OpenAI from 'openai';
import { APP_CONFIG, AppConfig } from '../config';
import { SealedStore } from '../memory/sealed-store';

/** Background jobs that can each use their own AI model. The live conversation keeps LLM_* (speed matters there). */
export const TASKS = {
  news: { label: 'News briefings', help: 'Picks the articles that match your interests and writes the summaries.' },
  suggest: { label: 'Website suggestions', help: 'Suggests news websites for your interests.' },
  memory: { label: 'Filing conversations', help: 'After each conversation, decides what is worth remembering and where.' },
  digest: { label: 'Memory tidy-up', help: 'Rolls old conversation notes up into weekly and monthly digests.' },
} as const;
export type Task = keyof typeof TASKS;

export interface Provider {
  id: string;
  label: string;
  baseUrl: string;
  /** The .env setting that holds its key (or address). */
  setting: string;
  where?: string;
}

/** Providers with an OpenAI-compatible API: Max talks to all of them the same way. */
const KNOWN: Provider[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', setting: 'OPENAI_API_KEY', where: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1/', setting: 'ANTHROPIC_API_KEY', where: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', setting: 'GEMINI_API_KEY', where: 'https://aistudio.google.com/apikey' },
  { id: 'openrouter', label: 'OpenRouter (hundreds of models, one key)', baseUrl: 'https://openrouter.ai/api/v1', setting: 'OPENROUTER_API_KEY', where: 'https://openrouter.ai/keys' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', setting: 'GROQ_API_KEY', where: 'https://console.groq.com/keys' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', setting: 'DEEPSEEK_API_KEY', where: 'https://platform.deepseek.com/api_keys' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', setting: 'MISTRAL_API_KEY', where: 'https://console.mistral.ai/api-keys' },
];

export interface Assignment {
  provider: string;
  /** Empty = Max's main model (LLM_MODEL). */
  model: string;
}

export interface ChatRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
}

const LIST_CACHE_MS = 10 * 60_000;

/**
 * Bring your own model: any OpenAI-compatible provider (OpenAI, Anthropic, Gemini, OpenRouter,
 * Groq, DeepSeek, Mistral, a local Ollama, or your own endpoint) for each background job.
 * Keys stay in .env; the choice of model per job is made on the control panel and kept in
 * data/models.json. A job whose model fails falls back to Max's main model, so it still runs.
 */
@Injectable()
export class ModelsService implements OnModuleInit {
  private readonly log = new Logger('Models');
  private assignments: Partial<Record<Task, Assignment>> = {};
  private readonly store: SealedStore<{ tasks: Partial<Record<Task, Assignment>> }>;
  private readonly clients = new Map<string, OpenAI>();
  private readonly lists = new Map<string, { at: number; models: string[]; error?: string }>();

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    // Not secret (no keys in it): plain JSON next to the memory.
    this.store = new SealedStore(cfg.memory.dir, 'models');
  }

  onModuleInit(): void {
    try {
      this.assignments = this.store.load()?.tasks ?? {};
    } catch (err) {
      this.log.warn(`Could not read the model choices (${(err as Error).message}); using the main model for everything`);
    }
    const custom = Object.entries(this.assignments).filter(([, a]) => a && a.provider !== 'default');
    if (custom.length) this.log.log(`Models: ${custom.map(([t, a]) => `${t} → ${a!.provider}/${a!.model}`).join(', ')}`);
  }

  // ---------- Providers ----------

  /** Every provider, with whether it is set up. */
  providers(): (Provider & { configured: boolean })[] {
    const m = this.cfg.models;
    return [
      { id: 'default', label: `Max's main model (${this.cfg.llm.model})`, baseUrl: this.cfg.llm.baseUrl, setting: 'LLM_API_KEY', configured: true },
      ...KNOWN.map((p) => ({ ...p, configured: Boolean(m.keys[p.id]) })),
      { id: 'ollama', label: 'Ollama (on your own computer)', baseUrl: m.ollamaUrl || 'http://127.0.0.1:11434/v1', setting: 'OLLAMA_BASE_URL', configured: Boolean(m.ollamaUrl), where: 'https://ollama.com' },
      { id: 'custom', label: 'Your own endpoint (OpenAI-compatible)', baseUrl: m.customUrl, setting: 'CUSTOM_LLM_BASE_URL', configured: Boolean(m.customUrl) },
    ];
  }

  private provider(id: string): (Provider & { configured: boolean }) | undefined {
    return this.providers().find((p) => p.id === id);
  }

  private client(id: string): OpenAI {
    let c = this.clients.get(id);
    if (!c) {
      const p = this.provider(id)!;
      const key = id === 'default' ? this.cfg.llm.apiKey : this.cfg.models.keys[id];
      c = new OpenAI({ baseURL: p.baseUrl, apiKey: key || 'none' });
      this.clients.set(id, c);
    }
    return c;
  }

  /** The models a provider offers (from its own list, cached for 10 minutes). */
  async available(id: string): Promise<{ models: string[]; error?: string }> {
    const cached = this.lists.get(id);
    if (cached && Date.now() - cached.at < LIST_CACHE_MS) return cached;
    const p = this.provider(id);
    if (!p?.configured) return { models: [] };
    let out: { at: number; models: string[]; error?: string };
    try {
      let ids: string[];
      if (id === 'anthropic') {
        // Anthropic lists its models through its own API.
        const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
          headers: { 'x-api-key': this.cfg.models.keys.anthropic, 'anthropic-version': '2023-06-01' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        ids = ((await res.json()) as { data: { id: string }[] }).data.map((x) => x.id);
      } else {
        const page = await this.client(id).models.list({ timeout: 10_000 });
        ids = page.data.map((x) => x.id.replace(/^models\//, ''));
      }
      // Leave out models that can't chat (speech, images, embeddings...).
      const chat = ids.filter((x) => !/(embed|whisper|tts|dall-e|image|audio|realtime|transcribe|moderation|search|veo|imagen|aqa|guard)/i.test(x));
      out = { at: Date.now(), models: [...new Set(chat)].sort() };
    } catch (err) {
      out = { at: Date.now(), models: [], error: (err as Error).message };
    }
    this.lists.set(id, out);
    return out;
  }

  // ---------- Jobs ----------

  assignment(task: Task): Assignment {
    const a = this.assignments[task];
    return a && this.provider(a.provider)?.configured ? a : { provider: 'default', model: '' };
  }

  /** "OpenAI · gpt-…" for the control panel and the logs. */
  describe(task: Task): string {
    const a = this.assignment(task);
    if (a.provider === 'default') return `Main model (${this.cfg.llm.model})`;
    return `${this.provider(a.provider)?.label.replace(/ \(.*\)$/, '') ?? a.provider} · ${a.model}`;
  }

  assign(task: Task, provider: string, model: string): string {
    if (!(task in TASKS)) return 'Unknown job.';
    const p = this.provider(provider);
    if (!p) return 'Unknown provider.';
    if (!p.configured) return `${p.label} isn't set up: add ${p.setting} to .env and restart Max.`;
    const m = model.trim();
    if (provider !== 'default' && !m) return `Choose which model to use from ${p.label.replace(/ \(.*\)$/, '')}.`;
    this.assignments[task] = { provider, model: provider === 'default' ? '' : m.slice(0, 120) };
    this.store.save({ tasks: this.assignments }).catch((err) => this.log.error(`Could not save the model choices: ${(err as Error).message}`));
    this.log.log(`${TASKS[task].label}: ${this.describe(task)}`);
    return `${TASKS[task].label} now use ${this.describe(task)}.`;
  }

  /**
   * One chat completion for a job, with its chosen model. If that model fails, the main model
   * (LLM_*) does it instead, so a typo in a model name never stops Max's background work.
   */
  async complete(task: Task, req: ChatRequest): Promise<string> {
    const a = this.assignment(task);
    try {
      return await this.call(a, req);
    } catch (err) {
      if (a.provider === 'default') throw err;
      this.log.warn(`${TASKS[task].label}: ${this.describe(task)} failed (${(err as Error).message}); using the main model this time`);
      return this.call({ provider: 'default', model: '' }, req);
    }
  }

  /** A tiny request to check a model answers, for the Test button. */
  async test(task: Task): Promise<string> {
    const started = Date.now();
    try {
      const out = await this.call(this.assignment(task), { system: 'Reply with the single word OK.', user: 'Test', maxTokens: 20, timeoutMs: 30_000 });
      return `${this.describe(task)} answered in ${((Date.now() - started) / 1000).toFixed(1)}s ("${out.slice(0, 30)}").`;
    } catch (err) {
      return `${this.describe(task)} failed: ${(err as Error).message}`;
    }
  }

  private async call(a: Assignment, req: ChatRequest): Promise<string> {
    const main = a.provider === 'default';
    const res = await this.client(a.provider).chat.completions.create(
      {
        model: main ? this.cfg.llm.model : a.model,
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxTokens,
        // Only Max's main model has a configured thinking setting (LLM_REASONING_EFFORT).
        ...(main && this.cfg.llm.reasoningEffort ? { reasoning_effort: this.cfg.llm.reasoningEffort as 'low' } : {}),
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      },
      { timeout: req.timeoutMs ?? 60_000, maxRetries: 1 },
    );
    return res.choices[0]?.message?.content ?? '';
  }
}
