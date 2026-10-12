import { EventEmitter } from 'node:events';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export interface VoiceClientOptions {
  url: string;
  apiKey: string;
  model: string;
  voice: string;
  instructions: string;
  tools: ChatCompletionTool[];
  silenceMs: number;
  interruptResponse: boolean;
  transcribeModel?: string;
  language?: string;
  /** Mic loudness that counts as speech, for providers without speech events (see Gemini). */
  vadThreshold?: number;
}

/**
 * What the realtime conversation needs from a speech-to-speech provider (OpenAI Realtime,
 * Gemini Live). Events:
 *  speech-started, speech-stopped, audio(Buffer 24 kHz 16-bit mono), response-done({ toolCalls,
 *  status, reason }), tool-call({ callId, name, args }), user-transcript(string),
 *  assistant-transcript(string), assistant-text(string: live pieces of what Max is saying),
 *  error(Error), close()
 * `response-done` with toolCalls > 0 means "the model is waiting for tool results and a
 * requestResponse()"; providers that continue on their own report toolCalls: 0.
 */
export interface VoiceClient extends EventEmitter {
  /** Sample rate the provider wants for microphone audio (16-bit mono). */
  readonly inputRate: number;
  connect(timeoutMs?: number): Promise<void>;
  sendAudio(pcm: Buffer): void;
  sendToolResult(callId: string, output: string): void;
  requestResponse(): void;
  cancelResponse(): void;
  clearInput(): void;
  close(): void;
}
