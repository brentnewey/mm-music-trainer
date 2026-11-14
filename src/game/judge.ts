// Scoring: matches played notes against target notes by pitch and timing.
// All times are in seconds on the song clock (audio time at the chosen speed).

export type Judgment = 'perfect' | 'great' | 'good' | 'miss';

export const WINDOWS = { perfect: 0.045, great: 0.09, good: 0.15 };
export const POINTS: Record<Judgment, number> = { perfect: 100, great: 70, good: 40, miss: 0 };

export interface TargetNote {
  midi: number;
  time: number;
  duration: number;
  ch: number;
  /** Hand expected to play the note (see song/hands.ts) */
  hand?: 'L' | 'R';
  /** A slide along the keys from `midi` to this pitch, judged on its start (see `Judge.noteOn`) */
  slideTo?: number;
  /** Suggested finger, 1 (thumb) to 5 */
  finger?: number;
  /** Held with another of the hand's notes too far away to reach (see `markWideReaches`) */
  wide?: boolean;
  judgment?: Judgment;
  /** played - expected, seconds (negative = early) */
  offset?: number;
}

export type NoteOnResult =
  | { kind: 'hit'; note: TargetNote; judgment: Judgment; offset: number }
  /** A key along a slide that's under way: neither a hit nor wrong */
  | { kind: 'slide' }
  | { kind: 'wrong' };

export interface JudgeStats {
  total: number;
  counts: Record<Judgment, number>;
  wrong: number;
  combo: number;
  maxCombo: number;
  score: number;
  /** Timing offsets of hits, for early/late feedback */
  offsets: number[];
}

/** A slide starts on a key this many semitones or fewer from its first note, and takes keys this far beyond its ends */
export const SLIDE_SLACK = 2;

/** The keys a slide covers, with some slack at each end */
export function slideKeys(n: TargetNote) {
  const lo = Math.min(n.midi, n.slideTo ?? n.midi);
  const hi = Math.max(n.midi, n.slideTo ?? n.midi);
  return { lo: lo - SLIDE_SLACK, hi: hi + SLIDE_SLACK };
}

/** Whether a key press at song time `t` belongs to a slide that's under way */
export function inSlide(n: TargetNote, midi: number, t: number) {
  const { lo, hi } = slideKeys(n);
  return n.slideTo !== undefined && midi >= lo && midi <= hi && t >= n.time - WINDOWS.good && t <= n.time + n.duration + WINDOWS.good;
}

export function judgmentFor(offset: number): Judgment | null {
  const a = Math.abs(offset);
  if (a <= WINDOWS.perfect) return 'perfect';
  if (a <= WINDOWS.great) return 'great';
  if (a <= WINDOWS.good) return 'good';
  return null;
}

export class Judge {
  stats: JudgeStats;
  /** Index of the first note that may still be pending (notes are sorted by time) */
  private cursor = 0;

  constructor(public notes: TargetNote[], private opts: { octaveForgiving: boolean }) {
    notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
    this.stats = {
      total: notes.length, counts: { perfect: 0, great: 0, good: 0, miss: 0 },
      wrong: 0, combo: 0, maxCombo: 0, score: 0, offsets: [],
    };
  }

  /** Whether a key plays a note: its pitch, or for a slide any key near where it starts */
  keyMatches(n: TargetNote, played: number) {
    if (n.slideTo !== undefined) return Math.abs(n.midi - played) <= SLIDE_SLACK;
    return this.opts.octaveForgiving ? (n.midi - played) % 12 === 0 : n.midi === played;
  }

  /**
   * Handles a key press at song time `t`. A slide is a hit when you press a key near
   * its first note in time; the keys you press along it after that are part of it.
   */
  noteOn(midi: number, t: number): NoteOnResult {
    let best: TargetNote | undefined;
    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.time - t > WINDOWS.good) break;
      if (n.judgment || !this.keyMatches(n, midi)) continue;
      if (Math.abs(n.time - t) > WINDOWS.good) continue;
      if (!best || Math.abs(n.time - t) < Math.abs(best.time - t)) best = n;
    }
    if (!best) {
      if (this.inSlide(midi, t)) return { kind: 'slide' };
      this.wrongNote();
      return { kind: 'wrong' };
    }
    const offset = t - best.time;
    const judgment = judgmentFor(offset)!;
    this.record(best, judgment, offset);
    return { kind: 'hit', note: best, judgment, offset };
  }

  /** Whether a key press is along a slide that's under way */
  inSlide(midi: number, t: number) {
    // Slides started before the cursor may still be sounding, so look back a little
    for (let i = this.cursor; i-- > 0;) {
      const n = this.notes[i];
      if (t - n.time > 10) break;
      if (inSlide(n, midi, t)) return true;
    }
    for (let i = this.cursor; i < this.notes.length && this.notes[i].time - t <= WINDOWS.good; i++) {
      if (inSlide(this.notes[i], midi, t)) return true;
    }
    return false;
  }

  /** Adds notes that come after all existing ones (next pass of a looping song). */
  append(more: TargetNote[]) {
    this.notes.push(...more);
    this.stats.total += more.length;
  }

  /** Forces a hit (wait mode, where timing is not scored). */
  hitWithoutTiming(note: TargetNote) {
    this.record(note, 'perfect', 0);
  }

  /** A key press that matched no note: breaks the combo and costs score. */
  wrongNote() {
    this.stats.wrong++;
    this.stats.combo = 0;
    this.stats.score = computeScore(this.stats);
  }

  private record(note: TargetNote, judgment: Judgment, offset: number) {
    note.judgment = judgment;
    note.offset = offset;
    const s = this.stats;
    s.counts[judgment]++;
    if (judgment === 'miss') {
      s.combo = 0;
    } else {
      s.combo++;
      s.maxCombo = Math.max(s.maxCombo, s.combo);
      s.offsets.push(offset);
    }
    s.score = computeScore(s);
  }

  /** Marks notes whose window has passed as missed; returns them. */
  advance(t: number): TargetNote[] {
    const missed: TargetNote[] = [];
    while (this.cursor < this.notes.length) {
      const n = this.notes[this.cursor];
      if (n.judgment) { this.cursor++; continue; }
      if (t - n.time <= WINDOWS.good) break;
      this.record(n, 'miss', 0);
      missed.push(n);
      this.cursor++;
    }
    return missed;
  }

  /** Earliest note that has not been judged yet. */
  nextPending(): TargetNote | undefined {
    for (let i = this.cursor; i < this.notes.length; i++) if (!this.notes[i].judgment) return this.notes[i];
    return undefined;
  }

  get done() { return this.cursor >= this.notes.length && this.notes.every((n) => n.judgment); }
}

export interface Summary {
  /** Notes hit, over the total; what the game shows and records */
  accuracy: number;
  /** Timing points earned over the maximum; the score's accuracy half */
  timing: number;
  grade: string;
  meanOffsetMs: number;
  /** Every note hit and no wrong notes */
  fullCombo: boolean;
}

export const MAX_SCORE = 1_000_000;

/** The wrong-note penalty as a fraction of the song: half a note per wrong press. */
function penalty(s: JudgeStats): number {
  return (0.5 * s.wrong) / Math.max(1, s.total);
}

/**
 * Notes hit over the song's total, minus a wrong-note penalty. How late or early a
 * note was doesn't matter here: a hit is a hit (timing lives in the score instead,
 * through `timingOf`), because a long note's sound dies away on a real piano long
 * before its window is over, especially at slow speeds.
 */
export function accuracyOf(s: JudgeStats): number {
  const hits = s.counts.perfect + s.counts.great + s.counts.good;
  return Math.max(0, hits / Math.max(1, s.total) - penalty(s));
}

/** Timing points earned so far over the song's maximum, minus a wrong-note penalty. */
function timingOf(s: JudgeStats): number {
  const points = (Object.keys(s.counts) as Judgment[]).reduce((sum, j) => sum + POINTS[j] * s.counts[j], 0);
  return Math.max(0, points / (100 * Math.max(1, s.total)) - penalty(s));
}

/** Score out of 1,000,000: 90% timing, 10% max combo. Rises as you play. */
export function computeScore(s: JudgeStats): number {
  const total = Math.max(1, s.total);
  return Math.round(MAX_SCORE * (0.9 * timingOf(s) + 0.1 * (s.maxCombo / total)));
}

/** The grade an accuracy earns: S is near-perfect, then A-D. */
export function gradeOf(accuracy: number): string {
  return accuracy >= 0.99 ? 'S' : accuracy >= 0.9 ? 'A' : accuracy >= 0.8 ? 'B' : accuracy >= 0.7 ? 'C' : 'D';
}

/** Accuracy from notes hit, penalised by wrong notes; graded S-D. */
export function summarize(s: JudgeStats): Summary {
  const accuracy = accuracyOf(s);
  const timing = timingOf(s);
  const grade = gradeOf(accuracy);
  const meanOffsetMs = s.offsets.length ? (1000 * s.offsets.reduce((a, b) => a + b, 0)) / s.offsets.length : 0;
  const fullCombo = s.total > 0 && s.counts.miss === 0 && s.wrong === 0 && s.maxCombo === s.total;
  return { accuracy, timing, grade, meanOffsetMs, fullCombo };
}
