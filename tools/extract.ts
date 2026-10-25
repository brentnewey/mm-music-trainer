// Writes the ROMs and NSF driver blobs from Proteus.exe to disk (for dev/inspection).
// Usage: npm run extract -- [path/to/Proteus.exe] [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { extractFromProteus } from '../src/rom/extract';

const DEFAULT_EXE = 'C:/Program Files (x86)/Steam/steamapps/common/Suzy/Proteus.exe';
const exePath = process.argv[2] ?? DEFAULT_EXE;
const outDir = process.argv[3] ?? 'roms';

fs.mkdirSync(path.join(outDir, 'nsf'), { recursive: true });
for (const item of extractFromProteus(new Uint8Array(fs.readFileSync(exePath)))) {
  const file = item.kind === 'rom' ? path.join(outDir, `${item.game}.nes`) : path.join(outDir, 'nsf', `${item.game}.bin`);
  fs.writeFileSync(file, item.data);
  console.log(`${item.kind} ${item.game}  @0x${item.offset.toString(16)}  ${item.data.length} bytes -> ${file}`);
}
