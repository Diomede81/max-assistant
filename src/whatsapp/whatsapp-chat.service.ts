import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { LlmService, explainLlmError } from '../llm/llm.service';
import { ToolRouterService } from '../actions/tool-router.service';
import { ModesService } from '../memory/modes.service';
import { MemoryLearnerService, TranscriptLine } from '../memory/memory-learner.service';
import { LockService } from '../lock/lock.service';
import { WhatsAppService } from './whatsapp.service';

/** A chat with no new message for this long is over: filed in memory, and the next one starts fresh. */
const IDLE_MS = 30 * 60_000;
const MAX_TURNS = 30;

const TEXT_NOTE =
  'This conversation is a WhatsApp chat with the user, in writing, not by voice: answer in writing, concisely. ' +
  'Short lists and links are fine; no markdown headings or bold. Everything else is as usual (your actions, memory, ' +
  'and the user\'s "yes" before sending or changing anything: here they type it).';

/**
 * Chatting with Max on WhatsApp: what the user writes in their own chat ("Message yourself") is
 * answered there, by the same AI with the same actions and safety as the voice (a typed "yes" counts
 * for "Shall I go ahead?"). Only the user's own chat: other people never reach Max this way. Not while
 * Max is locked or in guest mode. The chat is filed in memory once it has gone quiet, like a conversation.
 */
@Injectable()
export class WhatsAppChatService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('WhatsApp chat');
  private history: ChatCompletionMessageParam[] = [];
  private transcript: TranscriptLine[] = [];
  private lastAt = 0;
  private idle?: NodeJS.Timeout;

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly llm: LlmService,
    private readonly tools: ToolRouterService,
    private readonly modes: ModesService,
    @Optional() private readonly learner?: MemoryLearnerService,
    @Optional() private readonly lock?: LockService,
  ) {}

  onModuleInit(): void {
    this.whatsapp.onSelfMessage = (text) => this.reply(text);
  }

  onModuleDestroy(): void {
    clearTimeout(this.idle);
    this.whatsapp.onSelfMessage = undefined;
  }

  async reply(text: string): Promise<string | undefined> {
    if (this.lock?.locked) return 'I\'m locked: enter the start-up code on my screen first, then write again.';
    if (this.modes.mode === 'guest') return 'I\'m in guest mode, so I don\'t chat on WhatsApp right now. Say "Max, personal mode" at home to switch back.';
    if (Date.now() - this.lastAt > IDLE_MS) this.finish();
    this.lastAt = Date.now();
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.finish(), IDLE_MS);

    if (!this.history.length) this.history.push({ role: 'system', content: TEXT_NOTE });
    this.history.push({ role: 'user', content: text });
    this.transcript.push({ who: 'user', text });
    // a typed answer to "Shall I go ahead?" counts, like a spoken one
    this.tools.heard(text, 'whatsapp');
    this.log.log(`Message from you (${text.split(/\s+/).length} words)`);
    let out = '';
    try {
      for await (const fragment of this.llm.respond(this.history)) out += fragment;
    } catch (err) {
      const why = explainLlmError(err);
      this.log.warn(why.log);
      return why.spoken;
    }
    out = out.trim();
    if (out) this.transcript.push({ who: 'max', text: out });
    for (const m of this.history) if (m.role === 'assistant' && 'tool_calls' in m && m.tool_calls) for (const c of m.tool_calls) if (c.type === 'function' && !this.transcript.some((t) => t.who === 'action' && t.text === c.function.name)) this.transcript.push({ who: 'action', text: c.function.name });
    // a long chat keeps its start (the note) and its latest turns
    if (this.history.length > MAX_TURNS * 3) this.history = [this.history[0], ...this.history.slice(-MAX_TURNS * 2)];
    return out || 'Done.';
  }

  /** The chat went quiet: file it in memory (like a spoken conversation) and start afresh next time. */
  private finish(): void {
    clearTimeout(this.idle);
    const lines = this.transcript;
    this.history = [];
    this.transcript = [];
    if (lines.some((l) => l.who === 'user')) void this.learner?.learn(lines);
  }
}
