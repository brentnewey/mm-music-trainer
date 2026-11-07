import { describe, expect, it } from 'vitest';
import { LADDER, PRACTICE_SPEEDS, SpeedLadder, describeLadder } from '../src/game/ladder';

/** Plays `n` passes at `accuracy`, all at one speed, and returns the moves they triggered */
const play = (lad: SpeedLadder, n: number, accuracy: number, speed: number) =>
  Array.from({ length: n }, () => lad.record(accuracy, speed)).filter((m) => m !== null);

const clean = LADDER.target;
const poor = LADDER.target - 0.05;

describe('SpeedLadder', () => {
  it('steps up after three clean passes in a row', () => {
    const lad = new SpeedLadder();
    expect(lad.record(clean, 0.5)).toBeNull();
    expect(lad.record(clean, 0.5)).toBeNull();
    expect(lad.record(clean, 0.5)).toEqual({ dir: 'up', from: 0.5, to: 0.6 });
  });

  it('steps down after three passes under the target', () => {
    const lad = new SpeedLadder();
    expect(play(lad, 2, poor, 0.5)).toEqual([]);
    expect(lad.record(poor, 0.5)).toEqual({ dir: 'down', from: 0.5, to: 0.4 });
  });

  it('counts the target itself as clean', () => {
    expect(play(new SpeedLadder(), LADDER.up, LADDER.target, 0.5)).toEqual([{ dir: 'up', from: 0.5, to: 0.6 }]);
  });

  it('needs the passes in a row: a poor one in the middle starts the count over', () => {
    const lad = new SpeedLadder();
    expect(play(lad, 2, clean, 0.5)).toEqual([]);
    expect(lad.record(poor, 0.5)).toBeNull();
    expect(play(lad, 2, clean, 0.5)).toEqual([]);
    expect(lad.record(clean, 0.5)).toEqual({ dir: 'up', from: 0.5, to: 0.6 });
  });

  it('spends the streak on a step, so the next move takes three more passes', () => {
    const lad = new SpeedLadder();
    expect(play(lad, LADDER.up, clean, 0.5)).toHaveLength(1);
    expect(play(lad, LADDER.up - 1, clean, 0.6)).toEqual([]);
    expect(lad.record(clean, 0.6)).toEqual({ dir: 'up', from: 0.6, to: 0.7 });
  });

  it('will not step below the slowest speed', () => {
    const lad = new SpeedLadder();
    expect(play(lad, LADDER.down, poor, 0.15)).toEqual([{ dir: 'down', from: 0.15, to: 0.1 }]);
    // At 10% a run of poor passes reports the move with nowhere to go
    expect(play(lad, LADDER.down, poor, 0.1)).toEqual([{ dir: 'down', from: 0.1, to: null }]);
  });

  it('will not step above full speed', () => {
    expect(play(new SpeedLadder(), LADDER.up, clean, 1)).toEqual([{ dir: 'up', from: 1, to: null }]);
  });

  it('walks every rung of the ladder from the bottom to the top', () => {
    const lad = new SpeedLadder();
    const reached = [0.1];
    for (let i = 0; i < PRACTICE_SPEEDS.length * LADDER.up; i++) {
      const move = lad.record(clean, reached[reached.length - 1]);
      if (move?.to != null) reached.push(move.to);
    }
    expect(reached).toEqual(PRACTICE_SPEEDS);
  });

  it('steps from the nearest rung when the speed is not one of them', () => {
    const lad = new SpeedLadder();
    expect(lad.step(0.72, 'up')).toBe(0.8);
    expect(lad.step(0.72, 'down')).toBe(0.6);
  });

  it('logs every pass and groups the log by speed', () => {
    const lad = new SpeedLadder();
    play(lad, LADDER.up, 0.95, 0.5);
    lad.record(0.8, 0.6);
    expect(describeLadder(lad.log)).toBe('50%: 95/95/95 → 60%: 80');
  });

  it('forgets the streaks and the log when reset', () => {
    const lad = new SpeedLadder();
    play(lad, LADDER.up - 1, clean, 0.5);
    lad.reset();
    expect(lad.log).toEqual([]);
    expect(play(lad, LADDER.up - 1, clean, 0.5)).toEqual([]);
  });
});
