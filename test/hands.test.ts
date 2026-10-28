import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMerges, roleOf, soundOf, type EditRule } from '../src/song/hands';
import type { TargetNote } from '../src/game/judge';
import { GAMES } from '../src/games';
import { FRAME_SECONDS, analyzeSong, type Note, type SongAnalysis } from '../src/song/analyze';
import { buildPart, buildTargets } from '../src/song/targets';

/** A channel playing the given pitches in turn, 4 notes a second, for `seconds` (edit boundaries in tests fall between notes) */
const part = (ch: number, pitches: number[], seconds: number, sound = { duty: 2, vel: 10 }): Note[] =>
  Array.from({ length: seconds * 4 }, (_, i) => {
    const start = Math.round(i / 4 / FRAME_SECONDS);
    return { ch, midi: pitches[i % pitches.length], start, end: start + 10, ...sound };
  });
const rolesOf = (notes: Note[], ch: number, rules: EditRule[] = []) => new Set(notes.filter((n) => n.ch === ch).map((n) => roleOf(n, rules)));
const handsOf = (notes: TargetNote[], ch: number) => new Set(notes.filter((n) => n.ch === ch).map((n) => n.hand));
const timeOf = (n: Note) => n.start * FRAME_SECONDS;

describe('roleOf', () => {
  it('gives the pulses to the right hand and the triangle to the left, whatever the register', () => {
    // Ring Man: the triangle's G4 hits sit among the pulse chords but stay in the left hand
    const notes = [...part(0, [72, 74, 76], 10), ...part(1, [62, 74], 10), ...part(2, [43, 67], 10)];
    expect(rolesOf(notes, 0)).toEqual(new Set(['R']));
    expect(rolesOf(notes, 1)).toEqual(new Set(['R']));
    expect(rolesOf(notes, 2)).toEqual(new Set(['L']));
  });

  it('applies edits within their time range', () => {
    // Needle Man's intro: Pulse 1 plays the bass riff under the triangle until 16.7 s
    const notes = [...part(0, [46, 49, 51], 20), ...part(2, [70, 72, 73], 20)];
    const rules: EditRule[] = [{ ch: 0, hand: 'L', to: 16.7 }, { ch: 2, hand: 'R', to: 16.7 }];
    const p1 = notes.filter((n) => n.ch === 0);
    expect(rolesOf(p1.filter((n) => timeOf(n) < 16.7), 0, rules)).toEqual(new Set(['L']));
    expect(rolesOf(p1.filter((n) => timeOf(n) >= 16.7), 0, rules)).toEqual(new Set(['R']));
    expect(rolesOf(notes.filter((n) => timeOf(n) < 16.7), 2, rules)).toEqual(new Set(['R']));
  });

  it('removes notes, and only those of the chosen sound', () => {
    // A percussive sound on Pulse 2 among its harmony notes
    const harmony = part(1, [62, 65], 10);
    const drum = part(1, [81], 10, { duty: 0, vel: 6 });
    const rules: EditRule[] = [{ ch: 1, sound: soundOf(drum[0]), hand: 'off' }];
    expect(rolesOf(drum, 1, rules)).toEqual(new Set(['off']));
    expect(rolesOf(harmony, 1, rules)).toEqual(new Set(['R']));
  });

  it('lets a later edit override an earlier one, and restore the usual hand', () => {
    const notes = part(0, [60], 10);
    const rules: EditRule[] = [{ ch: 0, hand: 'off' }, { ch: 0, hand: 'L', from: 1.9, to: 3.9 }, { ch: 0, hand: 'default', from: 2.9, to: 3.9 }];
    const at = (t: number) => roleOf(notes.find((n) => Math.abs(timeOf(n) - t) < 0.01)!, rules);
    expect([at(1), at(2), at(3), at(5)]).toEqual(['off', 'L', 'R', 'off']);
  });
});

describe('applyMerges', () => {
  // A vibrato: 2-frame notes rocking between C5 and C#5, mostly on C5
  const vibrato: Note[] = [72, 73, 72, 72, 73, 72].map((midi, i) => ({ ch: 0, midi, start: 600 + 2 * i, end: 602 + 2 * i, vel: 8, duty: 1 }));
  const after: Note = { ch: 0, midi: 76, start: 700, end: 720, vel: 8, duty: 1 };
  const t = (f: number) => f * FRAME_SECONDS;

  it('joins the notes in range into one held note at the pitch held longest', () => {
    const out = applyMerges([...vibrato, after], [{ ch: 0, from: t(599), to: t(650), hand: 'merge' }]);
    expect(out).toEqual([{ ch: 0, midi: 72, start: 600, end: 612, vel: 8, duty: 1 }, after]);
  });

  it('keeps the merged note through the length filter, and lets hand edits apply to it', () => {
    const a: SongAnalysis = { id: 0, loopStart: -1, endFrame: 1000, notes: [...vibrato, after] };
    const edits: EditRule[] = [{ ch: 0, from: t(599), to: t(650), hand: 'merge' }, { ch: 0, from: t(599), to: t(650), hand: 'L' }];
    const out = buildTargets(a, [0], { minFrames: 4, speed: 1, octaveShift: 0, edits });
    expect(out.map((n) => [n.midi, n.hand])).toEqual([[72, 'L'], [76, 'R']]);
    expect(buildTargets(a, [0], { minFrames: 4, speed: 1, octaveShift: 0 }).length).toBe(1);
  });

  it('leaves other channels and sounds alone', () => {
    const other = vibrato.map((n) => ({ ...n, ch: 1 }));
    const out = applyMerges([...vibrato, ...other], [{ ch: 0, sound: '1:8', hand: 'merge' }, { ch: 1, sound: '2:8', hand: 'merge' }]);
    expect(out.filter((n) => n.ch === 0).length).toBe(1);
    expect(out.filter((n) => n.ch === 1).length).toBe(6);
  });
});

describe('joining echoes', () => {
  const note = (ch: number, midi: number, start: number, len: number): Note => ({ ch, midi, start, end: start + len, vel: 8, duty: 2 });
  // Pulse 2 repeats Pulse 1 12 frames later: once while it still sounds, once after a short note ends
  const p1 = [note(0, 52, 0, 24), note(0, 55, 24, 5), note(0, 57, 36, 12)];
  const p2 = [note(1, 52, 12, 24), note(1, 55, 36, 5), note(1, 57, 48, 12)];
  const join: EditRule[] = [{ ch: 1, hand: 'join' }];

  it('folds each echo into the note it repeats, held until the echo ends', () => {
    const out = applyMerges([...p1, ...p2], join);
    expect(out.map((n) => [n.ch, n.midi, n.start, n.end]).sort((x, y) => x[2] - y[2])).toEqual([[0, 52, 0, 36], [0, 55, 24, 41], [0, 57, 36, 60]]);
  });

  it('folds notes tapped on another channel under a held note into it', () => {
    // Flash Man at 0:28: Pulse 1 holds E4 while Pulse 2 taps E4 underneath
    const held = note(0, 64, 0, 47);
    const taps = [note(1, 64, 18, 5), note(1, 64, 30, 5), note(1, 64, 48, 11)];
    expect(applyMerges([held, ...taps], join)).toEqual([{ ...held, end: 59 }]);
  });

  it("keeps a channel's repeated notes as separate presses", () => {
    // Pulse 1 repeats F#4 with Pulse 2 doubling the first one: three presses
    const repeats = [note(0, 66, 0, 5), note(0, 66, 6, 5), note(0, 66, 12, 5)];
    const out = applyMerges([...repeats, note(1, 66, 1, 5)], [{ ch: 0, hand: 'join' }, { ch: 1, hand: 'join' }]);
    expect(out.map((n) => [n.ch, n.start, n.end])).toEqual([[0, 0, 6], [0, 6, 11], [0, 12, 17]]);
  });

  it('only joins notes on the channels the edit covers', () => {
    expect(applyMerges([...p1, ...p2], [{ ch: 0, hand: 'join' }]).length).toBe(6);
  });
});

describe.skipIf(!fs.existsSync('roms/nsf/mm2.bin'))('Flash Man (MM2)', () => {
  const game = GAMES.find((g) => g.id === 'mm2')!;
  const a = analyzeSong(new Uint8Array(fs.readFileSync('roms/nsf/mm2.bin')), game.driver, 0);
  const opts = { minFrames: 4, speed: 1, octaveShift: 0 };
  /** Right-hand notes struck while the other pulse still holds the same key: unplayable on a keyboard */
  const struckWhileHeld = (ns: TargetNote[]) =>
    ns.filter((n) => ns.some((m) => m.ch !== n.ch && m.midi === n.midi && n.time - m.time > 0.04 && n.time < m.time + m.duration - 1e-6)).length;

  it("joins Pulse 2's echoes of Pulse 1 into single held notes", () => {
    const before = buildPart(a, 'right', opts);
    // As the editor saves it with the whole song and both pulses selected
    const after = buildPart(a, 'right', { ...opts, edits: [{ ch: 0, hand: 'join' }, { ch: 1, hand: 'join' }] });
    expect(struckWhileHeld(before)).toBeGreaterThan(30);
    expect(struckWhileHeld(after)).toBe(0);
    expect(before.length - after.length).toBeGreaterThan(50);
  });
});

describe('buildTargets with edits', () => {
  const a = (notes: Note[]): SongAnalysis => ({ id: 0, loopStart: -1, endFrame: 100000, notes });
  const opts = { minFrames: 4, speed: 1, octaveShift: 0 };

  it('leaves out removed notes from every part', () => {
    const notes = [...part(0, [72], 4), ...part(2, [40], 4)];
    const edits: EditRule[] = [{ ch: 2, hand: 'off', from: 1.9 }];
    expect(buildPart(a(notes), 'both', { ...opts, edits }).length).toBe(16 + 8);
    expect(buildPart(a(notes), 'lh', { ...opts, edits }).every((n) => n.time < 1.9)).toBe(true);
  });

  it('keeps a unison note when the channel that doubled it is removed', () => {
    const notes = [...part(0, [72], 4), ...part(1, [72], 4)];
    expect(buildTargets(a(notes), [0, 1], opts).length).toBe(16);
    const t = buildTargets(a(notes), [0, 1], { ...opts, edits: [{ ch: 0, hand: 'off' }] });
    expect(t.length).toBe(16);
    expect(new Set(t.map((n) => n.ch))).toEqual(new Set([1]));
  });

  it('applies edits in song time, at any speed', () => {
    const t = buildTargets(a(part(0, [46], 10)), [0], { ...opts, speed: 0.5, edits: [{ ch: 0, hand: 'L', from: 4.9 }] });
    expect(t.find((n) => Math.abs(n.time - 9.5) < 0.02)!.hand).toBe('R');
    expect(t.find((n) => Math.abs(n.time - 10) < 0.02)!.hand).toBe('L');
  });
});

describe.skipIf(!fs.existsSync('roms/nsf/mm3.bin'))('Needle Man (MM3)', () => {
  const game = GAMES.find((g) => g.id === 'mm3')!;
  const a = analyzeSong(new Uint8Array(fs.readFileSync('roms/nsf/mm3.bin')), game.driver, 1);
  const edits = JSON.parse(fs.readFileSync('track-edits.json', 'utf-8'))['mm3:01'] as EditRule[];
  const opts = { minFrames: 4, speed: 1, octaveShift: 0, edits };

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
