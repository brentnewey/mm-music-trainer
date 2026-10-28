// Dev helper: print the suggested fingering for a track.
// Usage: npx tsx tools/fingering.ts <game> <soundIdHex> [right|lh|both] [count]
import fs from 'node:fs';
import { GAMES } from '../src/games';
import { analyzeSong } from '../src/song/analyze';
import { buildPart } from '../src/song/targets';
import { assignFingering } from '../src/song/fingering';
import { noteName } from '../src/game/highway';
import { CHARTS, SCORE_RUN_RULES } from '../src/scores';

const [gameId = 'mm2', idHex = '0', chartId = 'right', count = '48'] = process.argv.slice(2);
const game = GAMES.find((g) => g.id === gameId)!;
const chart = CHARTS.find((c) => c.id === chartId)!;
const image = new Uint8Array(fs.readFileSync(`roms/nsf/${game.id}.bin`));
const a = analyzeSong(image, game.driver, parseInt(idHex, 16));
const notes = buildPart(a, chart.id, { minFrames: SCORE_RUN_RULES.minNoteFrames, speed: 1, octaveShift: 0, track: `${gameId}:${idHex.padStart(2, '0')}` });
const t = performance.now();
assignFingering(notes);
console.log(`${notes.length} notes fingered in ${(performance.now() - t).toFixed(1)} ms`);

// Fast moves that reuse a finger on a different key are the clearest sign of a bad fingering
let reused = 0;
for (const hand of [notes.filter((n) => n.hand !== 'L'), notes.filter((n) => n.hand === 'L')]) {
  for (let i = 1; i < hand.length; i++) {
    const [p, n] = [hand[i - 1], hand[i]];
    if (n.time - p.time < 0.3 && n.time - p.time > 0.04 && n.finger === p.finger && n.midi !== p.midi) reused++;
  }
}
console.log(`fast same-finger moves: ${reused}`);
for (const n of notes.slice(0, Number(count))) {
  console.log(`${n.time.toFixed(2).padStart(7)}s  ${n.hand}  ${noteName(n.midi).padEnd(4)} ${n.finger}`);
}
