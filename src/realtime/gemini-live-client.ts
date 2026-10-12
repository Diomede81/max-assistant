import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { VoiceClient, VoiceClientOptions } from './voice-client';
import { toGeminiSchema } from './gemini-schema';

/**
 * Minimal client for Google's Gemini Live API (speech-to-speech over WebSocket,
 * BidiGenerateContent). Mic audio goes in as 16 kHz PCM (no resampling needed), the voice
 * comes back as 24 kHz PCM. Emits the same events as the OpenAI RealtimeClient, so the
 * conversation logic (echo guard, interruption, tools, confirmations) is shared.
 *
 * Differences handled here:
 * - Gemini continues by itself after tool results, so `response-done` always reports
 *   toolCalls: 0 and requestResponse() is a no-op.
 * - Speech start/stop events come from the server when it sends them (voiceActivity);
 *   otherwise a simple loudness detector on the outgoing mic audio provides them.
 * - There is no "cancel reply" message; interrupted audio is simply discarded.
 */
export class GeminiLiveClient extends EventEmitter implements VoiceClient {
  readonly inputRate = 16000;
  private ws?: WebSocket;
  private readonly toolNames = new Map<string, string>();
  private userText = '';
  private maxText = '';
  private interrupted = false;
  private serverVad = false;
  private closing = false;
  // local speech detection (fallback)
  private localSpeaking = false;
  private quietMs = 0;

  constructor(private readonly opts: VoiceClientOptions) {
    super();
  }

  connect(timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.opts.url}?key=${encodeURIComponent(this.opts.apiKey)}`);
      this.ws = ws;
      let settled = false;
      let ready = false; // set once the session is fully set up
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        ready = !err;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => {
        ws.terminate();
        done(new Error(`no answer from Gemini Live within ${timeoutMs / 1000}s`));
      }, timeoutMs);
      ws.on('unexpected-response', (_req, res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c));
        res.on('end', () => done(new Error(`Gemini Live refused the connection (${res.statusCode}): ${body.slice(0, 200)}`)));
      });
      ws.on('open', () => this.setup());
      ws.on('message', (raw) => {
        let m: Record<string, any>;
        try {
          m = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (m.setupComplete) done();
        this.handle(m);
      });
      // Errors before setup completes reject connect(); only later ones become 'error' events
      // (emitting during setup, before anyone listens, would crash the process).
      ws.on('error', (err) => {
        if (!ready) return done(err);
        this.emit('error', err);
      });
      ws.on('close', (code, reason) => {
        // Google reports setup problems (bad key, unknown model, invalid tool) as a close reason.
        const why = reason.toString() || `code ${code}`;
        if (!ready) done(new Error(`Gemini Live closed the connection: ${why}`));
        else if (!this.closing && code !== 1000) this.emit('error', new Error(`Gemini Live closed the connection: ${why}`));
        this.emit('close');
      });
    });
  }

  /** 16 kHz 16-bit mono PCM. */
  sendAudio(pcm: Buffer): void {
    this.send({ realtimeInput: { audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' } } });
    if (!this.serverVad) this.detectSpeech(pcm);
  }

  sendToolResult(callId: string, output: string): void {
    this.send({
      toolResponse: {
        functionResponses: [{ id: callId, name: this.toolNames.get(callId) ?? '', response: { result: output } }],
      },
    });
  }

  requestResponse(): void {
    /* Gemini continues on its own after tool results */
  }

  cancelResponse(): void {
    /* not supported by Gemini Live; the conversation discards the rest of the reply */
  }

  clearInput(): void {
    /* not supported by Gemini Live */
  }

  close(): void {
    this.closing = true;
    this.ws?.close();
    this.ws = undefined;
  }

  private setup(): void {
    this.send({ setup: buildGeminiSetup(this.opts) });
  }

  private handle(m: Record<string, any>): void {
    if (m.voiceActivity?.voiceActivityType) {
      this.serverVad = true;
      if (m.voiceActivity.voiceActivityType === 'ACTIVITY_START') this.emit('speech-started');
      if (m.voiceActivity.voiceActivityType === 'ACTIVITY_END') this.emit('speech-stopped');
    }
    if (m.toolCall?.functionCalls) {
      for (const c of m.toolCall.functionCalls as Array<{ id: string; name: string; args?: Record<string, unknown> }>) {
        this.toolNames.set(c.id, c.name);
        this.emit('tool-call', { callId: c.id, name: c.name, args: c.args ?? {} });
      }
    }
    const sc = m.serverContent;
    if (sc) {
      for (const part of sc.modelTurn?.parts ?? []) {
        const data = part.inlineData?.data;
        if (data && String(part.inlineData.mimeType ?? '').startsWith('audio/')) this.emit('audio', Buffer.from(data, 'base64'));
      }
      if (sc.inputTranscription?.text) this.userText += sc.inputTranscription.text;
      if (sc.outputTranscription?.text) {
        this.maxText += sc.outputTranscription.text;
        this.emit('assistant-text', sc.outputTranscription.text);
      }
      if (sc.interrupted) this.interrupted = true;
      if (sc.turnComplete) {
        if (this.userText.trim()) this.emit('user-transcript', this.userText.trim());
        if (this.maxText.trim()) this.emit('assistant-transcript', this.maxText.trim());
        this.userText = '';
        this.maxText = '';
        this.emit('response-done', { toolCalls: 0, status: this.interrupted ? 'cancelled' : 'completed' });
        this.interrupted = false;
      }
    }
    if (m.goAway) this.emit('error', new Error(`Gemini Live will end the session soon (time left: ${m.goAway.timeLeft ?? '?'})`));
  }

  /** Fallback speech detection when the server doesn't send voiceActivity events. */
  private detectSpeech(pcm: Buffer): void {
    let sum = 0;
    for (let i = 0; i + 1 < pcm.length; i += 2) {
      const v = pcm.readInt16LE(i);
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, pcm.length / 2));
    const ms = (pcm.length / 2 / this.inputRate) * 1000;
    if (rms >= (this.opts.vadThreshold ?? 500)) {
      this.quietMs = 0;
      if (!this.localSpeaking) {
        this.localSpeaking = true;
        this.emit('speech-started');
      }
    } else if (this.localSpeaking && (this.quietMs += ms) >= this.opts.silenceMs) {
      this.localSpeaking = false;
      this.emit('speech-stopped');
    }
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}

/** Which optional parts of the set-up to include (all by default); used by the diagnostic tool. */
export interface GeminiSetupParts {
  voice?: boolean;
  language?: boolean;
  transcription?: boolean;
  vad?: boolean;
}

/** Builds the BidiGenerateContent `setup` message. */
export function buildGeminiSetup(opts: VoiceClientOptions, parts: GeminiSetupParts = {}): Record<string, unknown> {
  const p = { voice: true, language: true, transcription: true, vad: true, ...parts };
  const speechConfig: Record<string, unknown> = {};
  if (p.voice) speechConfig.voiceConfig = { prebuiltVoiceConfig: { voiceName: opts.voice } };
  if (p.language && opts.language) speechConfig.languageCode = opts.language;
  return {
    model: opts.model.startsWith('models/') ? opts.model : `models/${opts.model}`,
    generationConfig: { responseModalities: ['AUDIO'], ...(Object.keys(speechConfig).length ? { speechConfig } : {}) },
    systemInstruction: { parts: [{ text: opts.instructions }] },
    // Strict OpenAPI-style schemas: Gemini Live rejects many JSON Schema keywords with
    // "Request contains an invalid argument" once the model tries to use the tools.
    ...(opts.tools.length ? { tools: [{ functionDeclarations: geminiDeclarations(opts.tools) }] } : {}),
    ...(p.vad ? { realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: opts.silenceMs } } } : {}),
    ...(p.transcription ? { inputAudioTranscription: {}, outputAudioTranscription: {} } : {}),
  };
}

export function geminiDeclarations(tools: VoiceClientOptions['tools']): Record<string, unknown>[] {
  return tools
    .filter((t) => t.type === 'function')
    .map((t) => {
      const fn = t.type === 'function' ? t.function : { name: '', description: '', parameters: {} };
      const params = toGeminiSchema(fn.parameters);
      const hasParams = Object.keys((params.properties as object) ?? {}).length > 0;
      return {
        name: fn.name,
        description: (fn.description ?? '').slice(0, 1000) || fn.name,
        ...(hasParams ? { parameters: params } : {}),
      };
    });
}
