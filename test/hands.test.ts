import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assignHands } from '../src/song/hands';
import type { TargetNote } from '../src/game/judge';
import { GAMES } from '../src/games';
import { analyzeSong } from '../src/song/analyze';
import { buildPart } from '../src/song/targets';

/** A channel playing the given pitches in turn, 4 notes a second, for `seconds` */
const part = (ch: number, pitches: number[], seconds: number, start = 0): TargetNote[] =>
  Array.from({ length: seconds * 4 }, (_, i) => ({ midi: pitches[i % pitches.length], time: start + i / 4, duration: 0.2, ch }));
const handsOf = (notes: TargetNote[], ch: number) => new Set(notes.filter((n) => n.ch === ch).map((n) => n.hand));

describe('assignHands', () => {
  it('gives the pulses to the right hand and the triangle to the left, whatever the register', () => {
    // Ring Man: the triangle's G4 hits sit among the pulse chords but stay in the left hand
    const notes = [...part(0, [72, 74, 76], 10), ...part(1, [62, 74], 10), ...part(2, [43, 67], 10)];
    assignHands(notes);
    expect(handsOf(notes, 0)).toEqual(new Set(['R']));
    expect(handsOf(notes, 1)).toEqual(new Set(['R']));
    expect(handsOf(notes, 2)).toEqual(new Set(['L']));
  });

  it("applies a song's override rules within their time range", () => {
    // Needle Man's intro: Pulse 1 plays the bass riff under the triangle until 16.7 s
    const notes = [...part(0, [46, 49, 51], 20), ...part(2, [70, 72, 73], 20)];
    assignHands(notes, 1, [{ ch: 0, hand: 'L', to: 16.7 }, { ch: 2, hand: 'R', to: 16.7 }]);
    const p1 = notes.filter((n) => n.ch === 0);
    expect(new Set(p1.filter((n) => n.time < 16.7).map((n) => n.hand))).toEqual(new Set(['L']));
    expect(new Set(p1.filter((n) => n.time >= 16.7).map((n) => n.hand))).toEqual(new Set(['R']));
    expect(handsOf(notes.filter((n) => n.time < 16.7), 2)).toEqual(new Set(['R']));
  });

  it('applies rules in song time, at any speed', () => {
    const notes = part(0, [46], 10).map((n) => ({ ...n, time: n.time * 2 }));
    assignHands(notes, 0.5, [{ ch: 0, hand: 'L', from: 5 }]);
    expect(notes.find((n) => n.time === 9.5)!.hand).toBe('R');
    expect(notes.find((n) => n.time === 10)!.hand).toBe('L');
  });
});

describe.skipIf(!fs.existsSync('roms/nsf/mm3.bin'))('Needle Man (MM3)', () => {
  const game = GAMES.find((g) => g.id === 'mm3')!;
  const a = analyzeSong(new Uint8Array(fs.readFileSync('roms/nsf/mm3.bin')), game.driver, 1);
  const opts = { minFrames: 4, speed: 1, octaveShift: 0, track: 'mm3:01' };

  it('plays the intro bass riff on Pulse 1 with the left hand', () => {
    const notes = buildPart(a, 'both', opts);
    const intro = notes.filter((n) => n.time < 16.7);
    expect(handsOf(intro, 0)).toEqual(new Set(['L']));
    expect(handsOf(intro, 2)).toEqual(new Set(['R']));
    expect(handsOf(notes.filter((n) => n.time >= 16.7), 0)).toEqual(new Set(['R']));
  });

  it('splits the song into parts by hand, with every note in exactly one hand', () => {
    const both = buildPart(a, 'both', opts);
    const right = buildPart(a, 'right', opts);
    const left = buildPart(a, 'lh', opts);
    expect(right.length + left.length).toBe(both.length);
    // After the intro the right hand is both pulses, every note of them
    const later = (ns: TargetNote[]) => ns.filter((n) => n.time >= 16.7);
    expect(later(right).length).toBe(later(both).filter((n) => n.ch < 2).length);
  });

  it('offers each pulse alone as an easier right hand', () => {
    const p1 = buildPart(a, 'p1', opts);
    const p2 = buildPart(a, 'p2', opts);
    expect(new Set(p1.map((n) => n.ch))).toEqual(new Set([0]));
    expect(new Set(p2.map((n) => n.ch))).toEqual(new Set([1]));
    // Pulse 1's bass riff in the intro belongs to the left hand, so it isn't in the Pulse 1 part
    expect(p1.every((n) => n.hand === 'R' && n.time >= 16.7)).toBe(true);
    // Together they cover the right hand's pulse notes, plus any unisons a full build merges
    expect(p1.length + p2.length).toBeGreaterThanOrEqual(buildPart(a, 'right', opts).filter((n) => n.ch < 2).length);
  });
});
