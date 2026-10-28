// Decides which hand plays each note: the pulses go to the right hand and the
// triangle to the left, except where a song's entry in `handOverrides.ts` says
// otherwise.
import type { TargetNote } from '../game/judge';
import type { HandRule } from './handOverrides';

export type Hand = 'L' | 'R';

/** The usual hand for each channel: pulses right, triangle left */
const CHANNEL_HAND: Record<number, Hand> = { 0: 'R', 1: 'R', 2: 'L' };

/**
 * Sets `hand` on every note from its channel, then applies the song's override
 * rules. `timeScale` converts note times to song time at 100% speed.
 */
export function assignHands(notes: TargetNote[], timeScale = 1, rules: HandRule[] = []) {
  for (const n of notes) {
    const t = n.time * timeScale;
    const rule = rules.find((r) => r.ch === n.ch && t >= (r.from ?? -Infinity) && t < (r.to ?? Infinity));
    n.hand = rule?.hand ?? CHANNEL_HAND[n.ch] ?? 'R';
  }
}
