// Persistence: IndexedDB for extracted driver blobs (binary), localStorage for
// small JSON (settings, track names, track edits, scores, discovery cache).
import type { TrackEdits } from './song/hands';

const DB_NAME = 'mm-music-trainer';
const STORE = 'blobs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveBlob(key: string, data: Uint8Array): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadBlob(key: string): Promise<Uint8Array | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as Uint8Array | undefined);
    req.onerror = () => reject(req.error);
  });
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable: settings just won't persist
  }
}

export interface Settings {
  speed: number;
  /** Volume of the parts you are playing in the backing track: 0 = muted, 0.3 = guide, 1 = full */
  myPartVolume: number;
  /** Play a chiptune sound for your own key presses */
  synthEnabled: boolean;
  /** Hide notes shorter than this many NES frames (60/s) */
  minNoteFrames: number;
  octaveForgiving: boolean;
  showNoteNames: boolean;
  /** Show suggested finger numbers on notes and keys */
  showFingering: boolean;
  /** Added to the song clock when judging (ms); positive if you tend to be judged late */
  latencyOffsetMs: number;
  /** Pixels per second of fall speed */
  scrollSpeed: number;
  /** Octave shift applied to target notes (to fit your keyboard) */
  octaveShift: number;
  /** Pause the song until you hit each note */
  waitMode: boolean;
  /** Keep repeating the song's loop section until you finish */
  loop: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  speed: 1,
  myPartVolume: 0.3,
  synthEnabled: false,
  minNoteFrames: 4,
  octaveForgiving: false,
  showNoteNames: true,
  showFingering: true,
  latencyOffsetMs: 0,
  scrollSpeed: 260,
  octaveShift: 0,
  waitMode: false,
  loop: false,
};

export const getSettings = () => loadJson<Settings>('settings', DEFAULT_SETTINGS);
export const saveSettings = (s: Settings) => saveJson('settings', s);

export function trackKey(game: string, id: number) {
  return `${game}:${id.toString(16).padStart(2, '0')}`;
}

// Data mirrored to JSON files in the project folder by the dev server, so it
// survives clearing browser data. Maps file name -> localStorage key.
const PROJECT_FILES = { 'track-names': 'trackNames', 'track-edits': 'trackEdits', scores: 'scores' } as const;
type ProjectFile = keyof typeof PROJECT_FILES;

export function saveToProjectFile(name: ProjectFile, data: unknown) {
  fetch(`/api/data/${name}`, { method: 'PUT', body: JSON.stringify(data) }).catch(() => {});
}

/** Merges each project file into local storage (file entries win) and writes back browser-only entries. */
export async function syncProjectFiles() {
  await Promise.all(
    (Object.keys(PROJECT_FILES) as ProjectFile[]).map(async (name) => {
      try {
        const res = await fetch(`/api/data/${name}`);
        if (!res.ok || !res.headers.get('content-type')?.includes('json')) return;
        const fromFile = (await res.json()) as Record<string, unknown>;
        const local = loadJson<Record<string, unknown>>(PROJECT_FILES[name], {});
        const merged = { ...local, ...fromFile };
        saveJson(PROJECT_FILES[name], merged);
        if (Object.keys(local).some((k) => !(k in fromFile))) saveToProjectFile(name, merged);
      } catch {
        // no dev server: browser storage only
      }
    }),
  );
}

export const getTrackNames = () => loadJson<Record<string, string>>('trackNames', {});

/** Saves names locally and to track-names.json via the dev server. */
export function saveTrackNames(n: Record<string, string>) {
  saveJson('trackNames', n);
  saveToProjectFile('track-names', n);
}

export const getTrackEdits = () => loadJson<TrackEdits>('trackEdits', {});

/** Saves song edits locally and to track-edits.json via the dev server. */
export function saveTrackEdits(e: TrackEdits) {
  saveJson('trackEdits', e);
  saveToProjectFile('track-edits', e);
}
