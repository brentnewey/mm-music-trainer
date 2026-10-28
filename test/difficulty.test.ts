import { describe, expect, it } from 'vitest';
import { rateDifficulty } from '../src/song/difficulty';
import type { TargetNote } from '../src/game/judge';

/** A steady line of notes on one channel */
const line = (perSecond: number, seconds: number, pitch: (i: number) => number, ch = 0): TargetNote[] =>
  Array.from({ length: perSecond * seconds }, (_, i) => ({ midi: pitch(i), time: i / perSecond, duration: 0.1, ch }));

describe('rateDifficulty', () => {
  it('rises with note density', () => {
    const slow = rateDifficulty(line(2, 20, () => 60));
    const fast = rateDifficulty(line(6, 20, () => 60));
    expect(fast.rating).toBeGreaterThan(slow.rating);
    expect(fast.nps).toBeCloseTo(6, 0);
  });

  it('rises with bigger jumps between notes', () => {
    const steps = rateDifficulty(line(4, 20, (i) => 60 + (i % 2)));
    const leaps = rateDifficulty(line(4, 20, (i) => 60 + 12 * (i % 2)));
    expect(leaps.rating).toBeGreaterThan(steps.rating);
    expect(leaps.leap).toBeCloseTo(12, 5);
  });

  it('rates a bouncing octave bass below a bass line that moves around', () => {
    // Guts Man: G2 G2 G3 over and over, thumb and little finger without moving the hand
    const rocking = rateDifficulty(line(7, 20, (i) => [43, 43, 55][i % 3], 2));
    const walking = rateDifficulty(line(7, 20, (i) => [43, 50, 55, 47, 41, 53, 45, 57, 40][i % 9], 2));
    expect(walking.rating).toBeGreaterThan(rocking.rating + 1);
  });

  it('rises with note variety at the same pace and span', () => {
    const fewNotes = rateDifficulty(line(5, 20, (i) => [60, 64, 67, 64][i % 4]));
    const manyNotes = rateDifficulty(line(5, 20, (i) => [60, 62, 64, 65, 67, 66, 63, 61][i % 8]));
    expect(manyNotes.variety).toBeGreaterThan(fewNotes.variety);
    expect(manyNotes.rating).toBeGreaterThan(fewNotes.rating);
  });

  it('rises with chords and with a second hand', () => {
    const single = rateDifficulty(line(4, 20, () => 64));
    const chords = rateDifficulty([...line(4, 20, () => 64), ...line(4, 20, () => 67, 1)]);
    const twoHands = rateDifficulty([...line(4, 20, () => 64), ...line(4, 20, () => 40, 2)]);
    expect(chords.chordShare).toBe(1);
    expect(chords.rating).toBeGreaterThan(single.rating);
    expect(twoHands.rating).toBeGreaterThan(chords.rating);
  });

  it('stays within 1–10 and handles empty charts', () => {
    expect(rateDifficulty([]).rating).toBe(0);
    expect(rateDifficulty(line(1, 4, () => 60)).rating).toBeGreaterThanOrEqual(1);
    expect(rateDifficulty([...line(12, 20, (i) => 40 + 24 * (i % 2)), ...line(12, 20, (i) => 70 - 12 * (i % 2), 1), ...line(12, 20, (i) => 30 + 12 * (i % 2), 2)]).rating).toBe(10);
  });
});
