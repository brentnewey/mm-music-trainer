import type { DiscoveredTrack } from '../song/discover';
import type { RenderParams, SongAnalysis } from '../song/analyze';

export type WorkerRequest =
  | { seq: number; type: 'load'; game: string; image: Uint8Array }
  | { seq: number; type: 'discover'; game: string }
  | { seq: number; type: 'analyze'; game: string; id: number }
  | { seq: number; type: 'render'; game: string; id: number; params: RenderParams };

export type WorkerResponse =
  | { seq: number; type: 'ok' }
  | { seq: number; type: 'progress'; value: number }
  | { seq: number; type: 'discovered'; tracks: DiscoveredTrack[] }
  | { seq: number; type: 'analyzed'; analysis: SongAnalysis }
  | { seq: number; type: 'rendered'; pcm: Float32Array }
  | { seq: number; type: 'error'; message: string };

type Body<T> = T extends unknown ? Omit<T, 'seq'> : never;

/** Promise-based client for the song worker. */
export class SongWorkerClient {
  private worker = new Worker(new URL('./song.worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (v: number) => void }>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.seq);
      if (!p) return;
      if (msg.type === 'progress') { p.onProgress?.(msg.value); return; }
      this.pending.delete(msg.seq);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
  }

  private send<R extends WorkerResponse>(body: Body<WorkerRequest>, onProgress?: (v: number) => void): Promise<R> {
    const seq = ++this.seq;
    return new Promise<R>((resolve, reject) => {
      this.pending.set(seq, { resolve: resolve as (r: WorkerResponse) => void, reject, onProgress });
      this.worker.postMessage({ ...body, seq });
    });
  }

  load(game: string, image: Uint8Array) { return this.send({ type: 'load', game, image }); }

  async discover(game: string, onProgress?: (v: number) => void) {
    return (await this.send<Extract<WorkerResponse, { type: 'discovered' }>>({ type: 'discover', game }, onProgress)).tracks;
  }

  async analyze(game: string, id: number) {
    return (await this.send<Extract<WorkerResponse, { type: 'analyzed' }>>({ type: 'analyze', game, id })).analysis;
  }

  async render(game: string, id: number, params: RenderParams) {
    return (await this.send<Extract<WorkerResponse, { type: 'rendered' }>>({ type: 'render', game, id, params })).pcm;
  }
}
