// Decides which hand plays each note.
//
// Channel roles change within a song (in Needle Man's intro, Pulse 1 plays the
// bass riff under the triangle), so hands are chosen by register rather than by
// channel. The song is cut into short windows, and in each one every combination
// of hands for the playing channels is scored:
// - low parts lean to the left hand and high parts to the right;
// - crossed hands (a left-hand part above a right-hand one) cost extra;
// - three parts in one hand cost extra, as do two parts more than an octave apart
//   and two parts in one hand while the other is free.
// The best sequence of combinations is found with dynamic programming, with a
// cost for each channel that changes hands. Each switch is then moved to the
// widest gap in that channel's notes near the window boundary.
import type { TargetNote } from '../game/judge';

export type Hand = 'L' | 'R';

/** Window length in seconds of song time (at 100% speed) */
const WINDOW = 2;
/** Cost of a channel changing hands between windows */
const SWITCH_COST = 1;
/** Below this pitch the right hand starts to cost more, above `LEFT_TOP` the left hand does */
const RIGHT_BOTTOM = 62; // D4
const LEFT_TOP = 57; // A3

const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];

/** Cost of one window's hand choice; `left[i]` is the hand of the part with median pitch `pitch[i]` */
function windowCost(pitch: number[], left: boolean[]): number {
  let cost = 0;
  pitch.forEach((m, i) => {
    cost += left[i]
      ? Math.min(1.5, Math.max(0, (m - LEFT_TOP) / 8))
      : Math.min(1.5, Math.max(0, (RIGHT_BOTTOM - m) / 8));
  });
  for (let i = 0; i < pitch.length; i++) {
    for (let j = 0; j < pitch.length; j++) {
      if (i === j) continue;
      // Hands crossed: a left-hand part above a right-hand part
      if (left[i] && !left[j] && pitch[i] > pitch[j] + 1) cost += 1.5 + 0.2 * (pitch[i] - pitch[j]);
      // Two parts far apart in the same hand
      if (i < j && left[i] === left[j] && Math.abs(pitch[i] - pitch[j]) > 12) cost += 1;
    }
  }
  for (const hand of [true, false]) {
    const parts = left.filter((l) => l === hand).length;
    if (parts >= 3) cost += 2.5;
    // Two parts in one hand while the other hand is free
    if (parts === 2 && left.length === 2) cost += 1;
  }
  return cost;
}

/**
 * Sets `hand` on every note. `timeScale` converts note times to song time at 100%
 * speed, and `pitchOffset` (an octave shift) is removed before judging register.
 */
export function assignHands(notes: TargetNote[], timeScale = 1, pitchOffset = 0) {
  if (!notes.length) return;
  const songTime = (n: TargetNote) => n.time * timeScale;
  const windows = Math.floor(Math.max(...notes.map(songTime)) / WINDOW) + 1;
  const channels = [...new Set(notes.map((n) => n.ch))];
  const byChannel = channels.map((ch) => notes.filter((n) => n.ch === ch).sort((a, b) => a.time - b.time));

  // Median pitch of each channel in each window (NaN when silent)
  const med = byChannel.map((ns) => {
    const buckets: number[][] = Array.from({ length: windows }, () => []);
    for (const n of ns) buckets[Math.floor(songTime(n) / WINDOW)].push(n.midi - pitchOffset);
    return buckets.map((b) => (b.length ? median(b) : NaN));
  });

  // Viterbi over windows; a state is a bitmask of channels (by index) on the left hand
  const states = 1 << channels.length;
  const isLeft = (s: number, c: number) => ((s >> c) & 1) === 1;
  const cost = (w: number, s: number) => {
    const active = channels.map((_, c) => c).filter((c) => !Number.isNaN(med[c][w]));
    return windowCost(active.map((c) => med[c][w]), active.map((c) => isLeft(s, c)));
  };
  const switches = (a: number, b: number, w: number) => {
    let n = 0;
    for (let c = 0; c < channels.length; c++) {
      // Changing hands only matters for a channel playing on either side of the boundary
      if (isLeft(a, c) !== isLeft(b, c) && (!Number.isNaN(med[c][w - 1]) || !Number.isNaN(med[c][w]))) n++;
    }
    return n * SWITCH_COST;
  };
  let total = Array.from({ length: states }, (_, s) => cost(0, s));
  const back: number[][] = [];
  for (let w = 1; w < windows; w++) {
    const from: number[] = [];
    const next: number[] = [];
    for (let s = 0; s < states; s++) {
      let best = Infinity;
      let arg = 0;
      for (let p = 0; p < states; p++) {
        const c = total[p] + switches(p, s, w);
        if (c < best) { best = c; arg = p; }
      }
      from.push(arg);
      next.push(best + cost(w, s));
    }
    back.push(from);
    total = next;
  }
  const state: number[] = new Array(windows);
  state[windows - 1] = total.indexOf(Math.min(...total));
  for (let w = windows - 1; w > 0; w--) state[w - 1] = back[w - 1][state[w]];

  byChannel.forEach((ns, c) => {
    const handAt = (w: number): Hand => (isLeft(state[w], c) ? 'L' : 'R');
    for (const n of ns) n.hand = handAt(Math.floor(songTime(n) / WINDOW));
    // Move each switch to the widest gap near the window boundary
    for (let w = 1; w < windows; w++) {
      if (handAt(w) === handAt(w - 1)) continue;
      const near = ns.filter((n) => songTime(n) >= (w - 1) * WINDOW && songTime(n) < (w + 1) * WINDOW);
      if (near.length < 2) continue;
      let split = 1;
      let widest = -Infinity;
      for (let i = 1; i < near.length; i++) {
        const gap = near[i].time - (near[i - 1].time + near[i - 1].duration);
        if (gap > widest) { widest = gap; split = i; }
      }
      near.forEach((n, i) => (n.hand = i >= split ? handAt(w) : handAt(w - 1)));
    }
  });
}

/**
 * The melody within a set of right-hand notes: one channel's line per window,
 * normally the highest. The current line is kept unless another channel sits
 * clearly above it, so echo channels (a delayed copy at the same pitch) don't
 * steal it. Ties go to the lower channel number (Pulse 1).
 */
export function melodyLine(notes: TargetNote[], timeScale = 1, pitchOffset = 0): TargetNote[] {
  if (!notes.length) return [];
  const songTime = (n: TargetNote) => n.time * timeScale;
  const windows = Math.floor(Math.max(...notes.map(songTime)) / WINDOW) + 1;
  const buckets: TargetNote[][] = Array.from({ length: windows }, () => []);
  for (const n of notes) buckets[Math.floor(songTime(n) / WINDOW)].push(n);
  const out: TargetNote[] = [];
  let lead = -1;
  for (const bucket of buckets) {
    const channels = [...new Set(bucket.map((n) => n.ch))].sort((a, b) => a - b);
    if (!channels.length) continue;
    const med = new Map(channels.map((ch) => [ch, median(bucket.filter((n) => n.ch === ch).map((n) => n.midi - pitchOffset))]));
    // Highest channel, unless only marginally above a lower-numbered one
    let best = channels[0];
    for (const ch of channels) if (med.get(ch)! > med.get(best)! + 1) best = ch;
    if (!med.has(lead) || med.get(best)! > med.get(lead)! + 2) lead = best;
    out.push(...bucket.filter((n) => n.ch === lead));
  }
  return out.sort((a, b) => a.time - b.time);
}
