// Dev helper: analyze a track, print its notes and write a WAV.
// Usage: npx tsx tools/render.ts <game> <id hex> [outFile]
import fs from 'node:fs';
import { GAMES } from '../src/games';
import { analyzeSong, renderSong, FRAME_SECONDS } from '../src/song/analyze';

const [gameId, idHex, outFile] = process.argv.slice(2);
const game = GAMES.find((g) => g.id === gameId)!;
const image = new Uint8Array(fs.readFileSync(`roms/nsf/${game.id}.bin`));
const id = parseInt(idHex, 16);
let t = performance.now();
const a = analyzeSong(image, game.driver, id);
console.log(`analyzed in ${(performance.now() - t).toFixed(0)}ms: loopStart=${(a.loopStart * FRAME_SECONDS).toFixed(2)}s end=${(a.endFrame * FRAME_SECONDS).toFixed(2)}s notes=${a.notes.length}`);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const name = (m: number) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
for (let ch = 0; ch < 3; ch++) {
  const ns = a.notes.filter((n) => n.ch === ch);
  const lens = new Map<number, number>();
  ns.forEach((n) => lens.set(n.end - n.start, (lens.get(n.end - n.start) ?? 0) + 1));
  console.log(`ch${ch}: ${ns.length} notes, range ${name(Math.min(...ns.map((n) => n.midi)))}-${name(Math.max(...ns.map((n) => n.midi)))}; common lengths ${[...lens].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([l, c]) => `${l}f×${c}`).join(' ')}`);
  console.log('   ' + ns.slice(0, 24).map((n) => `${name(n.midi)}@${n.start}+${n.end - n.start}`).join(' '));
}
if (outFile) {
  t = performance.now();
  const sr = 44100;
  const pcm = renderSong(image, game.driver, id, { sampleRate: sr, gains: [1, 1, 1, 1, 1], speed: 1, endFrame: a.endFrame, fadeSeconds: a.loopStart >= 0 ? 4 : 0 });
  console.log(`rendered ${(pcm.length / sr).toFixed(1)}s in ${(performance.now() - t).toFixed(0)}ms`);
  const buf = Buffer.alloc(44 + pcm.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 1.6 * 32767))), 44 + i * 2);
  fs.writeFileSync(outFile, buf);
}
