import { describe, expect, it } from 'vitest';
import { Judge, summarize, type TargetNote } from '../src/game/judge';

const note = (midi: number, time: number): TargetNote => ({ midi, time, duration: 0.2, ch: 0 });

describe('Judge', () => {
  it('grades hits by timing offset', () => {
    const j = new Judge([note(60, 1), note(62, 2), note(64, 3)], { octaveForgiving: false });
    expect(j.noteOn(60, 1.02)).toMatchObject({ kind: 'hit', judgment: 'perfect' });
    expect(j.noteOn(62, 1.93)).toMatchObject({ kind: 'hit', judgment: 'great' });
    expect(j.noteOn(64, 3.14)).toMatchObject({ kind: 'hit', judgment: 'good' });
    expect(j.stats.combo).toBe(3);
  });

  it('counts wrong pitches and out-of-window presses as wrong', () => {
    const j = new Judge([note(60, 1)], { octaveForgiving: false });
    expect(j.noteOn(61, 1)).toEqual({ kind: 'wrong' });
    expect(j.noteOn(60, 1.5)).toEqual({ kind: 'wrong' });
    expect(j.stats.wrong).toBe(2);
  });

  it('accepts other octaves when octave-forgiving', () => {
    const j = new Judge([note(60, 1)], { octaveForgiving: true });
    expect(j.noteOn(72, 1)).toMatchObject({ kind: 'hit' });
  });

  it('matches the closest of repeated same-pitch notes', () => {
    const j = new Judge([note(60, 1), note(60, 1.1)], { octaveForgiving: false });
    const r = j.noteOn(60, 1.09);
    expect(r.kind === 'hit' && r.note.time).toBe(1.1);
  });

  it('misses notes once their window passes and resets combo', () => {
    const j = new Judge([note(60, 1), note(62, 2)], { octaveForgiving: false });
    j.noteOn(60, 1);
    expect(j.advance(2.2)).toHaveLength(1);
    expect(j.stats.counts.miss).toBe(1);
    expect(j.stats.combo).toBe(0);
    expect(j.stats.maxCombo).toBe(1);
    expect(j.done).toBe(true);
  });

  it('summarizes accuracy with a wrong-note penalty', () => {
    const j = new Judge([note(60, 1), note(62, 2)], { octaveForgiving: false });
    j.noteOn(60, 1); j.noteOn(62, 2);
    expect(summarize(j.stats)).toMatchObject({ accuracy: 1, grade: 'S', fullCombo: true });
    expect(j.stats.score).toBe(1_000_000);
    j.noteOn(70, 3);
    expect(summarize(j.stats)).toMatchObject({ fullCombo: false });
    expect(summarize(j.stats).accuracy).toBeCloseTo(0.75);
    expect(j.stats.score).toBe(Math.round(1e6 * (0.9 * 0.75 + 0.1)));
  });

  it('weights max combo into the score', () => {
    const notes = [1, 2, 3, 4].map((t) => note(60, t));
    const j = new Judge(notes, { octaveForgiving: false });
    j.noteOn(60, 1); j.noteOn(60, 2); j.advance(3.5); j.noteOn(60, 4);
    // accuracy 3/4, best combo 2 of 4
    expect(j.stats.score).toBe(Math.round(1e6 * (0.9 * 0.75 + 0.1 * 0.5)));
  });

  it('hits a slide on a key near its start, then takes keys along it', () => {
    const slide: TargetNote = { midi: 76, slideTo: 60, time: 1, duration: 0.33, ch: 1 };
    const j = new Judge([slide, note(67, 2)], { octaveForgiving: false });
    expect(j.noteOn(77, 1.01)).toMatchObject({ kind: 'hit', judgment: 'perfect' });
    for (const [m, t] of [[74, 1.05], [71, 1.12], [65, 1.2], [60, 1.3], [59, 1.4]]) expect(j.noteOn(m, t)).toEqual({ kind: 'slide' });
    // Past its end, or outside its keys, a press is wrong again
    expect(j.noteOn(50, 1.2)).toEqual({ kind: 'wrong' });
    expect(j.noteOn(64, 1.6)).toEqual({ kind: 'wrong' });
    expect(j.stats).toMatchObject({ wrong: 2, combo: 0 });
  });

  it('misses a slide started too far from its first key', () => {
    const j = new Judge([{ midi: 76, slideTo: 60, time: 1, duration: 0.33, ch: 1 }], { octaveForgiving: false });
    expect(j.noteOn(70, 1)).toEqual({ kind: 'slide' });
    j.advance(2);
    expect(j.stats.counts.miss).toBe(1);
  });
});
