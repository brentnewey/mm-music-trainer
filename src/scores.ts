// Score-run records: best result per song × chart × speed × stop mode.
import type { JudgeStats, Judgment, Summary } from './game/judge';
import { loadJson, saveJson, saveToProjectFile } from './storage';

export interface Chart {
  id: string;
  label: string;
  hands: string;
  parts: number[];
}

/** The fixed part combinations a score run can use */
export const CHARTS: Chart[] = [
  { id: 'p1', label: 'Pulse 1', hands: 'right hand', parts: [0] },
  { id: 'tri', label: 'Triangle', hands: 'left hand', parts: [2] },
  { id: 'p12', label: 'Pulse 1 + 2', hands: 'right hand', parts: [0, 1] },
  { id: 'all', label: 'All three', hands: 'both hands', parts: [0, 1, 2] },
];

/** Settings forced during score runs so records stay comparable */
export const SCORE_RUN_RULES = { minNoteFrames: 4, octaveForgiving: false, loop: false } as const;

export interface ScoreRecord {
  score: number;
  accuracy: number;
  grade: string;
  fullCombo: boolean;
  maxCombo: number;
  counts: Record<Judgment, number>;
  wrong: number;
  /** When the best was set */
  date: number;
  plays: number;
}

export interface ScoreKey { game: string; id: number; chart: string; speed: number; stop: boolean }

const LOCAL_KEY = 'scores';

export function scoreKey(k: ScoreKey) {
  return `${k.game}:${k.id.toString(16).padStart(2, '0')}:${k.chart}:${Math.round(k.speed * 100)}:${k.stop ? 'stop' : 'flow'}`;
}

export const getScores = () => loadJson<Record<string, ScoreRecord>>(LOCAL_KEY, {});

function saveScores(s: Record<string, ScoreRecord>) {
  saveJson(LOCAL_KEY, s);
  saveToProjectFile('scores', s);
}

export function bestFor(k: ScoreKey): ScoreRecord | undefined {
  return getScores()[scoreKey(k)];
}

/** Records a finished score run; returns the previous best (if any) and whether this beat it. */
export function recordRun(k: ScoreKey, stats: JudgeStats, summary: Summary): { previous?: ScoreRecord; isBest: boolean } {
  const all = getScores();
  const key = scoreKey(k);
  const previous = all[key];
  const isBest = !previous || stats.score > previous.score;
  const plays = (previous?.plays ?? 0) + 1;
  all[key] = isBest
    ? {
      score: stats.score, accuracy: summary.accuracy, grade: summary.grade, fullCombo: summary.fullCombo,
      maxCombo: stats.maxCombo, counts: { ...stats.counts }, wrong: stats.wrong, date: Date.now(), plays,
    }
    : { ...previous, plays };
  saveScores(all);
  return { previous, isBest };
}

/** The chart, speed and stop setting the song list shows records for, and score runs start with */
export interface ScoreView { chart: string; speed: number; stop: boolean }

export const getScoreView = () => loadJson<ScoreView>('scoreView', { chart: 'p1', speed: 1, stop: false });
export const saveScoreView = (v: ScoreView) => saveJson('scoreView', v);
export const describeView = (v: ScoreView) =>
  `${CHARTS.find((c) => c.id === v.chart)?.label ?? v.chart} · ${Math.round(v.speed * 100)}%${v.stop ? ' · stop mode' : ''}`;

/** One-time import of bests from the earlier "ranked run" format (full speed, no stop mode). */
export function migrateLegacyBests() {
  const legacy = loadJson<Record<string, { accuracy: number; grade: string; date: number }>>('bestScores', {});
  const entries = Object.entries(legacy);
  if (!entries.length) return;
  const all = getScores();
  for (const [k, v] of entries) {
    const [game, idHex, parts] = k.split(':');
    const chart = CHARTS.find((c) => c.parts.join('') === parts);
    if (!chart) continue;
    const key = scoreKey({ game, id: parseInt(idHex, 16), chart: chart.id, speed: 1, stop: false });
    if (all[key]) continue;
    all[key] = {
      score: Math.round(900_000 * v.accuracy), accuracy: v.accuracy, grade: v.grade, fullCombo: false, maxCombo: 0,
      counts: { perfect: 0, great: 0, good: 0, miss: 0 }, wrong: 0, date: v.date, plays: 1,
    };
  }
  saveScores(all);
  localStorage.removeItem('bestScores');
}
