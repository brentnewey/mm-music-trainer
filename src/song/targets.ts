import type { SongAnalysis } from './analyze';
import { FRAME_SECONDS } from './analyze';
import type { TargetNote } from '../game/judge';
import { assignHands, melodyLine } from './hands';

export interface TargetOptions { minFrames: number; speed: number; octaveShift: number }

/** What you play: a hand's part of the arrangement */
export type PartId = 'rh' | 'rhc' | 'lh' | 'both';

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
  assignHands(out, opts.speed, 12 * opts.octaveShift);
  return out;
}

/**
 * Targets for one hand's part. Hands are decided on the whole arrangement (both
 * pulses and the triangle), so a part can draw on any channel: in Needle Man's
 * intro the left hand plays Pulse 1's bass riff.
 * - `rh`: the right hand's melody (one line, no chords)
 * - `rhc`: everything the right hand plays, chords included
 * - `lh`: everything the left hand plays
 * - `both`: the whole arrangement
 */
export function buildPart(a: SongAnalysis, part: PartId, opts: TargetOptions): TargetNote[] {
  const all = buildTargets(a, [0, 1, 2], opts);
  if (part === 'both') return all;
  if (part === 'lh') return all.filter((n) => n.hand === 'L');
  const right = all.filter((n) => n.hand === 'R');
  return part === 'rhc' ? right : melodyLine(right, opts.speed, 12 * opts.octaveShift);
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
