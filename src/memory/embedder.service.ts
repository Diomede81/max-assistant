import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';

type Extractor = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

/**
 * Turns text into "meaning fingerprints" (embeddings) on this machine, so memory search
 * finds "that supplier issue" from "Acme's delivery is late" - without sending the memory
 * anywhere to be indexed. Uses a small model (all-MiniLM-L6-v2, ~23 MB) that the Docker
 * build downloads once. If it can't load, search falls back to keywords only.
 */
@Injectable()
export class EmbedderService {
  private readonly log = new Logger('Memory');
  private loading?: Promise<Extractor | undefined>;
  private failed = false;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  get enabled(): boolean {
    return !!this.cfg.memory.embedModel && !this.failed;
  }

  /** Unit-length vectors, or undefined when embeddings are unavailable. */
  async embed(texts: string[]): Promise<Float32Array[] | undefined> {
    if (!texts.length || !this.enabled) return undefined;
    const fe = await (this.loading ??= this.load());
    if (!fe) return undefined;
    try {
      const out = await fe(texts.map((t) => t.slice(0, 1000)), { pooling: 'mean', normalize: true });
      return out.tolist().map((v) => Float32Array.from(v));
    } catch (err) {
      this.log.warn(`Meaning search failed (${(err as Error).message}); using keyword search`);
      return undefined;
    }
  }

  private async load(): Promise<Extractor | undefined> {
    const started = Date.now();
    try {
      const t = await import('@huggingface/transformers');
      if (this.cfg.memory.modelDir) t.env.localModelPath = this.cfg.memory.modelDir;
      t.env.allowRemoteModels = this.cfg.memory.allowModelDownload;
      if (this.cfg.memory.modelCacheDir) t.env.cacheDir = this.cfg.memory.modelCacheDir;
      const fe = (await t.pipeline('feature-extraction', this.cfg.memory.embedModel, {
        dtype: this.cfg.memory.embedDtype as 'fp32',
      })) as unknown as Extractor;
      this.log.log(`Meaning search ready (${this.cfg.memory.embedModel}, loaded in ${Date.now() - started} ms)`);
      return fe;
    } catch (err) {
      this.failed = true;
      this.log.warn(
        `Meaning search unavailable (${(err as Error).message.split('\n')[0]}); memory search uses keywords only. ` +
          'Rebuild the image (docker compose build max) to download the search model.',
      );
      return undefined;
    }
  }
}

export function toB64(v: Float32Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
}

export function fromB64(s: string): Float32Array {
  const b = Buffer.from(s, 'base64');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i];
  return s;
}
