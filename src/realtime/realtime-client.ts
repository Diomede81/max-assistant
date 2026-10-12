import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { VoiceClient, VoiceClientOptions } from './voice-client';

export type RealtimeOptions = VoiceClientOptions;

/**
 * Minimal client for OpenAI's Realtime API (speech-to-speech over WebSocket).
 * Audio in/out is 24 kHz 16-bit mono PCM. Emits:
 *  ready, speech-started, speech-stopped, audio(Buffer), response-done({ toolCalls }),
 *  tool-call({ callId, name, args }), user-transcript(string), assistant-transcript(string),
 *  error(Error), close()
 * Accepts both GA event names (response.output_audio.delta) and the older beta names
 * (response.audio.delta) so it keeps working across API versions.
 */
export class RealtimeClient extends EventEmitter implements VoiceClient {
  readonly inputRate = 24000;
  private ws?: WebSocket;
  private toolCallsInResponse = 0;

  constructor(private readonly opts: RealtimeOptions) {
    super();
  }

  connect(timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.opts.url}?model=${encodeURIComponent(this.opts.model)}`;
      const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.opts.apiKey}` } });
      this.ws = ws;
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error(`no answer from OpenAI Realtime within ${timeoutMs / 1000}s`));
      }, timeoutMs);
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
      ws.on('unexpected-response', (_req, res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c));
        res.on('end', () => done(new Error(`OpenAI Realtime refused the connection (${res.statusCode}): ${body.slice(0, 200)}`)));
      });
      ws.on('open', () => this.configure());
      ws.on('message', (raw) => {
        let e: Record<string, any>;
        try {
          e = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (e.type === 'session.updated') done();
        if (e.type === 'error' && !settled) done(new Error(e.error?.message ?? 'Realtime error'));
        this.handle(e);
      });
      // Errors before setup completes reject connect(); only later ones become 'error' events
      // (emitting during setup, before anyone listens, would crash the process).
      ws.on('error', (err) => {
        if (!ready) return done(err);
        this.emit('error', err);
      });
      ws.on('close', () => {
        if (!ready) done(new Error('connection closed during setup'));
        this.emit('close');
      });
    });
  }

  /** 24 kHz 16-bit mono PCM. */
  sendAudio(pcm24: Buffer): void {
    this.send({ type: 'input_audio_buffer.append', audio: pcm24.toString('base64') });
  }

  sendToolResult(callId: string, output: string): void {
    this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output } });
  }

  /** Drop any audio the server has buffered but not yet acted on (e.g. Max's own echo). */
  clearInput(): void {
    this.send({ type: 'input_audio_buffer.clear' });
  }

  /** Stop the reply the model is currently generating (the user interrupted). */
  cancelResponse(): void {
    this.send({ type: 'response.cancel' });
  }

  /** Ask the model to continue (e.g. after tool results) or to speak first. */
  requestResponse(): void {
    this.send({ type: 'response.create' });
  }

  close(): void {
    this.ws?.close();
    this.ws = undefined;
  }

  private configure(): void {
    const { opts } = this;
    const input: Record<string, unknown> = {
      format: { type: 'audio/pcm', rate: 24000 },
      turn_detection: {
        type: 'server_vad',
        silence_duration_ms: opts.silenceMs,
        create_response: true,
        interrupt_response: opts.interruptResponse,
      },
    };
    if (opts.transcribeModel) input.transcription = { model: opts.transcribeModel };
    this.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: opts.model,
        instructions: opts.instructions,
        output_modalities: ['audio'],
        audio: { input, output: { format: { type: 'audio/pcm', rate: 24000 }, voice: opts.voice } },
        tools: opts.tools.map((t) =>
          t.type === 'function'
            ? { type: 'function', name: t.function.name, description: t.function.description ?? '', parameters: t.function.parameters ?? { type: 'object', properties: {} } }
            : t,
        ),
        tool_choice: 'auto',
      },
    });
  }

  private handle(e: Record<string, any>): void {
    switch (e.type) {
      case 'input_audio_buffer.speech_started':
        this.emit('speech-started');
        break;
      case 'input_audio_buffer.speech_stopped':
        this.emit('speech-stopped');
        break;
      case 'response.output_audio.delta':
      case 'response.audio.delta':
        if (e.delta) this.emit('audio', Buffer.from(e.delta, 'base64'));
        break;
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        if (e.delta) this.emit('assistant-text', e.delta);
        break;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        if (e.transcript) this.emit('assistant-transcript', e.transcript);
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (e.transcript) this.emit('user-transcript', String(e.transcript).trim());
        break;
      case 'response.function_call_arguments.done': {
        this.toolCallsInResponse++;
        let args: Record<string, unknown> = {};
        try {
          args = e.arguments ? JSON.parse(e.arguments) : {};
        } catch {
          /* model produced invalid JSON; call with no arguments */
        }
        this.emit('tool-call', { callId: e.call_id, name: e.name, args });
        break;
      }
      case 'response.done': {
        const toolCalls = this.toolCallsInResponse;
        this.toolCallsInResponse = 0;
        const status = e.response?.status;
        const reason = e.response?.status_details?.error?.message ?? e.response?.status_details?.reason;
        this.emit('response-done', { toolCalls, status, reason });
        break;
      }
      case 'error':
        this.emit('error', new Error(e.error?.message ?? 'Realtime error'));
        break;
    }
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
