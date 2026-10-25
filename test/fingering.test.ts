import { describe, expect, it } from 'vitest';
import { assignFingering } from '../src/song/fingering';
import type { TargetNote } from '../src/game/judge';

/** Notes at a steady 4 per second */
const seq = (pitches: number[], ch = 0, start = 0): TargetNote[] =>
  pitches.map((midi, i) => ({ midi, time: start + i * 0.25, duration: 0.2, ch }));
const fingers = (notes: TargetNote[]) => notes.map((n) => n.finger);

const C_MAJOR = [60, 62, 64, 65, 67, 69, 71, 72];

describe('assignFingering', () => {
  it('fingers a five-finger position 1-2-3-4-5', () => {
    const n = seq([60, 62, 64, 65, 67, 65, 64, 62, 60]);
    assignFingering(n);
    expect(fingers(n)).toEqual([1, 2, 3, 4, 5, 4, 3, 2, 1]);
  });

  it('fingers a C major scale with the thumb passing under after E', () => {
    const n = seq(C_MAJOR);
    assignFingering(n);
    expect(fingers(n)).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
  });

  it('mirrors the left hand: thumb on top, 5-4-3-2-1 then crossing 3 over', () => {
    const n = seq(C_MAJOR.map((p) => p - 12), 2);
    assignFingering(n);
    expect(fingers(n)).toEqual([5, 4, 3, 2, 1, 3, 2, 1]);
  });

  it.each([
    ['C major descending, right hand', [72, 71, 69, 67, 65, 64, 62, 60], 0, [5, 4, 3, 2, 1, 3, 2, 1]],
    ['F major, right hand (4 on B flat, thumb on C)', [65, 67, 69, 70, 72, 74, 76, 77], 0, [1, 2, 3, 4, 1, 2, 3, 4]],
    ['C major two octaves, right hand', [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84], 0, [1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5]],
    ['C major descending, left hand', [60, 59, 57, 55, 53, 52, 50, 48], 2, [1, 2, 3, 1, 2, 3, 4, 5]],
    ['C arpeggio, right hand', [60, 64, 67, 72, 67, 64, 60], 0, [1, 2, 3, 5, 3, 2, 1]],
    ['C arpeggio, left hand', [48, 52, 55, 60, 55, 52, 48], 2, [5, 3, 2, 1, 2, 3, 5]],
  ])('matches the textbook fingering: %s', (_name, pitches, ch, expected) => {
    const n = seq(pitches as number[], ch as number);
    assignFingering(n);
    expect(fingers(n)).toEqual(expected);
  });

  it('gives chords distinct fingers in pitch order per hand', () => {
    const n: TargetNote[] = [
      { midi: 60, time: 0, duration: 0.5, ch: 0 }, { midi: 64, time: 0.01, duration: 0.5, ch: 1 },
      { midi: 48, time: 0, duration: 0.5, ch: 2 },
    ];
    assignFingering(n);
    const [low, high, bass] = n.map((x) => x.finger!);
    expect(low).toBeLessThan(high);
    expect(bass).toBeGreaterThanOrEqual(1);
  });

  it('never reuses a finger on a different key for fast consecutive notes', () => {
    const n = seq([60, 64, 67, 72, 67, 64, 60, 62, 65, 69, 74, 69, 65, 62]);
    assignFingering(n);
    for (let i = 1; i < n.length; i++) {
      if (n[i].midi !== n[i - 1].midi) expect(n[i].finger).not.toBe(n[i - 1].finger);
    }
  });

  it('avoids the thumb on black keys in an E major scale', () => {
    const n = seq([64, 66, 68, 69, 71, 73, 75, 76]);
    assignFingering(n);
    for (const x of n) if ([66, 68, 73, 75].includes(x.midi)) expect(x.finger).not.toBe(1);
  });
});
