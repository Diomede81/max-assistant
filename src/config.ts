/** Central, typed view of the environment. Every tunable lives in .env (see .env.example). */
export interface AppConfig {
  audio: {
    sampleRate: number;
    inputDevice: string;
    outputDevice: string;
    wakeChime: boolean;
  };
  wakeWord: { host: string; port: number; names: string[] };
  vad: { rmsThreshold: number; silenceMs: number; maxUtteranceMs: number };
  stt: { host: string; port: number; language: string };
  tts: { host: string; port: number; voice?: string };
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
    fallbackBaseUrl?: string;
    fallbackApiKey?: string;
    fallbackModel?: string;
    timeoutMs: number;
    systemPrompt: string;
  };
  ha: { mcpUrl: string; token: string };
}

const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

export function loadConfig(): AppConfig {
  const env = process.env;
  return {
    audio: {
      sampleRate: num(env.AUDIO_SAMPLE_RATE, 16000),
      inputDevice: env.AUDIO_INPUT_DEVICE ?? 'default',
      outputDevice: env.AUDIO_OUTPUT_DEVICE ?? 'default',
      wakeChime: (env.WAKE_CHIME ?? 'on') !== 'off',
    },
    wakeWord: {
      host: env.WAKEWORD_HOST ?? '127.0.0.1',
      port: num(env.WAKEWORD_PORT, 10400),
      // Accept "Hey Jarvis", "hey-jarvis" or "hey_jarvis": model names use lowercase + underscores.
      names: (env.WAKEWORD_NAMES ?? 'hey_jarvis')
        .split(',')
        .map((s) => s.trim().toLowerCase().replace(/^["']|["']$/g, '').replace(/[\s-]+/g, '_'))
        .filter(Boolean),
    },
    vad: {
      rmsThreshold: num(env.VAD_RMS_THRESHOLD, 500),
      silenceMs: num(env.VAD_SILENCE_MS, 450),
      maxUtteranceMs: num(env.VAD_MAX_UTTERANCE_MS, 10000),
    },
    stt: {
      host: env.STT_HOST ?? '127.0.0.1',
      port: num(env.STT_PORT, 10300),
      language: env.STT_LANGUAGE ?? 'en',
    },
    tts: {
      host: env.TTS_HOST ?? '127.0.0.1',
      port: num(env.TTS_PORT, 10200),
      voice: env.TTS_VOICE || undefined,
    },
    llm: {
      baseUrl: env.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1',
      apiKey: env.LLM_API_KEY ?? '',
      model: env.LLM_MODEL ?? 'openai/gpt-oss-20b',
      fallbackBaseUrl: env.LLM_FALLBACK_BASE_URL || undefined,
      fallbackApiKey: env.LLM_FALLBACK_API_KEY || 'ollama',
      fallbackModel: env.LLM_FALLBACK_MODEL || undefined,
      timeoutMs: num(env.LLM_TIMEOUT_MS, 4000),
      systemPrompt:
        env.LLM_SYSTEM_PROMPT ??
        'You are Max, a concise home assistant. Answer in one or two short spoken sentences. ' +
          'Use the Home Assistant tools to control or query devices. Never invent device names; ' +
          'if unsure, ask a short clarifying question. No markdown, no lists, no emojis.',
    },
    ha: {
      mcpUrl: env.HA_MCP_URL ?? 'http://homeassistant.local:8123/api/mcp',
      token: env.HA_TOKEN ?? '',
    },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
