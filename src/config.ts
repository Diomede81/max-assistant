/** Central, typed view of the environment. Every tunable lives in .env (see .env.example). */
export interface AppConfig {
  audio: {
    sampleRate: number;
    inputDevice: string;
    outputDevice: string;
    wakeChime: boolean;
    /** Keep the mic muted this long after Max's voice should have finished (speaker/bridge latency). */
    echoTailMs: number;
  };
  wakeWord: { host: string; port: number; names: string[] };
  vad: { rmsThreshold: number; silenceMs: number; maxUtteranceMs: number };
  stt: { host: string; port: number; language: string };
  tts: {
    /** 'piper' (local Wyoming) or 'openai' (any OpenAI-compatible speech API: Kokoro, OpenAI, ...) */
    provider: 'piper' | 'openai';
    host: string;
    port: number;
    voice?: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    instructions?: string;
    sampleRate: number;
  };
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
    fallbackBaseUrl?: string;
    fallbackApiKey?: string;
    fallbackModel?: string;
    /** Sent as `reasoning_effort` when set, e.g. "none" to switch off DeepSeek's slow thinking mode. */
    reasoningEffort?: string;
    fallbackReasoningEffort?: string;
    timeoutMs: number;
    systemPrompt: string;
  };
  ha: { mcpUrl: string; token: string };
  /** 'pipeline' = wake word + STT + LLM + TTS (default); 'realtime' = OpenAI Realtime speech-to-speech */
  voiceMode: 'pipeline' | 'realtime';
  realtime: {
    url: string;
    apiKey: string;
    model: string;
    voice: string;
    /** Extra delivery/personality instructions appended to the system prompt */
    style: string;
    silenceMs: number;
    bargeIn: boolean;
    transcribeModel?: string;
    followUpMs: number;
    maxSessionMs: number;
  };
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
      echoTailMs: num(env.AUDIO_ECHO_TAIL_MS, 1000),
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
      provider: env.TTS_PROVIDER === 'openai' ? 'openai' : 'piper',
      host: env.TTS_HOST ?? '127.0.0.1',
      port: num(env.TTS_PORT, 10200),
      voice: env.TTS_VOICE || undefined,
      baseUrl: (env.TTS_BASE_URL ?? 'http://127.0.0.1:8880/v1').replace(/\/+$/, ''),
      apiKey: env.TTS_API_KEY || 'none',
      model: env.TTS_MODEL ?? 'kokoro',
      instructions: env.TTS_INSTRUCTIONS || undefined,
      sampleRate: num(env.TTS_SAMPLE_RATE, 24000),
    },
    llm: {
      baseUrl: env.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1',
      apiKey: env.LLM_API_KEY ?? '',
      model: env.LLM_MODEL ?? 'openai/gpt-oss-20b',
      fallbackBaseUrl: env.LLM_FALLBACK_BASE_URL || undefined,
      fallbackApiKey: env.LLM_FALLBACK_API_KEY || 'ollama',
      fallbackModel: env.LLM_FALLBACK_MODEL || undefined,
      reasoningEffort: env.LLM_REASONING_EFFORT || undefined,
      fallbackReasoningEffort: env.LLM_FALLBACK_REASONING_EFFORT || undefined,
      timeoutMs: num(env.LLM_TIMEOUT_MS, 4000),
      systemPrompt:
        env.LLM_SYSTEM_PROMPT ??
        'You are Max, a concise home assistant. Answer in one or two short spoken sentences. ' +
          'Use the Home Assistant tools to control or query devices, and your own tools for the time, ' +
          'timers and reminders. Never invent device names; ' +
          'if unsure, ask a short clarifying question. No markdown, no lists, no emojis.',
    },
    voiceMode: env.VOICE_MODE === 'realtime' ? 'realtime' : 'pipeline',
    realtime: {
      url: env.REALTIME_URL ?? 'wss://api.openai.com/v1/realtime',
      apiKey: env.REALTIME_API_KEY || env.OPENAI_API_KEY || '',
      model: env.REALTIME_MODEL ?? 'gpt-realtime-2',
      voice: env.REALTIME_VOICE ?? 'cedar',
      style:
        env.REALTIME_STYLE ??
        'Speak with a warm, calm British accent, like a witty butler. Keep replies short and natural; ' +
          'never read out lists or long numbers unless asked.',
      silenceMs: num(env.REALTIME_SILENCE_MS, 500),
      bargeIn: env.REALTIME_BARGE_IN === 'on',
      transcribeModel: env.REALTIME_TRANSCRIBE_MODEL || undefined,
      followUpMs: num(env.REALTIME_FOLLOW_UP_MS, 8000),
      maxSessionMs: num(env.REALTIME_MAX_SESSION_S, 300) * 1000,
    },
    ha: {
      mcpUrl: env.HA_MCP_URL ?? 'http://homeassistant.local:8123/api/mcp',
      token: env.HA_TOKEN ?? '',
    },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
