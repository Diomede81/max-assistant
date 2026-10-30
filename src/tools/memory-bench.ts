/**
 * The memory benchmark: how fast and how well the meaning-search model works on this box, and how
 * long searching the vaults would take as they grow. Run on the box with
 *   node dist/tools/memory-bench.js
 * or from the control panel (Max → Memory → Run the benchmark). Each model is measured in its own
 * process, so the memory it needs is seen on its own. Results go to data/memory-bench.json, with a
 * recommendation worked out from rules written down in advance (docs/design/SELF-LEARNING.md):
 *   - switch models only if the other one finds the right fact at least 5 points more often AND
 *     stays under 60 ms a sentence;
 *   - move the vaults to a database only if searching 20,000 facts takes more than 100 ms.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config';
import { BENCH_SET } from './memory-bench-set';
import { normalise } from '../memory/memory.service';

export interface ModelResult {
  model: string;
  ok: boolean;
  error?: string;
  /** Milliseconds per short sentence, warm, over 200 sentences. */
  msPerSentence?: number;
  /** Milliseconds to load the model. */
  loadMs?: number;
  /** The Node process's resident memory with the model loaded (MB). */
  rssMb?: number;
  /** Share of the test questions whose fact was in the top 3 (0–1). */
  recallAt3?: number;
  recallAt1?: number;
}

export interface BenchResult {
  at: string;
  box: { arch: string; cpus: number; totalMemMb: number; node: string };
  models: ModelResult[];
  /** Searching N facts with meaning + keywords: milliseconds. */
  search: { facts: number; ms: number }[];
  recommendation: string;
  /** The rules' outcome, for the settings to read. */
  decision: { embedModel: string; storage: 'vaults' | 'database' };
}

export const ALT_MODEL = 'Xenova/bge-small-en-v1.5';
const SENTENCES = 200;
const SIZES = [5_000, 20_000, 50_000];
const SWITCH_MIN_GAIN = 0.05;
const SWITCH_MAX_MS = 60;
const DATABASE_ABOVE_MS = 100;
const DATABASE_AT = 20_000;

/** Where the results live (read by the control panel). */
export function benchFile(dir: string): string {
  return join(dir, 'memory-bench.json');
}
export function benchRunningFile(dir: string): string {
  return join(dir, 'memory-bench.running');
}

// ---------- one model, in its own process ----------

async function measureModel(model: string, fake = false): Promise<ModelResult> {
  const cfg = loadConfig();
  const started = Date.now();
  let embed: (texts: string[]) => Promise<Float32Array[]>;
  try {
    if (fake) embed = async (texts) => texts.map(fakeVector);
    else {
      const t = await import('@huggingface/transformers');
      t.env.localModelPath = cfg.memory.modelDir;
      t.env.allowRemoteModels = cfg.memory.allowModelDownload;
      if (cfg.memory.modelCacheDir) t.env.cacheDir = cfg.memory.modelCacheDir;
      const fe = (await t.pipeline('feature-extraction', model, { dtype: cfg.memory.embedDtype as 'fp32' })) as unknown as (
        texts: string[],
        o: { pooling: 'mean'; normalize: boolean },
      ) => Promise<{ tolist(): number[][] }>;
      embed = async (texts) => (await fe(texts, { pooling: 'mean', normalize: true })).tolist().map((v) => Float32Array.from(v));
    }
  } catch (err) {
    return { model, ok: false, error: `not available: ${(err as Error).message.split('\n')[0].slice(0, 160)} (rebuild the image to download it)` };
  }
  const loadMs = Date.now() - started;
  // warm up, then time: short sentences like the facts Max keeps
  const pool = BENCH_SET.map((s) => s.fact);
  const sentences = Array.from({ length: SENTENCES }, (_, i) => `${pool[i % pool.length]} (${i})`);
  await embed(sentences.slice(0, 8));
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < sentences.length; i += 8) await embed(sentences.slice(i, i + 8));
  const msPerSentence = Number(process.hrtime.bigint() - t0) / 1e6 / sentences.length;
  // recall: each question against every fact
  const facts = await embed(pool);
  const questions = await embed(BENCH_SET.map((s) => s.q));
  let top1 = 0;
  let top3 = 0;
  questions.forEach((qv, i) => {
    const ranked = facts.map((fv, j) => ({ j, s: cosine(qv, fv) })).sort((a, b) => b.s - a.s);
    const rank = ranked.findIndex((r) => r.j === i);
    if (rank === 0) top1++;
    if (rank >= 0 && rank < 3) top3++;
  });
  return { model, ok: true, loadMs, msPerSentence: round(msPerSentence), rssMb: Math.round(process.memoryUsage().rss / 1048576), recallAt3: round(top3 / BENCH_SET.length), recallAt1: round(top1 / BENCH_SET.length) };
}

// ---------- searching the vaults as they grow ----------

/** The same scoring as the memory service's search (meaning + keyword share), over N synthetic facts. */
function measureSearch(facts: number): number {
  const dims = 384;
  const vecs: Float32Array[] = [];
  const texts: string[] = [];
  for (let i = 0; i < facts; i++) {
    vecs.push(fakeVector(`fact ${i} ${BENCH_SET[i % BENCH_SET.length].fact}`));
    texts.push(`${BENCH_SET[i % BENCH_SET.length].fact} ${i}`);
  }
  const docTokens = texts.map((t) => new Set(tokens(t)));
  const df = new Map<string, number>();
  for (const set of docTokens) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  const runs = 5;
  const t0 = process.hrtime.bigint();
  for (let r = 0; r < runs; r++) {
    const q = BENCH_SET[r % BENCH_SET.length].q;
    const qv = fakeVector(q, dims);
    const qTokens = tokens(q);
    const idf = (t: string) => Math.log(1 + facts / (1 + (df.get(t) ?? 0)));
    const qWeight = qTokens.reduce((s, t) => s + idf(t), 0) || 1;
    const hits = vecs.map((v, n) => {
      const kw = qTokens.reduce((s, t) => s + (docTokens[n].has(t) ? idf(t) : 0), 0) / qWeight;
      return cosine(qv, v) + 0.25 * Math.min(1, kw);
    });
    hits.sort((a, b) => b - a);
  }
  return round(Number(process.hrtime.bigint() - t0) / 1e6 / runs);
}

// ---------- the decision ----------

export function decide(current: string, models: ModelResult[], search: { facts: number; ms: number }[]): { recommendation: string; decision: BenchResult['decision'] } {
  const cur = models.find((m) => m.model === current);
  const alt = models.find((m) => m.model !== current && m.ok);
  const lines: string[] = [];
  let embedModel = current;
  if (cur?.ok && alt?.ok) {
    const gain = (alt.recallAt3 ?? 0) - (cur.recallAt3 ?? 0);
    if (gain >= SWITCH_MIN_GAIN && (alt.msPerSentence ?? Infinity) <= SWITCH_MAX_MS) {
      embedModel = alt.model;
      lines.push(`${alt.model} finds the right fact ${Math.round(gain * 100)} points more often (${pct(alt.recallAt3)} vs ${pct(cur.recallAt3)}) and takes ${alt.msPerSentence} ms a sentence: worth switching (MEMORY_EMBED_MODEL=${alt.model} in .env, then Max re-indexes on the next start).`);
    } else lines.push(`Keep ${current}: ${alt.model} ${gain >= SWITCH_MIN_GAIN ? `finds facts more often but takes ${alt.msPerSentence} ms a sentence (limit ${SWITCH_MAX_MS})` : `finds the right fact ${pct(alt.recallAt3)} of the time vs ${pct(cur.recallAt3)}: not the 5-point gain needed`}.`);
  } else if (cur?.ok) lines.push(`${current} works (${cur.msPerSentence} ms a sentence, right fact in the top 3 ${pct(cur.recallAt3)} of the time); the other model could not be measured.`);
  else lines.push('The current meaning-search model could not be loaded: memory search is using keywords only. Rebuild the image.');
  const at20k = search.find((s) => s.facts === DATABASE_AT)?.ms;
  const storage = at20k !== undefined && at20k > DATABASE_ABOVE_MS ? 'database' : 'vaults';
  if (at20k !== undefined) lines.push(storage === 'database' ? `Searching ${DATABASE_AT.toLocaleString('en-GB')} facts takes ${at20k} ms (limit ${DATABASE_ABOVE_MS}): a database with an index is worth it once the vaults get that big.` : `Searching ${DATABASE_AT.toLocaleString('en-GB')} facts takes ${at20k} ms: the vaults as they are will do for years.`);
  return { recommendation: lines.join(' '), decision: { embedModel, storage } };
}

// ---------- helpers ----------

const STOP = new Set('a an and are as at be but by do does did for from has have he her his i in is it its me my of on or our she so that the their them they this to was we what when where which who will with you your'.split(' '));
const tokens = (s: string) => normalise(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
const round = (n: number) => Math.round(n * 100) / 100;
const pct = (n?: number) => `${Math.round((n ?? 0) * 100)}%`;

function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i];
  return s;
}

/** A stable pseudo-embedding from the words (for the search timing, and for testing without a model). */
export function fakeVector(text: string, dims = 384): Float32Array {
  const v = new Float32Array(dims);
  for (const w of tokens(text)) {
    let h = 2166136261;
    for (const c of w) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    for (let k = 0; k < 4; k++) {
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      v[Math.abs(h) % dims] += ((h >>> 8) & 1) ? 1 : -1;
    }
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dims; i++) v[i] /= n;
  return v;
}

// ---------- main ----------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fake = args.includes('--fake');
  const one = args.indexOf('--model');
  if (one >= 0) {
    // child: one model, result as JSON on stdout
    process.stdout.write(`${JSON.stringify(await measureModel(args[one + 1], fake))}\n`);
    return;
  }
  const cfg = loadConfig();
  mkdirSync(cfg.memory.dir, { recursive: true });
  writeFileSync(benchRunningFile(cfg.memory.dir), new Date().toISOString());
  try {
    const os = await import('node:os');
    console.log(`Memory benchmark on ${os.arch()}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 1048576)} MB`);
    const models: ModelResult[] = [];
    for (const model of [...new Set([cfg.memory.embedModel, ALT_MODEL])]) {
      console.log(`Measuring ${model}…`);
      models.push(await inChild(model, fake));
      const m = models[models.length - 1];
      console.log(m.ok ? `  ${m.msPerSentence} ms a sentence, ${m.rssMb} MB, right fact in the top 3 ${pct(m.recallAt3)} (top 1 ${pct(m.recallAt1)}), loaded in ${m.loadMs} ms` : `  ${m.error}`);
    }
    const search: BenchResult['search'] = [];
    for (const facts of SIZES) {
      const ms = measureSearch(facts);
      search.push({ facts, ms });
      console.log(`Searching ${facts.toLocaleString('en-GB')} facts: ${ms} ms`);
    }
    const { recommendation, decision } = decide(cfg.memory.embedModel, models, search);
    const result: BenchResult = { at: new Date().toISOString(), box: { arch: os.arch(), cpus: os.cpus().length, totalMemMb: Math.round(os.totalmem() / 1048576), node: process.version }, models, search, recommendation, decision };
    writeFileSync(benchFile(cfg.memory.dir), JSON.stringify(result, null, 2));
    console.log(recommendation);
  } finally {
    try {
      (await import('node:fs')).unlinkSync(benchRunningFile(cfg.memory.dir));
    } catch {
      /* already gone */
    }
  }
}

function inChild(model: string, fake: boolean): Promise<ModelResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [__filename, '--model', model, ...(fake ? ['--fake'] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.on('close', (code) => {
      try {
        resolve(JSON.parse(out.trim().split('\n').pop() ?? '') as ModelResult);
      } catch {
        resolve({ model, ok: false, error: `the measurement stopped (exit ${code})` });
      }
    });
    child.on('error', (err) => resolve({ model, ok: false, error: err.message }));
  });
}

if (require.main === module) void main();
