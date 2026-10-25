// Dev helper: difficulty ratings for every chart of every discovered song.
// Usage: npx tsx tools/difficulty.ts [speed]
import fs from 'node:fs';
import { GAMES } from '../src/games';
import { discoverTracks } from '../src/song/discover';
import { analyzeSong } from '../src/song/analyze';
import { buildTargets } from '../src/song/targets';
import { rateDifficulty } from '../src/song/difficulty';
import { CHARTS, SCORE_RUN_RULES } from '../src/scores';

const speed = Number(process.argv[2] ?? 1);
const all: Record<string, number[]> = {};
for (const game of GAMES) {
  const image = new Uint8Array(fs.readFileSync(`roms/nsf/${game.id}.bin`));
  console.log(game.title);
  for (const tr of discoverTracks(image, game.driver, game.probeIds)) {
    if (tr.kind !== 'song') continue;
    const a = analyzeSong(image, game.driver, tr.id);
    const cells = CHARTS.map((c) => {
      const d = rateDifficulty(buildTargets(a, c.parts, { minFrames: SCORE_RUN_RULES.minNoteFrames, speed, octaveShift: 0 }));
      if (!d.rating) return `${c.id.padEnd(4)}   -  `;
      (all[c.id] ??= []).push(d.rating);
      return `${c.id.padEnd(4)}${d.rating.toFixed(1).padStart(5)} (${d.nps.toFixed(1)}/${d.peakNps.toFixed(1)}nps ${d.leap.toFixed(1)}st ${Math.round(d.chordShare * 100)}%ch)`;
    });
    console.log(`  ${tr.id.toString(16).padStart(2, '0')}  ${cells.join('  ')}`);
  }
}
for (const [c, v] of Object.entries(all)) {
  v.sort((a, b) => a - b);
  const q = (p: number) => v[Math.floor(p * (v.length - 1))].toFixed(1);
  console.log(`${c}: min ${q(0)} p25 ${q(0.25)} median ${q(0.5)} p75 ${q(0.75)} max ${q(1)}`);
}
