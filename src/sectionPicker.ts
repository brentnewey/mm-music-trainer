// Song dialog timeline: shows a part's notes across the song and lets you drag
// out a section to practise. Times are song seconds at 100% speed.
import type { TargetNote } from './game/judge';

export interface Section { start: number; end: number }

const HEIGHT = 72;
/** Pointer distance (px) at which an edge is grabbed instead of starting a new selection */
const EDGE_GRAB = 7;
/** Edges snap to a note onset this close (seconds) */
const SNAP = 0.35;
const MIN_LENGTH = 0.5;
const HAND_COLORS = { R: '#3cbcfc', L: '#fca044' };

export class SectionPicker {
  section: Section | null = null;
  private canvas = document.createElement('canvas');
  private notes: TargetNote[] = [];
  private onsets: number[] = [];
  private duration = 1;
  private loopStart = -1;
  private hover: number | null = null;
  private drag: { mode: 'start' | 'end' | 'move' | 'new'; anchor: number; orig: Section } | null = null;

  constructor(container: HTMLElement, private onChange: (s: Section | null) => void) {
    container.replaceChildren(this.canvas);
    this.canvas.className = 'section-canvas';
    this.canvas.addEventListener('pointerdown', this.down);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
    new ResizeObserver(() => this.draw()).observe(this.canvas);
  }

  /** `loopStart` is where the song's own loop begins (seconds), or negative if it doesn't loop */
  setNotes(notes: TargetNote[], duration: number, loopStart: number) {
    this.notes = notes;
    this.onsets = [...new Set(notes.map((n) => n.time))].sort((a, b) => a - b);
    this.duration = Math.max(duration, 1);
    this.loopStart = loopStart;
    this.draw();
  }

  setSection(s: Section | null) {
    this.section = s && s.end - s.start >= MIN_LENGTH ? { start: Math.max(0, s.start), end: Math.min(this.duration, s.end) } : null;
    this.draw();
  }

  /** Notes of the current part starting inside the section */
  notesIn(s: Section) {
    return this.notes.filter((n) => n.time >= s.start - 1e-3 && n.time < s.end - 1e-3).length;
  }

  private x(t: number) { return (t / this.duration) * this.canvas.clientWidth; }
  private time(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return Math.max(0, Math.min(this.duration, ((e.clientX - r.left) / r.width) * this.duration));
  }

  /** Nearest note onset within SNAP seconds, else `t` itself */
  private snap(t: number) {
    let best = t;
    let dist = SNAP;
    for (const o of this.onsets) {
      if (Math.abs(o - t) < dist) { best = o; dist = Math.abs(o - t); }
    }
    return Math.abs(t - this.duration) < SNAP ? this.duration : best;
  }

  private down = (e: PointerEvent) => {
    const t = this.time(e);
    const s = this.section;
    const px = (a: number) => Math.abs(this.x(a) - this.x(t));
    let mode: 'start' | 'end' | 'move' | 'new' = 'new';
    if (s && px(s.start) <= EDGE_GRAB) mode = 'start';
    else if (s && px(s.end) <= EDGE_GRAB) mode = 'end';
    else if (s && t > s.start && t < s.end) mode = 'move';
    this.drag = { mode, anchor: t, orig: s ?? { start: t, end: t } };
    this.canvas.setPointerCapture(e.pointerId);
    if (mode === 'new') this.section = { start: t, end: t };
    this.draw();
  };

  private move = (e: PointerEvent) => {
    const t = this.time(e);
    this.hover = t;
    const d = this.drag;
    if (d) {
      const { orig } = d;
      if (d.mode === 'new') this.section = { start: Math.min(d.anchor, t), end: Math.max(d.anchor, t) };
      else if (d.mode === 'start') this.section = { start: Math.min(t, orig.end), end: Math.max(t, orig.end) };
      else if (d.mode === 'end') this.section = { start: Math.min(orig.start, t), end: Math.max(orig.start, t) };
      else {
        const len = orig.end - orig.start;
        const start = Math.max(0, Math.min(this.duration - len, orig.start + t - d.anchor));
        this.section = { start, end: start + len };
      }
    }
    this.canvas.style.cursor = this.cursorAt(t);
    this.draw();
  };

  private up = () => {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    let s = this.section;
    if (s) {
      if (d.mode === 'move') {
        // Keep the length; snap the start
        const start = this.snap(s.start);
        s = { start, end: Math.min(this.duration, start + (s.end - s.start)) };
      } else {
        s = { start: this.snap(s.start), end: this.snap(s.end) };
      }
    }
    // A click without a real drag keeps the previous section
    if (!s || s.end - s.start < MIN_LENGTH) s = d.mode === 'new' ? d.orig.end > d.orig.start ? d.orig : null : d.orig;
    this.setSection(s);
    this.onChange(this.section);
  };

  private cursorAt(t: number) {
    const s = this.section;
    if (!s) return 'crosshair';
    const near = (a: number) => Math.abs(this.x(a) - this.x(t)) <= EDGE_GRAB;
    if (near(s.start) || near(s.end)) return 'ew-resize';
    return t > s.start && t < s.end ? 'grab' : 'crosshair';
  }

  draw() {
    const c = this.canvas;
    const w = c.clientWidth;
    if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(HEIGHT * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#000a';
    g.fillRect(0, 0, w, HEIGHT);

    // Notes as a mini piano roll
    const top = 6;
    const bottom = HEIGHT - 16;
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of this.notes) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); }
    const span = Math.max(hi - lo, 12);
    const y = (m: number) => bottom - ((m - lo) / span) * (bottom - top);
    for (const n of this.notes) {
      g.fillStyle = HAND_COLORS[n.hand ?? 'R'];
      g.fillRect(this.x(n.time), y(n.midi) - 1.5, Math.max(1, this.x(n.duration)), 3);
    }

    if (this.loopStart > 0) {
      const lx = this.x(this.loopStart);
      g.strokeStyle = '#8f9acc';
      g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(lx + 0.5, 0); g.lineTo(lx + 0.5, HEIGHT - 14); g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#8f9acc';
      g.font = '10px system-ui, sans-serif';
      g.fillText('song loops', lx + 4, HEIGHT - 3);
    }

    const s = this.section;
    if (s) {
      const [a, b] = [this.x(s.start), this.x(s.end)];
      g.fillStyle = '#06081ab0';
      g.fillRect(0, 0, a, HEIGHT);
      g.fillRect(b, 0, w - b, HEIGHT);
      g.fillStyle = '#58f89822';
      g.fillRect(a, 0, b - a, HEIGHT);
      g.fillStyle = '#58f898';
      g.fillRect(a - 1, 0, 2, HEIGHT);
      g.fillRect(b - 1, 0, 2, HEIGHT);
    }

    if (this.hover !== null && !this.drag) {
      const hx = this.x(this.hover);
      g.fillStyle = '#ffffff55';
      g.fillRect(hx, 0, 1, HEIGHT);
    }

    // Time ticks every 10 s (30 s for long songs)
    const step = this.duration > 120 ? 30 : 10;
    g.fillStyle = '#8f9acc';
    g.font = '10px system-ui, sans-serif';
    for (let t = step; t < this.duration; t += step) {
      const tx = this.x(t);
      g.fillRect(tx, HEIGHT - 12, 1, 4);
      if (Math.abs(t - this.loopStart) * (w / this.duration) > 60) g.fillText(formatClock(t), tx + 3, HEIGHT - 3);
    }
  }
}

export function formatClock(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
