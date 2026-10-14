import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../config';

export type PowerAction = 'poweroff' | 'reboot';

/**
 * Asks the Max box to turn off or restart. Max runs in a container and can't do it himself:
 * he leaves a note in the folder he shares with the box (/run/max), and the box's max-power
 * service carries it out (scripts/pi/max-power.sh). Returns false when not on the box.
 */
export function requestPower(cfg: AppConfig, action: PowerAction): boolean {
  if (!cfg.face.onBox) return false;
  try {
    writeFileSync(join(cfg.face.runDir, 'power-request'), action);
    return true;
  } catch {
    return false;
  }
}
