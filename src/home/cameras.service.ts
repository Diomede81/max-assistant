import { Injectable, Logger } from '@nestjs/common';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { showCard } from '../face/screen';
import { HomeService } from './home.service';

/** A camera, with what its device saw lately (motion, a ring at the door). */
export interface HomeCamera {
  entityId: string;
  name: string;
  area?: string;
  /** "Motion: 5 min ago · Ding: yesterday 18:40". */
  recent: string[];
}

/**
 * Cameras in Home Assistant (Ring, Nest, Reolink...): Max shows a camera's latest picture on his screen and says
 * what it saw lately (motion, someone at the door), from the devices you let him use ("Max can use" on the Devices
 * page). Pictures only go to the box's own screen.
 */
@Injectable()
export class CamerasService {
  private readonly log = new Logger('Cameras');

  constructor(private readonly home: HomeService) {}

  get enabled(): boolean {
    return this.home.enabled;
  }

  /** The cameras Max may use, with their device's latest motion and doorbell events. */
  async list(): Promise<HomeCamera[]> {
    type Device = { id: string; name: string | null; name_by_user: string | null; area_id: string | null };
    type Entry = { entity_id: string; device_id: string | null; name: string | null; original_name: string | null; disabled_by: string | null };
    type State = { entity_id: string; state: string; last_changed?: string; attributes: Record<string, unknown> };
    const [devices, entries, states, exposed, areas] = await Promise.all([
      this.home.command<Device[]>('config/device_registry/list'),
      this.home.command<Entry[]>('config/entity_registry/list'),
      this.home.command<State[]>('get_states'),
      this.home.command<{ exposed_entities: Record<string, { conversation?: boolean }> }>('homeassistant/expose_entity/list'),
      this.home.command<{ area_id: string; name: string }[]>('config/area_registry/list'),
    ]);
    const stateOf = new Map(states.map((s) => [s.entity_id, s]));
    const deviceOf = new Map(devices.map((d) => [d.id, d]));
    const areaName = new Map(areas.map((a) => [a.area_id, a.name]));
    const allowed = (e: Entry) => Boolean(exposed.exposed_entities[e.entity_id]?.conversation);
    const out: HomeCamera[] = [];
    const registered = new Map(entries.map((e) => [e.entity_id, e]));
    // Every camera Home Assistant has (some aren't in its registry: then they stand alone).
    const cameras = states
      .filter((s) => s.entity_id.startsWith('camera.'))
      .map((s): Entry => registered.get(s.entity_id) ?? { entity_id: s.entity_id, device_id: null, name: null, original_name: null, disabled_by: null })
      .filter((e) => !e.disabled_by);
    for (const cam of cameras) {
      const d = cam.device_id ? deviceOf.get(cam.device_id) : undefined;
      // A camera without a device (some integrations): just itself.
      const siblings = cam.device_id ? entries.filter((e) => e.device_id === cam.device_id && !e.disabled_by) : [cam];
      // Only cameras on a device Max may use (the "Max can use" tick on the Devices page).
      if (!siblings.some(allowed)) continue;
      const recent: string[] = [];
      for (const e of siblings) {
        const s = stateOf.get(e.entity_id);
        if (!s) continue;
        const label = (e.name || e.original_name || String(s.attributes.friendly_name ?? '')).replace(d?.name_by_user || d?.name || '', '').trim() || e.entity_id.split('.')[1].replace(/_/g, ' ');
        // A ring or motion event: its state is when it last happened.
        if (e.entity_id.startsWith('event.') && !isNaN(Date.parse(s.state))) recent.push(`${label}: ${ago(s.state)}`);
        else if (e.entity_id.startsWith('binary_sensor.') && /motion|occupancy|ding|ring|doorbell|person/i.test(`${String(s.attributes.device_class ?? '')} ${label}`)) {
          recent.push(`${label}: ${s.state === 'on' ? 'now' : s.last_changed ? `last ${ago(s.last_changed)}` : 'no'}`);
        }
      }
      const st = stateOf.get(cam.entity_id);
      out.push({
        entityId: cam.entity_id,
        name: d?.name_by_user || d?.name || String(st?.attributes.friendly_name ?? cam.entity_id),
        area: d?.area_id ? areaName.get(d.area_id) : undefined,
        recent,
      });
    }
    return out;
  }

  /** Shows the camera's latest picture on Max's screen. */
  async show(cam: HomeCamera): Promise<string> {
    const jpeg = await this.home.snapshot(cam.entityId);
    showCard({
      id: 'camera',
      kind: 'notice',
      icon: '📷',
      title: cam.name,
      subtitle: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      image: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      body: cam.recent.join(' · ') || undefined,
      actions: [{ id: 'ok', label: 'Close', style: 'primary' }],
      ttlMs: 60_000,
    });
    this.log.log(`Showed ${cam.name} on the screen`);
    return `The latest picture from ${cam.name} is on the screen.${cam.recent.length ? ` ${cam.recent.join('; ')}.` : ''}`;
  }

  // ---------- For Max (by voice) ----------

  get tools(): ChatCompletionTool[] {
    if (!this.enabled) return [];
    return [
      {
        type: 'function',
        function: {
          name: 'camera',
          description:
            'The home\'s cameras and doorbells (Ring and others in Home Assistant). list: the cameras and what they saw lately ' +
            '(motion, someone ringing). show: put a camera\'s latest picture on your screen ("show me the front door") and say ' +
            'what it saw lately. You can only see a still picture, not describe it.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['list', 'show'] },
              name: { type: 'string', description: 'show: which camera (a few words of its name or room; optional when there is one)' },
            },
            required: ['action'],
          },
        },
      },
    ];
  }

  has(name: string): boolean {
    return this.enabled && name === 'camera';
  }

  async call(_name: string, a: Record<string, unknown>): Promise<string> {
    try {
      const cams = await this.list();
      if (!cams.length) {
        return 'No cameras Max may use. On the Devices page, tick "Max can use" on the camera (or doorbell), then ask again.';
      }
      if (a.action !== 'show') {
        return cams.map((c) => `${c.name}${c.area ? ` (${c.area})` : ''}${c.recent.length ? `: ${c.recent.join(', ')}` : ''}`).join('; ');
      }
      const want = String(a.name ?? '').toLowerCase();
      const words = want.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['the', 'camera', 'show', 'doorbell'].includes(w));
      const score = (c: HomeCamera) => words.filter((w) => `${c.name} ${c.area ?? ''}`.toLowerCase().includes(w)).length;
      const ranked = [...cams].sort((x, y) => score(y) - score(x));
      // The one camera there is, or the one whose name or room matches best (a tie: ask which).
      const cam = cams.length === 1 ? cams[0] : score(ranked[0]) > 0 && score(ranked[0]) > score(ranked[1]) ? ranked[0] : undefined;
      if (!cam) return `Which camera? ${cams.map((c) => c.name).join(', ')}.`;
      return await this.show(cam);
    } catch (err) {
      return `Couldn't reach the cameras: ${(err as Error).message}`;
    }
  }
}

/** "5 min ago", "2 h ago", "yesterday 18:40", "12 Oct 09:15". */
function ago(iso: string): string {
  const t = Date.parse(iso);
  if (isNaN(t)) return 'unknown';
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 6 * 60) return `${Math.round(min / 60)} h ago`;
  const d = new Date(t);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(Date.now() - 86_400_000).toDateString() === d.toDateString();
  if (new Date().toDateString() === d.toDateString()) return `today ${time}`;
  return yesterday ? `yesterday ${time}` : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
}
