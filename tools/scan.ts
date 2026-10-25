// Dev helper: probe every sound id of a game and report how long it plays.
// Usage: npx tsx tools/scan.ts <game>
import fs from 'node:fs';
import { NsfPlayer } from '../src/emu/nsf';
import { GAMES } from '../src/games';

const game = GAMES.find((g) => g.id === process.argv[2])!;
const image = new Uint8Array(fs.readFileSync(`roms/nsf/${game.id}.bin`));
const player = new NsfPlayer(image, game.driver);
const MAX = 60 * 60 * 6;
for (const id of game.probeIds) {
  try {
    player.reset();
    player.requestSound(id);
    const seen = new Map<number, number>();
    let lastAudible = -1, audibleFrames = 0, loop = '';
    const chUse = [0, 0, 0, 0];
    for (let f = 0; f < MAX; f++) {
      player.tick();
      player.apu.skip(29781);
      const snap = player.snapshot();
      let any = false;
      snap.forEach((c, i) => { if (c.audible) { chUse[i]++; any = true; } });
      if (any) { lastAudible = f; audibleFrames++; }
      const h = player.stateHash();
      const prev = seen.get(h);
      if (prev !== undefined) { loop = `loop ${prev}->${f} (${((f - prev) / 60).toFixed(1)}s)`; break; }
      seen.set(h, f);
      if (f - lastAudible > 600) break;
    }
    console.log(`id ${id.toString(16).padStart(2, '0')}: audible ${(audibleFrames / 60).toFixed(1)}s last@${(lastAudible / 60).toFixed(1)}s ${loop} ch=${chUse.map((c) => (c / 60).toFixed(0)).join('/')} romWrites=${player.romWrites}`);
  } catch (e) {
    console.log(`id ${id.toString(16)}: ERROR ${(e as Error).message}`);
  }
}
