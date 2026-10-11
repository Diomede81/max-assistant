/**
 * Live tuning tool: shows microphone loudness and every wake word detection.
 *   npm run mic-check
 * Use it to (1) confirm "hey max" triggers reliably from across the room, (2) check it
 * does NOT trigger during normal conversation / TV, and (3) pick VAD_RMS_THRESHOLD:
 * set it between the "quiet room" level and the "talking" level shown here.
 */
import { spawn } from 'node:child_process';
import { loadConfig } from '../config';
import { WyomingClient } from '../wyoming/wyoming-client';
import { wakeWordNames } from '../wake-word/wake-word.service';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env: use defaults / shell environment
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const fmt = { rate: cfg.audio.sampleRate, width: 2, channels: 1 };
  const ww = new WyomingClient(cfg.wakeWord.host, cfg.wakeWord.port);
  await ww.connect();
  const available = wakeWordNames(await ww.describe());
  console.log(`Wake words installed: ${available.join(', ')}`);
  const missing = cfg.wakeWord.names.filter((n) => !available.includes(n));
  if (missing.length) {
    console.log(`\n!! WAKEWORD_NAMES contains "${missing.join(', ')}", which is NOT installed.`);
    console.log(`!! Check .env has only ONE WAKEWORD_NAMES line (the last one wins). Installed: ${available.join(', ')}\n`);
  }
  const active = cfg.wakeWord.names.filter((n) => available.includes(n));
  const phrases = (active.length ? active : ['okay_nabu']).map((n) => `"${n.replace(/_/g, ' ')}"`);
  console.log(`>>> Say ${phrases.join(' or ')} <<<`);
  let detections = 0;
  ww.on('event', (e) => {
    if (e.type === 'detection') {
      detections++;
      process.stdout.write(`\n>>> DETECTED "${e.data.name}" (#${detections}) at ${new Date().toLocaleTimeString()}\n`);
    }
  });
  ww.send('detect', { names: cfg.wakeWord.names });
  ww.send('audio-start', { ...fmt, timestamp: 0 });

  const mic = spawn('arecord', ['-q', '-D', cfg.audio.inputDevice, '-f', 'S16_LE', '-c', '1',
    '-r', String(fmt.rate), '-t', 'raw'], { stdio: ['ignore', 'pipe', 'inherit'] });

  mic.on('error', (err) => {
    console.error(`Cannot start microphone (${err.message}). Install it with: sudo apt install alsa-utils`);
    process.exit(1);
  });

  let sum = 0;
  let samples = 0;
  let peak = 0;
  mic.stdout.on('data', (chunk: Buffer) => {
    ww.send('audio-chunk', fmt, chunk);
    for (let i = 0; i + 1 < chunk.length; i += 2) {
      const s = chunk.readInt16LE(i);
      sum += s * s;
      samples++;
    }
    if (samples >= fmt.rate / 4) {
      const rms = Math.round(Math.sqrt(sum / samples));
      peak = Math.max(peak, rms);
      const bar = '#'.repeat(Math.min(50, Math.round(rms / 100)));
      const mark = rms >= cfg.vad.rmsThreshold ? 'speech' : 'quiet ';
      process.stdout.write(`\rlevel ${String(rms).padStart(5)} ${mark} peak ${String(peak).padStart(5)} |${bar.padEnd(50)}|`);
      sum = 0;
      samples = 0;
    }
  });

  console.log(`Listening for: ${cfg.wakeWord.names.join(', ')}  (VAD threshold ${cfg.vad.rmsThreshold}). Ctrl+C to stop.`);
  process.on('SIGINT', () => {
    console.log(`\n${detections} detection(s).`);
    mic.kill();
    ww.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`Cannot reach the wake word service: ${err.message}. Is "docker compose up -d" running?`);
  process.exit(1);
});
