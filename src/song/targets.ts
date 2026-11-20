import type { Note, SongAnalysis } from './analyze';
import { FRAME_SECONDS } from './analyze';
import type { TargetNote } from '../game/judge';
import { applyMerges, isEasyOff, isKept, roleOf, type EditRule, type Hand } from './hands';

export interface TargetOptions {
  minFrames: number;
  speed: number;
  octaveShift: number;
  /** The song's edits from the track editor (which hand plays what, and what's removed) */
  edits?: EditRule[];
  /** Easy mode: leave out the notes the song's `easy-off` edits cover */
  easy?: boolean;
}

/** What you play: a hand's part of the arrangement */
export type PartId = 'right' | 'p1' | 'p2' | 'lh' | 'both';

/**
 * Converts analyzed notes on the given channels into timed targets, each with the
 * hand expected to play it. The song's edits merge notes and remove some, and
 * unisons across channels (same pitch, starting within 2 frames) are merged.
 * With `hand` given, only that hand's notes are built, so a unison doubled by the
 * other hand's channel stays in this hand's part (Heat Man's intro has the triangle
 * bass doubled note for note on Pulse 1; a whole-arrangement build keeps the pulse).
 */
export function buildTargets(a: SongAnalysis, channels: number[], opts: TargetOptions, hand?: Hand): TargetNote[] {
  const scale = FRAME_SECONDS / opts.speed;
  // Merge first, so a vibrato of short notes survives the length filter as one note
  const picked = applyMerges(a.notes, opts.edits)
    .filter((n) => channels.includes(n.ch) && (n.end - n.start >= opts.minFrames || isKept(n, opts.edits)) && n.start < a.endFrame && !(opts.easy && isEasyOff(n, opts.edits)))
    .map((n) => ({ n, role: roleOf(n, opts.edits) }))
    .filter((p): p is { n: Note; role: Hand } => p.role !== 'off' && (hand === undefined || p.role === hand))
    .sort((x, y) => x.n.start - y.n.start || x.n.ch - y.n.ch);
  const out: TargetNote[] = [];
  const recent: typeof picked = [];
  for (const p of picked) {
    const { n } = p;
    while (recent.length && n.start - recent[0].n.start > 2) recent.shift();
    // A slide is never a unison
    const slide = n.slideTo !== undefined;
    if (!slide && recent.some((r) => r.n.midi === n.midi && r.n.ch !== n.ch && r.n.slideTo === undefined)) continue;
    recent.push(p);
    const t: TargetNote = {
      midi: n.midi + 12 * opts.octaveShift,
      time: n.start * scale,
      duration: (Math.min(n.end, a.endFrame) - n.start) * scale,
      ch: n.ch,
      hand: p.role,
    };
    if (slide) t.slideTo = n.slideTo! + 12 * opts.octaveShift;
    out.push(t);
  }
  return out;
}

/**
 * Targets for one hand's part: `right` (the pulses), `p1` or `p2` (the right hand's
 * notes on one pulse, an easier right hand), `lh` (the triangle) or `both`.
 * Hands come from the channels, with the song's edits (see hands.ts), so a part
 * can draw on any channel: in Needle Man's intro the left hand plays Pulse 1's bass riff.
 */
export function buildPart(a: SongAnalysis, part: PartId, opts: TargetOptions): TargetNote[] {
  // A single hand or pulse keeps the unisons a whole-arrangement build merges away,
  // so the other hand's channel can't take a note out of this part
  if (part === 'p1' || part === 'p2') return buildTargets(a, [part === 'p1' ? 0 : 1], opts, 'R');
  if (part === 'both') return buildTargets(a, [0, 1, 2], opts);
  return buildTargets(a, [0, 1, 2], opts, part === 'lh' ? 'L' : 'R');
}

/** Channels carrying mostly this part's notes (muted or quietened in the backing track) */
export function partChannels(a: SongAnalysis, part: PartId, opts: TargetOptions): number[] {
  const all = buildTargets(a, [0, 1, 2], opts);
  const mine = new Set(buildPart(a, part, opts).map((n) => `${n.ch}:${n.time}`));
  return [0, 1, 2].filter((ch) => {
    const ns = all.filter((n) => n.ch === ch);
    return ns.length > 0 && ns.filter((n) => mine.has(`${n.ch}:${n.time}`)).length / ns.length >= 0.5;
  });
}

/**
 * Song-time span the notes occupy: the first onset to the end of the last note
 * (seconds on the same clock as the targets), or null when there are none.
 */
export function spanOf(notes: TargetNote[]): { start: number; end: number } | null {
  if (!notes.length) return null;
  return {
    start: Math.min(...notes.map((n) => n.time)),
    end: Math.max(...notes.map((n) => n.time + n.duration)),
  };
}

/** Note count and pitch range of a set of targets */
export function rangeOf(notes: TargetNote[]) {
  const ps = notes.map((n) => n.midi);
  return { count: notes.length, lo: Math.min(...ps), hi: Math.max(...ps) };
}
