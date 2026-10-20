/**
 * A small client for Recall.ai's meeting bot API (https://docs.recall.ai): send a bot to a meeting, read how it's
 * doing, make it leave, and download the transcript afterwards. Max asks for results himself (no webhooks), so the
 * box never has to be reachable from the internet.
 */
export const REGIONS = ['eu-central-1', 'us-east-1', 'us-west-2', 'ap-northeast-1'];

export interface RecallBot {
  id: string;
  /** The latest status, e.g. joining_call, in_waiting_room, in_call_recording, call_ended, done, fatal. */
  code: string;
  subCode?: string;
  /** Where the finished transcript can be downloaded, once it's ready. */
  transcriptUrl?: string;
  /** When recording started and ended (for the length and the cost). */
  startedAt?: string;
  endedAt?: string;
}

export interface TranscriptLine {
  speaker: string;
  /** Seconds from the start of the recording. */
  at: number;
  text: string;
}

export class RecallClient {
  private base?: string;
  /** Recall.ai's examples differ: the key alone, or "Token <key>". Whichever works is remembered. */
  private auth?: string;

  constructor(
    private readonly key: string,
    private readonly region: string,
    private readonly baseUrl = '',
  ) {}

  /** Finds the account's region (when not given) and checks the key. */
  async check(): Promise<string> {
    await this.ready();
    return this.base!.replace(/^https:\/\/([^.]+)\..*$/, '$1');
  }

  /**
   * live: the transcript is also sent, line by line, to `live.url` while the meeting is on (so Max can answer), and
   * the bot gets a voice (Recall.ai only plays audio for bots made with one: a moment of silence, `live.silence`).
   */
  async createBot(meetingUrl: string, botName: string, chatMessage: string, live?: { url: string; silence?: string }): Promise<RecallBot> {
    const body: Record<string, unknown> = {
      meeting_url: meetingUrl,
      bot_name: botName,
      recording_config: {
        transcript: { provider: { recallai_streaming: { mode: live ? 'prioritize_low_latency' : 'prioritize_accuracy', language_code: live ? 'en' : 'auto' } } },
        ...(live ? { realtime_endpoints: [{ type: 'webhook', url: live.url, events: ['transcript.data'] }] } : {}),
      },
      // Tells everyone in the meeting that it's being transcribed, as soon as Max is in.
      chat: { on_bot_join: { send_to: 'everyone', message: chatMessage } },
    };
    if (live?.silence) body.automatic_audio_output = { in_call_recording: { data: { kind: 'mp3', b64_data: live.silence } } };
    return toBot(await this.request('POST', '/bot/', body));
  }

  async getBot(id: string): Promise<RecallBot> {
    return toBot(await this.request('GET', `/bot/${encodeURIComponent(id)}/`));
  }

  /** Plays an MP3 (as base64) into the meeting: Max speaking. */
  async say(id: string, mp3Base64: string): Promise<void> {
    await this.request('POST', `/bot/${encodeURIComponent(id)}/output_audio/`, { kind: 'mp3', b64_data: mp3Base64 });
  }

  async leave(id: string): Promise<void> {
    await this.request('POST', `/bot/${encodeURIComponent(id)}/leave_call/`, {});
  }

  /** The finished transcript, as lines of who said what and when. */
  async transcript(url: string): Promise<TranscriptLine[]> {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Recall.ai answered ${res.status} for the transcript`);
    return parseTranscript(await res.json());
  }

  private async ready(): Promise<void> {
    if (this.base && this.auth) return;
    if (!this.key) throw new Error('No Recall.ai key: set RECALL_API_KEY in .env');
    const bases = this.baseUrl ? [this.baseUrl.replace(/\/+$/, '')] : (this.region ? [this.region] : REGIONS).map((r) => `https://${r}.recall.ai/api/v1`);
    for (const base of bases) {
      for (const auth of [this.key, `Token ${this.key}`]) {
        const res = await fetch(`${base}/bot/?page_size=1`, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
        if (res?.ok) {
          this.base = base;
          this.auth = auth;
          return;
        }
      }
    }
    throw new Error(
      this.region || this.baseUrl ? 'Recall.ai refused the key (check RECALL_API_KEY and RECALL_REGION)' : "Recall.ai refused the key in every region (check RECALL_API_KEY, or set RECALL_REGION)",
    );
  }

  private async request(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    await this.ready();
    const res = await fetch(this.base + path, {
      method,
      headers: { Authorization: this.auth!, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Recall.ai said no (${res.status}): ${explain(text)}`);
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }
}

/** The bot's latest status and its transcript download, from Recall.ai's bot record. */
export function toBot(raw: Record<string, unknown>): RecallBot {
  const changes = Array.isArray(raw.status_changes) ? (raw.status_changes as { code?: string; sub_code?: string | null }[]) : [];
  const last = changes[changes.length - 1] ?? (raw.status as { code?: string; sub_code?: string } | undefined);
  const rec = (Array.isArray(raw.recordings) ? raw.recordings[0] : undefined) as
    | { started_at?: string; completed_at?: string; media_shortcuts?: { transcript?: { data?: { download_url?: string } } | null } }
    | undefined;
  return {
    id: String(raw.id ?? ''),
    code: last?.code ?? 'ready',
    subCode: last?.sub_code ?? undefined,
    transcriptUrl: rec?.media_shortcuts?.transcript?.data?.download_url ?? undefined,
    startedAt: rec?.started_at ?? undefined,
    endedAt: rec?.completed_at ?? undefined,
  };
}

/** Recall.ai's transcript: one entry per turn, with the speaker and their words (each with timestamps). */
export function parseTranscript(raw: unknown): TranscriptLine[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { data?: unknown })?.data) ? (raw as { data: unknown[] }).data : [];
  const out: TranscriptLine[] = [];
  for (const e of list as { participant?: { name?: string | null }; words?: { text?: string; start_timestamp?: { relative?: number } }[] }[]) {
    const words = Array.isArray(e?.words) ? e.words : [];
    const text = words.map((w) => w?.text ?? '').join(' ').replace(/\s+([,.!?;:])/g, '$1').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push({ speaker: e?.participant?.name?.trim() || 'Someone', at: Math.max(0, Number(words[0]?.start_timestamp?.relative) || 0), text });
  }
  return out;
}

function explain(text: string): string {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const first = Object.values(j)[0];
    return String(Array.isArray(first) ? first[0] : (j.detail ?? first ?? text)).slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}
