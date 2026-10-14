import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { APP_CONFIG, AppConfig } from '../config';

/** off = not configured; unreachable = speaker not running; pairing = waiting for Spotify sign-in; ready = signed in */
export type MusicState = 'off' | 'unreachable' | 'pairing' | 'ready';

interface Status {
  username: string;
  device_name: string;
  context_name?: string;
  stopped: boolean;
  paused: boolean;
  volume: number;
  volume_steps: number;
  track?: { name: string; artist_names: string[]; album_name: string; uri: string } | null;
}

interface Pick {
  uri: string;
  label: string;
}

const POLL_MS = 15_000;
const TIMEOUT_MS = 5_000;
const KINDS = ['any', 'song', 'artist', 'album', 'playlist', 'podcast', 'episode', 'audiobook'] as const;
type Kind = (typeof KINDS)[number];
const ACTIONS = ['pause', 'resume', 'next', 'previous', 'stop', 'now_playing', 'set_volume', 'volume_up', 'volume_down'] as const;
const LIKED = /\b(liked|favou?rite|my (songs|music|tracks)|saved songs)\b/i;
const MOOD = /\b(music|songs|mix|playlist|radio|hits|vibes?|relaxing|chill|focus|workout|party|jazz|classical|lo-?fi|sleep)\b/i;

/**
 * Max's own music player. A small Spotify Connect receiver (go-librespot) runs next to
 * Max, so the Max box is a Spotify speaker called "Max": music plays through Max's own
 * speakers, can also be picked from the Spotify app on any phone, and Max controls it by
 * voice: search and play songs, artists, albums, playlists and podcasts, pause, skip,
 * volume. While Max is talking the music is turned down, then back up.
 */
@Injectable()
export class MusicService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Music');
  private timer?: NodeJS.Timeout;
  state: MusicState = 'off';
  pairing?: { url: string; code: string; expiresAt: string };
  account?: string;
  lastError?: string;
  /** Set while Max is talking: the volume to go back to afterwards (undefined = leave as is). */
  private duck?: { restoreTo?: number };
  private firstCheck = true;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  private get base(): string {
    return this.cfg.music.spotifyUrl.replace(/\/$/, '');
  }

  onModuleInit(): void {
    if (!this.base) return;
    this.state = 'unreachable';
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Re-checks the speaker now (control panel refresh). */
  async poll(): Promise<void> {
    const before = this.state;
    try {
      const status = await this.api<Status>('GET', '/status');
      if (status) {
        this.state = 'ready';
        this.account = status.username;
        this.pairing = undefined;
      } else {
        this.state = 'pairing';
        const auth = await this.api<{ url: string; code: string; expires_at: string }>('GET', '/auth/code').catch(() => undefined);
        const code = auth ? { url: auth.url, code: auth.code, expiresAt: auth.expires_at } : undefined;
        if (code && code.code !== this.pairing?.code) {
          this.log.warn(
            `Spotify speaker needs signing in once: open ${code.url} (or spotify.com/pair, code ${code.code}) ` +
              `and approve. The link is also on the control panel (${this.cfg.controlPanel.publicUrl}).`,
          );
        }
        this.pairing = code;
      }
      this.lastError = undefined;
    } catch (err) {
      this.state = 'unreachable';
      this.lastError = (err as Error).message;
    }
    if (this.state === before && !this.firstCheck) return;
    this.firstCheck = false;
    if (this.state === 'ready') this.log.log(`Spotify speaker ready (account ${this.account}) - Max can play music`);
    else if (this.state === 'unreachable') {
      this.log.log(
        `Music is off: the Spotify speaker isn't running (${this.base}: ${this.lastError}). ` +
          'To use it: docker compose --profile music up -d (see docs/MUSIC.md)',
      );
    }
  }

  /** Music actions are offered once the speaker is running (signed in or waiting to be). */
  get tools(): ChatCompletionTool[] {
    if (this.state !== 'ready' && this.state !== 'pairing') return [];
    return [
      {
        type: 'function',
        function: {
          name: 'play_music',
          description:
            "Play music or podcasts on Max's own speaker through Spotify: a song, artist, album, playlist " +
            '(including the user\'s own playlists and Liked Songs), a mood or genre ("relaxing jazz"), or a podcast.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'What to play, e.g. "Yellow by Coldplay", "Norah Jones", "my running playlist"' },
              kind: { type: 'string', enum: [...KINDS], description: 'What kind of thing it is, if clear (default any)' },
              shuffle: { type: 'boolean', description: 'Shuffle (for artists, albums and playlists)' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'music_control',
          description: "Control the music on Max's speaker: pause, resume, skip, go back, stop, what's playing, volume.",
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: [...ACTIONS] },
              level: { type: 'number', description: 'Volume 0-100 for set_volume; step size for volume_up/volume_down (default 15)' },
            },
            required: ['action'],
          },
        },
      },
    ];
  }

  has(name: string): boolean {
    return name === 'play_music' || name === 'music_control';
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    if (this.state !== 'ready') await this.poll();
    if (this.state === 'pairing') {
      return "Spotify isn't signed in yet. Tell the user to open Max's control panel and approve the Spotify sign-in (one time only).";
    }
    if (this.state !== 'ready') return "Max's Spotify speaker isn't running right now.";
    try {
      if (name === 'play_music') return await this.play(String(args.query ?? ''), (args.kind as Kind) ?? 'any', args.shuffle === true);
      return await this.control(String(args.action ?? ''), typeof args.level === 'number' ? args.level : undefined);
    } catch (err) {
      return `Spotify error: ${(err as Error).message}`;
    }
  }

  // ---- Ducking: music down while Max talks ----

  /** Turns playing music down for a conversation. Quick and never throws. */
  async duckStart(): Promise<void> {
    if (this.state !== 'ready') return;
    this.duck = {};
    try {
      const s = await this.status();
      if (!s || s.stopped || s.paused) return;
      const target = this.duckLevel(s.volume_steps);
      if (s.volume > target) {
        this.duck.restoreTo = s.volume;
        await this.setVolume(target);
      }
    } catch {
      // music keeps playing at its volume; not worth interrupting the conversation over
    }
  }

  /** Puts the volume back after the conversation (including any change asked for meanwhile). */
  async duckEnd(): Promise<void> {
    const d = this.duck;
    this.duck = undefined;
    if (d?.restoreTo === undefined) return;
    await this.setVolume(d.restoreTo).catch(() => undefined);
  }

  // ---- Playing ----

  private async play(query: string, kind: Kind, shuffle: boolean): Promise<string> {
    if (!query.trim()) return 'Ask the user what to play.';
    const pick = await this.find(query.trim(), kind);
    if (!pick) return `Couldn't find "${query}" on Spotify.`;
    const isContext = !/^spotify:(track|episode):/.test(pick.uri);
    if (isContext) await this.api('POST', '/player/shuffle_context', { shuffle_context: shuffle }).catch(() => undefined);
    await this.api('POST', '/player/play', { uri: pick.uri });
    // Started mid-conversation: keep it quiet until Max has finished talking.
    if (this.duck && this.duck.restoreTo === undefined) {
      const s = await this.status().catch(() => undefined);
      if (s && s.volume > this.duckLevel(s.volume_steps)) {
        this.duck.restoreTo = s.volume;
        await this.setVolume(this.duckLevel(s.volume_steps));
      }
    }
    this.log.log(`Playing ${pick.label} (${pick.uri})`);
    return `Now playing ${pick.label}${shuffle && isContext ? ', shuffled' : ''}.`;
  }

  private async find(query: string, kind: Kind): Promise<Pick | undefined> {
    const s = await this.status();
    // 1. Liked Songs
    if (LIKED.test(query) && (kind === 'any' || kind === 'playlist') && s) {
      return { uri: `spotify:user:${s.username}:collection`, label: 'your Liked Songs' };
    }
    // 2. The user's own playlists, by name (no public search needed)
    if (kind === 'any' || kind === 'playlist') {
      const own = await this.ownPlaylist(query);
      if (own) return own;
    }
    // 3. Spotify search
    return this.search(query, kind);
  }

  private async ownPlaylist(query: string): Promise<Pick | undefined> {
    const res = await this.api<{ items: { uri: string; name: string }[] }>('GET', '/library/playlists?limit=500').catch(() => undefined);
    const q = words(query.replace(/\b(my|the|playlist)\b/gi, ' '));
    if (!res?.items?.length || !q.length) return undefined;
    let best: { p: { uri: string; name: string }; score: number } | undefined;
    for (const p of res.items) {
      const n = words(p.name);
      if (!n.length) continue;
      const hits = q.filter((w) => n.includes(w)).length;
      const score = hits / Math.max(q.length, n.length);
      if (hits && (!best || score > best.score)) best = { p, score };
    }
    // Needs a clear match ("running" -> "Running Mix"), not one shared word in a long name.
    return best && best.score >= 0.5 ? { uri: best.p.uri, label: `your playlist ${best.p.name}` } : undefined;
  }

  private async search(query: string, kind: Kind): Promise<Pick | undefined> {
    const types: Record<Kind, string> = {
      any: 'track,artist,album,playlist',
      song: 'track',
      artist: 'artist',
      album: 'album',
      playlist: 'playlist',
      podcast: 'show',
      episode: 'episode',
      audiobook: 'audiobook',
    };
    const token = await this.api<{ token: string }>('POST', '/token');
    if (!token?.token) throw new Error('no Spotify session');
    const url = `${this.cfg.music.webApiUrl}/search?${new URLSearchParams({ q: query, type: types[kind], limit: '5', market: 'from_token' })}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`search failed (${res.status} ${res.statusText})`);
    const r = (await res.json()) as Record<string, { items: (Record<string, unknown> | null)[] } | undefined>;
    const first = (key: string) => (r[key]?.items ?? []).filter((i): i is Record<string, unknown> => !!i && typeof i.uri === 'string');
    const by = (i: Record<string, unknown>) => {
      const a = (i.artists as { name: string }[] | undefined)?.map((x) => x.name).join(' and ');
      return a ? ` by ${a}` : '';
    };
    const pick = (key: string, what: string): Pick | undefined => {
      const i = first(key)[0];
      return i ? { uri: String(i.uri), label: `${what}${String(i.name)}${key === 'tracks' || key === 'albums' ? by(i) : ''}` } : undefined;
    };
    if (kind !== 'any') {
      const key = { song: 'tracks', artist: 'artists', album: 'albums', playlist: 'playlists', podcast: 'shows', episode: 'episodes', audiobook: 'audiobooks' }[kind];
      const what = { song: '', artist: '', album: 'the album ', playlist: 'the playlist ', podcast: 'the podcast ', episode: '', audiobook: 'the audiobook ' }[kind];
      return pick(key, what);
    }
    // "any": an exact artist or album name wins; "X by Y" is a song; moods go to playlists; else the top song.
    const q = norm(query);
    const exact = (key: string) => first(key).find((i) => norm(String(i.name)) === q);
    const artist = exact('artists');
    if (artist) return { uri: String(artist.uri), label: String(artist.name) };
    const album = exact('albums');
    if (album) return { uri: String(album.uri), label: `the album ${String(album.name)}${by(album)}` };
    if (!/\bby\b/i.test(query) && MOOD.test(query)) {
      const pl = pick('playlists', 'the playlist ');
      if (pl) return pl;
    }
    return pick('tracks', '') ?? pick('artists', '') ?? pick('playlists', 'the playlist ') ?? pick('albums', 'the album ');
  }

  // ---- Controls ----

  private async control(action: string, level?: number): Promise<string> {
    const s = await this.status();
    if (!s) return "Spotify isn't signed in.";
    const max = s.volume_steps || 100;
    const pct = (v: number) => Math.round((v / max) * 100);
    switch (action) {
      case 'pause':
        await this.api('POST', '/player/pause');
        return 'Paused.';
      case 'resume':
        if (s.stopped) return 'Nothing to resume. Ask what to play.';
        await this.api('POST', '/player/resume');
        return 'Resumed.';
      case 'next':
        await this.api('POST', '/player/next', {});
        return 'Skipped to the next track.';
      case 'previous':
        await this.api('POST', '/player/prev');
        return 'Went back.';
      case 'stop':
        await this.api('POST', '/player/pause');
        return 'Stopped the music.';
      case 'now_playing':
        if (s.stopped || !s.track) return 'Nothing is playing.';
        return `${s.paused ? 'Paused' : 'Playing'}: ${s.track.name} by ${s.track.artist_names.join(' and ')}` +
          `${s.context_name ? `, from ${s.context_name}` : ''}. Volume ${pct(this.duck?.restoreTo ?? s.volume)}%.`;
      case 'set_volume':
      case 'volume_up':
      case 'volume_down': {
        // While Max is talking the music is ducked: change the level it returns to.
        const current = this.duck?.restoreTo ?? s.volume;
        const step = Math.round(((level ?? 15) / 100) * max);
        let target =
          action === 'set_volume' ? Math.round(((level ?? 50) / 100) * max) : current + (action === 'volume_up' ? step : -step);
        target = Math.max(0, Math.min(max, target));
        if (this.duck) this.duck.restoreTo = target;
        else await this.setVolume(target);
        return `Volume ${pct(target)}%.`;
      }
      default:
        return `Unknown music action "${action}".`;
    }
  }

  private duckLevel(steps: number): number {
    return Math.round(((steps || 100) * this.cfg.music.duckVolume) / 100);
  }

  private setVolume(v: number): Promise<unknown> {
    return this.api('POST', '/player/volume', { volume: Math.round(v) });
  }

  /** The player for the screen's music card: what's playing (or paused), cover, position. */
  async player(): Promise<{ title: string; artist: string; album: string; art?: string; paused: boolean; position?: number; duration?: number } | undefined> {
    if (this.state !== 'ready') return undefined;
    const s = await this.status().catch(() => undefined);
    if (!s || s.stopped || !s.track) return undefined;
    const t = s.track as unknown as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    return {
      title: s.track.name,
      artist: s.track.artist_names.join(', '),
      album: s.track.album_name,
      art: typeof t.album_cover_url === 'string' && /^https?:\/\//.test(t.album_cover_url) ? t.album_cover_url : undefined,
      paused: s.paused,
      position: n(t.position),
      duration: n(t.duration),
    };
  }

  /** The music card's buttons: pause, resume, next, previous. */
  async press(action: 'pause' | 'resume' | 'next' | 'previous'): Promise<void> {
    await this.control(action);
  }

  /** What's playing right now, for the face screen (undefined when stopped or paused). */
  async nowPlaying(): Promise<{ title: string; artist: string } | undefined> {
    if (this.state !== 'ready') return undefined;
    const s = await this.status().catch(() => undefined);
    if (!s || s.stopped || s.paused || !s.track) return undefined;
    return { title: s.track.name, artist: s.track.artist_names.join(', ') };
  }

  private status(): Promise<Status | undefined> {
    return this.api<Status>('GET', '/status');
  }

  /** go-librespot's local API. Returns undefined for "204 No Content" (e.g. not signed in). */
  private async api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T | undefined> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 204) return undefined;
    if (!res.ok) throw new Error(`${path} -> ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T | undefined;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (s: string) => norm(s).split(' ').filter((w) => w.length > 1);
