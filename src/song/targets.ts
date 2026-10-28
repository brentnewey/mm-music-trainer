import type { SongAnalysis } from './analyze';
import { FRAME_SECONDS } from './analyze';
import type { TargetNote } from '../game/judge';
import { assignHands } from './hands';
import { HAND_OVERRIDES } from './handOverrides';

export interface TargetOptions {
  minFrames: number;
  speed: number;
  octaveShift: number;
  /** The track (`trackKey`), for its hand overrides */
  track: string;
}

/** What you play: a hand's part of the arrangement */
export type PartId = 'right' | 'p1' | 'p2' | 'lh' | 'both';

/**
 * Converts analyzed notes on the given channels into timed targets, each with the
 * hand expected to play it. Unisons across channels (same pitch, starting within
 * 2 frames) are merged.
 */
export function buildTargets(a: SongAnalysis, channels: number[], opts: TargetOptions): TargetNote[] {
  const scale = FRAME_SECONDS / opts.speed;
  const picked = a.notes
    .filter((n) => channels.includes(n.ch) && n.end - n.start >= opts.minFrames && n.start < a.endFrame)
    .sort((x, y) => x.start - y.start || x.ch - y.ch);
  const out: TargetNote[] = [];
  const recent: typeof picked = [];
  for (const n of picked) {
    while (recent.length && n.start - recent[0].start > 2) recent.shift();
    if (recent.some((r) => r.midi === n.midi && r.ch !== n.ch)) continue;
    recent.push(n);
    out.push({
      midi: n.midi + 12 * opts.octaveShift,
      time: n.start * scale,
      duration: (Math.min(n.end, a.endFrame) - n.start) * scale,
      ch: n.ch,
    });
  }
  assignHands(out, opts.speed, HAND_OVERRIDES[opts.track]);
  return out;
}

/**
 * Targets for one hand's part: `right` (the pulses), `p1` or `p2` (the right hand's
 * notes on one pulse, an easier right hand), `lh` (the triangle) or `both`.
 * Hands come from the channels, with per-song overrides (see hands.ts), so a part
 * can draw on any channel: in Needle Man's intro the left hand plays Pulse 1's bass riff.
 */
export function buildPart(a: SongAnalysis, part: PartId, opts: TargetOptions): TargetNote[] {
  // One pulse alone keeps its unisons with the other, which a full build merges away
  if (part === 'p1' || part === 'p2') return buildTargets(a, [part === 'p1' ? 0 : 1], opts).filter((n) => n.hand === 'R');
  const all = buildTargets(a, [0, 1, 2], opts);
  if (part === 'both') return all;
  return all.filter((n) => n.hand === (part === 'lh' ? 'L' : 'R'));
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

/** Note count and pitch range of a set of targets */
export function rangeOf(notes: TargetNote[]) {
  const ps = notes.map((n) => n.midi);
  return { count: notes.length, lo: Math.min(...ps), hi: Math.max(...ps) };
}
