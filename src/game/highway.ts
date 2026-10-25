// Canvas renderer: notes fall toward a piano keyboard at the bottom.
import type { Judgment, TargetNote } from './judge';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);
export const noteName = (m: number) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const isBlack = (m: number) => BLACK.has(((m % 12) + 12) % 12);

// Notes are coloured by the hand that plays them
export const HAND_COLORS = { R: '#3cbcfc', L: '#fca044' };
const noteColor = (n: TargetNote) => HAND_COLORS[n.hand ?? (n.ch === 2 ? 'L' : 'R')];
const JUDGE_COLORS: Record<Judgment, string> = { perfect: '#80f0ff', great: '#58f898', good: '#f8d878', miss: '#f85858' };

interface Popup { text: string; color: string; x: number; born: number }
interface Flash { midi: number; color: string; born: number }

export class Highway {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private lo = 48;
  private hi = 83;
  private popups: Popup[] = [];
  private flashes: Flash[] = [];
  /** key -> 'good' | 'bad' highlight while held */
  keyState = new Map<number, 'good' | 'bad'>();
  showNoteNames = true;
  showFingering = true;
  pxPerSec = 260;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Fits the keyboard to whole octaves covering the notes (at least two octaves). */
  setRange(notes: { midi: number }[]) {
    if (!notes.length) return;
    let lo = Math.min(...notes.map((n) => n.midi));
    let hi = Math.max(...notes.map((n) => n.midi));
    lo = Math.floor(lo / 12) * 12;
    hi = Math.ceil((hi + 1) / 12) * 12 - 1;
    while (hi - lo + 1 < 24) { if (lo >= 36) lo -= 12; else hi += 12; }
    this.lo = lo;
    this.hi = hi;
  }

  /** Widens the keyboard (by whole octaves) so a pressed key outside the song's range is visible. */
  includeKey(midi: number) {
    if (midi < this.lo) this.lo = Math.floor(midi / 12) * 12;
    if (midi > this.hi) this.hi = Math.ceil((midi + 1) / 12) * 12 - 1;
  }

  private get keyboardH() { return Math.max(70, Math.min(150, this.h * 0.18)); }
  get hitY() { return this.h - this.keyboardH; }

  private whiteCount() {
    let n = 0;
    for (let m = this.lo; m <= this.hi; m++) if (!isBlack(m)) n++;
    return n;
  }

  /** Horizontal extent of a key. */
  keyRect(midi: number): { x: number; w: number } {
    const ww = this.w / this.whiteCount();
    let whites = 0;
    for (let m = this.lo; m < midi; m++) if (!isBlack(m)) whites++;
    if (!isBlack(midi)) return { x: whites * ww, w: ww };
    const bw = ww * 0.62;
    return { x: whites * ww - bw / 2, w: bw };
  }

  popup(text: string, judgment: Judgment, midi: number, now: number) {
    const r = this.keyRect(midi);
    this.popups.push({ text, color: JUDGE_COLORS[judgment], x: r.x + r.w / 2, born: now });
    if (judgment !== 'miss') this.flashes.push({ midi, color: JUDGE_COLORS[judgment], born: now });
  }

  draw(notes: TargetNote[], songTime: number, wallTime: number) {
    const { ctx, w } = this;
    const hitY = this.hitY;
    ctx.clearRect(0, 0, w, this.h);

    // Lanes
    ctx.fillStyle = '#0b0f24';
    ctx.fillRect(0, 0, w, hitY);
    for (let m = this.lo; m <= this.hi; m++) {
      if (isBlack(m)) {
        const r = this.keyRect(m);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(r.x, 0, r.w, hitY);
      } else if (m % 12 === 0 || m % 12 === 5) {
        const r = this.keyRect(m);
        ctx.fillStyle = m % 12 === 0 ? 'rgba(120,140,255,0.22)' : 'rgba(120,140,255,0.08)';
        ctx.fillRect(r.x, 0, 1, hitY);
      }
    }

    // Notes (white-key notes first so black-key notes draw on top)
    const visibleAhead = hitY / this.pxPerSec;
    for (const pass of [false, true]) {
      for (const n of notes) {
        if (n.time > songTime + visibleAhead) break;
        if (n.time + n.duration < songTime - 0.5) continue;
        if (isBlack(n.midi) !== pass || n.midi < this.lo || n.midi > this.hi) continue;
        this.drawNote(n, songTime, hitY);
      }
    }

    // Hit line
    ctx.fillStyle = '#fcfcfc';
    ctx.fillRect(0, hitY - 2, w, 3);
    ctx.fillStyle = 'rgba(60,188,252,0.25)';
    ctx.fillRect(0, hitY - 8, w, 6);

    this.drawKeyboard(hitY, wallTime);
    if (this.showFingering) this.drawKeyFingers(notes, songTime, hitY);
    this.drawPopups(wallTime, hitY);
  }

  private drawNote(n: TargetNote, songTime: number, hitY: number) {
    const { ctx } = this;
    const r = this.keyRect(n.midi);
    const yBottom = hitY - (n.time - songTime) * this.pxPerSec;
    const height = Math.max(8, n.duration * this.pxPerSec - 2);
    const yTop = yBottom - height;
    const pad = isBlack(n.midi) ? 1 : 3;
    let color = noteColor(n);
    let alpha = 1;
    if (n.judgment === 'miss') { color = '#5a5a6a'; alpha = 0.6; }
    else if (n.judgment) { color = JUDGE_COLORS[n.judgment]; alpha = 0.55; }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    roundRect(ctx, r.x + pad, yTop, r.w - pad * 2, height, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    let labelBottom = yBottom - 3;
    if (this.showFingering && n.finger && !n.judgment) {
      // Finger number in a dark badge at the note's leading edge
      const radius = Math.min(9, r.w / 2 - 1);
      const cy = yBottom - radius - 2;
      fingerBadge(ctx, n.finger, r.x + r.w / 2, cy, radius, '#0b0f24', '#fff');
      labelBottom = cy - radius - 2;
    }
    if (this.showNoteNames && r.w >= 14) {
      ctx.fillStyle = '#0b0f24';
      ctx.font = `bold ${Math.min(13, r.w * 0.45)}px "Press Start 2P", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(NOTE_NAMES[n.midi % 12].replace('#', '♯'), r.x + r.w / 2, labelBottom);
    }
    ctx.globalAlpha = 1;
  }

  private drawKeyboard(top: number, wallTime: number) {
    const { ctx } = this;
    const kh = this.keyboardH;
    const flashFor = (m: number) => this.flashes.find((f) => f.midi === m && wallTime - f.born < 0.18);
    for (const pass of [false, true]) {
      for (let m = this.lo; m <= this.hi; m++) {
        if (isBlack(m) !== pass) continue;
        const r = this.keyRect(m);
        const state = this.keyState.get(m);
        const flash = flashFor(m);
        let fill = pass ? '#1a1a22' : '#f4f4f4';
        if (state === 'good' || flash) fill = flash?.color ?? '#58f898';
        else if (state === 'bad') fill = '#f85858';
        ctx.fillStyle = fill;
        const height = pass ? kh * 0.62 : kh;
        ctx.fillRect(r.x + 0.5, top, r.w - 1, height);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 0.5, top, r.w - 1, height);
        if (!pass && m % 12 === 0) {
          ctx.fillStyle = '#555';
          ctx.font = '10px "Press Start 2P", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(noteName(m), r.x + r.w / 2, top + kh - 4);
        }
      }
    }
    this.flashes = this.flashes.filter((f) => wallTime - f.born < 0.3);
  }

  /** Finger numbers on the keys of notes about to be played */
  private drawKeyFingers(notes: TargetNote[], songTime: number, top: number) {
    const kh = this.keyboardH;
    for (const n of notes) {
      if (n.time > songTime + KEY_FINGER_AHEAD) break;
      if (n.judgment || !n.finger || n.time < songTime - 0.3 || n.midi < this.lo || n.midi > this.hi) continue;
      const r = this.keyRect(n.midi);
      const radius = Math.min(10, r.w / 2 - 1);
      const cy = top + (isBlack(n.midi) ? kh * 0.4 : kh * 0.72);
      fingerBadge(this.ctx, n.finger, r.x + r.w / 2, cy, radius, noteColor(n), '#0b0f24');
    }
  }

  private drawPopups(wallTime: number, hitY: number) {
    const { ctx } = this;
    ctx.font = '12px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.popups = this.popups.filter((p) => wallTime - p.born < 0.6);
    for (const p of this.popups) {
      const age = wallTime - p.born;
      ctx.globalAlpha = 1 - age / 0.6;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, hitY - 24 - age * 60);
    }
    ctx.globalAlpha = 1;
  }
}

/** How far ahead (seconds) upcoming notes show their finger on the keyboard */
const KEY_FINGER_AHEAD = 0.6;

function fingerBadge(ctx: CanvasRenderingContext2D, finger: number, cx: number, cy: number, radius: number, bg: string, fg: string) {
  if (radius < 4) return;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = `${Math.round(radius * 1.1)}px "Press Start 2P", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(finger), cx, cy + 1);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
