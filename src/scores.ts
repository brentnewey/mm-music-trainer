// Score-run records: best result per song × chart × speed × stop mode.
import type { JudgeStats, Judgment, Summary } from './game/judge';
import { loadJson, saveJson, saveToProjectFile } from './storage';
import type { PartId } from './song/targets';

export interface Chart {
  id: PartId;
  label: string;
  /** Short name for buttons */
  short: string;
  description: string;
  color: string;
}

/** The parts you can play, in practice and score runs (see buildPart) */
export const CHARTS: Chart[] = [
  { id: 'right', label: 'Right hand', short: 'Right', description: 'both pulses', color: '#3cbcfc' },
  { id: 'p1', label: 'Pulse 1 only', short: 'Pulse 1', description: 'right hand, usually the melody', color: '#f878f8' },
  { id: 'p2', label: 'Pulse 2 only', short: 'Pulse 2', description: 'right hand, usually the harmony', color: '#b8b8f8' },
  { id: 'lh', label: 'Left hand', short: 'Left', description: 'triangle bass', color: '#fca044' },
  { id: 'both', label: 'Both hands', short: 'Both', description: 'the whole arrangement', color: '#58f898' },
];

/** Charts before parts were chosen by hand, and the hand part each is closest to */
const CHANNEL_CHARTS: Record<string, PartId> = { p12: 'right', tri: 'lh', all: 'both' };
/**
 * Retired parts and the part a saved selection moves to. Their records stay in the
 * file but aren't shown: `rh` was the right hand's melody alone, and `rhc` the
 * melody with its chords, both picked out automatically. (`p1`, the old Pulse 1
 * channel chart, is a part again.)
 */
const RETIRED_CHARTS: Record<string, PartId> = { rh: 'right', rhc: 'right' };

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
  /** Set when the record was carried over from a channel chart (e.g. 'p1') */
  migratedFrom?: string;
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

export function getScoreView(): ScoreView {
  const v = loadJson<ScoreView>('scoreView', { chart: 'right', speed: 1, stop: false });
  return { ...v, chart: CHANNEL_CHARTS[v.chart] ?? RETIRED_CHARTS[v.chart] ?? v.chart };
}
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
    const chart = ({ '01': 'right', '2': 'lh', '012': 'both' } as Record<string, PartId>)[parts];
    if (!chart) continue;
    const key = scoreKey({ game, id: parseInt(idHex, 16), chart, speed: 1, stop: false });
    if (all[key]) continue;
    all[key] = {
      score: Math.round(900_000 * v.accuracy), accuracy: v.accuracy, grade: v.grade, fullCombo: false, maxCombo: 0,
      counts: { perfect: 0, great: 0, good: 0, miss: 0 }, wrong: 0, date: v.date, plays: 1,
    };
  }
  saveScores(all);
  localStorage.removeItem('bestScores');
}

/**
 * One-time carry-over of records from the channel charts (Pulse 1, Triangle, …) to
 * the closest hand part. The old entries are kept in the file, and the copies are
 * marked `migratedFrom`, since the note sets differ slightly.
 */
export function migrateChannelCharts() {
  const all = getScores();
  let changed = false;
  for (const [k, rec] of Object.entries(all)) {
    const parts = k.split(':');
    const to = CHANNEL_CHARTS[parts[2]];
    if (!to) continue;
    const key = [...parts.slice(0, 2), to, ...parts.slice(3)].join(':');
    if (all[key]) continue;
    all[key] = { ...rec, migratedFrom: parts[2] };
    changed = true;
  }
  if (changed) saveScores(all);
}
