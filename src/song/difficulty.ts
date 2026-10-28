// Difficulty rating for a set of target notes (a chart at a given speed).
import type { TargetNote } from '../game/judge';

export interface Difficulty {
  /** 1–10 scale */
  rating: number;
  /** Average key presses (chords count once per hand) per second while playing */
  nps: number;
  /** Presses per second in the busiest stretches */
  peakNps: number;
  /** Average jump between consecutive presses in the same hand, in semitones */
  leap: number;
  /** Share of presses that are chords (two or more keys at once, either hand or across hands) */
  chordShare: number;
  /** Average number of different notes (pitch names, so octaves count once) in a 4-second stretch */
  variety: number;
}

/** Notes starting this close together are played as one chord */
const CHORD_SECONDS = 0.04;
const WINDOW_SECONDS = 4;
const STEP_SECONDS = 0.5;
/** A hand reaches an octave without moving (thumb to little finger) */
const REACH = 12;
/** Spans wider than this, within the reach, cost a little stretch */
const COMFORT_SPAN = 7;
/** The hand's position is the span of its last few presses */
const POSITION_PRESSES = 4;
/** Base cost of a press that repeats one of the hand's last two presses (a repeated note, or rocking between two keys) */
const REPEAT_COST = 0.65;
/** A window using this many different notes (pitch names) or more counts at full weight; fewer weigh less */
const FULL_VARIETY = 6;

interface Press { time: number; keys: number; lo: number; hi: number; pitch: number; midis: number[]; cost: number }

/**
 * Groups one hand's notes into presses and gives each a cost for reading, reaching and
 * stretching. Reaching is judged against the hand's position (the span of its last few
 * presses): a note within an octave of it is played without moving the hand, so an
 * octave-bouncing bass line (thumb and little finger) costs only a stretch, while a note
 * out of reach is a jump.
 */
function handPresses(notes: TargetNote[]): Press[] {
  const presses: Press[] = [];
  let group: TargetNote[] = [];
  const flush = () => {
    if (!group.length) return;
    const midis = group.map((n) => n.midi);
    const pitch = midis.reduce((s, m) => s + m, 0) / midis.length;
    presses.push({ time: group[0].time, keys: new Set(midis).size, lo: Math.min(...midis), hi: Math.max(...midis), pitch, midis, cost: 0 });
    group = [];
  };
  for (const n of notes) {
    if (group.length && n.time - group[0].time > CHORD_SECONDS) flush();
    group.push(n);
  }
  flush();
  presses.forEach((p, i) => {
    const prev = presses[i - 1];
    const same = (q: Press | undefined) => q !== undefined && q.midis.length === p.midis.length && q.midis.every((m) => p.midis.includes(m));
    let cost = (same(prev) || same(presses[i - 2]) ? REPEAT_COST : 1) + 0.5 * (p.keys - 1);
    if (prev) {
      // Moves matter more when there is little time to make them
      const hurry = Math.min(2, Math.max(0.5, 0.25 / Math.max(p.time - prev.time, 0.01)));
      const recent = presses.slice(Math.max(0, i - POSITION_PRESSES), i);
      const lo = Math.min(p.lo, ...recent.map((r) => r.lo));
      const hi = Math.max(p.hi, ...recent.map((r) => r.hi));
      if (hi - lo <= REACH) {
        cost += 0.15 * (Math.max(0, hi - lo - COMFORT_SPAN) / (REACH - COMFORT_SPAN)) * hurry;
      } else {
        const leap = Math.min(Math.abs(p.pitch - prev.pitch), 24);
        cost += 0.6 * (leap / 12) * hurry;
      }
    }
    p.cost = cost;
  });
  return presses;
}

/** Mean of the highest `share` of values */
function topMean(values: number[], share: number) {
  const sorted = [...values].sort((a, b) => b - a);
  const n = Math.max(1, Math.ceil(sorted.length * share));
  return sorted.slice(0, n).reduce((s, v) => s + v, 0) / n;
}

export function rateDifficulty(targets: TargetNote[]): Difficulty {
  const sorted = [...targets].sort((a, b) => a.time - b.time);
  // Hands as assigned by song/hands.ts (falling back to triangle = left hand)
  const isLeft = (n: TargetNote) => (n.hand ?? (n.ch === 2 ? 'L' : 'R')) === 'L';
  const right = handPresses(sorted.filter((n) => !isLeft(n)));
  const left = handPresses(sorted.filter(isLeft));
  // Pressing with both hands at once needs coordination
  let li = 0;
  for (const r of right) {
    while (li < left.length && left[li].time < r.time - CHORD_SECONDS) li++;
    if (li < left.length && Math.abs(left[li].time - r.time) <= CHORD_SECONDS) r.cost += 0.25;
  }
  const presses = [...right, ...left].sort((a, b) => a.time - b.time);
  if (!presses.length) return { rating: 0, nps: 0, peakNps: 0, leap: 0, chordShare: 0, variety: 0 };

  // Strain (cost per second) and press rate over sliding windows that contain notes
  const strain: number[] = [];
  const rate: number[] = [];
  const end = presses[presses.length - 1].time;
  let lo = 0;
  let hi = 0;
  const varieties: number[] = [];
  for (let t = presses[0].time; t <= Math.max(end - WINDOW_SECONDS, presses[0].time) + 1e-9; t += STEP_SECONDS) {
    while (lo < presses.length && presses[lo].time < t) lo++;
    while (hi < presses.length && presses[hi].time < t + WINDOW_SECONDS) hi++;
    if (hi === lo) continue;
    let cost = 0;
    const keys = new Set<number>();
    for (let i = lo; i < hi; i++) {
      cost += presses[i].cost;
      for (const m of presses[i].midis) keys.add(m % 12);
    }
    // A riff on a few notes is quicker to learn and read than a passage over many; a note
    // and its octave are one note to read, played with the same hand shape
    const variety = Math.min(1, 0.55 + 0.45 * ((keys.size - 1) / (FULL_VARIETY - 1)));
    strain.push((cost * variety) / WINDOW_SECONDS);
    rate.push((hi - lo) / WINDOW_SECONDS);
    varieties.push(keys.size);
  }
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  // Hard passages dominate, but a song that is busy throughout is harder than one hard bar
  const load = 0.6 * topMean(strain, 0.1) + 0.4 * mean(strain);

  const leaps: number[] = [];
  for (const hand of [right, left]) for (let i = 1; i < hand.length; i++) leaps.push(Math.abs(hand[i].pitch - hand[i - 1].pitch));
  let chords = right.filter((p) => p.keys > 1).length + left.filter((p) => p.keys > 1).length;
  chords += right.filter((p) => left.some((l) => Math.abs(l.time - p.time) <= CHORD_SECONDS)).length;

  return {
    rating: Math.min(10, Math.max(1, RATING_SCALE * Math.sqrt(load))),
    nps: mean(rate),
    peakNps: topMean(rate, 0.1),
    leap: leaps.length ? mean(leaps) : 0,
    chordShare: chords / (right.length + left.length),
    variety: mean(varieties),
  };
}

const RATING_SCALE = 2;
