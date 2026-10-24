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
  // Several channels (AUDIO_INPUT_CHANNEL set, or MIC_CHECK_CHANNELS=2): the level of each is shown, and the
  // chosen one (default 0) feeds the wake word, as Max would.
  const channels = cfg.audio.inputChannel !== undefined ? cfg.audio.inputChannels : Math.max(1, Number(process.env.MIC_CHECK_CHANNELS) || 1);
  const pick = Math.min(cfg.audio.inputChannel ?? 0, channels - 1);
  if (channels > 1) console.log(`Recording ${channels} channels; the wake word hears channel ${pick} (AUDIO_INPUT_CHANNEL)`);
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

  const mic = spawn('arecord', ['-q', '-D', cfg.audio.inputDevice, '-f', 'S16_LE', '-c', String(channels),
    '-r', String(fmt.rate), '-t', 'raw'], { stdio: ['ignore', 'pipe', 'inherit'] });

  mic.on('error', (err) => {
    console.error(`Cannot start microphone (${err.message}). Install it with: sudo apt install alsa-utils`);
    process.exit(1);
  });

  const sum = new Array<number>(channels).fill(0);
  let samples = 0;
  let peak = 0;
  const frame = channels * 2;
  let rest: Buffer = Buffer.alloc(0);
  mic.stdout.on('data', (chunk: Buffer) => {
    const all = rest.length ? Buffer.concat([rest, chunk]) : chunk;
    const frames = Math.floor(all.length / frame);
    rest = all.subarray(frames * frame);
    const mono = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++) {
        const s = all.readInt16LE(i * frame + c * 2);
        sum[c] += s * s;
      }
      mono.writeInt16LE(all.readInt16LE(i * frame + pick * 2), i * 2);
    }
    samples += frames;
    ww.send('audio-chunk', fmt, mono);
    if (samples >= fmt.rate / 4) {
      const levels = sum.map((x) => Math.round(Math.sqrt(x / samples)));
      const rms = levels[pick];
      peak = Math.max(peak, rms);
      const bar = '#'.repeat(Math.min(50, Math.round(rms / 100)));
      const mark = rms >= cfg.vad.rmsThreshold ? 'speech' : 'quiet ';
      const others = channels > 1 ? ` [${levels.map((l, c) => `ch${c} ${String(l).padStart(5)}`).join(' ')}]` : '';
      process.stdout.write(`\rlevel ${String(rms).padStart(5)} ${mark} peak ${String(peak).padStart(5)} |${bar.padEnd(50)}|${others}`);
      sum.fill(0);
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
