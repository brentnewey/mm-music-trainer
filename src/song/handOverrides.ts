// Songs whose hands differ from the usual layout (pulses right, triangle left).
// Add a song here when one of its channels plays in the other hand's role, such as
// a pulse carrying the bass. Times are song seconds at 100% speed; check them with
// `npx tsx tools/hands.ts <game> <id>`.
import type { Hand } from './hands';

export interface HandRule {
  /** Channel: 0 = Pulse 1, 1 = Pulse 2, 2 = Triangle */
  ch: number;
  hand: Hand;
  /** Applies to notes starting in [from, to); either end may be left open */
  from?: number;
  to?: number;
}

/** Keyed by track (`trackKey`: game and hex sound ID) */
export const HAND_OVERRIDES: Record<string, HandRule[]> = {
  // Needle Man: in the intro Pulse 1 plays the bass riff under the triangle's melody
  'mm3:01': [{ ch: 0, hand: 'L', to: 16.7 }, { ch: 2, hand: 'R', to: 16.7 }],
};
