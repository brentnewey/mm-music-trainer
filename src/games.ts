import type { DriverSpec } from './emu/nsf';

export interface GameInfo {
  id: string;
  title: string;
  driver: DriverSpec;
  /** Sound ids to probe when discovering music tracks */
  probeIds: number[];
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const GAMES: GameInfo[] = [
  // MM1's jukebox stub at $9003 maps index 0-15 through a table to driver ids
  { id: 'mm1', title: 'Mega Man', driver: { load: 0x9000, play: 0x9000, request: 0x9003 }, probeIds: range(0, 15) },
  { id: 'mm2', title: 'Mega Man 2', driver: { load: 0x8000, play: 0x8000, request: 0x8003, setup: 0xc0f0 }, probeIds: range(0, 0x3f) },
  { id: 'mm3', title: 'Mega Man 3', driver: { load: 0x8000, play: 0x8000, request: 0x8003 }, probeIds: range(0, 0x3f) },
  { id: 'mm4', title: 'Mega Man 4', driver: { load: 0x8000, play: 0x8000, request: 0x8003 }, probeIds: range(0, 0x3f) },
  { id: 'mm5', title: 'Mega Man 5', driver: { load: 0x8000, play: 0x8000, request: 0x8003 }, probeIds: range(0, 0x3f) },
  { id: 'mm6', title: 'Mega Man 6', driver: { load: 0x8000, play: 0x8000, request: 0x8003 }, probeIds: range(0, 0x3f) },
];
