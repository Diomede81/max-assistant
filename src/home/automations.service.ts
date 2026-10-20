import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { ModelsService } from '../models/models.service';
import { ModesService } from '../memory/modes.service';
import { CamerasService } from './cameras.service';
import { HomeService } from './home.service';

/** One automation, as the Devices page and Max see it. */
export interface Automation {
  /** Home Assistant's automation id (its config id), when it can be changed here. */
  id?: string;
  entityId: string;
  name: string;
  /** What it does, in plain words (Max writes this for the ones he makes). */
  description?: string;
  on: boolean;
  lastRun?: string;
  /** Made by Max (from what you described). */
  byMax: boolean;
}

/** An on/off switch Max made for automations to check (e.g. "Alarm"). */
export interface HomeSwitch {
  entityId: string;
  name: string;
  on: boolean;
}

/** An automation Max drafted from what you described: shown or read back before it's saved. */
export interface AutomationDraft {
  id: string;
  name: string;
  /** In plain words: when, only if, then. */
  summary: string;
  /** New on/off switches it needs (created when it's saved). */
  newSwitches: string[];
  config: Record<string, unknown>;
  at: number;
}

/** The event an automation fires to make Max say something on the box. */
export const SAY_EVENT = 'max_say';
/** The event an automation fires to put a camera's latest picture on Max's screen (and say a line). */
export const CAMERA_EVENT = 'max_show_camera';
/** What marks the automations Max made (in their description). */
const MADE_BY_MAX = '(Made by Max)';
/** How long a draft waits to be saved. */
const DRAFT_TTL_MS = 30 * 60_000;
/** Kinds of things the AI is shown (and may use) when writing an automation. */
const USEFUL = /^(binary_sensor|sensor|light|switch|siren|alarm_control_panel|lock|cover|climate|fan|media_player|person|device_tracker|input_boolean|scene|vacuum|camera|button|event|sun|zone|water_heater|humidifier|valve)\./;
/** What an automation may do. Never unlock, disarm, or open doors, gates or the garage: those stay by hand (or by voice, with a yes). */
const ALLOWED_DOMAINS = /^(light|switch|siren|media_player|input_boolean|scene|notify|cover|lock|alarm_control_panel|climate|fan|vacuum|humidifier|water_heater|button|camera|persistent_notification|tts)$/;
const BLOCKED = /^(lock\.(unlock|open)|alarm_control_panel\.alarm_disarm|cover\.(open_cover|toggle|set_cover_position|stop_cover)|valve\.open_valve|camera\.(turn_off|disable_motion_detection))$/;

/**
 * Home automations: Max turns what you describe ("when I'm out and the alarm is on, if the hallway sensor sees
 * motion, turn on all the lights and tell me") into a Home Assistant automation, reads it back, and saves it once you
 * say yes. He can also make simple on/off switches for automations to check ("Alarm"), and say things on the box
 * when an automation asks him to. Automations never unlock, disarm or open anything.
 */
@Injectable()
export class AutomationsService extends EventEmitter implements OnModuleInit {
  private readonly log = new Logger('Automations');
  private readonly drafts = new Map<string, AutomationDraft>();
  /** The automations' and switches' names, as last read: told to the AI so it uses the existing ones. */
  private known: { automations: string[]; switches: string[] } = { automations: [], switches: [] };

  constructor(
    private readonly home: HomeService,
    @Optional() private readonly models?: ModelsService,
    @Optional() private readonly cameras?: CamerasService,
    @Optional() private readonly modes?: ModesService,
  ) {
    super();
  }

  get enabled(): boolean {
    return this.home.enabled;
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    // Automations that say something on the box ("Motion in the hallway while the alarm is on").
    void this.home.ready().then(() => {
      void this.list().catch(() => undefined); // the names, for the AI
      this.home.listen(SAY_EVENT, (data) => {
        const text = String(data.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (!text) return;
        this.log.log(`An automation asked Max to say: ${text}`);
        this.emit('say', text);
      });
      // "Every time the front camera sees motion, show it and tell me": the picture on the screen, and the line said.
      this.home.listen(CAMERA_EVENT, (data) => {
        const camera = String(data.camera ?? '');
        const text = String(data.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (text) this.emit('say', text);
        if (!/^camera\.[a-z0-9_]+$/.test(camera)) return;
        // Not with visitors around: guest mode only hears the line.
        if (this.modes?.mode === 'guest') return;
        this.log.log(`An automation asked for ${camera} on the screen`);
        void this.cameras?.showFor(camera);
      });
    });
  }

  // ---------- Reading ----------

  async list(): Promise<{ automations: Automation[]; switches: HomeSwitch[] }> {
    type State = { entity_id: string; state: string; attributes: Record<string, unknown>; last_changed?: string };
    const states = await this.home.rest<State[]>('GET', '/api/states');
    const automations = states
      .filter((s) => s.entity_id.startsWith('automation.'))
      .map((s): Automation => {
        const id = typeof s.attributes.id === 'string' ? s.attributes.id : undefined;
        return {
          id,
          entityId: s.entity_id,
          name: String(s.attributes.friendly_name ?? s.entity_id),
          on: s.state === 'on',
          lastRun: typeof s.attributes.last_triggered === 'string' ? s.attributes.last_triggered : undefined,
          byMax: Boolean(id?.startsWith('max_')),
        };
      })
      .sort((a, b) => Number(b.byMax) - Number(a.byMax) || a.name.localeCompare(b.name));
    // Max's own: their description says what they do.
    await Promise.all(
      automations
        .filter((a) => a.byMax && a.id)
        .map(async (a) => {
          const c = await this.home.rest<{ description?: string }>('GET', `/api/config/automation/config/${encodeURIComponent(a.id!)}`).catch(() => undefined);
          a.description = c?.description?.replace(MADE_BY_MAX, '').trim() || undefined;
        }),
    );
    const switches = states
      .filter((s) => s.entity_id.startsWith('input_boolean.'))
      .map((s) => ({ entityId: s.entity_id, name: String(s.attributes.friendly_name ?? s.entity_id), on: s.state === 'on' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.known = { automations: automations.map((x) => x.name), switches: switches.map((x) => x.name) };
    return { automations, switches };
  }

  draft(id: string): AutomationDraft | undefined {
    this.prune();
    return this.drafts.get(id);
  }

  // ---------- Drafting (the AI) ----------

  /** Writes an automation from what the user described. Nothing is saved yet. */
  async describe(text: string, name?: string): Promise<{ ok: true; draft: AutomationDraft } | { ok: false; message: string }> {
    if (!this.models) return { ok: false, message: 'No AI model is set up to write automations.' };
    const wanted = text.replace(/\s+/g, ' ').trim().slice(0, 1500);
    if (!wanted) return { ok: false, message: 'Describe the automation: when it should happen, only if what, and what it should do.' };
    type State = { entity_id: string; state: string; attributes: Record<string, unknown> };
    const states = (await this.home.rest<State[]>('GET', '/api/states')).filter((s) => USEFUL.test(s.entity_id));
    const services = await this.home.rest<{ domain: string; services: Record<string, unknown> }[]>('GET', '/api/services').catch(() => []);
    const notify = services.find((s) => s.domain === 'notify');
    const phones = notify ? Object.keys(notify.services).filter((s) => s.startsWith('mobile_app_')) : [];
    const things = states
      .slice(0, 500)
      .map((s) => {
        const a = s.attributes;
        const extra = a.device_class ? ` (${String(a.device_class)})` : '';
        return `${s.entity_id} | ${String(a.friendly_name ?? '')}${extra} | now: ${s.state}`;
      })
      .join('\n');
    const raw = await this.models
      .complete('home', {
        system:
          'You write Home Assistant automations from what the user describes. Answer with JSON only:\n' +
          '{"name": "a short name, 2 to 4 words, e.g. \"Alarm: hallway motion\"", "summary": "what it does in plain words, one or two sentences: when…, only if…, then…", ' +
          '"new_switches": ["names of new on/off switches it needs, if any"], "automation": {"triggers": [...], "conditions": [...], "actions": [...], "mode": "single"}}\n' +
          'Use current Home Assistant syntax: triggers with "trigger": "state" (entity_id, to, from, for), "time", "sun", "numeric_state"; ' +
          'conditions with "condition": "state", "time", "sun", "numeric_state", "or"/"and"; actions with "action": "domain.service", ' +
          '"target": {"entity_id": [...]}, "data": {...}, plus "delay", "repeat" when needed.\n' +
          'Only use the entity ids listed. If the user means something that is not listed, say so in the summary and leave it out; ' +
          'never invent one. To make Max (the voice assistant in the room) say something out loud, use the action ' +
          `{"event": "${SAY_EVENT}", "event_data": {"message": "what to say"}}. To put a camera's latest picture on Max's screen ` +
          `(and say a line), use {"event": "${CAMERA_EVENT}", "event_data": {"camera": "camera.…", "message": "what to say"}}: ` +
          'for "show me the camera / the picture when…", use this one, not max_say: it does both, the picture and the line. ' +
          'Never say in the summary that Max can\'t show pictures or combine them with an announcement: he can. ' +
          (phones.length
            ? `To send a notification to a phone, use "action": "notify.<name>" with data.title/message; phones: ${phones.join(', ')}. ` +
              'A phone notification can carry a camera\'s picture: add "data": {"image": "/api/camera_proxy/camera.…", "entity_id": "camera.…"} ' +
              'inside its data (e.g. {"action": "notify.mobile_app_x", "data": {"title": "Front door", "message": "Motion", "data": ' +
              '{"image": "/api/camera_proxy/camera.front_door", "entity_id": "camera.front_door"}}}). Never say a notification ' +
              'can\'t include the camera picture: it can. '
            : 'No phone is set up for notifications (the Home Assistant app on the phone, signed in to this Home Assistant): use ' +
              'Max saying it (and showing the camera on his screen) instead, and say in the summary that phone notifications, with or ' +
              'without the camera picture, need the Home Assistant app on the phone first. ') +
          '"When I\'m out / away": a person entity\'s state "not_home" if one is listed and it is not "unknown"; otherwise, or for ' +
          '"when the alarm is on / active" with no alarm listed, use an on/off switch: put its name in new_switches (e.g. "Alarm") ' +
          'and use the entity id input_boolean.<name in lower case, spaces as underscores>. Motion: binary_sensor with ' +
           'device_class motion or occupancy, to "on". A doorbell ring or a camera\'s motion as an event entity (event.…): ' +
          'trigger "state" on that entity with no "to" (it changes each time it happens), plus the condition ' +
          '{"condition": "template", "value_template": "{{ trigger.from_state.state not in [\'unavailable\', \'unknown\'] }}"} ' +
          'so it doesn\'t fire when Home Assistant restarts. Never unlock locks, disarm alarms, or open doors, gates, covers or the garage: ' +
          'if asked, leave it out and say so in the summary. Plain British English in name and summary.',
        user: `What the user wants: ${wanted}${name ? `\nName: ${name}` : ''}\n\nWhat's in the house (entity id | name | now):\n${things || '(nothing yet)'}`,
        maxTokens: 1500,
        temperature: 0.1,
        timeoutMs: 60_000,
      })
      .catch((err: Error) => {
        this.log.warn(`The AI model couldn't write the automation: ${err.message}`);
        return '';
      });
    let j: { name?: unknown; summary?: unknown; new_switches?: unknown; automation?: Record<string, unknown> };
    try {
      j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    } catch {
      return { ok: false, message: raw ? "The automation didn't come out right: try describing it again, a little differently." : "The AI model didn't answer: check Settings → AI models (Home automations)." };
    }
    const auto = j.automation ?? {};
    const newSwitches = (Array.isArray(j.new_switches) ? j.new_switches : []).map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 3);
    const known = new Set([...states.map((s) => s.entity_id), ...newSwitches.map((n) => `input_boolean.${slug(n)}`)]);
    const problem = check(auto, known);
    if (problem) return { ok: false, message: `That automation can't be made: ${problem}` };
    const draft: AutomationDraft = {
      id: randomBytes(4).toString('hex'),
      name: String(name || j.name || 'New automation').trim().slice(0, 80),
      summary: String(j.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
      newSwitches,
      config: { triggers: auto.triggers ?? auto.trigger, conditions: auto.conditions ?? auto.condition ?? [], actions: auto.actions ?? auto.action, mode: auto.mode ?? 'single' },
      at: Date.now(),
    };
    this.prune();
    this.drafts.set(draft.id, draft);
    return { ok: true, draft };
  }

  // ---------- Changing ----------

  /** Saves a draft in Home Assistant (making its new switches first), switched on. */
  async save(draftId: string): Promise<string> {
    const d = this.draft(draftId);
    if (!d) return 'That draft has expired: describe the automation again.';
    let json = JSON.stringify(d.config);
    for (const name of d.newSwitches) {
      const entityId = await this.ensureSwitch(name);
      json = json.split(`input_boolean.${slug(name)}`).join(entityId);
    }
    const id = `max_${Date.now().toString(36)}`;
    const config = { id, alias: d.name, description: `${d.summary} ${MADE_BY_MAX}`.trim(), ...JSON.parse(json) };
    try {
      await this.home.rest('POST', `/api/config/automation/config/${id}`, config);
    } catch (err) {
      return `Home Assistant didn't accept it: ${(err as Error).message.replace(/^\d+\s*/, '').slice(0, 200)}`;
    }
    this.drafts.delete(draftId);
    this.log.log(`Automation "${d.name}" saved`);
    // Home Assistant only runs saved automations when its configuration reads them (the box's setup adds that).
    const entityId = await this.loaded(id);
    if (!entityId) {
      this.log.warn(`"${d.name}" was saved but Home Assistant didn't load it (no "automation: !include automations.yaml")`);
      return `Saved "${d.name}", but Home Assistant isn't running automations yet: update the box (run the setup again) once, and it will start.`;
    }
    // On from the start: Home Assistant would otherwise keep an earlier automation's "off" when the name is the same.
    await this.setOn(entityId, true).catch(() => undefined);
    return `Saved "${d.name}": it's on.${d.newSwitches.length ? ` New switch${d.newSwitches.length === 1 ? '' : 'es'}: ${d.newSwitches.join(', ')} (say "turn on the ${d.newSwitches[0].toLowerCase()}", or use the Devices page).` : ''}`;
  }

  /** The automation Home Assistant loaded for this id (it takes a moment after saving), if it did. */
  private async loaded(id: string): Promise<string | undefined> {
    for (let i = 0; i < 10; i++) {
      const states = await this.home.rest<{ entity_id: string; attributes: Record<string, unknown> }[]>('GET', '/api/states').catch(() => []);
      const found = states.find((s) => s.entity_id.startsWith('automation.') && s.attributes.id === id);
      if (found) return found.entity_id;
      await new Promise((r) => setTimeout(r, 500));
    }
    return undefined;
  }

  /** An on/off switch automations can check ("Alarm"): made if it doesn't exist, and Max can turn it on and off. */
  async ensureSwitch(name: string): Promise<string> {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 40);
    const list = await this.home.command<{ id: string; name: string }[]>('input_boolean/list').catch(() => []);
    const found = list.find((x) => x.name.toLowerCase() === clean.toLowerCase());
    const id = found?.id ?? (await this.home.command<{ id: string }>('input_boolean/create', { name: clean, icon: /alarm/i.test(clean) ? 'mdi:shield-home' : 'mdi:toggle-switch' })).id;
    const entityId = `input_boolean.${id}`;
    // So "Max, turn on the alarm" works by voice.
    await this.home.command('homeassistant/expose_entity', { assistants: ['conversation'], entity_ids: [entityId], should_expose: true }).catch(() => undefined);
    if (!found) this.log.log(`Made the switch "${clean}" (${entityId})`);
    return entityId;
  }

  /** Renames an automation (its id stays, so nothing else changes). */
  async rename(id: string, name: string): Promise<string> {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!clean) return 'Give it a name.';
    if (!/^[\w-]+$/.test(id)) return 'Automation not found.';
    const path = `/api/config/automation/config/${encodeURIComponent(id)}`;
    const config = await this.home.rest<Record<string, unknown>>('GET', path);
    await this.home.rest('POST', path, { ...config, id, alias: clean });
    void this.list().catch(() => undefined);
    return `Renamed to "${clean}".`;
  }

  async setOn(entityId: string, on: boolean): Promise<string> {
    if (!/^(automation|input_boolean)\.[a-z0-9_]+$/.test(entityId)) return 'Not an automation or switch.';
    const domain = entityId.split('.')[0];
    await this.home.rest('POST', `/api/services/${domain}/turn_${on ? 'on' : 'off'}`, { entity_id: entityId });
    return on ? 'Turned on.' : 'Turned off.';
  }

  async run(entityId: string): Promise<string> {
    if (!/^automation\.[a-z0-9_]+$/.test(entityId)) return 'Not an automation.';
    await this.home.rest('POST', '/api/services/automation/trigger', { entity_id: entityId });
    return 'Ran it.';
  }

  /** Deletes an automation (only ones with a config: made here, or in Home Assistant's own screens). */
  async remove(id: string): Promise<string> {
    if (!/^[\w-]+$/.test(id)) return 'Automation not found.';
    await this.home.rest('DELETE', `/api/config/automation/config/${encodeURIComponent(id)}`);
    return 'Automation deleted.';
  }

  /** Deletes a switch Max made. */
  async removeSwitch(entityId: string): Promise<string> {
    const id = entityId.replace(/^input_boolean\./, '');
    if (!/^[a-z0-9_]+$/.test(id)) return 'Switch not found.';
    await this.home.command('input_boolean/delete', { input_boolean_id: id });
    return 'Switch deleted.';
  }

  private prune(): void {
    for (const [k, d] of this.drafts) if (Date.now() - d.at > DRAFT_TTL_MS) this.drafts.delete(k);
  }

  // ---------- For Max (by voice) ----------

  get tools(): ChatCompletionTool[] {
    if (!this.enabled) return [];
    return [
      {
        type: 'function',
        function: {
          name: 'home_automation',
          description:
            'Home automations (Home Assistant): things that happen by themselves. draft: write one from what the user describes ' +
            '(when, only if, then: e.g. "when I\'m out and the alarm is on, if the hallway sensor sees motion, turn on all the lights ' +
            'and tell me"); you get a plain summary and a draft_id. Read the summary back and ask "Shall I save it?"; on yes call save ' +
            'with the draft_id. What an automation can do: control devices, make you SAY something out loud on the box, ' +
            'send a phone notification (with the camera\'s picture in it, if wanted), and put a camera\'s latest picture ON YOUR ' +
            'SCREEN while you say a line, all in the ' +
            'same automation (e.g. "every time the front camera sees motion, show the picture and say there\'s movement at ' +
            'the front"): never tell the user that can\'t be done, draft it. ONLY draft when the user describes a NEW automation. When they name one that exists ("turn off the ' +
            'alarm automation", "switch the hallway one back on"), never draft: use on / off with its name (a few words of it are ' +
            'enough). on / off: turn an automation, or a switch like "Alarm", on or off. run: run one now (to test it). rename: give ' +
            'one a new name (name, new_name). delete: delete one. list: all of them. Automations never unlock, disarm or open ' +
            'anything.' +
            (this.known.automations.length ? ` Existing automations: ${this.known.automations.slice(0, 30).map((n) => `"${n}"`).join(', ')}.` : '') +
            (this.known.switches.length ? ` Switches: ${this.known.switches.slice(0, 20).map((n) => `"${n}"`).join(', ')}.` : ''),
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['draft', 'save', 'list', 'on', 'off', 'run', 'rename', 'delete'] },
              description: { type: 'string', description: 'draft: what the automation should do, in the user\'s words (when, only if, then)' },
              name: { type: 'string', description: 'draft: a short name (optional); on / off / run / rename / delete: which automation or switch (a few words of its name)' },
              new_name: { type: 'string', description: 'rename: the new name' },
              draft_id: { type: 'string', description: 'save: the draft_id from draft' },
              confirmed: { type: 'boolean' },
            },
            required: ['action'],
          },
        },
      },
    ];
  }

  has(name: string): boolean {
    return this.enabled && name === 'home_automation';
  }

  async call(_name: string, a: Record<string, unknown>): Promise<string> {
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    try {
      switch (str(a.action)) {
        case 'draft': {
          // "Turn off the alarm automation" sent as a new one: it's about an existing automation.
          const d = str(a.description);
          const toggle = /^\W*(please\s+)?(can you\s+)?((turn|switch|put)\b.*\b(on|off)|(enable|disable|activate|deactivate|pause|resume|stop|start)\b)/i.exec(d);
          if (toggle && d.split(/\s+/).length <= 12) {
            const { automations, switches } = await this.list();
            const hit = best(d, [...automations, ...(/automation/i.test(d) ? [] : switches)]);
            if (!('error' in hit)) {
              const on = !/\b(off|disable|deactivate|pause|stop)\b/i.test(d);
              return `${hit.item.name}: ${await this.setOn(hit.item.entityId, on)} (an existing one: nothing new was made)`;
            }
          }
          const r = await this.describe(str(a.description), str(a.name) || undefined);
          if (!r.ok) return r.message;
          return (
            `Draft "${r.draft.name}" (draft_id ${r.draft.id}), not saved yet: ${r.draft.summary}` +
            (r.draft.newSwitches.length ? ` It adds a new on/off switch: ${r.draft.newSwitches.join(', ')}.` : '') +
            ' Read this back briefly and ask "Shall I save it?".'
          );
        }
        case 'save':
          if (a.confirmed !== true) return 'Not saved yet: read the summary back and ask the user to confirm, then call again with confirmed=true.';
          return await this.save(str(a.draft_id));
        case 'list': {
          const { automations, switches } = await this.list();
          if (!automations.length && !switches.length) return 'No automations yet. The user can describe one ("when … then …").';
          return (
            automations.map((x) => `${x.name} (${x.on ? 'on' : 'off'}${x.description ? `: ${x.description}` : ''})`).join('; ') +
            (switches.length ? `. Switches: ${switches.map((s) => `${s.name} (${s.on ? 'on' : 'off'})`).join(', ')}` : '')
          );
        }
        case 'on':
        case 'off':
        case 'run':
        case 'rename':
        case 'delete': {
          const { automations, switches } = await this.list();
          const pool = [
            ...automations.map((x) => ({ ...x, kind: 'automation' as const })),
            // "the alarm automation": only automations; "the alarm": the switch wins when it matches as well.
            ...(a.action === 'run' || a.action === 'rename' || /automation/i.test(str(a.name)) ? [] : switches.map((x) => ({ ...x, kind: 'switch' as const }))),
          ];
          const hit = best(str(a.name), pool, a.action === 'on' || a.action === 'off' ? a.action : undefined);
          if ('error' in hit) return hit.error;
          const auto = hit.item.kind === 'automation' ? automations.find((x) => x.entityId === hit.item.entityId) : undefined;
          const sw = hit.item.kind === 'switch' ? switches.find((x) => x.entityId === hit.item.entityId) : undefined;
          if (a.action === 'run') return await this.run(auto!.entityId);
          if (a.action === 'rename') {
            if (!auto?.id) return "That one can only be renamed in Home Assistant's own screens.";
            return `${auto.name}: ${await this.rename(auto.id, str(a.new_name))}`;
          }
          if (a.action === 'delete') {
            if (a.confirmed !== true) return 'Not deleted yet: ask the user to confirm, then call again with confirmed=true.';
            if (auto) return auto.id ? await this.remove(auto.id) : "That one can only be deleted in Home Assistant's own screens.";
            return await this.removeSwitch(sw!.entityId);
          }
          const target = auto ?? sw!;
          return `${target.name}: ${await this.setOn(target.entityId, a.action === 'on')}`;
        }
        default:
          return 'Unknown action.';
      }
    } catch (err) {
      return `Couldn't do that: ${(err as Error).message}`;
    }
  }
}

/** Home Assistant's id for a name: lower case, underscores. */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Why an automation the AI wrote can't be saved (or nothing when it's fine): it needs a trigger and an action, may
 * only use things that exist, and may never unlock, disarm or open anything, or run anything outside the house.
 */
export function check(auto: Record<string, unknown>, known: Set<string>): string | undefined {
  const triggers = auto.triggers ?? auto.trigger;
  const actions = auto.actions ?? auto.action;
  if (!Array.isArray(triggers) || !triggers.length) return 'it has nothing that starts it.';
  if (!Array.isArray(actions) || !actions.length) return 'it does nothing.';
  for (const t of triggers as Record<string, unknown>[]) {
    const kind = String(t?.trigger ?? t?.platform ?? '');
    if (kind === 'webhook' || kind === 'mqtt' || kind === 'tag') return `it would be started from outside the house (${kind}).`;
  }
  const bad: string[] = [];
  const walk = (v: unknown, key = ''): void => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, key));
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const action = o.action ?? o.service;
      if (typeof action === 'string' && action.includes('.')) {
        const [domain] = action.split('.');
        if (BLOCKED.test(action)) bad.push(`it would ${action.replace('.', ' ').replace(/_/g, ' ')}, which automations never do`);
        else if (!ALLOWED_DOMAINS.test(domain)) bad.push(`it uses "${action}", which automations made here can't`);
      }
      for (const [k, x] of Object.entries(o)) walk(x, k);
      return;
    }
    if (typeof v === 'string' && key === 'camera' && !known.has(v)) bad.push(`there's no camera "${v}" in the house`);
    const pictured = typeof v === 'string' && key === 'image' ? /^\/api\/camera_proxy\/(camera\.[a-z0-9_]+)/.exec(v)?.[1] : undefined;
    if (pictured && !known.has(pictured)) bad.push(`there's no camera "${pictured}" in the house`);
    if (typeof v === 'string' && (key === 'entity_id' || key === 'entity_ids') && /^[a-z_]+\.[a-z0-9_]+$/.test(v) && !known.has(v) && v !== 'all') {
      bad.push(`there's no "${v}" in the house`);
    }
  };
  walk(auto);
  return bad.length ? `${[...new Set(bad)].slice(0, 3).join('; ')}.` : undefined;
}

/** Words that say nothing about which automation is meant. */
const FILLER = new Set(['the', 'a', 'an', 'my', 'our', 'automation', 'automations', 'switch', 'please', 'turn', 'switch', 'on', 'off', 'it', 'one', 'that', 'this', 'enable', 'disable', 'activate', 'deactivate', 'pause', 'resume', 'back', 'again', 'now', 'can', 'you', 'max', 'and', 'of', 'for', 'to', 'in', 'when', 'is', 'set', 'put']);

/**
 * The automation or switch the user means, from a few words of its name ("the hallway one", "alarm motion"): the one
 * sharing the most words with what they said. Several equally good: which one is asked.
 */
export function best<T extends { name: string; on?: boolean }>(said: string, pool: T[], wantOn?: 'on' | 'off'): { item: T } | { error: string } {
  const words = (s: string) => slug(s).split('_').filter((w) => w && !FILLER.has(w));
  const asked = words(said);
  const names = pool.map((x) => x.name);
  if (!pool.length) return { error: 'There are no automations or switches yet.' };
  const exact = pool.find((x) => slug(x.name) === slug(said));
  if (exact) return { item: exact };
  if (!asked.length) return { error: `Which one? ${names.map((n) => `"${n}"`).join(', ')}.` };
  const score = (x: T) => {
    const w = words(x.name);
    const hits = asked.filter((a) => w.some((n) => n === a || (a.length > 3 && (n.startsWith(a) || a.startsWith(n))))).length;
    return hits / asked.length + hits / Math.max(1, w.length) / 10;
  };
  const ranked = pool.map((x) => ({ x, s: score(x) })).filter((r) => r.s >= 0.5).sort((p, q) => q.s - p.s);
  if (!ranked.length) return { error: `No automation or switch matches "${said}". There are: ${names.map((n) => `"${n}"`).join(', ')}.` };
  let top = ranked.filter((r) => Math.abs(r.s - ranked[0].s) < 1e-9);
  // Turning one on: prefer the one that's off (and the other way round).
  if (top.length > 1 && wantOn) {
    const fits = top.filter((r) => r.x.on === (wantOn === 'off'));
    if (fits.length === 1) top = fits;
  }
  return top.length === 1 ? { item: top[0].x } : { error: `Several match: ${top.map((r) => `"${r.x.name}"`).join(', ')}. Ask which one.` };
}
