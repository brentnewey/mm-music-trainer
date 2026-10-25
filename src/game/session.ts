// One play-through of a song: drives the clock, input judging, wait mode and drawing.
import type { AudioEngine } from '../audio/engine';
import type { NoteInput, NoteEvent } from '../input/midi';
import { Highway, noteName } from './highway';
import { Judge, POINTS, WINDOWS, summarize, type TargetNote, type JudgeStats, type Summary } from './judge';
import type { Settings } from '../storage';
import { keepScreenAwake } from '../wakeLock';

const LEAD_IN = 3;
/** Notes this close together are treated as one chord in wait mode */
const CHORD_EPSILON = 0.03;

export interface SessionResult { stats: JudgeStats; summary: Summary; completed: boolean; passes: number[] }

export interface SessionHud {
  update(s: {
    score: number; combo: number; accuracy: number; progress: number; waiting: string | null; countdown: number | null;
    pass: number | null; passBanner: string | null;
  }): void;
}

/** Song-time span of the repeating section (seconds) */
export interface LoopSpan { start: number; length: number }

/** How far ahead of the song clock the next pass's notes are queued */
const LOOP_QUEUE_AHEAD = 15;

export class Session {
  readonly judge: Judge;
  private highway: Highway;
  private raf = 0;
  private unsub: (() => void)[] = [];
  private waitingFor: TargetNote[] = [];
  private endTime: number;
  private finished = false;
  paused = false;
  /** Notes of one pass through the loop, used as a template for later passes */
  private loopTemplate: TargetNote[] = [];
  private queuedPasses = 1;
  /** Accuracy of each completed pass */
  private passAccuracies: number[] = [];
  private passBanner: { text: string; until: number } | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private audio: AudioEngine,
    private input: NoteInput,
    private notes: TargetNote[],
    private settings: Settings,
    private hud: SessionHud,
    private onFinish: (r: SessionResult) => void,
    private loopSpan: LoopSpan | null = null,
  ) {
    this.judge = new Judge(notes, { octaveForgiving: settings.octaveForgiving });
    this.highway = new Highway(canvas);
    this.highway.showNoteNames = settings.showNoteNames;
    this.highway.pxPerSec = settings.scrollSpeed;
    this.highway.setRange(notes);
    const last = notes[notes.length - 1];
    if (loopSpan) {
      this.endTime = Infinity;
      this.loopTemplate = notes.filter((n) => n.time >= loopSpan.start - 0.001).map((n) => ({ ...n }));
    } else {
      this.endTime = Math.min(audio.duration, last ? last.time + last.duration + 1.5 : audio.duration);
    }
  }

  /** End of pass k (1-based) in song time. */
  private passEnd(k: number) {
    return this.loopSpan!.start + k * this.loopSpan!.length;
  }

  /** Looping: queue upcoming passes' notes and report each finished pass. */
  private updateLoop(songTime: number, wall: number) {
    const span = this.loopSpan!;
    while (songTime + LOOP_QUEUE_AHEAD > this.passEnd(this.queuedPasses)) {
      const shift = this.queuedPasses * span.length;
      this.judge.append(this.loopTemplate.map((n) => ({ midi: n.midi, ch: n.ch, duration: n.duration, time: n.time + shift })));
      this.queuedPasses++;
    }
    const k = this.passAccuracies.length + 1;
    // Wait until the pass's last notes have been judged
    if (songTime > this.passEnd(k) + 0.3) {
      const from = k === 1 ? -Infinity : this.passEnd(k - 1);
      const passNotes = this.notes.filter((n) => n.time >= from && n.time < this.passEnd(k));
      const points = passNotes.reduce((sum, n) => sum + (n.judgment ? POINTS[n.judgment] : 0), 0);
      const acc = passNotes.length ? points / (100 * passNotes.length) : 1;
      this.passAccuracies.push(acc);
      const prev = this.passAccuracies[k - 2];
      const trend = prev === undefined ? '' : acc > prev + 0.005 ? ' ▲' : acc < prev - 0.005 ? ' ▼' : '';
      this.passBanner = { text: `Pass ${k}: ${(acc * 100).toFixed(1)}%${trend}`, until: wall + 3 };
    }
  }

  /** Ends a looping (or any) run and shows results. */
  finishNow() {
    if (this.paused) this.togglePause();
    this.finish(true);
  }

  start() {
    this.unsub.push(this.input.onNoteOn(this.handleNoteOn), this.input.onNoteOff(this.handleNoteOff));
    const onResize = () => this.highway.resize();
    window.addEventListener('resize', onResize);
    this.unsub.push(() => window.removeEventListener('resize', onResize));
    this.audio.play(-LEAD_IN);
    keepScreenAwake(true);
    this.loop();
  }

  /** Song time adjusted for the user's latency calibration. */
  private judgeTime(perfMs?: number) {
    return this.audio.position(perfMs) - this.settings.latencyOffsetMs / 1000;
  }

  private handleNoteOn = (e: NoteEvent) => {
    if (this.settings.synthEnabled) this.audio.noteOn(e.midi, e.velocity);
    this.highway.includeKey(e.midi);
    if (this.paused || this.finished) return;
    if (this.waitingFor.length) {
      const match = this.waitingFor.find((n) => !n.judgment && (this.settings.octaveForgiving ? (n.midi - e.midi) % 12 === 0 : n.midi === e.midi));
      if (match) {
        this.judge.hitWithoutTiming(match);
        this.highway.keyState.set(e.midi, 'good');
        this.highway.popup('OK', 'great', match.midi, performance.now() / 1000);
        if (this.waitingFor.every((n) => n.judgment)) {
          this.waitingFor = [];
          this.audio.play();
        }
      } else {
        this.judge.wrongNote();
        this.highway.keyState.set(e.midi, 'bad');
      }
      return;
    }
    const r = this.judge.noteOn(e.midi, this.judgeTime(e.time));
    if (r.kind === 'hit') {
      this.highway.keyState.set(e.midi, 'good');
      const label = r.judgment === 'perfect' ? 'PERFECT' : r.judgment === 'great' ? 'GREAT' : r.offset < 0 ? 'EARLY' : 'LATE';
      this.highway.popup(label, r.judgment, r.note.midi, performance.now() / 1000);
    } else {
      this.highway.keyState.set(e.midi, 'bad');
    }
  };

  private handleNoteOff = (e: NoteEvent) => {
    if (this.settings.synthEnabled) this.audio.noteOff(e.midi);
    this.highway.keyState.delete(e.midi);
  };

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const wall = performance.now() / 1000;
    const songTime = this.audio.position();
    if (!this.paused && !this.finished) {
      if (this.loopSpan) this.updateLoop(songTime, wall);
      if (this.settings.waitMode) this.checkWait(songTime);
      else {
        for (const n of this.judge.advance(this.judgeTime())) this.highway.popup('MISS', 'miss', n.midi, wall);
      }
      if (songTime >= this.endTime) this.finish(true);
    }
    this.highway.draw(this.notes, songTime, wall);
    const s = this.judge.stats;
    const judged = s.total - this.notes.filter((n) => !n.judgment).length;
    this.hud.update({
      score: s.score,
      combo: s.combo,
      accuracy: judged ? summarize({ ...s, total: judged }).accuracy : 1,
      progress: Math.max(0, Math.min(1, this.loopSpan ? this.loopProgress(songTime) : songTime / this.endTime)),
      waiting: this.waitingFor.length ? this.waitingFor.filter((n) => !n.judgment).map((n) => noteName(n.midi)).join(' + ') : null,
      countdown: songTime < 0 ? Math.ceil(-songTime) : null,
      pass: this.loopSpan ? this.passAccuracies.length + 1 : null,
      passBanner: this.passBanner && wall < this.passBanner.until ? this.passBanner.text : null,
    });
  };

  /** Progress through the current pass (the intro counts as part of pass 1). */
  private loopProgress(songTime: number) {
    const k = this.passAccuracies.length + 1;
    const from = k === 1 ? 0 : this.passEnd(k - 1);
    return (songTime - from) / (this.passEnd(k) - from);
  }

  /** Wait mode: hold the song at each note until it is played. */
  private checkWait(songTime: number) {
    if (this.waitingFor.length) return;
    const next = this.judge.nextPending();
    if (!next || next.time > songTime) return;
    this.waitingFor = this.notes.filter((n) => !n.judgment && Math.abs(n.time - next.time) <= CHORD_EPSILON);
    this.audio.pause();
  }

  togglePause() {
    if (this.finished) return;
    this.paused = !this.paused;
    if (this.paused) this.audio.pause();
    else if (!this.waitingFor.length) this.audio.play();
  }

  private finish(completed: boolean) {
    if (this.finished) return;
    this.finished = true;
    if (this.loopSpan) {
      // Notes queued for the future were never reachable; drop them from the totals
      const now = this.judgeTime();
      const unreached = this.notes.filter((n) => !n.judgment && n.time > now - WINDOWS.good);
      this.judge.stats.total -= unreached.length;
      for (const n of unreached) n.judgment = 'miss';
      this.judge.advance(now);
    } else if (completed) {
      this.judge.advance(Infinity);
    }
    this.audio.pause();
    keepScreenAwake(false);
    this.onFinish({ stats: this.judge.stats, summary: summarize(this.judge.stats), completed, passes: this.passAccuracies });
  }

  quit() {
    this.finish(false);
    this.destroy();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.unsub.forEach((u) => u());
    this.unsub = [];
    this.audio.stop();
    keepScreenAwake(false);
  }
}
