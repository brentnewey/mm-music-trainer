import type { Note, SongAnalysis } from './analyze';
import { FRAME_SECONDS } from './analyze';
import type { TargetNote } from '../game/judge';

export interface PartInfo {
  ch: number;
  count: number;
  lo: number;
  hi: number;
}

export function partInfo(notes: Note[], minFrames: number): PartInfo[] {
  return [0, 1, 2].map((ch) => {
    const ns = notes.filter((n) => n.ch === ch && n.end - n.start >= minFrames);
    return {
      ch,
      count: ns.length,
      lo: ns.length ? Math.min(...ns.map((n) => n.midi)) : 0,
      hi: ns.length ? Math.max(...ns.map((n) => n.midi)) : 0,
    };
  });
}

/** Guesses the lead part: the pulse channel carrying the most sustained notes. */
export function defaultPart(notes: Note[]): number {
  const weight = [0, 0];
  for (const n of notes) {
    if (n.ch < 2 && n.end - n.start >= 4) weight[n.ch] += (n.end - n.start) * (n.midi >= 60 ? 1.2 : 1);
  }
  return weight[1] > weight[0] * 1.1 ? 1 : 0;
}

/**
 * Converts analyzed notes into timed targets for the chosen parts.
 * Unisons across channels (same pitch, starting within 2 frames) are merged.
 */
export function buildTargets(a: SongAnalysis, parts: number[], opts: { minFrames: number; speed: number; octaveShift: number }): TargetNote[] {
  const scale = FRAME_SECONDS / opts.speed;
  const picked = a.notes
    .filter((n) => parts.includes(n.ch) && n.end - n.start >= opts.minFrames && n.start < a.endFrame)
    .sort((x, y) => x.start - y.start || x.ch - y.ch);
  const out: TargetNote[] = [];
  const recent: Note[] = [];
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
  return out;
}
