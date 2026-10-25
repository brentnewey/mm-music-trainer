// Dev helper: list music tracks discovered for each game.
import fs from 'node:fs';
import { GAMES } from '../src/games';
import { discoverTracks } from '../src/song/discover';
import { analyzeSong, FRAME_SECONDS } from '../src/song/analyze';

for (const game of GAMES) {
  const image = new Uint8Array(fs.readFileSync(`roms/nsf/${game.id}.bin`));
  const t = performance.now();
  const tracks = discoverTracks(image, game.driver, game.probeIds);
  const ms = performance.now() - t;
  console.log(`${game.title}: ${tracks.length} tracks (${ms.toFixed(0)}ms)`);
  for (const tr of tracks) {
    const a = analyzeSong(image, game.driver, tr.id);
    const counts = [0, 1, 2].map((c) => a.notes.filter((n) => n.ch === c && n.end - n.start >= 3).length);
    console.log(`  ${tr.id.toString(16).padStart(2, '0')} ${tr.kind.padEnd(6)} len=${(a.endFrame * FRAME_SECONDS).toFixed(1)}s loop@${a.loopStart >= 0 ? (a.loopStart * FRAME_SECONDS).toFixed(1) : '-'} notes(p1/p2/tri)=${counts.join('/')}`);
  }
}
