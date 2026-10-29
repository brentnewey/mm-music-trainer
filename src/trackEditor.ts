// Track editor: a piano roll of a song's three melodic channels, coloured by the
// hand that plays each note. Select a stretch of the song (or one note), narrow it
// to channels and sounds, then move it to a hand or remove it. The edits are rules
// (see song/hands.ts) saved per song in track-edits.json. A stretch can also be
// merged into one held note, for a vibrato or trill written as many short notes,
// and echoes on another channel can be joined to the notes they repeat.
import type { AudioEngine } from './audio/engine';
import { noteName } from './game/highway';
import { formatClock } from './sectionPicker';
import { FRAME_SECONDS, type Note, type SongAnalysis } from './song/analyze';
import { CHANNEL_HAND, applyMerges, roleOf, ruleCovers, soundOf, type EditRule, type Role } from './song/hands';

export interface EditorContext {
  title: string;
  analysis: SongAnalysis;
  edits: EditRule[];
  /** Called with the song's full list of edits after every change */
  save(edits: EditRule[]): void;
  audio: AudioEngine;
  /** Renders the song at 100% speed with per-channel gains [p1, p2, tri, noise, dmc] */
  render(gains: number[]): Promise<Float32Array>;
  sampleRate: number;
  /** Where to pick up, when coming back from practising a selection */
  view?: EditorView;
}

/**
 * The editor's selection, sound filters and scroll, to reopen it as it was. Without
 * the zoom and scroll it opens fitted to the song, with the selection in view
 */
export interface EditorView {
  range: { start: number; end: number } | null;
  /** The picked note's channel and start frame */
  picked: { ch: number; start: number } | null;
  filter?: string[][];
  pps?: number;
  scroll?: number;
}

interface EdNote { n: Note; t: number; d: number; sound: string; role: Role }
interface Sound { key: string; letter: string; label: string; count: number }

const CHANNELS = ['Pulse 1', 'Pulse 2', 'Triangle'];
/** Removed notes are drawn as outlines */
const ROLE_COLORS: Record<Role, string> = { R: '#3cbcfc', L: '#fca044', off: '#8890b8' };
type Action = EditRule['hand'];
const ROLE_NAMES: Record<Action, string> = { R: 'right hand', L: 'left hand', off: 'removed', default: 'usual hand', merge: 'merged into one note', join: 'echoes joined to the notes they repeat' };
const DUTY = ['12.5%', '25%', '50%', '75%'];
const AXIS_H = 18;
const LANE_H = 112;
const HEIGHT = AXIS_H + 3 * LANE_H;
/** Pointer movement (px) that turns a click into a drag */
const DRAG_PX = 4;
/** Range edges snap to a note onset this close (px) */
const SNAP_PX = 6;
/** Score runs leave out notes shorter than this (frames); the summary counts what they play */
const SCORE_MIN_FRAMES = 4;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const r3 = (t: number) => Math.round(t * 1000) / 1000;
/** Whether a note is long enough to show in play (score runs leave out shorter ones) */
const playable = (e: EdNote) => e.n.end - e.n.start >= SCORE_MIN_FRAMES;

/**
 * What to do after the editor closes: practise a stretch of the song (100%-speed
 * seconds) and then come back to `view`, or nothing
 */
export type EditorResult = { practice: { start: number; end: number }; view: EditorView } | null;

export function openTrackEditor(ctx: EditorContext): Promise<EditorResult> {
  return new Promise((resolve) => new TrackEditor(ctx, resolve));
}

class TrackEditor {
  private dialog = $<HTMLDialogElement>('edit-dialog');
  private roll = $('edit-roll');
  private inner = this.roll.querySelector<HTMLElement>('.edit-roll-inner')!;
  private canvas = this.roll.querySelector('canvas')!;
  private edits: EditRule[];
  /** The song's melodic notes before any edits */
  private raw: Note[];
  /** Notes after the edits' merges, with their roles */
  private notes: EdNote[] = [];
  private onsets: number[] = [];
  private sounds: Sound[][];
  private duration: number;
  /** Pixels per second */
  private pps = 40;
  private range: { start: number; end: number } | null = null;
  private picked: EdNote | null = null;
  /** Sounds (keys) included in a range selection, per channel */
  private filter: Set<string>[];
  private highlight: ((n: EdNote) => boolean) | null = null;
  private drag: { x: number; t: number; note: EdNote | null; moved: boolean } | null = null;
  private listening = false;
  private pcmCache = new Map<string, Float32Array>();
  /** Each channel lane's pitch-to-y mapping and note height, as last drawn */
  private lanes: { y: (midi: number) => number; h: number }[] = [];
  private frame = 0;

  private result: EditorResult = null;

  constructor(private ctx: EditorContext, private done: (r: EditorResult) => void) {
    const a = ctx.analysis;
    this.edits = ctx.edits.map((r) => ({ ...r }));
    this.duration = Math.max(1, a.endFrame * FRAME_SECONDS);
    this.raw = a.notes.filter((n) => n.ch < 3 && n.start < a.endFrame);
    this.sounds = [0, 1, 2].map((ch) => this.soundsOf(ch));
    this.filter = this.sounds.map((ss) => new Set(ss.map((s) => s.key)));
    this.applyEdits();

    $('edit-title').textContent = `Edit parts — ${ctx.title}`;
    this.canvas.onpointerdown = this.down;
    this.canvas.onpointermove = this.move;
    this.canvas.onpointerup = this.up;
    this.canvas.onpointerleave = () => { this.highlight = null; this.draw(); };
    this.roll.onscroll = () => this.draw();
    $('edit-zoom-in').onclick = () => this.zoom(1.5);
    $('edit-zoom-out').onclick = () => this.zoom(1 / 1.5);
    $('edit-fit').onclick = () => this.zoom(0);
    $('edit-listen').onclick = () => (this.listening ? this.stopListening() : this.listen());
    $('edit-whole').onclick = () => this.select(null, null);
    $('edit-clear').onclick = () => {
      if (!this.edits.length || !confirm('Remove every edit to this song? Its hands go back to pulses right, triangle left.')) return;
      this.commit([]);
    };
    for (const b of document.querySelectorAll<HTMLButtonElement>('#edit-actions [data-role]')) {
      b.onclick = () => this.assign(b.dataset.role as Action);
    }
    $('edit-done').onclick = () => this.dialog.close();
    $('edit-practice').onclick = () => {
      // The selected stretch, or from the picked note (or the start) to the end
      const start = this.range?.start ?? this.picked?.t ?? 0;
      const view: EditorView = {
        range: this.range,
        picked: this.picked && { ch: this.picked.n.ch, start: this.picked.n.start },
        filter: this.filter.map((f) => [...f]),
        pps: this.pps,
        scroll: this.roll.scrollLeft,
      };
      this.result = { practice: { start, end: this.range?.end ?? this.duration }, view };
      this.dialog.close();
    };
    this.dialog.onclose = () => {
      this.stopListening();
      this.dialog.onclose = null;
      this.done(this.result);
    };

    this.dialog.showModal();
    const v = ctx.view;
    this.pps = Math.max(this.fitPps(), v?.pps ?? 0);
    if (v) {
      this.filter = this.sounds.map((ss, ch) => new Set(ss.map((s) => s.key).filter((k) => v.filter?.[ch]?.includes(k) ?? true)));
      this.range = v.range;
      const p = v.picked;
      this.picked = p && (this.notes.find((e) => e.n.ch === p.ch && e.n.start === p.start) ?? null);
    }
    this.layout();
    if (v) this.roll.scrollLeft = v.scroll ?? (v.range ? v.range.start * this.pps - 40 : 0);
    this.renderPanel();
  }

  // ---------- model ----------

  /** A channel's sounds, most-used first, lettered A, B, C… */
  private soundsOf(ch: number): Sound[] {
    const counts = new Map<string, number>();
    for (const n of this.raw) if (n.ch === ch) counts.set(soundOf(n), (counts.get(soundOf(n)) ?? 0) + 1);
    return [...counts].sort((x, y) => y[1] - x[1]).map(([key, count], i) => {
      const [duty, vel] = key.split(':').map(Number);
      const letter = String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : '');
      return { key, letter, count, label: ch === 2 ? `volume ${vel}` : `${DUTY[duty]} pulse, volume ${vel}` };
    });
  }

  private soundName(ch: number, key: string) {
    return `sound ${this.sounds[ch].find((s) => s.key === key)?.letter ?? '?'}`;
  }

  private applyEdits() {
    const end = this.ctx.analysis.endFrame;
    this.notes = applyMerges(this.raw, this.edits).map((n) => ({
      n, t: n.start * FRAME_SECONDS, d: (Math.min(n.end, end) - n.start) * FRAME_SECONDS, sound: soundOf(n), role: roleOf(n, this.edits),
    }));
    this.onsets = [...new Set(this.notes.map((e) => e.t))].sort((x, y) => x - y);
    // A picked note may have been merged away or replaced
    const p = this.picked;
    this.picked = p && (this.notes.find((e) => e.n.ch === p.n.ch && e.n.start === p.n.start) ?? null);
  }

  private commit(edits: EditRule[]) {
    this.edits = edits;
    this.applyEdits();
    this.ctx.save(this.edits.map((r) => ({ ...r })));
    this.renderPanel();
    this.draw();
  }

  private inRange(e: EdNote) {
    return !this.range || (e.t >= this.range.start - 1e-4 && e.t < this.range.end - 1e-4);
  }

  /** The notes an action would change */
  private selected(): EdNote[] {
    if (this.picked) return [this.picked];
    return this.notes.filter((e) => this.inRange(e) && this.filter[e.n.ch].has(e.sound));
  }

  /** Whether anything narrower than the whole song is selected */
  private narrowed() {
    return !!(this.picked || this.range || this.filter.some((f, ch) => f.size < this.sounds[ch].length));
  }

  /** Whether merging can apply: a stretch of the song with two or more notes on a channel */
  private canMerge(sel: EdNote[]) {
    return !this.picked && !!this.range && [0, 1, 2].some((ch) => sel.filter((e) => e.n.ch === ch).length > 1);
  }

  /** Adds edits sending the selection to a hand, removing it, or merging it */
  private assign(role: Action) {
    const sel = this.selected();
    if (!sel.length || (role === 'merge' && !this.canMerge(sel))) return;
    const added: EditRule[] = [];
    if (this.picked) {
      // One note: a window narrower than a frame around its start
      const { n, t } = this.picked;
      added.push({ ch: n.ch, from: r3(t - 0.004), to: r3(t + 0.004), hand: role });
    } else {
      const span = this.range ? { from: r3(this.range.start), to: r3(this.range.end) } : {};
      for (const ch of [0, 1, 2]) {
        if (sel.filter((e) => e.n.ch === ch).length < (role === 'merge' ? 2 : 1)) continue;
        const f = this.filter[ch];
        if (f.size === this.sounds[ch].length) added.push({ ch, ...span, hand: role });
        else for (const s of this.sounds[ch]) if (f.has(s.key)) added.push({ ch, sound: s.key, ...span, hand: role });
      }
    }
    this.commit([...this.edits, ...added]);
  }

  private select(range: { start: number; end: number } | null, picked: EdNote | null) {
    this.range = range;
    this.picked = picked;
    this.renderPanel();
    this.draw();
  }

  // ---------- panel ----------

  private renderPanel() {
    const sel = this.selected();
    const label = $('edit-sel-label');
    if (this.picked) {
      const { n, t } = this.picked;
      label.innerHTML = `One note: <b>${noteName(n.midi)}</b> on ${CHANNELS[n.ch]} (${this.soundName(n.ch, this.picked.sound)}) at ${formatClock(t)}, ${ROLE_NAMES[this.picked.role]}`;
    } else {
      const where = this.range ? `<b>${formatClock(this.range.start)} – ${formatClock(this.range.end)}</b>` : '<b>Whole song</b>';
      label.innerHTML = `${where} · ${sel.length} note${sel.length === 1 ? '' : 's'}`;
    }
    $<HTMLButtonElement>('edit-whole').disabled = !this.range && !this.picked;

    // Channel and sound filter (ranges and the whole song only)
    const box = $('edit-filter');
    box.innerHTML = '';
    box.classList.toggle('disabled', !!this.picked);
    for (const ch of [0, 1, 2]) {
      const sounds = this.sounds[ch];
      if (!sounds.length) continue;
      const f = this.filter[ch];
      const row = document.createElement('div');
      row.className = 'edit-filter-row';
      const chLabel = document.createElement('label');
      chLabel.className = 'edit-ch';
      chLabel.innerHTML = `<input type="checkbox" ${f.size ? 'checked' : ''} ${this.picked ? 'disabled' : ''} /> ${CHANNELS[ch]}`;
      const chBox = chLabel.querySelector('input')!;
      chBox.indeterminate = f.size > 0 && f.size < sounds.length;
      chBox.onchange = () => {
        this.filter[ch] = new Set(chBox.checked ? sounds.map((s) => s.key) : []);
        this.renderPanel();
        this.draw();
      };
      row.append(chLabel);
      // A channel with one sound needs no sound choice
      if (sounds.length > 1) {
        for (const s of sounds) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip' + (f.has(s.key) ? ' on' : '');
          chip.disabled = !!this.picked;
          chip.textContent = `${s.letter} · ${s.count}`;
          chip.title = `Sound ${s.letter}: ${s.label}, ${s.count} note${s.count === 1 ? '' : 's'}. Hover to see its notes; click to include or leave out.`;
          chip.onclick = () => {
            if (f.has(s.key)) f.delete(s.key); else f.add(s.key);
            this.renderPanel();
            this.draw();
          };
          chip.onpointerenter = () => { this.highlight = (e) => e.n.ch === ch && e.sound === s.key; this.draw(); };
          chip.onpointerleave = () => { this.highlight = null; this.draw(); };
          row.append(chip);
        }
      }
      box.append(row);
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#edit-actions [data-role]')) {
      b.disabled = b.dataset.role === 'merge' ? !this.canMerge(sel) : !sel.length;
    }

    // Edits so far, newest last
    const list = $('edit-rules');
    list.innerHTML = '';
    this.edits.forEach((r, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${this.describeRule(r)}</span>`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn small';
      del.textContent = '✕';
      del.title = 'Undo this edit';
      del.onclick = () => this.commit(this.edits.filter((_, j) => j !== i));
      li.append(del);
      li.onpointerenter = () => { this.highlight = (e) => ruleCovers(r, e.n); this.draw(); };
      li.onpointerleave = () => { this.highlight = null; this.draw(); };
      list.append(li);
    });
    $('edit-none').hidden = this.edits.length > 0;
    $<HTMLButtonElement>('edit-clear').disabled = !this.edits.length;

    // What score runs will play
    const counts: Record<Role, number> = { R: 0, L: 0, off: 0 };
    for (const e of this.notes) if (playable(e)) counts[e.role]++;
    $('edit-summary').innerHTML = `<span style="color:${ROLE_COLORS.R}">■</span> Right hand ${counts.R} · <span style="color:${ROLE_COLORS.L}">■</span> Left hand ${counts.L} · <span class="removed">□</span> Removed ${counts.off} <small>(notes in a score run)</small>`;
  }

  private describeRule(r: EditRule) {
    const to = r.hand === 'default' ? `usual hand (${CHANNEL_HAND[r.ch] === 'L' ? 'left' : 'right'})` : ROLE_NAMES[r.hand];
    if (r.from !== undefined && r.to !== undefined && r.to - r.from < 0.01) {
      const e = this.notes.find((x) => ruleCovers(r, x.n));
      return `${CHANNELS[r.ch]} ${e ? noteName(e.n.midi) : 'note'} at ${formatClock(r.from + 0.004)} → ${to}`;
    }
    const sound = r.sound !== undefined ? ` ${this.soundName(r.ch, r.sound)}` : '';
    const when = r.from === undefined && r.to === undefined ? 'whole song'
      : `${r.from === undefined ? 'start' : formatClock(r.from)} – ${r.to === undefined ? 'end' : formatClock(r.to)}`;
    return `${CHANNELS[r.ch]}${sound}, ${when} → ${to}`;
  }

  // ---------- roll ----------

  private fitPps() { return Math.max(4, (this.roll.clientWidth - 2) / this.duration); }

  /** Multiplies the zoom by `factor` (0 = fit the song), keeping the view's centre in place */
  private zoom(factor: number) {
    const w = this.roll.clientWidth;
    const centre = (this.roll.scrollLeft + w / 2) / this.pps;
    this.pps = factor ? Math.min(400, Math.max(this.fitPps(), this.pps * factor)) : this.fitPps();
    this.layout();
    this.roll.scrollLeft = centre * this.pps - w / 2;
    this.draw();
  }

  private layout() {
    this.inner.style.width = `${Math.ceil(this.duration * this.pps)}px`;
    this.inner.style.height = `${HEIGHT}px`;
    this.draw();
  }

  private timeAt(clientX: number) {
    const r = this.canvas.getBoundingClientRect();
    return Math.max(0, Math.min(this.duration, (clientX - r.left + this.roll.scrollLeft) / this.pps));
  }

  private snap(t: number) {
    let best = t;
    let dist = SNAP_PX / this.pps;
    for (const o of this.onsets) if (Math.abs(o - t) < dist) { best = o; dist = Math.abs(o - t); }
    return Math.abs(t - this.duration) < SNAP_PX / this.pps ? this.duration : best;
  }

  private laneGeometry(ch: number) {
    const ps = this.notes.filter((e) => e.n.ch === ch).map((e) => e.n.midi);
    const lo = ps.length ? Math.min(...ps) : 60;
    const span = Math.max(ps.length ? Math.max(...ps) - lo : 0, 12);
    const top = AXIS_H + ch * LANE_H + 8;
    const bottom = AXIS_H + (ch + 1) * LANE_H - 8;
    const h = Math.max(2, Math.min(5, (bottom - top) / span));
    return { y: (m: number) => bottom - ((m - lo) / span) * (bottom - top) - h / 2, h };
  }

  /** The note under a point, if any */
  private noteAt(clientX: number, clientY: number): EdNote | null {
    const r = this.canvas.getBoundingClientRect();
    const t = this.timeAt(clientX);
    const y = clientY - r.top;
    const slack = 3 / this.pps;
    // Of the notes under the pointer, a note you play beats a sliver too short to show
    // in play (a drum hit's pitch sweep is several notes), then the nearest one wins
    let best: EdNote | null = null;
    let bestScore = Infinity;
    for (const e of this.notes) {
      if (t < e.t - slack || t > e.t + Math.max(e.d, 2 / this.pps) + slack) continue;
      const l = this.lanes[e.n.ch];
      const ny = l.y(e.n.midi);
      if (y < ny - 3 || y > ny + l.h + 3) continue;
      const score = (playable(e) ? 0 : 1000) + Math.abs(y - (ny + l.h / 2));
      if (score < bestScore) [best, bestScore] = [e, score];
    }
    return best;
  }

  private down = (ev: PointerEvent) => {
    this.canvas.setPointerCapture(ev.pointerId);
    this.drag = { x: ev.clientX, t: this.timeAt(ev.clientX), note: this.noteAt(ev.clientX, ev.clientY), moved: false };
  };

  private move = (ev: PointerEvent) => {
    const d = this.drag;
    if (!d) {
      this.canvas.style.cursor = this.noteAt(ev.clientX, ev.clientY) ? 'pointer' : 'crosshair';
      return;
    }
    if (!d.moved && Math.abs(ev.clientX - d.x) < DRAG_PX) return;
    d.moved = true;
    const t = this.timeAt(ev.clientX);
    this.range = { start: Math.min(d.t, t), end: Math.max(d.t, t) };
    this.picked = null;
    this.draw();
  };

  private up = () => {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.moved && this.range) {
      const range = { start: this.snap(this.range.start), end: this.snap(this.range.end) };
      this.select(range.end - range.start > 0.05 ? range : null, null);
    } else if (d.note) {
      this.select(null, d.note);
    } else {
      this.select(null, null);
    }
  };

  draw() {
    const c = this.canvas;
    const w = this.roll.clientWidth;
    if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    c.style.width = `${w}px`;
    c.style.height = `${HEIGHT}px`;
    c.width = Math.round(w * dpr);
    c.height = Math.round(HEIGHT * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t0 = this.roll.scrollLeft / this.pps;
    const t1 = t0 + w / this.pps;
    const x = (t: number) => (t - t0) * this.pps;
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, HEIGHT);

    // Lanes
    g.font = '11px system-ui, sans-serif';
    this.lanes = [0, 1, 2].map((ch) => this.laneGeometry(ch));
    for (const ch of [0, 1, 2]) {
      g.fillStyle = ch % 2 ? '#0a0e26' : '#060918';
      g.fillRect(0, AXIS_H + ch * LANE_H, w, LANE_H);
    }

    // Time axis
    const step = [1, 2, 5, 10, 30, 60].find((s) => s * this.pps >= 50) ?? 60;
    g.fillStyle = '#8f9acc';
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      g.fillRect(x(t), AXIS_H - 5, 1, 5);
      g.fillText(formatClock(t).replace(/\.0$/, ''), x(t) + 3, 12);
    }
    const loop = this.ctx.analysis.loopStart;
    if (loop > 0) {
      const lx = x(loop * FRAME_SECONDS);
      g.strokeStyle = '#8f9acc';
      g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(lx + 0.5, AXIS_H); g.lineTo(lx + 0.5, HEIGHT); g.stroke();
      g.setLineDash([]);
    }

    // Notes: dimmed outside the selection, white where hovered, outlined where removed,
    // faint where too short to show in play
    const sel = this.narrowed() ? new Set(this.selected()) : null;
    for (const e of this.notes) {
      if (e.t + e.d < t0 || e.t > t1) continue;
      const l = this.lanes[e.n.ch];
      const [nx, ny, nw] = [x(e.t), l.y(e.n.midi), Math.max(2, e.d * this.pps - 1)];
      const color = this.highlight?.(e) ? '#ffffff' : ROLE_COLORS[e.role];
      g.globalAlpha = (!sel || sel.has(e) ? 1 : 0.5) * (playable(e) ? 1 : 0.35);
      if (e.role === 'off') {
        g.strokeStyle = color;
        g.strokeRect(nx + 0.5, ny + 0.5, Math.max(1, nw - 1), Math.max(1, l.h - 1));
      } else {
        g.fillStyle = color;
        g.fillRect(nx, ny, nw, l.h);
      }
    }
    g.globalAlpha = 1;
    if (this.picked) {
      const e = this.picked;
      const l = this.lanes[e.n.ch];
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.strokeRect(x(e.t) - 2, l.y(e.n.midi) - 2, Math.max(2, e.d * this.pps - 1) + 4, l.h + 4);
      g.lineWidth = 1;
    }

    if (this.range) {
      const [a, b] = [x(this.range.start), x(this.range.end)];
      g.fillStyle = '#58f89818';
      g.fillRect(a, AXIS_H, b - a, HEIGHT - AXIS_H);
      g.fillStyle = '#58f898';
      g.fillRect(a - 1, 0, 2, HEIGHT);
      g.fillRect(b - 1, 0, 2, HEIGHT);
    }

    // Lane names, over the notes
    for (const ch of [0, 1, 2]) {
      const ty = AXIS_H + ch * LANE_H + 14;
      const label = CHANNELS[ch];
      g.fillStyle = '#000b';
      g.fillRect(2, ty - 11, g.measureText(label).width + 8, 15);
      g.fillStyle = '#c8d0f8';
      g.fillText(label, 6, ty);
    }

    if (this.listening) {
      const px = x(this.ctx.audio.position());
      g.fillStyle = '#ffffff';
      g.fillRect(px, 0, 2, HEIGHT);
    }
  }

  // ---------- listening ----------

  /** Plays the selection (or from the left of the view), soloing the selected channels if asked */
  private async listen() {
    const solo = $<HTMLInputElement>('edit-solo').checked;
    const chans = this.picked ? [this.picked.n.ch] : [0, 1, 2].filter((ch) => this.filter[ch].size > 0);
    const gains = [0, 1, 2, 3, 4].map((ch) => (!solo || chans.includes(ch) ? 1 : 0));
    const key = gains.join(',');
    this.listening = true;
    $('edit-listen').textContent = '■ Stop';
    const audio = this.ctx.audio;
    await audio.resume();
    let pcm = this.pcmCache.get(key);
    if (!pcm) {
      pcm = await this.ctx.render(gains);
      this.pcmCache.set(key, pcm);
    }
    if (!this.listening) return;
    const from = this.picked ? Math.max(0, this.picked.t - 1) : this.range?.start ?? this.roll.scrollLeft / this.pps;
    const until = this.picked ? this.picked.t + 1.5 : this.range?.end ?? this.duration;
    audio.setSong(pcm, this.ctx.sampleRate);
    audio.play(from);
    const tick = () => {
      if (!this.listening) return;
      const pos = audio.position();
      if (pos >= until) { this.stopListening(); return; }
      // Keep the playhead in view
      const px = pos * this.pps - this.roll.scrollLeft;
      if (px > this.roll.clientWidth - 40 || px < 0) this.roll.scrollLeft = pos * this.pps - 40;
      this.draw();
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  private stopListening() {
    this.listening = false;
    cancelAnimationFrame(this.frame);
    this.ctx.audio.stop();
    $('edit-listen').textContent = '▶ Listen';
    this.draw();
  }
}
