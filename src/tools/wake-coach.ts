/**
 * Wake word coach, step 1: records you saying the wake word (and a few normal sentences)
 * so scripts/wake/score.py can measure how confidently the model recognises your voice.
 * Started by scripts/wake-coach.sh, which then runs the scoring.
 *   node dist/tools/wake-coach.js <output folder>
 * The recordings (16 kHz WAV) can also be added to training to make the model learn
 * your voice (training/README.md).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env: use defaults / shell environment
}

const RATE = 16000;
const ATTEMPTS = 10;
/** With the TV or radio on: the recordings that teach the model to hear you through your home's noise. */
const NOISY_ATTEMPTS = 6;
const SENTENCES = [
  "I'm going to the shop to buy some milk and bread.",
  'Max, can you pass me that box over there?',
  'Hey Mike, how was your weekend?',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Records `ms` of 16 kHz mono audio from the configured microphone: the same channel Max listens to
 * (AUDIO_INPUT_CHANNEL), so the recordings sound exactly like what reaches the wake word.
 */
function record(device: string, ms: number, pick?: number, channels = 1): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn('arecord', ['-q', '-D', device, '-f', 'S16_LE', '-c', String(channels), '-r', String(RATE), '-t', 'raw'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const parts: Buffer[] = [];
    const max = Math.round((RATE * 2 * ms) / 1000);
    let got = 0;
    const frame = channels * 2;
    let rest: Buffer = Buffer.alloc(0);
    proc.stdout.on('data', (raw: Buffer) => {
      let b = raw;
      if (pick !== undefined) {
        const all = rest.length ? Buffer.concat([rest, raw]) : raw;
        const frames = Math.floor(all.length / frame);
        rest = all.subarray(frames * frame);
        b = Buffer.alloc(frames * 2);
        for (let i = 0; i < frames; i++) b.writeInt16LE(all.readInt16LE(i * frame + pick * 2), i * 2);
      }
      if (got < max) parts.push(b.subarray(0, max - got));
      got += b.length;
    });
    proc.on('error', reject);
    setTimeout(() => proc.kill(), ms);
    proc.on('exit', () => resolve(Buffer.concat(parts)));
  });
}

function wav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Peak level in dB (0 = maximum), for live feedback. */
function peakDb(pcm: Buffer): number {
  let peak = 1;
  for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  return Math.round(20 * Math.log10(peak / 32768));
}

function levelNote(db: number): string {
  if (db < -35) return "very quiet: I may not have heard you";
  if (db < -22) return 'quiet';
  if (db > -1) return 'too loud (clipping)';
  return 'good';
}

async function countdown(text: string): Promise<void> {
  process.stdout.write(`\n${text}  3`);
  for (const n of ['2', '1']) {
    await sleep(700);
    process.stdout.write(` ${n}`);
  }
  await sleep(700);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const out = process.argv[2] ?? join('wake-coach', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(out, { recursive: true });
  const phrase = (cfg.wakeWord.names[0] ?? 'hey_max').replace(/_/g, ' ');
  const device = cfg.audio.inputDevice;
  const pick = cfg.audio.inputChannel;
  const channels = pick === undefined ? 1 : cfg.audio.inputChannels;
  const rec = (ms: number) => record(device, ms, pick, channels);
  const save = (name: string, pcm: Buffer) => {
    writeFileSync(join(out, `${name}.wav`), wav(pcm));
    const db = peakDb(pcm);
    console.log(`   recorded (${db} dB, ${levelNote(db)})`);
  };

  console.log(`\nWAKE WORD COACH\n`);
  console.log(`Sit or stand where you normally talk to Max, and speak as you normally would.`);
  console.log(`I'll ask you to say "${phrase}" ${ATTEMPTS} times, read ${SENTENCES.length} short sentences, say it ${NOISY_ATTEMPTS} more times with some noise on, then record your room's usual background sounds.`);
  if (pick !== undefined) console.log(`(Recording channel ${pick} of the microphone, the one Max listens to.)`);
  await sleep(2500);

  await countdown('First, stay quiet for 3 seconds so I can hear the room...');
  process.stdout.write('  (quiet please)\n');
  save('room', await rec(3000));

  for (let i = 1; i <= ATTEMPTS; i++) {
    const tip = i === 4 ? ' (a bit quieter this time)' : i === 7 ? ' (a bit faster)' : i === 9 ? ' (from a little further away)' : '';
    await countdown(`Attempt ${i} of ${ATTEMPTS}: get ready to say "${phrase}"${tip}`);
    process.stdout.write(`  >>> SAY "${phrase.toUpperCase()}" NOW <<<\n`);
    save(`positive_${String(i).padStart(2, '0')}`, await rec(2500));
    await sleep(600);
  }

  // The same, through the house's usual noise: these teach the model to pick your voice out of it.
  console.log(`\nNow put on the TV, the radio or some music at the volume you usually have it, then say "${phrase}" again a few times (don't shout: speak as you normally would).`);
  await sleep(6000);
  for (let i = 1; i <= NOISY_ATTEMPTS; i++) {
    const tip = i === 3 ? ' (from across the room)' : i === 5 ? ' (while the noise is loudest)' : '';
    await countdown(`Noisy attempt ${i} of ${NOISY_ATTEMPTS}: get ready to say "${phrase}"${tip}`);
    process.stdout.write(`  >>> SAY "${phrase.toUpperCase()}" NOW <<<\n`);
    save(`positive_noisy_${String(i).padStart(2, '0')}`, await rec(2500));
    await sleep(600);
  }

  for (let i = 0; i < SENTENCES.length; i++) {
    await countdown(`Sentence ${i + 1} of ${SENTENCES.length}: get ready to read this out loud:\n   "${SENTENCES[i]}"\n`);
    process.stdout.write('  >>> READ IT NOW <<<\n');
    save(`negative_${String(i + 1).padStart(2, '0')}`, await rec(4500));
    await sleep(600);
  }

  // False wake-ups come from the room's usual sounds: measure them too.
  const bgSeconds = Number(process.env.COACH_BACKGROUND_SECONDS ?? 45);
  if (bgSeconds > 0) {
    await countdown(
      `Last step: ${bgSeconds} seconds of your room's usual sounds. Put on whatever normally plays (TV, music, ` +
        `the radio, people chatting, the kitchen) and DON'T say "${phrase}". Starting in`,
    );
    process.stdout.write('  (recording the background...)\n');
    save('negative_background', await rec(bgSeconds * 1000));
  }

  console.log(`\nDone: recordings saved in ${out}`);
}

main().catch((err) => {
  console.error(`Recording failed: ${(err as Error).message}`);
  process.exit(1);
});
