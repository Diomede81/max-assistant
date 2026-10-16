import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** One sound stream playing through the box's sound system (radio, AirPlay, Max's voice...). */
export interface SinkInput {
  index: number;
  /** Application and stream names, lower case, to recognise it. */
  names: string;
  /** Volume in % (the loudest channel). */
  volume: number;
}

/** The streams playing right now (pactl, through Max's sound system connection). */
export async function sinkInputs(): Promise<SinkInput[]> {
  try {
    const { stdout } = await run('pactl', ['-f', 'json', 'list', 'sink-inputs'], { timeout: 4000 });
    const list = JSON.parse(stdout) as {
      index: number;
      properties?: Record<string, string>;
      volume?: Record<string, { value_percent?: string }>;
    }[];
    return list.map((s) => {
      const p = s.properties ?? {};
      const names = [p['application.name'], p['application.process.binary'], p['media.name'], p['node.name']].filter(Boolean).join(' | ').toLowerCase();
      const vols = Object.values(s.volume ?? {}).map((v) => parseInt(v.value_percent ?? '', 10)).filter((n) => Number.isFinite(n));
      return { index: s.index, names, volume: vols.length ? Math.max(...vols) : 100 };
    });
  } catch {
    return [];
  }
}

export async function setSinkInputVolume(index: number, pct: number): Promise<void> {
  await run('pactl', ['set-sink-input-volume', String(index), `${Math.max(0, Math.min(150, Math.round(pct)))}%`], { timeout: 4000 });
}

/** Radio and AirPlay streams (the ones Max turns down while he talks). */
export const MUSIC_STREAM = /max radio|shairport/;
