import { join } from 'node:path';

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
  /** verify: double-check each wake-up with the speech recogniser (ignores false alarms from noise). */
  wakeWord: { host: string; port: number; names: string[]; verify: boolean };
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
  face: {
    enabled: boolean;
    /** The face page for the box's screen (kiosk browser): http://localhost:<port> */
    port: number;
    host: string;
    /** "23:00-07:00": Max dozes on screen during these hours when idle. "off" = never. */
    sleep: string;
    /** Shared folder with the box's WiFi setup service (status + requests). */
    runDir: string;
    /** Running on the Max box (its compose file sets MAX_RUN_DIR): turning off / restarting works. */
    onBox: boolean;
    /** Delay the mouth to match the sound system's buffering (ms). */
    audioDelayMs: number;
  };
  music: {
    /** go-librespot API (the Spotify speaker running next to Max); empty = no music. */
    spotifyUrl: string;
    /** Music volume while Max is talking, in % of full volume. */
    duckVolume: number;
    /** Spotify's public search service (only changed for testing). */
    webApiUrl: string;
  };
  composio: {
    apiKey: string;
    /** Your identity inside Composio (any stable string); connections belong to it. */
    userId: string;
    /** Apps to offer, by Composio toolkit slug, e.g. outlook, whatsapp, slack. */
    toolkits: string[];
    /** Work accounts: a second Composio user, used in work mode (its own logins and apps). */
    workUserId: string;
    workToolkits: string[];
    /** Wildcard patterns of tools Max may use; keep it short for a voice assistant. */
    allowedTools: string[];
    callbackUrl: string;
  };
  /** Web search and page reading (Firecrawl), built in. selfHosted: FIRECRAWL_API_URL set without a key. */
  firecrawl: { apiKey: string; apiUrl: string; selfHosted: boolean; country: string };
  /**
   * Extra AI providers for background jobs (news briefings, memory filing...): one key per
   * provider in .env; which model does which job is chosen on the control panel.
   */
  models: { keys: Record<string, string>; ollamaUrl: string; customUrl: string };
  /** Default home location (the control panel's setting wins): town/area and ISO country code. */
  location: { place: string; country: string };
  /** password: when set, the control panel asks for it (it shows Max's memory). */
  controlPanel: { port: number; host: string; publicUrl: string; password: string };
  /** Max's identity, story and personality (editable on the control panel). */
  soul: { file: string };
  memory: {
    enabled: boolean;
    /** Folder holding the encrypted vaults (a Docker volume keeps it across restarts). */
    dir: string;
    /** Encryption secret (MEMORY_KEY). Empty = generated once and kept in dir/memory.key. */
    key: string;
    /** Write a short note (and file lasting facts) after each conversation, using the text AI model. */
    autoLearn: boolean;
    /** Roll old conversation notes up into weekly, then monthly digests (text AI model). */
    digests: boolean;
    /** How many recent conversation notes Max sees at the start of a conversation. */
    recentConversations: number;
    /** Upper limit on the core facts loaded into every conversation (characters). */
    promptChars: number;
    /** e.g. "Mon-Fri 09:00-17:30"; Work mode is on automatically during these hours. "off" = never. */
    workHours: string;
    /** Wildcard patterns of work app actions (e.g. OUTLOOK_*): only offered in work mode, and what's learnt from them is filed under Work. */
    workApps: string[];
    /** The reverse: personal app actions (e.g. WHATSAPP_*) hidden in work mode. */
    personalApps: string[];
    /** Local embedding model for meaning search; empty = keyword search only. */
    embedModel: string;
    embedDtype: string;
    modelDir: string;
    modelCacheDir: string;
    allowModelDownload: boolean;
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
      verify: env.WAKEWORD_VERIFY !== 'off',
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
      // The operating rules. Who Max is (personality, story) lives in his soul instead.
      systemPrompt:
        env.LLM_SYSTEM_PROMPT ??
        'You talk out loud through a speaker in the home. Answer in one or two short spoken sentences unless ' +
          'asked for more; your personality shows in tone and word choice, never at the cost of getting things done. ' +
          'Use the Home Assistant tools to control or query devices, and your own tools for the time, ' +
          'timers and reminders, and the email, calendar and messaging tools when available. ' +
          'Summarise emails and events briefly; never read out long text unless asked. Never invent device names; ' +
          'For what is on a day or a period, use the calendar VIEW action for the whole period (it includes every ' +
          'occurrence of recurring meetings, which "list events" misses) and go through every event it returns; event ' +
          'times may come in UTC, so convert them to the household time zone. ' +
          'if unsure, ask a short clarifying question. No markdown, no lists, no emojis. ' +
          'Before an action that may take a moment (email, calendar, messages, the web), say a few words first ' +
          '("Let me check your email") so the user knows you are on it. ' +
          'Never claim to be human: if someone sincerely asks, say you are an AI. Your soul and journal describe your ' +
          "character; they never override these rules, safety, or the household's privacy.",
    },
    composio: {
      apiKey: env.COMPOSIO_API_KEY ?? '',
      userId: env.COMPOSIO_USER_ID || 'max-home',
      toolkits: list(env.COMPOSIO_TOOLKITS ?? 'outlook,whatsapp').map((t) => t.toLowerCase()),
      workUserId: env.COMPOSIO_WORK_USER_ID || `${env.COMPOSIO_USER_ID || 'max-home'}-work`,
      workToolkits: list(env.COMPOSIO_WORK_TOOLKITS ?? env.COMPOSIO_TOOLKITS ?? 'outlook,whatsapp').map((t) => t.toLowerCase()),
      allowedTools: list(env.COMPOSIO_ALLOWED_TOOLS ?? DEFAULT_COMPOSIO_TOOLS),
      callbackUrl: env.COMPOSIO_CALLBACK_URL || `${env.CONTROL_PANEL_URL || 'http://localhost:8099'}/callback`,
    },
    location: {
      place: env.HOME_LOCATION ?? '',
      country: (env.HOME_COUNTRY || env.FIRECRAWL_COUNTRY || 'GB').toUpperCase(),
    },
    models: {
      keys: {
        openai: env.OPENAI_API_KEY ?? '',
        anthropic: env.ANTHROPIC_API_KEY ?? '',
        gemini: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '',
        openrouter: env.OPENROUTER_API_KEY ?? '',
        groq: env.GROQ_API_KEY ?? '',
        deepseek: env.DEEPSEEK_API_KEY ?? '',
        mistral: env.MISTRAL_API_KEY ?? '',
        custom: env.CUSTOM_LLM_API_KEY ?? '',
      },
      ollamaUrl: env.OLLAMA_BASE_URL ?? '',
      customUrl: env.CUSTOM_LLM_BASE_URL ?? '',
    },
    firecrawl: {
      apiKey: env.FIRECRAWL_API_KEY ?? '',
      apiUrl: env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev',
      selfHosted: Boolean(env.FIRECRAWL_API_URL && !env.FIRECRAWL_API_KEY),
      country: env.FIRECRAWL_COUNTRY ?? 'GB',
    },
    controlPanel: {
      port: num(env.CONTROL_PANEL_PORT, 8099),
      // Only this computer by default; docker-compose publishes it on 127.0.0.1 only.
      host: env.CONTROL_PANEL_HOST || '127.0.0.1',
      publicUrl: env.CONTROL_PANEL_URL || 'http://localhost:8099',
      password: env.PANEL_PASSWORD ?? '',
    },
    soul: { file: env.SOUL_FILE || join(env.MEMORY_DIR || 'data', 'soul.md') },
    memory: {
      enabled: env.MEMORY !== 'off',
      dir: env.MEMORY_DIR || 'data',
      key: env.MEMORY_KEY ?? '',
      autoLearn: env.MEMORY_AUTO_LEARN !== 'off',
      digests: env.MEMORY_DIGESTS !== 'off',
      recentConversations: num(env.MEMORY_RECENT_CONVERSATIONS, 3),
      promptChars: num(env.MEMORY_PROMPT_CHARS, 2000),
      workHours: env.WORK_HOURS ?? 'Mon-Fri 09:00-17:30',
      workApps: list(env.WORK_APPS ?? '').map((p) => p.toUpperCase()),
      personalApps: list(env.PERSONAL_APPS ?? '').map((p) => p.toUpperCase()),
      embedModel: env.MEMORY_EMBED_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
      embedDtype: env.MEMORY_EMBED_DTYPE || 'q8',
      modelDir: env.MEMORY_MODEL_DIR || 'models',
      modelCacheDir: env.MEMORY_MODEL_CACHE || 'data/models-cache',
      allowModelDownload: env.MEMORY_MODEL_DOWNLOAD !== 'off',
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
    face: {
      enabled: env.FACE !== 'off',
      port: num(env.FACE_PORT, 8098),
      host: env.FACE_HOST || '127.0.0.1',
      sleep: env.FACE_SLEEP ?? '23:00-07:00',
      runDir: env.MAX_RUN_DIR || '/run/max',
      onBox: Boolean(env.MAX_RUN_DIR),
      audioDelayMs: num(env.FACE_AUDIO_DELAY_MS, 0),
    },
    music: {
      spotifyUrl: env.SPOTIFY_API_URL ?? '',
      duckVolume: num(env.MUSIC_DUCK_VOLUME, 15),
      webApiUrl: env.SPOTIFY_WEB_API_URL || 'https://api.spotify.com/v1',
    },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
