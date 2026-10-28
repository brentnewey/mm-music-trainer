// Dev-tool helper: a song's edits from track-edits.json (made in the app's track editor).
import fs from 'node:fs';
import type { EditRule, TrackEdits } from '../src/song/hands';

const all: TrackEdits = fs.existsSync('track-edits.json') ? JSON.parse(fs.readFileSync('track-edits.json', 'utf-8')) : {};

/** `game` and numeric sound ID, as in `trackKey` */
export const editsFor = (game: string, id: number): EditRule[] => all[`${game}:${id.toString(16).padStart(2, '0')}`] ?? [];
