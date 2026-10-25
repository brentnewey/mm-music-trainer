import { describe, expect, it } from 'vitest';
import { assignHands, melodyLine } from '../src/song/hands';
import type { TargetNote } from '../src/game/judge';

/** A channel playing the given pitches in turn, 4 notes a second, for `seconds` */
const part = (ch: number, pitches: number[], seconds: number, start = 0): TargetNote[] =>
  Array.from({ length: seconds * 4 }, (_, i) => ({ midi: pitches[i % pitches.length], time: start + i / 4, duration: 0.2, ch }));
const handsOf = (notes: TargetNote[], ch: number) => new Set(notes.filter((n) => n.ch === ch).map((n) => n.hand));

describe('assignHands', () => {
  it('gives the usual layout: pulses to the right hand, a low triangle to the left', () => {
    const notes = [...part(0, [72, 74, 76], 10), ...part(1, [67, 69], 10), ...part(2, [45, 52], 10)];
    assignHands(notes);
    expect(handsOf(notes, 0)).toEqual(new Set(['R']));
    expect(handsOf(notes, 1)).toEqual(new Set(['R']));
    expect(handsOf(notes, 2)).toEqual(new Set(['L']));
  });

  it('follows register, not channel: a pulse bass under the triangle goes to the left hand', () => {
    // Needle Man's intro: Pulse 1 plays a riff around A#2 while the triangle plays around C5
    const notes = [...part(0, [46, 49, 51], 10), ...part(2, [70, 72, 73], 10)];
    assignHands(notes);
    expect(handsOf(notes, 0)).toEqual(new Set(['L']));
    expect(handsOf(notes, 2)).toEqual(new Set(['R']));
  });

  it('swaps hands when the channels swap roles, at a gap in the notes', () => {
    const notes = [
      ...part(0, [46, 49], 8), ...part(2, [70, 72], 8),
      ...part(0, [72, 76], 8, 9), ...part(2, [45, 48], 8, 9),
    ];
    assignHands(notes);
    const p1 = notes.filter((n) => n.ch === 0);
    expect(p1.filter((n) => n.time < 8).every((n) => n.hand === 'L')).toBe(true);
    expect(p1.filter((n) => n.time >= 9).every((n) => n.hand === 'R')).toBe(true);
  });

  it('never leaves three parts in one hand when they share a register', () => {
    // Pulse 2 and the triangle sit together around F4, under a high Pulse 1
    const notes = [...part(0, [79, 81], 10), ...part(1, [65, 67], 10), ...part(2, [64, 66], 10)];
    assignHands(notes);
    const left = [0, 1, 2].filter((ch) => handsOf(notes, ch).has('L'));
    expect(left.length).toBeGreaterThanOrEqual(1);
    expect(handsOf(notes, 0)).toEqual(new Set(['R']));
  });

  it('judges register before an octave shift', () => {
    const notes = part(2, [45, 48], 6).map((n) => ({ ...n, midi: n.midi + 24 }));
    assignHands(notes, 1, 24);
    expect(handsOf(notes, 2)).toEqual(new Set(['L']));
  });
});

describe('melodyLine', () => {
  it('keeps the top line and drops the harmony under it', () => {
    const notes = [...part(0, [76, 79], 6), ...part(1, [67, 71], 6)];
    expect(new Set(melodyLine(notes).map((n) => n.ch))).toEqual(new Set([0]));
  });

  it('does not hand the melody to an echo channel at the same pitch', () => {
    const lead = part(0, [72, 74, 76], 8);
    const echo = lead.map((n) => ({ ...n, ch: 1, time: n.time + 0.1 }));
    expect(new Set(melodyLine([...lead, ...echo]).map((n) => n.ch))).toEqual(new Set([0]));
  });
});
