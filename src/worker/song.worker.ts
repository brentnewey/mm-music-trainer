// Runs driver emulation off the main thread: discovery, analysis and rendering.
import { GAMES } from '../games';
import { discoverTracks } from '../song/discover';
import { analyzeSong, renderSong, type RenderParams } from '../song/analyze';
import type { WorkerRequest, WorkerResponse } from './protocol';

const images = new Map<string, Uint8Array>();

function reply(msg: WorkerResponse, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(msg, transfer);
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'load') {
      images.set(req.game, req.image);
      reply({ seq: req.seq, type: 'ok' });
      return;
    }
    const game = GAMES.find((g) => g.id === req.game);
    const image = images.get(req.game);
    if (!game || !image) throw new Error(`Game ${req.game} not loaded`);
    if (req.type === 'discover') {
      const tracks = discoverTracks(image, game.driver, game.probeIds, (done) =>
        reply({ seq: req.seq, type: 'progress', value: done / game.probeIds.length }),
      );
      reply({ seq: req.seq, type: 'discovered', tracks });
    } else if (req.type === 'analyze') {
      reply({ seq: req.seq, type: 'analyzed', analysis: analyzeSong(image, game.driver, req.id) });
    } else if (req.type === 'render') {
      const pcm = renderSong(image, game.driver, req.id, req.params as RenderParams);
      const copy = pcm.slice(); // subarray views can't be transferred on their own
      reply({ seq: req.seq, type: 'rendered', pcm: copy }, [copy.buffer]);
    }
  } catch (err) {
    reply({ seq: req.seq, type: 'error', message: (err as Error).message });
  }
};
