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
}

/** Notes starting this close together are played as one chord */
const CHORD_SECONDS = 0.04;
const WINDOW_SECONDS = 4;
const STEP_SECONDS = 0.5;

interface Press { time: number; keys: number; pitch: number; cost: number }

/** Groups one hand's notes into presses and gives each a cost for reading, reaching and stretching. */
function handPresses(notes: TargetNote[]): Press[] {
  const presses: Press[] = [];
  let group: TargetNote[] = [];
  const flush = () => {
    if (!group.length) return;
    const pitch = group.reduce((s, n) => s + n.midi, 0) / group.length;
    presses.push({ time: group[0].time, keys: new Set(group.map((n) => n.midi)).size, pitch, cost: 0 });
    group = [];
  };
  for (const n of notes) {
    if (group.length && n.time - group[0].time > CHORD_SECONDS) flush();
    group.push(n);
  }
  flush();
  presses.forEach((p, i) => {
    const prev = presses[i - 1];
    let cost = 1 + 0.5 * (p.keys - 1);
    if (prev) {
      const leap = Math.min(Math.abs(p.pitch - prev.pitch), 24);
      // Leaps matter more when there is little time to move the hand
      const hurry = Math.min(2, Math.max(0.5, 0.25 / Math.max(p.time - prev.time, 0.01)));
      cost += 0.6 * (leap / 12) * hurry;
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
  if (!presses.length) return { rating: 0, nps: 0, peakNps: 0, leap: 0, chordShare: 0 };

  // Strain (cost per second) and press rate over sliding windows that contain notes
  const strain: number[] = [];
  const rate: number[] = [];
  const end = presses[presses.length - 1].time;
  let lo = 0;
  let hi = 0;
  for (let t = presses[0].time; t <= Math.max(end - WINDOW_SECONDS, presses[0].time) + 1e-9; t += STEP_SECONDS) {
    while (lo < presses.length && presses[lo].time < t) lo++;
    while (hi < presses.length && presses[hi].time < t + WINDOW_SECONDS) hi++;
    if (hi === lo) continue;
    let cost = 0;
    for (let i = lo; i < hi; i++) cost += presses[i].cost;
    strain.push(cost / WINDOW_SECONDS);
    rate.push((hi - lo) / WINDOW_SECONDS);
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
  };
}

const RATING_SCALE = 1.8;
