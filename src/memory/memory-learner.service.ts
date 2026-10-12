import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { APP_CONFIG, AppConfig } from '../config';
import { describeNow } from '../actions/clock';
import { MemoryService } from './memory.service';

export interface TranscriptLine {
  who: 'user' | 'max' | 'action';
  text: string;
}

const MIN_USER_WORDS = 4;
const TIMEOUT_MS = 30_000;

/**
 * After each conversation, asks the text AI model (the LLM_* settings) for a one-line note
 * of what was discussed and any lasting facts the user mentioned, and files them in memory.
 * Runs in the background once the conversation is over, so it never slows Max down.
 */
@Injectable()
export class MemoryLearnerService {
  private readonly log = new Logger('Memory');
  private readonly client?: OpenAI;
  private warned = false;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly memory: MemoryService,
  ) {
    if (memory.enabled && cfg.memory.autoLearn) {
      this.client = new OpenAI({ baseURL: cfg.llm.baseUrl, apiKey: cfg.llm.apiKey || 'none' });
    }
  }

  /** Never throws: a failed note is logged and skipped. */
  async learn(lines: TranscriptLine[]): Promise<void> {
    if (!this.client) return;
    const userWords = lines.filter((l) => l.who === 'user').reduce((n, l) => n + l.text.split(/\s+/).length, 0);
    const maxWords = lines.filter((l) => l.who === 'max').reduce((n, l) => n + l.text.split(/\s+/).length, 0);
    // Without the user's words (e.g. realtime transcription off) Max's replies still carry the gist.
    if (userWords < MIN_USER_WORDS && maxWords < MIN_USER_WORDS * 3) return;

    const transcript = lines
      .map((l) => (l.who === 'action' ? `[Max used: ${l.text}]` : `${l.who === 'user' ? 'User' : 'Max'}: ${l.text}`))
      .join('\n')
      .slice(-8000);
    const known = this.memory.facts.map((f) => `- ${f.text}`).join('\n').slice(-3000) || '(none)';
    try {
      const res = await this.client.chat.completions.create(
        {
          model: this.cfg.llm.model,
          temperature: 0.2,
          max_tokens: 400,
          ...(this.cfg.llm.reasoningEffort ? { reasoning_effort: this.cfg.llm.reasoningEffort as 'low' } : {}),
          messages: [
            {
              role: 'system',
              content:
                'You keep the long-term memory of Max, a home voice assistant. Read the conversation and reply with ' +
                'JSON only: {"summary": string, "facts": string[]}.\n' +
                '- summary: one short sentence on what was discussed or done, useful days later (e.g. "Planned ' +
                'Saturday\'s barbecue and asked for a 2pm reminder"). Use "" if it was only a quick command or ' +
                'question with nothing worth remembering (lights, time, weather, a timer).\n' +
                '- facts: lasting things the USER said about themselves, their household, people, preferences, ' +
                'routines or important dates, each a short self-contained sentence with real names and absolute ' +
                'dates. Skip anything temporary, anything already known, guesses, and anything Max said on his own. ' +
                'Never include passwords, PINs, codes or account numbers. Usually this list is empty.\n' +
                `Current time: ${describeNow()}.\nAlready known:\n${known}`,
            },
            { role: 'user', content: transcript },
          ],
        },
        { timeout: TIMEOUT_MS, maxRetries: 1 },
      );
      const parsed = parseJson(res.choices[0]?.message?.content ?? '');
      if (!parsed) {
        this.log.warn('Could not read the conversation note from the AI model; skipped');
        return;
      }
      if (parsed.summary) this.memory.addConversation(parsed.summary);
      for (const f of parsed.facts) this.memory.remember(f, 'auto');
    } catch (err) {
      const msg = (err as Error).message;
      if (!this.warned) {
        this.log.warn(
          `Could not write a conversation note (${msg}). Memory still works for things you ask Max to remember. ` +
            'Notes use the text AI model (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL); set MEMORY_AUTO_LEARN=off to stop trying.',
        );
        this.warned = true;
      } else {
        this.log.warn(`Conversation note skipped: ${msg}`);
      }
    }
  }
}

function parseJson(text: string): { summary: string; facts: string[] } | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as { summary?: unknown; facts?: unknown };
    return {
      summary: typeof v.summary === 'string' ? v.summary : '',
      facts: Array.isArray(v.facts) ? v.facts.filter((f): f is string => typeof f === 'string' && !!f.trim()) : [],
    };
  } catch {
    return undefined;
  }
}
