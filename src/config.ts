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
  composio: {
    apiKey: string;
    /** Your identity inside Composio (any stable string); connections belong to it. */
    userId: string;
    /** Apps to offer, by Composio toolkit slug, e.g. outlook, whatsapp, slack. */
    toolkits: string[];
    /** Wildcard patterns of tools Max may use; keep it short for a voice assistant. */
    allowedTools: string[];
    callbackUrl: string;
  };
  controlPanel: { port: number; host: string; publicUrl: string };
  memory: {
    enabled: boolean;
    /** JSON file holding facts and conversation notes (a Docker volume keeps it across restarts). */
    file: string;
    /** Write a short note (and pick up lasting facts) after each conversation, using the text AI model. */
    autoLearn: boolean;
    /** How many recent conversation notes Max sees at the start of a conversation. */
    recentConversations: number;
    /** Upper limit on how much of the fact list goes into every conversation (characters). */
    promptChars: number;
  };
  /** 'pipeline' = wake word + STT + LLM + TTS (default); 'realtime' = OpenAI Realtime speech-to-speech */
  voiceMode: 'pipeline' | 'realtime';
  realtime: {
    /** 'openai' (gpt-realtime) or 'gemini' (Gemini Live, roughly 10x cheaper) */
    provider: 'openai' | 'gemini';
    url: string;
    apiKey: string;
    /** Optional BCP-47 language for the voice, e.g. en-GB (Gemini). */
    language?: string;
    model: string;
    voice: string;
    /** Extra delivery/personality instructions appended to the system prompt */
    style: string;
    silenceMs: number;
    bargeIn: boolean;
    /** Say the wake word while Max is talking to interrupt him (works on speakers, no echo issues). */
    wakeInterrupt: boolean;
    transcribeModel?: string;
    /** Offer Max's actions in realtime mode (off = conversation only; useful to isolate problems). */
    tools: boolean;
    /** Wildcard patterns of actions to leave out in realtime mode (e.g. one a provider rejects). */
    excludeTools: string[];
    followUpMs: number;
    maxSessionMs: number;
  };
}

const num = (v: string | undefined, d: number) => (v ? Number(v) : d);
const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

/**
 * A voice assistant works best with a short list of tools. These cover reading and
 * searching email, sending/replying, and the calendar (Outlook = Office 365), plus
 * sending WhatsApp messages. Change with COMPOSIO_ALLOWED_TOOLS (use * as a wildcard).
 */
const DEFAULT_COMPOSIO_TOOLS = [
  'OUTLOOK_*LIST*MESSAGE*', 'OUTLOOK_*SEARCH*', 'OUTLOOK_*GET*MESSAGE*', 'OUTLOOK_*SEND*',
  'OUTLOOK_*REPLY*', 'OUTLOOK_*EVENT*', 'OUTLOOK_*CALENDAR*', 'OUTLOOK_*SCHEDULE*',
  'WHATSAPP_SEND*', 'WHATSAPP_GET*',
].join(',');

export function loadConfig(): AppConfig {
  const env = process.env;
  const realtimeProvider = env.REALTIME_PROVIDER === 'gemini' ? 'gemini' : 'openai';
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
          'timers and reminders, and the email, calendar and messaging tools when available. ' +
          'Summarise emails and events briefly; never read out long text unless asked. Never invent device names; ' +
          'if unsure, ask a short clarifying question. No markdown, no lists, no emojis.',
    },
    composio: {
      apiKey: env.COMPOSIO_API_KEY ?? '',
      userId: env.COMPOSIO_USER_ID || 'max-home',
      toolkits: list(env.COMPOSIO_TOOLKITS ?? 'outlook,whatsapp').map((t) => t.toLowerCase()),
      allowedTools: list(env.COMPOSIO_ALLOWED_TOOLS ?? DEFAULT_COMPOSIO_TOOLS),
      callbackUrl: env.COMPOSIO_CALLBACK_URL || `${env.CONTROL_PANEL_URL || 'http://localhost:8099'}/callback`,
    },
    controlPanel: {
      port: num(env.CONTROL_PANEL_PORT, 8099),
      // Only this computer by default; docker-compose publishes it on 127.0.0.1 only.
      host: env.CONTROL_PANEL_HOST || '127.0.0.1',
      publicUrl: env.CONTROL_PANEL_URL || 'http://localhost:8099',
    },
    memory: {
      enabled: env.MEMORY !== 'off',
      file: env.MEMORY_FILE || 'data/memory.json',
      autoLearn: env.MEMORY_AUTO_LEARN !== 'off',
      recentConversations: num(env.MEMORY_RECENT_CONVERSATIONS, 5),
      promptChars: num(env.MEMORY_PROMPT_CHARS, 3000),
    },
    voiceMode: env.VOICE_MODE === 'realtime' ? 'realtime' : 'pipeline',
    realtime: {
      provider: realtimeProvider,
      url:
        env.REALTIME_URL ??
        (realtimeProvider === 'gemini'
          ? 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
          : 'wss://api.openai.com/v1/realtime'),
      apiKey:
        realtimeProvider === 'gemini'
          ? env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.REALTIME_API_KEY || ''
          : env.REALTIME_API_KEY || env.OPENAI_API_KEY || '',
      language: env.REALTIME_LANGUAGE || undefined,
      model: env.REALTIME_MODEL ?? (realtimeProvider === 'gemini' ? 'gemini-3.8-live' : 'gpt-realtime-2'),
      voice: env.REALTIME_VOICE ?? (realtimeProvider === 'gemini' ? 'Charon' : 'cedar'),
      style:
        env.REALTIME_STYLE ??
        'Speak with a warm, calm British accent, like a witty butler. Keep replies short and natural; ' +
          'never read out lists or long numbers unless asked.',
      silenceMs: num(env.REALTIME_SILENCE_MS, 500),
      bargeIn: env.REALTIME_BARGE_IN === 'on',
      wakeInterrupt: env.REALTIME_WAKE_INTERRUPT !== 'off',
      transcribeModel: env.REALTIME_TRANSCRIBE_MODEL || undefined,
      tools: env.REALTIME_TOOLS !== 'off',
      excludeTools: list(env.REALTIME_EXCLUDE_TOOLS ?? ''),
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
