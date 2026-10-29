import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findLoop, findLoopFuzzy, analyzeSong, periodToMidi, extractChannelNotes } from '../src/song/analyze';
import type { FrameSnapshot } from '../src/emu/nsf';
import { buildPart } from '../src/song/targets';
import { buildTargets } from '../src/song/targets';
import { GAMES } from '../src/games';

function periodic(intro: number[], body: number[], repeats: number) {
  return Uint32Array.from([...intro, ...Array.from({ length: repeats }, () => body).flat()]);
}

describe('loop detection', () => {
  it('finds an exact loop after an intro', () => {
    const body = Array.from({ length: 200 }, (_, i) => (i * 7) % 13);
    const seq = periodic([99, 98, 97], body, 5);
    expect(findLoop(seq, 50)).toEqual({ start: 3, length: 200 });
  });

  it('is not fooled by a phrase that repeats twice at the end', () => {
    const body = Array.from({ length: 400 }, (_, i) => (i < 300 ? i : 1000 + (i % 50)));
    const seq = periodic([], body, 4);
    expect(findLoop(seq, 20)?.length).toBe(400);
  });

  it('tolerates one-frame jitter between loop passes', () => {
    // A loop of ~300.5 frames: every other pass is one frame longer
    const pass = (extra: boolean) => Array.from({ length: extra ? 301 : 300 }, (_, i) => Math.floor(i / (extra ? 10.04 : 10)) + 1);
    const seq = Uint32Array.from([...Array(17).fill(500), ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((k) => pass(k % 2 === 1))]);
    const loop = findLoopFuzzy(seq, 100)!;
    expect(loop.length).toBeGreaterThanOrEqual(300);
    expect(loop.length).toBeLessThanOrEqual(301);
    expect(loop.start).toBeLessThanOrEqual(20);
  });
});

describe('periodToMidi', () => {
  it('maps NES timer periods to pitches', () => {
    expect(periodToMidi(0, 253)).toBeCloseTo(69, 0); // A4 on pulse
    expect(periodToMidi(2, 126)).toBeCloseTo(69, 0); // A4 on triangle (octave lower per period)
  });
});

describe('note segmentation', () => {
  // Pulse 1 frames from [volume, triggered] pairs, all at A4 (period 253); volume 0 is silent
  const pulse = (frames: [number, boolean?][]): FrameSnapshot[] => frames.map(([volume, triggered = false]) => {
    const c = { period: 253, volume, audible: volume > 0, triggered, duty: 2 };
    return [c, c, c, c];
  });
  const spans = (snaps: FrameSnapshot[]) => extractChannelNotes(snaps, 0, snaps.length).map((n) => [n.start, n.end]);

  it('holds a note through tremolo: one-frame silences and small swells after the attack', () => {
    // Top Man at 0:19: struck at 10, then fluttering 3-5 with a silent frame every 4
    const note = [[10, true], [4], [0], [4], [5], [4], [0], [3], [5], [5], [0], [3]] as [number, boolean?][];
    expect(spans(pulse([...note, ...note]))).toEqual([[0, 12], [12, 24]]);
  });

  it('still splits repeated notes at a short rest when they come back as loud', () => {
    expect(spans(pulse([[8, true], [6], [0], [8], [6], [0], [8], [6]]))).toEqual([[0, 2], [3, 5], [6, 8]]);
  });

  it('still splits at a re-attack without a trigger', () => {
    expect(spans(pulse([[10, true], [6], [4], [10], [6], [4]]))).toEqual([[0, 3], [3, 6]]);
  });
});

// Integration checks against the real game data, when it has been extracted locally
const hasRoms = fs.existsSync('roms/nsf/mm2.bin');
describe.skipIf(!hasRoms)('real drivers', () => {
  const load = (id: string) => new Uint8Array(fs.readFileSync(`roms/nsf/${id}.bin`));

  it('detects the MM2 track 1 loop (8s intro, 32s loop)', () => {
    const g = GAMES.find((x) => x.id === 'mm2')!;
    const a = analyzeSong(load('mm2'), g.driver, 1);
    expect(a.loopStart).toBe(480);
    expect(a.endFrame).toBe(480 + 1920);
  });

  it('finds a loop for a fractional-tempo MM6 song', () => {
    const g = GAMES.find((x) => x.id === 'mm6')!;
    const a = analyzeSong(load('mm6'), g.driver, 0);
    expect(a.loopStart).toBeGreaterThanOrEqual(0);
    expect(a.endFrame - a.loopStart).toBeGreaterThan(3000);
    expect(a.endFrame - a.loopStart).toBeLessThan(3200);
  });

  it("keeps Top Man's tremolo melody at 0:19 as whole notes (MM3)", () => {
    const g = GAMES.find((x) => x.id === 'mm3')!;
    const a = analyzeSong(load('mm3'), g.driver, 5);
    const melody = buildPart(a, 'p1', { minFrames: 4, speed: 1, octaveShift: 0 }).filter((n) => n.time > 18.6 && n.time < 20.9);
    expect(melody.map((n) => n.midi)).toEqual([74, 76, 77, 84, 83, 79, 79]); // D5 E5 F5 C6 B5 G5 G5
    expect(melody.every((n) => n.duration > 0.3)).toBe(true);
  });

  it('builds playable targets', () => {
    const g = GAMES.find((x) => x.id === 'mm2')!;
    const a = analyzeSong(load('mm2'), g.driver, 1);
    const t = buildTargets(a, [0], { minFrames: 4, speed: 0.5, octaveShift: 0 });
    expect(t.length).toBeGreaterThan(50);
    expect(t.every((n, i) => i === 0 || n.time >= t[i - 1].time)).toBe(true);
    expect(t[t.length - 1].time).toBeLessThan((a.endFrame / 60.0988) * 2 + 0.01);
  });
});
