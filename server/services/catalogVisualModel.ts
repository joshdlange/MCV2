import sharp from 'sharp';
import path from 'node:path';
import { access } from 'node:fs/promises';

export const MODEL_ID = 'Xenova/dinov2-small';
export const MODEL_REVISION = 'c2bb04a51fab207c420665f1946016107bffc701';
export const MODEL_VERSION = `dinov2-small:${MODEL_REVISION}:q8:cls:rgb-fit224-v1`;
export const VECTOR_DIMENSIONS = 384;
export const bundledVisualModelPath = () => path.resolve('dist/models', MODEL_ID, MODEL_REVISION);
let modelPromise: Promise<any> | undefined;
let offlineModelPromise: Promise<any> | undefined;

/** Explicit opt-in: never downloads and does not reuse a possibly remote model. */
export async function preloadBundledCatalogVisualModel(): Promise<any> {
  offlineModelPromise ??= (async () => {
    const root = bundledVisualModelPath();
    for (const file of ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx']) {
      await access(path.join(root, file)).catch(() => {
        throw new Error(`Bundled visual model unavailable: ${file}`);
      });
    }
    const { pipeline, env } = await import('@huggingface/transformers');
    const previous = { remote: env.allowRemoteModels, local: env.allowLocalModels, cache: env.useFSCache };
    try {
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.useFSCache = false;
      return await pipeline('image-feature-extraction', root, {
        revision: MODEL_REVISION, device: 'cpu', dtype: 'q8', local_files_only: true,
        session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
      });
    } finally {
      env.allowRemoteModels = previous.remote;
      env.allowLocalModels = previous.local;
      env.useFSCache = previous.cache;
    }
  })().catch(error => { offlineModelPromise = undefined; throw error; });
  return offlineModelPromise;
}
type Work = { run: () => Promise<unknown>; resolve: (value: any) => void; reject: (error: unknown) => void };

// One active ONNX call is not preemptible. Waiting scans always run before
// waiting backfill; backfill may occupy at most one waiting slot.
export class VisualInferenceScheduler {
  private active = false;
  private foreground: Work[] = [];
  private background: Work[] = [];

  run<T>(run: () => Promise<T>, priority: 'scan' | 'background' = 'scan'): Promise<T> {
    const queue = priority === 'scan' ? this.foreground : this.background;
    if (queue.length >= (priority === 'scan' ? 4 : 1)) {
      return Promise.reject(new Error('Visual inference busy; retry shortly'));
    }
    return new Promise<T>((resolve, reject) => {
      queue.push({ run, resolve, reject });
      this.drain();
    });
  }

  private drain() {
    if (this.active) return;
    const work = this.foreground.shift() ?? this.background.shift();
    if (!work) return;
    this.active = true;
    Promise.resolve().then(work.run).then(work.resolve, work.reject).finally(() => {
      this.active = false;
      this.drain();
    });
  }
}
const scheduler = new VisualInferenceScheduler();

export function normalizeVisualVector(values: ArrayLike<number>): number[] {
  if (values.length !== VECTOR_DIMENSIONS) throw new Error('Invalid visual vector dimensions');
  const vector = Array.from(values);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm <= 0) throw new Error('Invalid visual vector values');
  return vector.map(value => value / norm);
}

export function visualCosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error('Visual vector dimension mismatch');
  let value = 0;
  for (let i = 0; i < a.length; i++) value += a[i] * b[i];
  return Math.max(-1, Math.min(1, value));
}

export function visualTopK(
  references: Iterable<{ url: string; vector: ArrayLike<number> }>,
  vector: ArrayLike<number>, count: number,
): { url: string; similarity: number }[] {
  const size = Math.max(1, Math.min(200, Math.floor(count)));
  const heap: { url: string; similarity: number }[] = [];
  for (const ref of references) {
    const similarity = visualCosine(vector, ref.vector);
    if (heap.length === size && similarity <= heap[0].similarity) continue;
    const entry = { url: ref.url, similarity };
    if (heap.length < size) {
      heap.push(entry);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent].similarity <= heap[i].similarity) break;
        [heap[parent], heap[i]] = [heap[i], heap[parent]];
        i = parent;
      }
    } else {
      heap[0] = entry;
      let i = 0;
      while (2 * i + 1 < heap.length) {
        let child = 2 * i + 1;
        if (child + 1 < heap.length && heap[child + 1].similarity < heap[child].similarity) child++;
        if (heap[i].similarity <= heap[child].similarity) break;
        [heap[i], heap[child]] = [heap[child], heap[i]];
        i = child;
      }
    }
  }
  return heap.sort((a, b) => b.similarity - a.similarity);
}

// A bounded serialized queue prevents concurrent ONNX executions exhausting RAM.
// DINO's CLS token is an instance-artwork descriptor, not a text/name embedding.
export async function embedCatalogVisualImage(buffer: Buffer, priority: 'scan' | 'background' = 'scan', options: { offline?: boolean } = {}): Promise<number[]> {
  if (!buffer.length || buffer.length > 12 * 1024 * 1024) throw new Error('Visual image must be 1 byte–12 MB');
  return scheduler.run(async () => {
    const { pipeline, RawImage, env } = await import('@huggingface/transformers');
    let model: any;
    if (options.offline) {
      model = await preloadBundledCatalogVisualModel();
    } else {
      const offline = process.env.NODE_ENV === 'production' || process.env.CATALOG_VISUAL_OFFLINE === 'true';
      if (offline) {
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        env.useFSCache = false;
      }
      modelPromise ??= pipeline('image-feature-extraction', offline ? bundledVisualModelPath() : MODEL_ID, {
        revision: MODEL_REVISION, device: 'cpu', dtype: 'q8',
        local_files_only: offline,
        session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
      }).catch(error => { modelPromise = undefined; throw error; });
      model = await modelPromise;
    }
    // Decode with explicit pixel cap, apply orientation and retain the entire card.
    const { data, info } = await sharp(buffer, { limitInputPixels: 24_000_000 })
      .rotate().resize(224, 224, { fit: 'contain', background: '#777777' })
      .removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    const output = await model(new RawImage(new Uint8ClampedArray(data), info.width, info.height, 3));
    // [batch, 257 tokens, 384]; first token is CLS. Never average CLS with patches.
    if (output.dims?.[2] !== VECTOR_DIMENSIONS) throw new Error('Unexpected DINO output shape');
    return normalizeVisualVector(output.data.slice(0, VECTOR_DIMENSIONS));
  }, priority);
}

/** Convenience wrapper only: q8 inference MUST remain single-image because
 * tensor batches change dynamic quantization scales. Yield to scans per image.
 */
export async function embedCatalogVisualImages(buffers: Buffer[], priority: 'scan' | 'background' = 'background'): Promise<number[][]> {
  if (!buffers.length || buffers.length > 16) throw new Error('Visual batch must contain 1–16 images');
  if (buffers.some(buffer => !buffer.length || buffer.length > 12 * 1024 * 1024)) throw new Error('Visual image must be 1 byte–12 MB');
  const vectors: number[][] = [];
  for (const buffer of buffers) vectors.push(await embedCatalogVisualImage(buffer, priority));
  return vectors;
}