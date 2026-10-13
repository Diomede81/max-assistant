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
const SENTENCES = [
  "I'm going to the shop to buy some milk and bread.",
  'Max, can you pass me that box over there?',
  'Hey Mike, how was your weekend?',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Records `ms` of 16 kHz mono audio from the configured microphone. */
function record(device: string, ms: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn('arecord', ['-q', '-D', device, '-f', 'S16_LE', '-c', '1', '-r', String(RATE), '-t', 'raw'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const parts: Buffer[] = [];
    const max = Math.round((RATE * 2 * ms) / 1000);
    let got = 0;
    proc.stdout.on('data', (b: Buffer) => {
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
  const save = (name: string, pcm: Buffer) => {
    writeFileSync(join(out, `${name}.wav`), wav(pcm));
    const db = peakDb(pcm);
    console.log(`   recorded (${db} dB, ${levelNote(db)})`);
  };

  console.log(`\nWAKE WORD COACH\n`);
  console.log(`Sit or stand where you normally talk to Max, and speak as you normally would.`);
  console.log(`I'll ask you to say "${phrase}" ${ATTEMPTS} times, read ${SENTENCES.length} short sentences, then record your room's usual background sounds.`);
  await sleep(2500);

  await countdown('First, stay quiet for 3 seconds so I can hear the room...');
  process.stdout.write('  (quiet please)\n');
  save('room', await record(device, 3000));

  for (let i = 1; i <= ATTEMPTS; i++) {
    const tip = i === 4 ? ' (a bit quieter this time)' : i === 7 ? ' (a bit faster)' : i === 9 ? ' (from a little further away)' : '';
    await countdown(`Attempt ${i} of ${ATTEMPTS}: get ready to say "${phrase}"${tip}`);
    process.stdout.write(`  >>> SAY "${phrase.toUpperCase()}" NOW <<<\n`);
    save(`positive_${String(i).padStart(2, '0')}`, await record(device, 2500));
    await sleep(600);
  }

  for (let i = 0; i < SENTENCES.length; i++) {
    await countdown(`Sentence ${i + 1} of ${SENTENCES.length}: get ready to read this out loud:\n   "${SENTENCES[i]}"\n`);
    process.stdout.write('  >>> READ IT NOW <<<\n');
    save(`negative_${String(i + 1).padStart(2, '0')}`, await record(device, 4500));
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
    save('negative_background', await record(device, bgSeconds * 1000));
  }

  console.log(`\nDone: recordings saved in ${out}`);
}

main().catch((err) => {
  console.error(`Recording failed: ${(err as Error).message}`);
  process.exit(1);
});
