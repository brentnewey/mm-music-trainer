import { GAMES, type GameInfo } from './games';
import { extractFromProteus } from './rom/extract';
import { SongWorkerClient } from './worker/protocol';
import { AudioEngine } from './audio/engine';
import { NoteInput } from './input/midi';
import { Session, type SessionHud, type SessionResult } from './game/session';
import { noteName } from './game/highway';
import { buildPart, partChannels, rangeOf, type PartId } from './song/targets';
import { FRAME_SECONDS, type SongAnalysis } from './song/analyze';
import { rateDifficulty, type Difficulty } from './song/difficulty';
import { assignFingering } from './song/fingering';
import type { DiscoveredTrack } from './song/discover';
import type { TargetNote } from './game/judge';
import {
  getSettings, saveSettings, loadBlob, saveBlob, loadJson, saveJson, getTrackNames, saveTrackNames,
  trackKey, syncProjectFiles, type Settings,
} from './storage';
import {
  CHARTS, SCORE_RUN_RULES, bestFor, describeView, getScoreView, migrateChannelCharts, migrateLegacyBests, recordRun, saveScoreView,
  type Chart, type ScoreKey,
} from './scores';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SAMPLE_RATE = 44100;
const DISCOVERY_VERSION = 1;

const worker = new SongWorkerClient();
const audio = new AudioEngine();
const input = new NoteInput();
const analyses = new Map<string, SongAnalysis>();

let currentGame: GameInfo = GAMES[0];
let tracks: DiscoveredTrack[] = [];
let previewing: string | null = null;

// ---------- boot ----------

async function boot() {
  await Promise.all([input.init(), syncProjectFiles()]);
  migrateLegacyBests();
  migrateChannelCharts();
  renderMidiStatus();
  input.onDevicesChanged(renderMidiStatus);
  input.onRawMidi(showMidiActivity);
  input.onNoteOn((e) => { if (e.source === 'keyboard') lastInput = `key ${noteName(e.midi)}`; renderMidiStatus(); });

  const loaded = await Promise.all(GAMES.map(async (g) => [g, await loadBlob(`nsf:${g.id}`)] as const));
  if (loaded.some(([, blob]) => !blob)) {
    // The dev server serves the Steam install's Proteus.exe; fall back to a file picker
    if (await importExe(() => fetchLocalExe())) return;
    showScreen('setup-screen');
    setupFilePicker();
    return;
  }
  await Promise.all(loaded.map(([g, blob]) => worker.load(g.id, blob!)));
  showLibrary();
}

async function fetchLocalExe(): Promise<Uint8Array> {
  const res = await fetch('/proteus.exe');
  if (!res.ok) throw new Error(await res.text());
  // Without the dev-server plugin (e.g. a stale server) Vite answers with index.html
  if (!res.headers.get('content-type')?.includes('octet-stream')) {
    throw new Error('The dev server is not serving Proteus.exe. Restart it with "npm run dev", or choose the file below.');
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Extracts and caches the sound drivers; returns false (with an error shown) on failure. */
async function importExe(read: () => Promise<Uint8Array>): Promise<boolean> {
  $('setup-error').textContent = '';
  try {
    const items = extractFromProteus(await read(), ['nsf']);
    for (const item of items) {
      await saveBlob(`nsf:${item.game}`, item.data);
      await worker.load(item.game, item.data);
    }
    showLibrary();
    return true;
  } catch (e) {
    $('setup-error').textContent = (e as Error).message;
    return false;
  }
}

function showScreen(id: string) {
  for (const s of document.querySelectorAll<HTMLElement>('.screen')) s.hidden = s.id !== id;
}

let lastInput = '';

/** Describes the latest MIDI message so you can see whether the keyboard is reaching the browser. */
function showMidiActivity(d: Uint8Array) {
  const status = d[0];
  if (status === 0xfe || status === 0xf8) return; // active sensing / clock: constant chatter
  const cmd = status & 0xf0;
  const ch = (status & 0x0f) + 1;
  if (cmd === 0x90 && d[2] > 0) lastInput = `${noteName(d[1])} on (vel ${d[2]}, ch ${ch})`;
  else if (cmd === 0x80 || cmd === 0x90) lastInput = `${noteName(d[1])} off`;
  else lastInput = `msg ${[...d].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`;
  renderMidiStatus();
}

function renderMidiStatus() {
  const el = $('midi-status');
  const devices = input.devices;
  if (input.midiError) el.innerHTML = `<span class="dot"></span>${input.midiError}`;
  else if (devices.length) el.innerHTML = `<span class="dot on"></span>${devices.map(escapeHtml).join(', ')}`;
  else el.innerHTML = `<span class="dot"></span>No MIDI keyboard detected (computer keys work)`;
  el.innerHTML += ` · <span class="midi-last">${lastInput ? `last input: ${escapeHtml(lastInput)}` : devices.length ? 'press a key to test' : ''}</span>`;
}

// ---------- first-run extraction ----------

function setupFilePicker() {
  const handle = async (file?: File) => {
    if (file) await importExe(async () => new Uint8Array(await file.arrayBuffer()));
  };
  $<HTMLInputElement>('exe-input').onchange = (e) => handle((e.target as HTMLInputElement).files?.[0]);
  const zone = $('drop-zone');
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('over'); };
  zone.ondragleave = () => zone.classList.remove('over');
  zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove('over'); handle(e.dataTransfer?.files[0]); };
}

// ---------- library ----------

function showLibrary() {
  showScreen('library-screen');
  const tabs = $('game-tabs');
  tabs.innerHTML = '';
  for (const g of GAMES) {
    const b = document.createElement('button');
    b.className = 'btn' + (g === currentGame ? ' active' : '');
    b.textContent = g.title.replace('Mega Man', 'MM').replace(/^MM$/, 'MM1');
    b.title = g.title;
    b.onclick = () => { currentGame = g; showLibrary(); };
    tabs.append(b);
  }
  renderScoreFilter();
  loadTracks(currentGame);
}

/** Chart / speed / stop selector for the records shown in the song list */
function renderScoreFilter() {
  const view = getScoreView();
  const update = (patch: Partial<typeof view>) => {
    saveScoreView({ ...getScoreView(), ...patch });
    renderScoreFilter();
    renderTrackList();
  };
  const box = $('filter-charts');
  box.innerHTML = '';
  for (const c of CHARTS) {
    const b = document.createElement('button');
    b.className = 'btn small' + (c.id === view.chart ? ' active' : '');
    b.textContent = c.short;
    b.title = `${c.label}: ${c.description}`;
    b.onclick = () => update({ chart: c.id });
    box.append(b);
  }
  const speed = $<HTMLSelectElement>('filter-speed');
  speed.value = String(view.speed);
  speed.onchange = () => update({ speed: Number(speed.value) });
  const stop = $<HTMLInputElement>('filter-stop');
  stop.checked = view.stop;
  stop.onchange = () => update({ stop: stop.checked });
}

async function loadTracks(game: GameInfo) {
  const status = $('track-status');
  const cacheKey = `tracks:${game.id}`;
  const cached = loadJson<{ v: number; tracks: DiscoveredTrack[] }>(cacheKey, { v: 0, tracks: [] });
  if (cached.v === DISCOVERY_VERSION && cached.tracks.length) {
    tracks = cached.tracks;
  } else {
    $('track-list').innerHTML = '';
    status.textContent = 'Scanning the sound driver for music…';
    tracks = await worker.discover(game.id, (p) => { status.textContent = `Scanning the sound driver for music… ${Math.round(p * 100)}%`; });
    saveJson(cacheKey, { v: DISCOVERY_VERSION, tracks });
  }
  if (game !== currentGame) return;
  status.textContent = `${tracks.length} tracks found. Click a name to rename it, ▶ to preview.`;
  renderTrackList();
  // Fill in lengths in the background
  for (const t of tracks) {
    if (game !== currentGame) return;
    await getAnalysis(game.id, t.id);
    renderTrackList();
  }
}

const partCache = new Map<string, { notes: TargetNote[]; difficulty?: Difficulty }>();

/** A part's notes at a speed, as played in score runs (cached) */
function partEntry(gameId: string, a: SongAnalysis, chart: Chart, speed: number) {
  const key = `${gameId}:${a.id}:${chart.id}:${speed}`;
  let e = partCache.get(key);
  if (!e) {
    e = { notes: buildPart(a, chart.id, { minFrames: SCORE_RUN_RULES.minNoteFrames, speed, octaveShift: 0 }) };
    partCache.set(key, e);
  }
  return e;
}
const partTargets = (gameId: string, a: SongAnalysis, chart: Chart, speed: number) => partEntry(gameId, a, chart, speed).notes;

/** Difficulty of a part at a speed, as played in score runs */
function chartDifficulty(gameId: string, a: SongAnalysis, chart: Chart, speed: number) {
  const e = partEntry(gameId, a, chart, speed);
  return (e.difficulty ??= rateDifficulty(e.notes));
}

function difficultyBadge(d: Difficulty) {
  const tier = d.rating < 3 ? 'easy' : d.rating < 5 ? 'normal' : d.rating < 7 ? 'hard' : d.rating < 8.5 ? 'expert' : 'insane';
  const title = `${d.nps.toFixed(1)} presses/s (busiest ${d.peakNps.toFixed(1)}) · average jump ${d.leap.toFixed(1)} semitones · ${Math.round(d.chordShare * 100)}% chords`;
  return `<span class="diff ${tier}" title="${title}">${d.rating.toFixed(1)}</span>`;
}

/** CSS class colouring a grade: gold S, green A, yellow B, orange C, red below */
const gradeClass = (grade: string) => `g-${['S', 'A', 'B', 'C'].includes(grade) ? grade : 'D'}`;

function trackName(gameId: string, t: DiscoveredTrack, index: number) {
  return getTrackNames()[trackKey(gameId, t.id)] ?? `${t.kind === 'song' ? 'Track' : 'Jingle'} ${String(index + 1).padStart(2, '0')}`;
}

function renderTrackList() {
  const body = $('track-list');
  body.innerHTML = '';
  const view = getScoreView();
  const chart = CHARTS.find((c) => c.id === view.chart) ?? CHARTS[0];
  let played = 0;
  let fullCombos = 0;
  let shown = 0;
  tracks.forEach((t, i) => {
    const key = trackKey(currentGame.id, t.id);
    const a = analyses.get(key);
    // Record for the selected chart / speed / stop setting
    const rec = bestFor({ game: currentGame.id, id: t.id, ...view });
    // Hide tracks without notes for the selected part (numbers stay stable)
    if (a && !partTargets(currentGame.id, a, chart, 1).length) return;
    shown++;
    const diff = a ? `<td>${difficultyBadge(chartDifficulty(currentGame.id, a, chart, view.speed))}</td>` : '<td>…</td>';
    if (rec) { played++; if (rec.fullCombo) fullCombos++; }
    const best = rec
      ? `<td class="best" title="${rec.plays} play${rec.plays === 1 ? '' : 's'} · set ${new Date(rec.date).toLocaleDateString()}"><span class="${gradeClass(rec.grade)}"><span class="grade-cell">${rec.grade}</span> ${rec.score.toLocaleString()}</span>${rec.fullCombo ? ' <span class="fc">★FC</span>' : ''}<span class="acc">${(rec.accuracy * 100).toFixed(1)}%</span></td>`
      : '<td class="best none">—</td>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${String(i + 1).padStart(2, '0')}</td>
      <td class="name"></td>
      <td class="kind">${t.kind}</td>
      <td>${a ? formatTime(a.endFrame * FRAME_SECONDS) : '…'}</td>
      ${diff}
      ${best}
      <td class="row-actions">
        <button class="btn small" data-act="preview">${previewing === key ? '■' : '▶'}</button>
        <button class="btn small primary" data-act="play">Play</button>
      </td>`;
    const nameCell = tr.querySelector<HTMLElement>('.name')!;
    nameCell.textContent = trackName(currentGame.id, t, i);
    nameCell.title = 'Click to rename';
    nameCell.insertAdjacentHTML('beforeend', '<span class="edit">✎ rename</span>');
    nameCell.onclick = () => editName(nameCell, key, trackName(currentGame.id, t, i));
    tr.querySelector<HTMLButtonElement>('[data-act=preview]')!.onclick = () => togglePreview(t);
    tr.querySelector<HTMLButtonElement>('[data-act=play]')!.onclick = () => openSongDialog(t, trackName(currentGame.id, t, i));
    body.append(tr);
  });
  $('filter-summary').textContent = `${played} / ${shown} played${fullCombos ? ` · ${fullCombos} full combo${fullCombos === 1 ? '' : 's'}` : ''}`;
  $('filter-summary').title = describeView(view);
}

function editName(cell: HTMLElement, key: string, current: string) {
  if (cell.querySelector('input')) return;
  const inputEl = document.createElement('input');
  inputEl.value = current;
  cell.textContent = '';
  cell.append(inputEl);
  inputEl.focus();
  inputEl.select();
  const commit = () => {
    const names = getTrackNames();
    const v = inputEl.value.trim();
    if (v) names[key] = v; else delete names[key];
    saveTrackNames(names);
    renderTrackList();
  };
  inputEl.onblur = commit;
  inputEl.onkeydown = (e) => { if (e.key === 'Enter') inputEl.blur(); if (e.key === 'Escape') renderTrackList(); };
}

async function getAnalysis(gameId: string, id: number) {
  const key = trackKey(gameId, id);
  let a = analyses.get(key);
  if (!a) {
    a = await worker.analyze(gameId, id);
    analyses.set(key, a);
  }
  return a;
}

async function togglePreview(t: DiscoveredTrack) {
  const key = trackKey(currentGame.id, t.id);
  audio.stop();
  if (previewing === key) { previewing = null; renderTrackList(); return; }
  previewing = key;
  renderTrackList();
  await audio.resume();
  const a = await getAnalysis(currentGame.id, t.id);
  const pcm = await worker.render(currentGame.id, t.id, {
    sampleRate: SAMPLE_RATE, gains: [1, 1, 1, 1, 1], speed: 1, endFrame: a.endFrame, fadeSeconds: a.loopStart >= 0 ? 4 : 0,
  });
  if (previewing !== key) return;
  audio.setSong(pcm, SAMPLE_RATE);
  audio.play(0);
}

// ---------- song options ----------

async function openSongDialog(t: DiscoveredTrack, title: string) {
  audio.stop();
  previewing = null;
  const a = await getAnalysis(currentGame.id, t.id);
  const settings = getSettings();
  const dialog = $<HTMLDialogElement>('song-dialog');
  const form = $<HTMLFormElement>('song-form');
  $('song-title').textContent = `${currentGame.title} — ${title}`;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  for (const [k, v] of Object.entries(settings)) {
    const el = field(k);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = String(v);
  }

  let mode = loadJson<{ mode: 'practice' | 'score' }>('mode', { mode: 'practice' }).mode;
  const songKey = trackKey(currentGame.id, t.id);
  // Score runs start from the song list's part / speed / stop selection; practice remembers a part per song
  const view = getScoreView();
  const practiceMemo = loadJson<Record<string, PartId>>('practicePart', {});
  const targetOpts = () => ({
    minFrames: Number(field('minNoteFrames').value), speed: Number(field('speed').value), octaveShift: Number(field('octaveShift').value),
  });
  const notesFor = (c: Chart) => buildPart(a, c.id, targetOpts());
  const available = (c: Chart) => partTargets(currentGame.id, a, c, 1).length > 0;
  let chart = CHARTS.find((c) => c.id === (mode === 'score' ? view.chart : practiceMemo[songKey] ?? 'rh') && available(c))
    ?? CHARTS.find(available) ?? CHARTS[0];
  const currentScoreKey = (): ScoreKey => ({ game: currentGame.id, id: t.id, chart: chart.id, speed: Number(field('speed').value), stop: field('waitMode').checked });

  const renderBest = () => {
    const k = currentScoreKey();
    const rec = bestFor(k);
    const desc = `${chart.label} · ${Math.round(k.speed * 100)}%${k.stop ? ' · stop mode' : ''}`;
    $('score-best').innerHTML = rec
      ? `Best (${escapeHtml(desc)}): <b class="${gradeClass(rec.grade)}">${rec.score.toLocaleString()} ${rec.grade}</b> · ${(rec.accuracy * 100).toFixed(1)}%${rec.fullCombo ? ' <span class="fc">FULL COMBO</span>' : ''} · ${rec.plays} play${rec.plays === 1 ? '' : 's'}`
      : `No record yet for ${escapeHtml(desc)}.`;
  };
  const updateRangeWarning = () => {
    const ns = notesFor(chart);
    const { lo, hi } = rangeOf(ns);
    $('range-warning').textContent = ns.length
      ? `Needs keys ${noteName(lo)}–${noteName(hi)}.` + (lo < 36 || hi > 96 ? ' That is outside a 61-key keyboard (C2–C7); try an octave shift.' : '')
      : 'This part has no notes with the current Notes setting.';
    $<HTMLButtonElement>('play-btn').disabled = !ns.length;
  };
  /** Part radios with note counts, ranges and difficulty for the current settings */
  const renderParts = () => {
    const box = $('part-options');
    box.innerHTML = '';
    const speed = Number(field('speed').value);
    for (const c of CHARTS) {
      const ns = notesFor(c);
      const ok = ns.length > 0;
      const { lo, hi } = rangeOf(ns);
      const label = document.createElement('label');
      label.className = ok ? '' : 'disabled';
      label.style.color = c.color;
      label.innerHTML = `<input type="radio" name="part" ${c === chart ? 'checked' : ''} ${ok ? '' : 'disabled'} />
        <span class="hand">${ok ? difficultyBadge(chartDifficulty(currentGame.id, a, c, speed)) : ''}</span>${c.label}
        <small>${ok ? `${c.description} · ${ns.length} notes · ${noteName(lo)}–${noteName(hi)}` : 'not in this song'}</small>`;
      label.querySelector('input')!.onchange = () => { chart = c; renderBest(); updateRangeWarning(); };
      box.append(label);
    }
    renderBest();
    updateRangeWarning();
  };

  // ---- practice / score mode ----
  const locked = ['minNoteFrames', 'octaveForgiving', 'loop'] as const;
  const setMode = (m: typeof mode) => {
    mode = m;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#mode-switch [data-mode]')) b.classList.toggle('active', b.dataset.mode === m);
    $('score-info').hidden = m !== 'score';
    // Score runs use fixed rules; show them and restore practice values afterwards
    for (const k of locked) {
      const el = field(k);
      el.disabled = m === 'score';
      const v = m === 'score' ? SCORE_RUN_RULES[k] : settings[k];
      if (el.type === 'checkbox') el.checked = Boolean(v); else el.value = String(v);
    }
    // Speed and stop mode are kept separately for practice and score runs
    field('speed').value = String(m === 'score' ? view.speed : settings.speed);
    field('waitMode').checked = m === 'score' ? view.stop : settings.waitMode;
    renderParts();
  };
  for (const b of document.querySelectorAll<HTMLButtonElement>('#mode-switch [data-mode]')) {
    b.onclick = () => setMode(b.dataset.mode as typeof mode);
  }
  setMode(mode);
  field('minNoteFrames').onchange = renderParts;
  field('octaveShift').onchange = renderParts;
  const onRecordSetting = () => {
    if (mode === 'score') Object.assign(view, { speed: Number(field('speed').value), stop: field('waitMode').checked });
    renderParts();
  };
  field('speed').onchange = onRecordSetting;
  field('waitMode').onchange = onRecordSetting;

  dialog.onclose = () => {
    if (dialog.returnValue !== 'play') return;
    const next: Settings = { ...settings };
    for (const k of Object.keys(settings) as (keyof Settings)[]) {
      const el = field(k);
      if (!el || (mode === 'score' && [...locked, 'speed', 'waitMode'].includes(k))) continue;
      (next as unknown as Record<string, number | boolean>)[k] = el.type === 'checkbox' ? el.checked : Number(el.value);
    }
    saveSettings(next);
    saveJson('mode', { mode });
    if (mode === 'score') {
      const key = currentScoreKey();
      saveScoreView({ chart: chart.id, speed: key.speed, stop: key.stop });
      startSession(t, title, a, chart, { ...next, ...SCORE_RUN_RULES, speed: key.speed, waitMode: key.stop }, { chart, key });
    } else {
      practiceMemo[songKey] = chart.id;
      saveJson('practicePart', practiceMemo);
      startSession(t, title, a, chart, next, null);
    }
  };
  dialog.returnValue = '';
  dialog.showModal();
}

// ---------- gameplay ----------

let session: Session | null = null;

/** A score run's chart and record key; null for practice */
type ScoreRun = { chart: Chart; key: ScoreKey } | null;

async function startSession(t: DiscoveredTrack, title: string, a: SongAnalysis, part: Chart, settings: Settings, scoreRun: ScoreRun) {
  showScreen('play-screen');
  $('loading').hidden = false;
  $('results-overlay').hidden = true;
  $('pause-overlay').hidden = true;
  $('hud-title').textContent = scoreRun
    ? `${title} · ${part.label} · ${Math.round(settings.speed * 100)}%${settings.waitMode ? ' · STOP' : ''}`
    : `${title} · ${part.label}`;
  await audio.resume();
  const opts = { minFrames: settings.minNoteFrames, speed: settings.speed, octaveShift: settings.octaveShift };
  // Quieten the channels that mostly carry your part
  const mine = partChannels(a, part.id, opts);
  const gains = [0, 1, 2, 3, 4].map((ch) => (mine.includes(ch) ? settings.myPartVolume : 1));
  const pcm = await worker.render(currentGame.id, t.id, {
    sampleRate: SAMPLE_RATE, gains, speed: settings.speed, endFrame: a.endFrame,
    fadeSeconds: a.loopStart >= 0 && !settings.loop ? 3 : 0,
  });
  audio.setSong(pcm, SAMPLE_RATE);
  // Loop the song's own loop section; songs that end (jingles, etc.) repeat from the top
  const secs = FRAME_SECONDS / settings.speed;
  const loopSpan = settings.loop
    ? { start: Math.max(0, a.loopStart) * secs, length: (a.endFrame - Math.max(0, a.loopStart)) * secs }
    : null;
  audio.setLoop(loopSpan && { start: loopSpan.start, end: loopSpan.start + loopSpan.length });
  $('loading').hidden = true;

  const notes = buildPart(a, part.id, opts);
  assignFingering(notes);
  const restart = () => { session?.destroy(); startSession(t, title, a, part, settings, scoreRun); };
  const quit = () => { session?.destroy(); session = null; document.onkeydown = null; showLibrary(); };

  session?.destroy();
  session = new Session($<HTMLCanvasElement>('highway'), audio, input, notes, settings, hud, (r) => showResults(r, settings, scoreRun), loopSpan);
  session.start();

  for (const btn of document.querySelectorAll<HTMLButtonElement>('#play-screen [data-action]')) {
    btn.onclick = () => {
      const act = btn.dataset.action;
      if (act === 'resume') { session?.togglePause(); $('pause-overlay').hidden = true; }
      if (act === 'finish') { $('pause-overlay').hidden = true; session?.finishNow(); }
      if (act === 'restart') restart();
      if (act === 'quit') quit();
    };
  }
  document.onkeydown = (e) => {
    if (e.key === 'Escape' && session && $('results-overlay').hidden) {
      e.preventDefault();
      session.togglePause();
      $('pause-overlay').hidden = !session.paused;
    }
  };
}

const hud = {
  update(s: Parameters<SessionHud['update']>[0]) {
    $('hud-pass').textContent = s.pass ? `LOOP · PASS ${s.pass}` : '';
    $('pass-banner').textContent = s.passBanner ?? '';
    $('hud-score').textContent = s.score.toLocaleString();
    $('hud-combo').textContent = s.combo >= 5 ? `${s.combo} COMBO` : '';
    $('hud-accuracy').textContent = `${(s.accuracy * 100).toFixed(1)}%`;
    $('hud-progress').style.width = `${s.progress * 100}%`;
    $('countdown').textContent = s.countdown ? String(s.countdown) : '';
    $('wait-banner').textContent = s.waiting ? `Play ${s.waiting}` : '';
  },
};

function showResults(r: SessionResult, settings: Settings, scoreRun: ScoreRun) {
  if (!r.completed) return;
  const { stats, summary } = r;
  let banner = '<div class="new-best">Practice run (not recorded)</div>';
  if (scoreRun) {
    const { previous, isBest } = recordRun(scoreRun.key, stats, summary);
    const k = scoreRun.key;
    const desc = `${scoreRun.chart.label} · ${Math.round(k.speed * 100)}%${k.stop ? ' · stop mode' : ''}`;
    banner = isBest
      ? `<div class="new-best">NEW BEST! ${escapeHtml(desc)}${previous ? `<br><small>previous ${previous.score.toLocaleString()}</small>` : ''}</div>`
      : `<div class="calib">${escapeHtml(desc)} · best <span class="${gradeClass(previous!.grade)}">${previous!.score.toLocaleString()} (${previous!.grade})</span></div>`;
  }
  $('res-grade').textContent = summary.grade;
  $('res-grade').className = `grade ${gradeClass(summary.grade)}`;
  const offset = Math.round(summary.meanOffsetMs);
  const offsetText = Math.abs(offset) < 10 ? 'Your timing is centered.' : `On average you play ${Math.abs(offset)} ms ${offset > 0 ? 'late' : 'early'}.`;
  $('res-body').innerHTML = `
    ${summary.fullCombo ? '<div class="fc">★ FULL COMBO ★</div>' : ''}
    ${banner}
    <table>
      <tr><td>Accuracy</td><td>${(summary.accuracy * 100).toFixed(1)}%</td></tr>
      <tr><td>Score</td><td>${stats.score.toLocaleString()}</td></tr>
      <tr><td>Max combo</td><td>${stats.maxCombo}</td></tr>
      <tr><td style="color:#80f0ff">Perfect</td><td>${stats.counts.perfect}</td></tr>
      <tr><td style="color:#58f898">Great</td><td>${stats.counts.great}</td></tr>
      <tr><td style="color:#f8d878">Good</td><td>${stats.counts.good}</td></tr>
      <tr><td style="color:#f85858">Miss</td><td>${stats.counts.miss}</td></tr>
      <tr><td>Wrong notes</td><td>${stats.wrong}</td></tr>
    </table>
    ${r.passes.length ? `<div class="passes">${r.passes.map((p, i) => `Pass ${i + 1}: ${(p * 100).toFixed(0)}%`).join(' · ')}</div>` : ''}
    ${settings.waitMode ? '' : `<div class="calib">${offsetText}
      ${Math.abs(offset) >= 10 ? `<br><button class="btn small" id="apply-calib">Compensate ${offset > 0 ? '+' : ''}${offset} ms</button>` : ''}</div>`}`;
  const calib = document.getElementById('apply-calib');
  if (calib) calib.onclick = () => {
    const s = getSettings();
    s.latencyOffsetMs = Math.round(s.latencyOffsetMs + offset);
    saveSettings(s);
    calib.replaceWith(`Saved: latency offset is now ${s.latencyOffsetMs} ms.`);
  };
  $('results-overlay').hidden = false;
}

// ---------- utils ----------

function formatTime(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

boot().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<p class="error" style="padding:20px">Failed to start: ${escapeHtml(String(e))}</p>`);
});
