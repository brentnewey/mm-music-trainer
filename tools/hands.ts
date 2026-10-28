// Dev helper: show which hand plays each channel over time.
// Usage: npx tsx tools/hands.ts <game> <soundIdHex> [right|lh|both]
// Hands follow the channels unless the song has rules in src/song/handOverrides.ts.
import fs from 'node:fs';
import { GAMES } from '../src/games';
import { analyzeSong } from '../src/song/analyze';
import { buildPart } from '../src/song/targets';
import { noteName } from '../src/game/highway';
import { CHARTS, SCORE_RUN_RULES } from '../src/scores';
import type { TargetNote } from '../src/game/judge';

const NAMES = ['P1', 'P2', 'Tri'];

function timeline(notes: TargetNote[], step = 2) {
  const end = Math.max(...notes.map((n) => n.time));
  for (let t = 0; t <= end; t += step) {
    const cells = [0, 1, 2].map((ch) => {
      const ns = notes.filter((n) => n.ch === ch && n.time >= t && n.time < t + step);
      if (!ns.length) return ''.padEnd(16);
      const hands = [...new Set(ns.map((n) => n.hand))].join('');
      const ps = ns.map((n) => n.midi).sort((a, b) => a - b);
      return `${hands.padEnd(2)} ${noteName(ps[0])}-${noteName(ps[ps.length - 1])}`.padEnd(16);
    });
    console.log(`${t.toFixed(0).padStart(4)}s  ${cells.map((c, i) => `${NAMES[i]} ${c}`).join(' | ')}`);
  }
}

const [gameId = 'mm3', idHex = '1', chartId = 'both'] = process.argv.slice(2);
const game = GAMES.find((g) => g.id === gameId)!;
const image = new Uint8Array(fs.readFileSync(`roms/nsf/${game.id}.bin`));
const chart = CHARTS.find((c) => c.id === chartId)!;
const opts = { minFrames: SCORE_RUN_RULES.minNoteFrames, speed: 1, octaveShift: 0, track: `${gameId}:${idHex.padStart(2, '0')}` };
timeline(buildPart(analyzeSong(image, game.driver, parseInt(idHex, 16)), chart.id, opts));
