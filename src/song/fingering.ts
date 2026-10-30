// Suggested piano fingering for target notes.
//
// Each hand is fingered separately (the hand per note comes from song/hands.ts)
// by finding the lowest-cost finger sequence with dynamic programming. The
// cost model follows Parncutt et al. (1997), "An ergonomic model of keyboard
// fingering for melodic fragments": comfortable/practical spans between finger
// pairs, plus penalties for weak fingers and awkward thumb/fifth-finger use on
// black keys. Chords are fingered as a group, and costs between notes far apart
// in time are scaled down because the hand can reposition during a rest.
import type { TargetNote } from '../game/judge';
import { isBlack } from '../game/highway';

/** Fingers: 1 = thumb … 5 = little finger, as in printed piano music */
export type Finger = 1 | 2 | 3 | 4 | 5;

/** Notes starting this close together are played as one chord */
const CHORD_SECONDS = 0.04;

/**
 * Right-hand spans in semitones from the lower-numbered finger's key to the
 * higher-numbered finger's key: [minPrac, minComf, minRel, maxRel, maxComf, maxPrac].
 * Negative values are thumb crossings (Parncutt et al. 1997, table 1).
 */
const SPANS: Record<string, number[]> = {
  '12': [-5, -3, 1, 5, 8, 10],
  '13': [-4, -2, 3, 7, 10, 12],
  '14': [-3, -1, 5, 9, 12, 14],
  '15': [-1, 1, 7, 10, 13, 15],
  '23': [1, 1, 1, 2, 3, 5],
  '24': [1, 1, 3, 4, 5, 7],
  '25': [2, 2, 5, 6, 8, 10],
  '34': [1, 1, 1, 2, 2, 4],
  '35': [1, 1, 3, 4, 5, 7],
  '45': [1, 1, 1, 2, 3, 5],
};

/** Moving a finger to a different key while it is needed costs this much */
const SAME_FINGER = 8;
/** Cost of a thumb pass (a hand position shift) */
const THUMB_PASS = 5;

interface Key { pitch: number; black: boolean }

/**
 * Stretch cost of finger `fa` on key `a` and finger `fb` on key `b` (both as
 * right-hand pitches; the left hand is mirrored before it gets here).
 */
function spanCost(fa: Finger, a: Key, fb: Finger, b: Key): number {
  if (fa === fb) return a.pitch === b.pitch ? 0 : SAME_FINGER;
  // Orient from the lower-numbered finger to the higher
  const [lo, hi, d] = fa < fb ? [fa, fb, b.pitch - a.pitch] : [fb, fa, a.pitch - b.pitch];
  const [minPrac, minComf, minRel, maxRel, maxComf, maxPrac] = SPANS[`${lo}${hi}`];
  const relaxWeight = lo === 1 ? 1 : 2;
  let cost = 0;
  // Stretch beyond comfortable, then beyond relaxed
  if (d > maxComf) cost += 2 * (d - maxComf);
  if (d > maxRel) cost += relaxWeight * (d - maxRel);
  if (lo === 1 && hi <= 4 && d < 0) {
    // Passing the thumb under (or a finger over it) shifts the whole hand: a fixed
    // cost, plus extra when the thumb has to land on a black key from a white one
    const thumbKey = fa === 1 ? a : b;
    const otherKey = fa === 1 ? b : a;
    cost += THUMB_PASS + 0.5 * -d + (thumbKey.black && !otherKey.black ? 2 : 0);
  } else {
    if (d < minComf) cost += 2 * (minComf - d);
    if (d < minRel) cost += relaxWeight * (minRel - d);
  }
  // Beyond what a hand can do without jumping
  if (d > maxPrac) cost += 10 * (d - maxPrac);
  if (d < minPrac) cost += 10 * (minPrac - d);
  return cost;
}

/** Cost of using a finger on a key, regardless of neighbours */
function keyCost(f: Finger, k: Key): number {
  let cost = 0;
  if (f === 4 || f === 5) cost += 1;
  if (f === 1 && k.black) cost += 1;
  return cost;
}

interface Event { time: number; keys: Key[]; notes: TargetNote[][] }
type State = Finger[];

/** All ways to give `k` keys (sorted low to high) increasing fingers */
function fingerChoices(k: number): State[] {
  const out: State[] = [];
  const rec = (from: number, acc: Finger[]) => {
    if (acc.length === k) { out.push([...acc]); return; }
    for (let f = from; f <= 5; f++) rec(f + 1, [...acc, f as Finger]);
  };
  rec(1, []);
  return out;
}
const CHOICES = [1, 2, 3, 4, 5].map(fingerChoices);

function chordCost(e: Event, s: State): number {
  let cost = 0;
  for (let i = 0; i < s.length; i++) {
    cost += keyCost(s[i], e.keys[i]);
    for (let j = i + 1; j < s.length; j++) cost += spanCost(s[i], e.keys[i], s[j], e.keys[j]);
  }
  return cost;
}

function transitionCost(prev: Event, ps: State, cur: Event, cs: State): number {
  let cost = 0;
  let pairs = 0;
  for (let i = 0; i < ps.length; i++) {
    for (let j = 0; j < cs.length; j++) {
      const a = prev.keys[i];
      const b = cur.keys[j];
      cost += spanCost(ps[i], a, cs[j], b);
      pairs++;
      // Three followed by four is awkward, more so onto a black key from a white one
      if (ps[i] === 3 && cs[j] === 4) cost += 1 + (b.black && !a.black ? 1 : 0);
      // Thumb or little finger on a black key next to white keys
      if (cs[j] === 1 && b.black && !a.black) cost += 2;
      if (ps[i] === 1 && a.black && !b.black) cost += 2;
      if (cs[j] === 5 && b.black && !a.black) cost += 2;
      if (ps[i] === 5 && a.black && !b.black) cost += 2;
    }
  }
  cost /= pairs;
  // The hand can reposition during rests: the longer the gap, the less transitions matter
  const gap = cur.time - prev.time;
  const weight = gap <= 0.25 ? 1 : gap >= 1.5 ? 0.15 : 1 - (0.85 * (gap - 0.25)) / 1.25;
  return cost * weight;
}

/** Groups one hand's notes into chords of distinct keys, pitch-mirrored for the left hand */
function handEvents(notes: TargetNote[], mirror: boolean): Event[] {
  const events: Event[] = [];
  let group: TargetNote[] = [];
  const flush = () => {
    if (!group.length) return;
    const byPitch = new Map<number, TargetNote[]>();
    for (const n of group) {
      const p = mirror ? -n.midi : n.midi;
      byPitch.set(p, [...(byPitch.get(p) ?? []), n]);
    }
    // Five fingers: drop the inner keys of anything bigger
    let pitches = [...byPitch.keys()].sort((x, y) => x - y);
    if (pitches.length > 5) pitches = [...pitches.slice(0, 4), pitches[pitches.length - 1]];
    events.push({
      time: group[0].time,
      keys: pitches.map((p) => ({ pitch: p, black: isBlack(mirror ? -p : p) })),
      notes: pitches.map((p) => byPitch.get(p)!),
    });
    group = [];
  };
  for (const n of [...notes].sort((a, b) => a.time - b.time || a.midi - b.midi)) {
    if (group.length && n.time - group[0].time > CHORD_SECONDS) flush();
    group.push(n);
  }
  flush();
  return events;
}

/** Lowest-cost fingering for one hand (Viterbi over chord fingerings) */
function fingerHand(events: Event[]) {
  if (!events.length) return;
  const states = events.map((e) => CHOICES[e.keys.length - 1]);
  let cost = states[0].map((s) => chordCost(events[0], s));
  const back: number[][] = [];
  for (let i = 1; i < events.length; i++) {
    const next: number[] = [];
    const from: number[] = [];
    for (const s of states[i]) {
      const own = chordCost(events[i], s);
      let best = Infinity;
      let arg = 0;
      states[i - 1].forEach((p, k) => {
        const c = cost[k] + transitionCost(events[i - 1], p, events[i], s);
        if (c < best) { best = c; arg = k; }
      });
      next.push(best + own);
      from.push(arg);
    }
    back.push(from);
    cost = next;
  }
  let k = cost.indexOf(Math.min(...cost));
  for (let i = events.length - 1; i >= 0; i--) {
    states[i][k].forEach((f, j) => events[i].notes[j].forEach((n) => (n.finger = f)));
    if (i > 0) k = back[i - 1][k];
  }
}

/** Sets `finger` on every note but slides, for the hand in `hand` (falling back to triangle = left hand). */
export function assignFingering(notes: TargetNote[]) {
  for (const n of notes) delete n.finger;
  notes = notes.filter((n) => n.slideTo === undefined);
  const isLeft = (n: TargetNote) => (n.hand ?? (n.ch === 2 ? 'L' : 'R')) === 'L';
  fingerHand(handEvents(notes.filter((n) => !isLeft(n)), false));
  fingerHand(handEvents(notes.filter(isLeft), true));
}
