// Dev helper: disassemble a region of an extracted NSF blob.
// Usage: npm run probe -- <game> <loadAddr hex> <startAddr hex> [count]
import fs from 'node:fs';
import { disasm } from '../src/emu/cpu6502';

const [game, loadHex, startHex, countStr] = process.argv.slice(2);
const blob = fs.readFileSync(`roms/nsf/${game}.bin`);
const load = parseInt(loadHex, 16);
const read = (a: number) => blob[a - load] ?? 0;
let pc = parseInt(startHex, 16);
for (let i = 0; i < Number(countStr ?? 30); i++) {
  const [text, len] = disasm(read, pc);
  const bytes = [...Array(len)].map((_, k) => read(pc + k).toString(16).padStart(2, '0')).join(' ');
  console.log(`$${pc.toString(16)}  ${bytes.padEnd(9)} ${text}`);
  pc += len;
}
