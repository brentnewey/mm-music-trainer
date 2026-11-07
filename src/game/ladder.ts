// Speed ladder: a looped practice section that speeds up when you play it cleanly
// and slows back down when you don't. The rules are in LADDER.

/** The speeds the ladder steps through, as offered by the song dialog's Speed select */
export const PRACTICE_SPEEDS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

export const LADDER = {
  /** Pass accuracy that counts as playing the section cleanly */
  target: 0.9,
  /** Clean passes in a row that move up one speed */
  up: 3,
  /** Passes in a row below the target that move down one */
  down: 3,
};

export interface LadderMove {
  dir: 'up' | 'down';
  from: number;
  /** Speed to move to, or null at the end of the ladder (10% going down, 100% going up) */
  to: number | null;
}

/**
 * Tracks a run of looped passes and says when to change speed. One ladder lives
 * across the session restarts that a speed change needs (the music is re-rendered).
 */
export class SpeedLadder {
  /** Clean passes in a row */
  hits = 0;
  /** Passes in a row below the target */
  misses = 0;
  /** Every pass so far, in order, for the results screen */
  readonly log: { speed: number; accuracy: number }[] = [];

  constructor(private speeds = PRACTICE_SPEEDS) {}

  /**
   * Records a finished pass played at `speed`. Returns the speed change it triggers
   * (`to` is null when the ladder has no speed left that way), or null while a
   * streak is still building. Either streak reaching its length spends both.
   */
  record(accuracy: number, speed: number): LadderMove | null {
    this.log.push({ speed, accuracy });
    if (accuracy >= LADDER.target) {
      this.hits++;
      this.misses = 0;
    } else {
      this.misses++;
      this.hits = 0;
    }
    const dir = this.hits >= LADDER.up ? 'up' : this.misses >= LADDER.down ? 'down' : null;
    if (!dir) return null;
    this.hits = 0;
    this.misses = 0;
    return { dir, from: speed, to: this.step(speed, dir) };
  }

  /** The next speed up or down from `speed`, or null if there is none */
  step(speed: number, dir: 'up' | 'down'): number | null {
    const i = this.nearest(speed) + (dir === 'up' ? 1 : -1);
    return i >= 0 && i < this.speeds.length ? this.speeds[i] : null;
  }

  /** Index of the rung closest to `speed` (a saved setting may sit between rungs) */
  private nearest(speed: number) {
    let best = 0;
    for (let i = 1; i < this.speeds.length; i++) {
      if (Math.abs(this.speeds[i] - speed) < Math.abs(this.speeds[best] - speed)) best = i;
    }
    return best;
  }

  /** Forgets the streaks and the log (a manual restart starts the ladder over) */
  reset() {
    this.hits = 0;
    this.misses = 0;
    this.log.length = 0;
  }
}

/** The log grouped by speed, e.g. `60%: 91/95/92 → 70%: 80/85` */
export function describeLadder(log: readonly { speed: number; accuracy: number }[]) {
  const groups: { speed: number; accuracies: number[] }[] = [];
  for (const e of log) {
    const last = groups[groups.length - 1];
    if (last && last.speed === e.speed) last.accuracies.push(e.accuracy);
    else groups.push({ speed: e.speed, accuracies: [e.accuracy] });
  }
  return groups
    .map((g) => `${Math.round(g.speed * 100)}%: ${g.accuracies.map((a) => Math.round(a * 100)).join('/')}`)
    .join(' → ');
}
