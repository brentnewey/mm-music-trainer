// Extracts the NES ROMs and the jukebox NSF driver blobs embedded in the
// Mega Man Legacy Collection executable (Steam app 363440, "Suzy" folder).
//
// Layout inside Proteus.exe .rdata: each item is stored as
//   [raw data][C++ descriptor struct][NUL-terminated name label]
// ROM descriptors are 0x30 bytes, NSF descriptors are 0x34 bytes, and NSF
// data begins (8-byte aligned) right after the previous item's label.

export interface ExtractedItem {
  kind: 'rom' | 'nsf';
  game: string;
  offset: number;
  data: Uint8Array;
}

// PRG/CHR sizes in bytes, mapper number, mirroring (1 = vertical)
const ROMS: Record<string, { id: string; mapper: number; prg: number; chr: number; mirror: number }> = {
  MegaMan: { id: 'mm1', mapper: 2, prg: 0x20000, chr: 0, mirror: 1 },
  MegaMan2: { id: 'mm2', mapper: 1, prg: 0x40000, chr: 0, mirror: 0 },
  MegaMan3: { id: 'mm3', mapper: 4, prg: 0x40000, chr: 0x20000, mirror: 0 },
  MegaMan4: { id: 'mm4', mapper: 4, prg: 0x80000, chr: 0, mirror: 0 },
  MegaMan5: { id: 'mm5', mapper: 4, prg: 0x40000, chr: 0x40000, mirror: 0 },
  MegaMan6: { id: 'mm6', mapper: 4, prg: 0x80000, chr: 0, mirror: 0 },
};

function inesHeader({ mapper, prg, chr, mirror }: (typeof ROMS)[string]) {
  const h = new Uint8Array(16);
  h.set([0x4e, 0x45, 0x53, 0x1a]);
  h[4] = prg / 0x4000;
  h[5] = chr / 0x2000;
  h[6] = ((mapper & 0x0f) << 4) | mirror;
  h[7] = mapper & 0xf0;
  return h;
}

interface Label { offset: number; end: number; nsf: boolean; region: string; name: string }

function findLabels(exe: Uint8Array): Label[] {
  // latin1 decoding keeps byte offsets 1:1 with string indices
  const text = new TextDecoder('latin1').decode(exe);
  const re = /(NSF)?(MegaMan|Rockman)([1-6]?)\x00/g;
  const labels: Label[] = [];
  for (let m; (m = re.exec(text)); ) {
    labels.push({ offset: m.index, end: m.index + m[0].length, nsf: !!m[1], region: m[2], name: m[2] + m[3] });
  }
  return labels;
}

/** Extracts US ROMs (with iNES headers) and NSF driver blobs. */
export function extractFromProteus(exe: Uint8Array, kinds: ('rom' | 'nsf')[] = ['rom', 'nsf']): ExtractedItem[] {
  const labels = findLabels(exe);
  const items: ExtractedItem[] = [];
  labels.forEach((lab, i) => {
    if (lab.region !== 'MegaMan' || !kinds.includes(lab.nsf ? 'nsf' : 'rom')) return;
    const rom = ROMS[lab.name];
    if (!rom) return;
    const dataEnd = lab.offset - (lab.nsf ? 0x34 : 0x30);
    if (lab.nsf) {
      if (i === 0) return;
      const dataStart = (labels[i - 1].end + 7) & ~7;
      items.push({ kind: 'nsf', game: rom.id, offset: dataStart, data: exe.slice(dataStart, dataEnd) });
    } else {
      const start = dataEnd - rom.prg - rom.chr;
      if (start < 0) return;
      const data = new Uint8Array(16 + rom.prg + rom.chr);
      data.set(inesHeader(rom));
      data.set(exe.subarray(start, dataEnd), 16);
      items.push({ kind: 'rom', game: rom.id, offset: start, data });
    }
  });
  const nsfCount = items.filter((x) => x.kind === 'nsf').length;
  if (kinds.includes('nsf') && nsfCount !== 6) {
    throw new Error(`Expected 6 sound drivers in Proteus.exe, found ${nsfCount}. Is this the Mega Man Legacy Collection (1) executable?`);
  }
  return items;
}
