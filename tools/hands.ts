// Dev helper: show which hand plays each channel over time, or summarize all songs.
// Usage: npx tsx tools/hands.ts <game> <soundIdHex> [rh|rhc|lh|both]
//        npx tsx tools/hands.ts --summary
import fs from 'node:fs';
import { GAMES } from '../src/games';
import { analyzeSong } from '../src/song/analyze';
import { discoverTracks } from '../src/song/discover';
import { buildPart, buildTargets } from '../src/song/targets';
import { noteName } from '../src/game/highway';
import { CHARTS, SCORE_RUN_RULES } from '../src/scores';
import type { TargetNote } from '../src/game/judge';

const NAMES = ['P1', 'P2', 'Tri'];
const opts = { minFrames: SCORE_RUN_RULES.minNoteFrames, speed: 1, octaveShift: 0 };
const names: Record<string, string> = fs.existsSync('track-names.json') ? JSON.parse(fs.readFileSync('track-names.json', 'utf8')) : {};

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

if (process.argv[2] === '--summary') {
  // Share of each channel's notes given to the "unexpected" hand in the full arrangement
  for (const game of GAMES) {
    const image = new Uint8Array(fs.readFileSync(`roms/nsf/${game.id}.bin`));
    for (const tr of discoverTracks(image, game.driver, game.probeIds)) {
      if (tr.kind !== 'song') continue;
      const notes = buildTargets(analyzeSong(image, game.driver, tr.id), [0, 1, 2], opts);
      const share = (ch: number, hand: string) => {
        const ns = notes.filter((n) => n.ch === ch);
        return ns.length ? Math.round((100 * ns.filter((n) => n.hand === hand).length) / ns.length) : 0;
      };
      const odd = [share(0, 'L'), share(1, 'L'), share(2, 'R')];
      if (odd.some((x) => x >= 10)) {
        const id = tr.id.toString(16).padStart(2, '0');
        console.log(`${game.id}:${id} ${(names[`${game.id}:${id}`] ?? '').padEnd(20)} P1→L ${odd[0]}%  P2→L ${odd[1]}%  Tri→R ${odd[2]}%`);
      }
    }
  }
} else {
  const [gameId = 'mm3', idHex = '1', chartId = 'both'] = process.argv.slice(2);
  const game = GAMES.find((g) => g.id === gameId)!;
  const image = new Uint8Array(fs.readFileSync(`roms/nsf/${game.id}.bin`));
  const chart = CHARTS.find((c) => c.id === chartId)!;
  timeline(buildPart(analyzeSong(image, game.driver, parseInt(idHex, 16)), chart.id, opts));
}
