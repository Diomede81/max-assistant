import { Injectable, Logger } from '@nestjs/common';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { best } from './automations.service';
import { HomeService } from './home.service';

/**
 * Renaming devices and moving them to another room, by voice ("call the hallway sensor Front door motion", "move the
 * lamp to the bedroom"): the same change as Edit on the Devices page, so the page shows it straight away. Max checks it
 * took before saying so.
 */
@Injectable()
export class DeviceNamesService {
  private readonly log = new Logger('Device names');

  constructor(private readonly home: HomeService) {}

  get enabled(): boolean {
    return this.home.enabled;
  }

  /** The devices as the Devices page shows them (cards, and the battery-only ones). */
  private async devices(): Promise<{ id: string; name: string; area?: string }[]> {
    const o = await this.home.overview();
    if (o.state !== 'ready') throw new Error(o.message || 'Home Assistant is still starting: try again in a minute');
    return [...o.devices.map((d) => ({ id: d.id, name: d.name, area: d.area })), ...(o.parts ?? []).map((p) => ({ id: p.id, name: p.name, area: p.area }))];
  }

  get tools(): ChatCompletionTool[] {
    if (!this.enabled) return [];
    return [
      {
        type: 'function',
        function: {
          name: 'home_device',
          description:
            'Rename a device or move it to another room, as on the Devices page. rename: name (which device: a few words of its ' +
            'current name, or with its room) and new_name. move: name and room (a new room is made if needed). list: the devices ' +
            'and their rooms. Only say it is done when this action says so.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['rename', 'move', 'list'] },
              name: { type: 'string', description: 'rename / move: the device, by its current name (a few words are enough)' },
              new_name: { type: 'string', description: 'rename: the new name' },
              room: { type: 'string', description: 'move: the room, e.g. "Kitchen"' },
            },
            required: ['action'],
          },
        },
      },
    ];
  }

  has(name: string): boolean {
    return this.enabled && name === 'home_device';
  }

  async call(_name: string, a: Record<string, unknown>): Promise<string> {
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    try {
      const all = await this.devices();
      if (a.action === 'list' || !a.action) {
        return all.map((d) => `${d.name}${d.area ? ` (${d.area})` : ''}`).join('; ') || 'No devices yet.';
      }
      // "the lamp in the bedroom": its room counts as part of its name.
      const pool = all.map((d) => ({ ...d, name: d.name, full: `${d.name} ${d.area ?? ''}` }));
      const first = best(str(a.name), pool);
      const hit = 'error' in first ? best(str(a.name), pool.map((d) => ({ ...d, name: d.full }))) : first;
      if ('error' in hit) {
        const why = 'error' in first ? first.error : hit.error;
        return why.replace(/automation or switch/g, 'device').replace(/automations or switches/g, 'devices').slice(0, 600);
      }
      const d = all.find((x) => x.id === hit.item.id)!;
      if (a.action === 'rename') {
        const to = str(a.new_name).replace(/\s+/g, ' ').slice(0, 80);
        if (!to) return 'What should it be called?';
        await this.home.editDevice(d.id, to);
        const now = (await this.devices()).find((x) => x.id === d.id);
        if (now?.name !== to) return `Home Assistant didn't take the new name for ${d.name}: try again, or use Edit on the Devices page.`;
        this.log.log(`Renamed a device to "${to}"`);
        return `Renamed "${d.name}" to "${to}": the Devices page shows it now.`;
      }
      if (a.action === 'move') {
        const room = str(a.room).replace(/\s+/g, ' ').slice(0, 60);
        if (!room) return 'Which room?';
        await this.home.editDevice(d.id, undefined, room);
        const now = (await this.devices()).find((x) => x.id === d.id);
        if (now?.area?.toLowerCase() !== room.toLowerCase()) return `Home Assistant didn't move ${d.name}: try again, or use Edit on the Devices page.`;
        return `Moved "${d.name}" to ${now.area}.`;
      }
      return 'Unknown action.';
    } catch (err) {
      return `Couldn't do that: ${(err as Error).message}`;
    }
  }
}
