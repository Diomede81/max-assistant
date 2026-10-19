import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { APP_CONFIG, AppConfig } from '../config';
import { HaSocket } from './ha-socket';

/** Home Assistant on the Max box, as the control panel's Devices page sees it. */
export type HomeState = 'off' | 'starting' | 'needs-login' | 'ready';

export interface HomeEntity {
  id: string;
  name: string;
  domain: string;
  /** What the panel shows: "On", "21.5 °C", "Open"... */
  state: string;
  on?: boolean;
  /** What the panel can do with it: toggle, open/close, press, set a temperature... */
  control: 'toggle' | 'cover' | 'lock' | 'press' | 'media' | 'climate' | 'vacuum' | 'none';
  brightness?: number;
  target?: number;
  unavailable?: boolean;
}

export interface HomeDevice {
  id: string;
  name: string;
  area?: string;
  areaId?: string;
  maker?: string;
  /** Max can control it by voice (its entities are exposed to Home Assistant's Assist). */
  max: boolean;
  entities: HomeEntity[];
}

export interface HomeOverview {
  state: HomeState;
  message?: string;
  /** The full Home Assistant, for anything the simple page doesn't do. */
  url: string;
  /** The account Max created for it (shown under "Advanced"). */
  login?: { username: string; password: string };
  areas: { id: string; name: string }[];
  devices: HomeDevice[];
  /** Devices Home Assistant found on the network, ready to add. */
  found: { flowId: string; name: string; integration: string; attention?: boolean }[];
}

export interface FlowField {
  name: string;
  label: string;
  help?: string;
  type: 'text' | 'password' | 'number' | 'checkbox' | 'select';
  required: boolean;
  value?: string | number | boolean;
  options?: { value: string; label: string }[];
}

/** One step of adding something, in a shape the panel can draw without knowing Home Assistant. */
export interface FlowStep {
  flowId?: string;
  kind: 'form' | 'menu' | 'link' | 'wait' | 'done' | 'stopped';
  integration: string;
  title: string;
  text?: string;
  fields?: FlowField[];
  error?: string;
  menu?: { id: string; label: string }[];
  url?: string;
}

interface Saved {
  username?: string;
  password?: string;
  token?: string;
}

const CLIENT_ID = 'http://max.local/';
/** Thrown when Home Assistant turns a username and password down (as opposed to not answering). */
class WrongLogin extends Error {
  constructor() {
    super('wrong username or password');
  }
}

/** A password that's easy to read and type: no look-alike characters (0/O, 1/l/I), in groups of four. */
function newPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b) => letters[b % letters.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}
const TOGGLE = new Set(['light', 'switch', 'fan', 'input_boolean', 'humidifier', 'siren']);
const SHOWN = new Set([...TOGGLE, 'cover', 'valve', 'lock', 'climate', 'media_player', 'vacuum', 'water_heater', 'button', 'sensor', 'binary_sensor', 'scene']);
const NOT_SET_UP_HERE = new Set(['helper', 'entity', 'system', 'hardware', 'virtual']);
const DISCOVERY = new Set(['zeroconf', 'ssdp', 'dhcp', 'homekit', 'bluetooth', 'discovery', 'integration_discovery', 'usb', 'mqtt', 'hassio']);

/**
 * Home Assistant running on the Max box (HA_LOCAL=1): Max sets it up himself on first start (account,
 * the welcome steps, a long-lived token, and the "Model Context Protocol Server" Max talks to), then serves
 * the control panel's simple Devices page: devices by room with their controls, which ones Max may
 * control, and adding new ones through Home Assistant's own setup steps. Off unless HA_LOCAL=1.
 */
@Injectable()
export class HomeService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Home');
  private stateNow: HomeState = 'off';
  private message?: string;
  private saved: Saved = {};
  private socket?: HaSocket;
  private retry?: NodeJS.Timeout;
  private readyResolve!: () => void;
  private readonly readyPromise = new Promise<void>((r) => (this.readyResolve = r));
  private catalog?: { at: number; list: { domain: string; name: string; local: boolean }[] };
  private readonly names = new Map<string, string>();

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  get enabled(): boolean {
    return this.cfg.ha.local;
  }

  get state(): HomeState {
    return this.stateNow;
  }

  /** Resolves once Home Assistant is set up and Max has a token for it. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    this.stateNow = 'starting';
    this.saved = this.load();
    void this.setUp();
  }

  onModuleDestroy(): void {
    clearTimeout(this.retry);
    this.socket?.close();
  }

  // ---------- setting Home Assistant up ----------

  private get base(): string {
    return this.cfg.ha.localUrl.replace(/\/+$/, '');
  }

  private async setUp(): Promise<void> {
    clearTimeout(this.retry);
    try {
      if (!(this.saved.token && (await this.tokenWorks(this.saved.token)))) {
        const steps = await this.json<{ step: string; done: boolean }[]>('GET', '/api/onboarding');
        if (!steps.find((s) => s.step === 'user')?.done) await this.onboard(steps);
        else {
          let signedIn = false;
          if (this.saved.username && this.saved.password) {
            try {
              await this.signIn(this.saved.username, this.saved.password);
              signedIn = true;
            } catch (err) {
              if (!(err instanceof WrongLogin)) throw err;
              // Home Assistant got its account another way (e.g. its own welcome screens): the login Max kept is
              // out of date, so forget it and ask.
              this.saved = {};
              this.save();
            }
          }
          if (!signedIn) {
            this.stateNow = 'needs-login';
            this.message = 'This Home Assistant already has an account: sign in once so Max can manage it.';
            return;
          }
        }
      }
      await this.ensureMcp();
      this.cfg.ha.mcpUrl = `${this.base}/api/mcp`;
      this.cfg.ha.token = this.saved.token!;
      this.stateNow = 'ready';
      this.message = undefined;
      this.log.log('Home Assistant on the box is ready');
      this.readyResolve();
    } catch (err) {
      this.stateNow = 'starting';
      this.message = `Waiting for Home Assistant to start (${(err as Error).message})`;
      this.retry = setTimeout(() => void this.setUp(), 15_000);
    }
  }

  /** First start: creates the owner account and finishes Home Assistant's welcome steps. */
  private async onboard(steps: { step: string; done: boolean }[]): Promise<void> {
    const password = newPassword();
    const created = await this.json<{ auth_code: string }>('POST', '/api/onboarding/users', {
      client_id: CLIENT_ID,
      name: 'Max',
      username: 'max',
      password,
      language: 'en',
    });
    this.saved = { username: 'max', password };
    this.save();
    const access = await this.exchange(created.auth_code);
    for (const [step, body] of [
      ['core_config', {}],
      ['analytics', {}],
      ['integration', { client_id: CLIENT_ID, redirect_uri: CLIENT_ID }],
    ] as const) {
      if (!steps.find((s) => s.step === step)?.done) await this.json('POST', `/api/onboarding/${step}`, body, access);
    }
    await this.keepToken(access);
    this.log.log('Set up Home Assistant on the box (account "max")');
  }

  /** Signs in with a username and password (an existing Home Assistant) and keeps a long-lived token. */
  async login(username: string, password: string): Promise<string> {
    if (!this.enabled) return 'Home Assistant on the box is off.';
    try {
      await this.signIn(username.trim(), password);
      this.saved = { ...this.saved, username: username.trim(), password };
      this.save();
      this.stateNow = 'starting';
      this.message = 'Signed in: Max is connecting to Home Assistant…';
      void this.setUp();
      return 'Signed in: Max is setting up the connection.';
    } catch (err) {
      return `Couldn't sign in: ${(err as Error).message}`;
    }
  }

  private async signIn(username: string, password: string): Promise<void> {
    const start = await this.json<{ flow_id: string }>('POST', '/auth/login_flow', {
      client_id: CLIENT_ID,
      handler: ['homeassistant', null],
      redirect_uri: CLIENT_ID,
    });
    const done = await this.json<{ type: string; result?: string; errors?: Record<string, string> }>('POST', `/auth/login_flow/${start.flow_id}`, {
      client_id: CLIENT_ID,
      username,
      password,
    });
    if (done.type !== 'create_entry' || !done.result) throw new WrongLogin();
    await this.keepToken(await this.exchange(done.result));
  }

  /**
   * Gives Max's own Home Assistant account ("max") a new password, e.g. when the one shown doesn't work.
   * Only for the account Max made: an account someone else made keeps its password.
   */
  async resetPassword(): Promise<string> {
    if (this.stateNow !== 'ready') return "Home Assistant isn't ready yet.";
    const me = await this.ws().call<{ id: string }>('auth/current_user');
    const users = await this.ws().call<{ id: string; username: string | null }[]>('config/auth/list');
    if (users.find((u) => u.id === me.id)?.username !== 'max') return "Max didn't make this Home Assistant's account, so he can't change its password.";
    const password = newPassword();
    await this.ws().call('config/auth_provider/homeassistant/admin_change_password', { user_id: me.id, password });
    this.saved = { ...this.saved, username: 'max', password };
    this.save();
    return 'New password made: press Show to see it.';
  }

  private async exchange(code: string): Promise<string> {
    const res = await fetch(`${this.base}/auth/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: CLIENT_ID }),
    });
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new Error('no access token');
    return body.access_token;
  }

  /** Turns a short-lived sign-in into a 10-year token for Max. */
  private async keepToken(access: string): Promise<void> {
    const once = new HaSocket(this.base, () => access);
    try {
      this.saved.token = await once.call<string>('auth/long_lived_access_token', { client_name: `Max (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`, lifespan: 3650 });
      this.save();
    } finally {
      once.close();
    }
  }

  private async tokenWorks(token: string): Promise<boolean> {
    const res = await fetch(`${this.base}/api/`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) return false;
    if (!res.ok) throw new Error(`Home Assistant answered ${res.status}`);
    return true;
  }

  /** Max talks to Home Assistant through its "Model Context Protocol Server": add it if it isn't there. */
  private async ensureMcp(): Promise<void> {
    const entries = await this.json<{ domain: string }[]>('GET', '/api/config/config_entries/entry?domain=mcp_server', undefined, this.saved.token);
    if (entries.some((e) => e.domain === 'mcp_server')) return;
    let step = await this.json<{ type: string; flow_id?: string }>('POST', '/api/config/config_entries/flow', { handler: 'mcp_server' }, this.saved.token);
    if (step.type === 'form' && step.flow_id) step = await this.json('POST', `/api/config/config_entries/flow/${step.flow_id}`, {}, this.saved.token);
    if (step.type !== 'create_entry') throw new Error(`couldn't add the MCP Server integration (${step.type})`);
    this.log.log('Added the MCP Server integration to Home Assistant');
  }

  private async json<T = unknown>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 120)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  private ws(): HaSocket {
    if (this.stateNow !== 'ready') throw new Error('Home Assistant is still starting: try again in a minute');
    this.socket ??= new HaSocket(this.base, () => this.saved.token ?? '');
    return this.socket;
  }

  private get file(): string {
    return join(this.cfg.memory.dir, 'home-assistant.json');
  }

  private load(): Saved {
    try {
      return existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as Saved) : {};
    } catch {
      return {};
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.saved, null, 2), { mode: 0o600 });
    chmodSync(this.file, 0o600);
  }

  // ---------- the Devices page ----------

  async overview(): Promise<HomeOverview> {
    const url = this.publicUrl();
    const base: HomeOverview = { state: this.stateNow, message: this.message, url, areas: [], devices: [], found: [] };
    if (this.stateNow !== 'ready') return base;
    const ws = this.ws();
    type Area = { area_id: string; name: string };
    type Device = { id: string; name: string | null; name_by_user: string | null; area_id: string | null; manufacturer: string | null; disabled_by: string | null; entry_type: string | null };
    type Entry = { entity_id: string; device_id: string | null; area_id: string | null; name: string | null; original_name: string | null; hidden_by: string | null; disabled_by: string | null; entity_category: string | null };
    type State = { entity_id: string; state: string; attributes: Record<string, unknown> };
    const [areas, devices, entries, states, exposed, flows] = await Promise.all([
      ws.call<Area[]>('config/area_registry/list'),
      ws.call<Device[]>('config/device_registry/list'),
      ws.call<Entry[]>('config/entity_registry/list'),
      ws.call<State[]>('get_states'),
      ws.call<{ exposed_entities: Record<string, { conversation?: boolean }> }>('homeassistant/expose_entity/list'),
      ws.call<{ flow_id: string; handler: string; context?: { source?: string; title_placeholders?: Record<string, string> } }[]>('config_entries/flow/progress'),
    ]);
    const areaName = new Map(areas.map((a) => [a.area_id, a.name]));
    const stateOf = new Map(states.map((s) => [s.entity_id, s]));
    const byDevice = new Map<string, Entry[]>();
    for (const e of entries) {
      if (!e.device_id || e.hidden_by || e.disabled_by || e.entity_category) continue;
      if (!SHOWN.has(e.entity_id.split('.')[0])) continue;
      byDevice.set(e.device_id, [...(byDevice.get(e.device_id) ?? []), e]);
    }
    const list: HomeDevice[] = [];
    for (const d of devices) {
      const ents = byDevice.get(d.id);
      if (!ents?.length || d.disabled_by || d.entry_type === 'service') continue;
      const name = d.name_by_user || d.name || 'Device';
      const areaId = d.area_id ?? ents.find((e) => e.area_id)?.area_id ?? undefined;
      list.push({
        id: d.id,
        name,
        areaId,
        area: areaId ? areaName.get(areaId) : undefined,
        maker: d.manufacturer ?? undefined,
        max: ents.some((e) => exposed.exposed_entities[e.entity_id]?.conversation),
        entities: ents
          .map((e) => describe(e.entity_id, e.name || e.original_name || '', name, stateOf.get(e.entity_id)))
          .sort((a, b) => Number(b.control !== 'none') - Number(a.control !== 'none')),
      });
    }
    // Rooms first (alphabetically), then devices without a room.
    list.sort((a, b) => Number(!a.area) - Number(!b.area) || (a.area ?? '').localeCompare(b.area ?? '') || a.name.localeCompare(b.name));
    const found = await Promise.all(
      flows
        .filter((f) => DISCOVERY.has(f.context?.source ?? '') || f.context?.source === 'reauth')
        .map(async (f) => ({
          flowId: f.flow_id,
          integration: await this.integrationName(f.handler),
          name: f.context?.title_placeholders?.name || (await this.integrationName(f.handler)),
          attention: f.context?.source === 'reauth' || undefined,
        })),
    );
    return {
      ...base,
      login: this.saved.username === 'max' && this.saved.password ? { username: 'max', password: this.saved.password } : undefined,
      areas: areas.map((a) => ({ id: a.area_id, name: a.name })).sort((a, b) => a.name.localeCompare(b.name)),
      devices: list,
      found,
    };
  }

  /** A tap on the Devices page: turn on/off, open/close, press, change brightness or temperature. */
  async act(entityId: string, action: string, value?: number): Promise<string> {
    const domain = entityId.split('.')[0];
    const service: Record<string, [string, string, Record<string, unknown>?]> = {
      toggle: [domain, 'toggle'],
      on: [domain, 'turn_on'],
      off: [domain, 'turn_off'],
      open: [domain, domain === 'valve' ? 'open_valve' : 'open_cover'],
      close: [domain, domain === 'valve' ? 'close_valve' : 'close_cover'],
      stop: [domain, domain === 'valve' ? 'stop_valve' : 'stop_cover'],
      lock: ['lock', 'lock'],
      unlock: ['lock', 'unlock'],
      press: ['button', 'press'],
      scene: ['scene', 'turn_on'],
      play: ['media_player', 'media_play_pause'],
      start: ['vacuum', 'start'],
      dock: ['vacuum', 'return_to_base'],
      brightness: ['light', 'turn_on', { brightness_pct: Math.max(1, Math.min(100, Math.round(value ?? 100))) }],
      temperature: [domain, 'set_temperature', { temperature: value }],
    };
    const s = service[action];
    if (!s || !/^[a-z_]+\.[a-z0-9_]+$/.test(entityId)) return 'Not something this page can do.';
    await this.ws().call('call_service', { domain: s[0], service: s[1], service_data: s[2] ?? {}, target: { entity_id: entityId } });
    return 'Done';
  }

  /** Lets Max control a device by voice (or not): exposes its entities to Home Assistant's Assist. */
  async allowMax(deviceId: string, on: boolean): Promise<string> {
    const entries = await this.ws().call<{ entity_id: string; device_id: string | null }[]>('config/entity_registry/list');
    const ids = entries.filter((e) => e.device_id === deviceId).map((e) => e.entity_id);
    if (!ids.length) return 'Device not found.';
    await this.ws().call('homeassistant/expose_entity', { assistants: ['conversation'], entity_ids: ids, should_expose: on });
    return on ? 'Max can control it now.' : "Max won't control it.";
  }

  /** Renames a device, or moves it to a room (a new room is created when it doesn't exist yet). */
  async editDevice(deviceId: string, name?: string, room?: string): Promise<string> {
    const update: Record<string, unknown> = { device_id: deviceId };
    if (name !== undefined) update.name_by_user = name.trim() || null;
    if (room !== undefined) {
      const wanted = room.trim();
      if (!wanted) update.area_id = null;
      else {
        const areas = await this.ws().call<{ area_id: string; name: string }[]>('config/area_registry/list');
        const known = areas.find((a) => a.name.toLowerCase() === wanted.toLowerCase());
        update.area_id = known ? known.area_id : (await this.ws().call<{ area_id: string }>('config/area_registry/create', { name: wanted })).area_id;
      }
    }
    await this.ws().call('config/device_registry/update', update);
    return 'Saved.';
  }

  // ---------- adding devices ----------

  /** What can be added: every brand Home Assistant can set up from its own screens, matching the search. */
  async integrations(query: string): Promise<{ domain: string; name: string; local: boolean }[]> {
    if (!this.catalog || Date.now() - this.catalog.at > 6 * 3600_000) {
      type Desc = { name?: string; integration_type?: string; config_flow?: boolean; iot_class?: string; supported_by?: string; integrations?: Record<string, Desc> };
      const all = await this.ws().call<{ core: { integration: Record<string, Desc> } }>('integration/descriptions');
      const list: { domain: string; name: string; local: boolean }[] = [];
      const add = (domain: string, d: Desc, real: Record<string, Desc>) => {
        const target = d.supported_by ?? domain;
        const t = real[target] ?? d;
        if (!t.config_flow || NOT_SET_UP_HERE.has(t.integration_type ?? '')) return;
        list.push({ domain: target, name: d.name ?? target, local: !String(t.iot_class ?? '').startsWith('cloud') });
      };
      const flat: Record<string, Desc> = {};
      for (const [k, v] of Object.entries(all.core.integration)) {
        if (v.integrations) for (const [sk, sv] of Object.entries(v.integrations)) flat[sk] = sv;
        else flat[k] = v;
      }
      for (const [k, v] of Object.entries(flat)) add(k, v, flat);
      for (const i of list) this.names.set(i.domain, i.name);
      this.catalog = { at: Date.now(), list: list.sort((a, b) => a.name.localeCompare(b.name)) };
    }
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // The brand itself first ("Shelly"), then names starting with the search, then the rest.
    const rank = (i: { domain: string; name: string }) => {
      const n = i.name.toLowerCase();
      return n === q ? 0 : n.startsWith(q) ? 1 : i.domain === q ? 2 : 3; // brands sold under another one's name last
    };
    return this.catalog.list
      .filter((i) => i.name.toLowerCase().includes(q) || i.domain.includes(q))
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 30);
  }

  async startFlow(domain: string): Promise<FlowStep> {
    if (!/^[a-z0-9_]+$/.test(domain)) return { kind: 'stopped', integration: domain, title: 'Not found' };
    return this.step(await this.json('POST', '/api/config/config_entries/flow', { handler: domain, show_advanced_options: false }, this.token()));
  }

  async getFlow(flowId: string): Promise<FlowStep> {
    return this.step(await this.json('GET', `/api/config/config_entries/flow/${encodeURIComponent(flowId)}`, undefined, this.token()));
  }

  async continueFlow(flowId: string, data: Record<string, unknown>): Promise<FlowStep> {
    return this.step(await this.json('POST', `/api/config/config_entries/flow/${encodeURIComponent(flowId)}`, data, this.token()));
  }

  async cancelFlow(flowId: string): Promise<void> {
    await fetch(`${this.base}/api/config/config_entries/flow/${encodeURIComponent(flowId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${this.token()}` } });
  }

  /** "Not mine": Home Assistant stops suggesting a device it found. */
  async ignoreFound(flowId: string): Promise<void> {
    await this.ws().call('config_entries/ignore_flow', { flow_id: flowId, title: 'Ignored from Max' });
  }

  private token(): string {
    if (this.stateNow !== 'ready' || !this.saved.token) throw new Error('Home Assistant is still starting: try again in a minute');
    return this.saved.token;
  }

  private async integrationName(domain: string): Promise<string> {
    if (!this.names.size) await this.integrations('').catch(() => undefined);
    return this.names.get(domain) ?? domain.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }

  /** Home Assistant's step, with its labels and messages in plain words (its own translations). */
  private async step(raw: RawStep): Promise<FlowStep> {
    const domain = raw.handler;
    const integration = await this.integrationName(domain);
    const tr = await this.translations(domain);
    const ph = { ...(raw.description_placeholders ?? {}) };
    const t = (key: string) => fill(tr[`component.${domain}.config.${key}`], ph);
    const out: FlowStep = { flowId: raw.flow_id, integration, kind: 'stopped', title: integration };
    if (raw.type === 'form') {
      out.kind = 'form';
      out.title = t(`step.${raw.step_id}.title`) || `Add ${integration}`;
      out.text = t(`step.${raw.step_id}.description`);
      out.fields = (raw.data_schema ?? []).map((f) => field(f, t(`step.${raw.step_id}.data.${f.name}`), t(`step.${raw.step_id}.data_description.${f.name}`)));
      const errs = Object.values(raw.errors ?? {});
      if (errs.length) out.error = errs.map((e) => t(`error.${e}`) || e.replace(/_/g, ' ')).join(' ');
    } else if (raw.type === 'menu') {
      out.kind = 'menu';
      out.title = t(`step.${raw.step_id}.title`) || `Add ${integration}`;
      out.text = t(`step.${raw.step_id}.description`);
      const opts = Array.isArray(raw.menu_options) ? raw.menu_options.map((o) => [o, '']) : Object.entries(raw.menu_options ?? {});
      out.menu = opts.map(([id, label]) => ({ id, label: t(`step.${raw.step_id}.menu_options.${id}`) || label || id.replace(/_/g, ' ') }));
    } else if (raw.type === 'external' || raw.type === 'external_step') {
      out.kind = 'link';
      out.title = `Sign in to ${integration}`;
      out.text = t(`step.${raw.step_id}.description`) || `Finish signing in on ${integration}'s page, then come back here.`;
      out.url = raw.url;
    } else if (raw.type === 'progress' || raw.type === 'show_progress') {
      out.kind = 'wait';
      out.title = `Adding ${integration}…`;
      out.text = t(`progress.${raw.progress_action}`) || 'This can take a minute.';
    } else if (raw.type === 'create_entry') {
      out.kind = 'done';
      out.title = `${raw.title || integration} added`;
      out.text = "It's on your Devices page. New devices are ready for Max to control.";
      out.flowId = undefined;
    } else if (raw.type === 'abort') {
      out.kind = 'stopped';
      const reason = String(raw.reason ?? '');
      const already = ['already_configured', 'single_instance_allowed', 'already_in_progress'].includes(reason);
      out.title = already ? `${integration} is already added` : `Couldn't add ${integration}`;
      out.text = already
        ? reason === 'already_in_progress' ? "It's being added already: look under Found on your network." : 'It only needs adding once, and it is.'
        : t(`abort.${reason}`) || reason.replace(/_/g, ' ');
      out.flowId = undefined;
    }
    return out;
  }

  private async translations(domain: string): Promise<Record<string, string>> {
    try {
      const r = await this.ws().call<{ resources: Record<string, string> }>('frontend/get_translations', { language: 'en', category: 'config', integration: [domain] });
      return r.resources ?? {};
    } catch {
      return {};
    }
  }

  private publicUrl(): string {
    try {
      const panel = new URL(this.cfg.controlPanel.publicUrl || 'http://max.local:8099');
      return `${panel.protocol}//${panel.hostname}:8123`;
    } catch {
      return 'http://max.local:8123';
    }
  }
}

interface RawStep {
  type: string;
  flow_id?: string;
  handler: string;
  step_id?: string;
  data_schema?: RawField[];
  errors?: Record<string, string> | null;
  description_placeholders?: Record<string, string> | null;
  menu_options?: string[] | Record<string, string>;
  url?: string;
  progress_action?: string;
  title?: string;
  reason?: string;
}

interface RawField {
  name: string;
  type?: string;
  required?: boolean;
  optional?: boolean;
  default?: unknown;
  options?: unknown;
  selector?: Record<string, Record<string, unknown> | null>;
  description?: { suggested_value?: unknown };
}

function fill(text: string | undefined, ph: Record<string, string>): string {
  return (text ?? '').replace(/\{(\w+)\}/g, (m, k: string) => (k in ph ? String(ph[k]) : m));
}

/** One question of a setup step, as a plain form field. */
function field(f: RawField, label: string, help: string): FlowField {
  const sel = f.selector ? Object.keys(f.selector)[0] : undefined;
  const conf = (sel && f.selector?.[sel]) || {};
  const value = (f.default ?? f.description?.suggested_value) as FlowField['value'];
  const out: FlowField = { name: f.name, label: label || f.name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), help: help || undefined, type: 'text', required: Boolean(f.required), value };
  const opts = (raw: unknown): { value: string; label: string }[] =>
    Array.isArray(raw)
      ? raw.map((o) => (Array.isArray(o) ? { value: String(o[0]), label: String(o[1]) } : o && typeof o === 'object' ? { value: String((o as { value: unknown }).value), label: String((o as { label?: unknown }).label ?? (o as { value: unknown }).value) } : { value: String(o), label: String(o) }))
      : raw && typeof raw === 'object'
        ? Object.entries(raw).map(([v, l]) => ({ value: v, label: String(l) }))
        : [];
  if (sel === 'boolean' || f.type === 'boolean') out.type = 'checkbox';
  else if (sel === 'number' || f.type === 'integer' || f.type === 'float') out.type = 'number';
  else if (sel === 'select' || f.type === 'select') {
    out.type = 'select';
    out.options = opts(sel === 'select' ? (conf as { options?: unknown }).options : f.options);
  } else if ((sel === 'text' && (conf as { type?: string }).type === 'password') || /password|secret|pin/i.test(f.name)) out.type = 'password';
  return out;
}

/** An entity on the Devices page: what it shows and how it's controlled. */
function describe(id: string, ownName: string, deviceName: string, s?: { state: string; attributes: Record<string, unknown> }): HomeEntity {
  const domain = id.split('.')[0];
  const a = s?.attributes ?? {};
  const raw = s?.state ?? 'unknown';
  const name = ownName && ownName !== deviceName ? ownName : deviceName;
  const e: HomeEntity = { id, name, domain, state: nice(raw), control: 'none', unavailable: raw === 'unavailable' || raw === 'unknown' || undefined };
  if (TOGGLE.has(domain)) {
    e.control = 'toggle';
    e.on = raw === 'on';
    if (domain === 'light' && typeof a.brightness === 'number') e.brightness = Math.round((a.brightness / 255) * 100);
  } else if (domain === 'cover' || domain === 'valve') e.control = 'cover';
  else if (domain === 'lock') e.control = 'lock';
  else if (domain === 'button' || domain === 'scene') {
    e.control = 'press';
    e.state = '';
  } else if (domain === 'media_player') {
    e.control = 'media';
    e.on = raw === 'playing';
  } else if (domain === 'vacuum') e.control = 'vacuum';
  else if (domain === 'climate' || domain === 'water_heater') {
    e.control = 'climate';
    e.target = typeof a.temperature === 'number' ? a.temperature : undefined;
    const now = a.current_temperature;
    e.state = `${nice(raw)}${typeof now === 'number' ? ` · ${now}°` : ''}`;
  } else if (domain === 'sensor') e.state = `${raw}${a.unit_of_measurement ? ` ${a.unit_of_measurement}` : ''}`;
  else if (domain === 'binary_sensor') e.state = raw === 'on' ? (BINARY_ON[String(a.device_class)] ?? 'On') : raw === 'off' ? (BINARY_OFF[String(a.device_class)] ?? 'Off') : nice(raw);
  return e;
}

const BINARY_ON: Record<string, string> = { door: 'Open', window: 'Open', opening: 'Open', motion: 'Movement', occupancy: 'Someone there', presence: 'Home', moisture: 'Wet', smoke: 'Smoke!', battery: 'Battery low', connectivity: 'Connected', plug: 'Plugged in' };
const BINARY_OFF: Record<string, string> = { door: 'Closed', window: 'Closed', opening: 'Closed', motion: 'Still', occupancy: 'Empty', presence: 'Away', moisture: 'Dry', smoke: 'Clear', battery: 'Battery OK', connectivity: 'Offline', plug: 'Unplugged' };

function nice(state: string): string {
  if (state === 'unavailable') return 'Not responding';
  if (state === 'unknown') return '—';
  return state.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
