import { NsfPlayer, NTSC_FRAME_CYCLES, type DriverSpec, type FrameSnapshot } from '../emu/nsf';
import { CPU_HZ } from '../emu/apu';

export const FRAME_SECONDS = NTSC_FRAME_CYCLES / CPU_HZ;

export interface Note {
  /** 0 = pulse 1, 1 = pulse 2, 2 = triangle */
  ch: number;
  midi: number;
  /** start/end in NES frames */
  start: number;
  end: number;
  /** peak volume 0-15 */
  vel: number;
  /** Pulse duty cycle at the note's start (0-3; 0 for the triangle). With `vel` it tells a channel's sounds apart */
  duty: number;
}

export interface SongAnalysis {
  id: number;
  /** Frame where the looping section begins (or -1 if the song ends on its own) */
  loopStart: number;
  /** Frame where playback should stop (one pass through the loop) */
  endFrame: number;
  notes: Note[];
}

const SILENCE_STOP_FRAMES = 180;

function hashWrites(w: number[]): number {
  let h = 2166136261;
  for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w[i], 16777619);
  return h >>> 0;
}

/**
 * Finds the smallest period L such that the tail of `seq` is L-periodic.
 * The periodic region must span at least two periods and at least half the
 * capture, so a phrase that merely repeats twice near the end is not mistaken
 * for the song's loop.
 */
export function findLoop(seq: Uint32Array, minPeriod = 120): { start: number; length: number } | null {
  const n = seq.length;
  for (let L = minPeriod; L <= n / 2; L++) {
    let i = n - 1 - L;
    while (i >= 0 && seq[i] === seq[i + L]) i--;
    const start = i + 1;
    if (n - start >= 2 * L && n - start >= n / 2) return { start, length: L };
  }
  return null;
}

/**
 * Runs a sound id through the driver and captures per-frame channel state.
 * Stops after `maxSeconds` or after a stretch of silence.
 */
export function captureSong(image: Uint8Array, spec: DriverSpec, id: number, maxSeconds = 330) {
  const player = new NsfPlayer(image, spec);
  player.reset();
  player.requestSound(id);
  const maxFrames = Math.round(maxSeconds / FRAME_SECONDS);
  const snaps: FrameSnapshot[] = [];
  const hashes = new Uint32Array(maxFrames);
  let lastAudible = -1;
  let f = 0;
  for (; f < maxFrames; f++) {
    hashes[f] = hashWrites(player.tick());
    player.apu.skip(Math.round(NTSC_FRAME_CYCLES));
    const s = player.snapshot();
    snaps.push(s);
    if (s.some((c) => c.audible)) lastAudible = f;
    if (lastAudible >= 0 && f - lastAudible > SILENCE_STOP_FRAMES) break;
    if (lastAudible < 0 && f > SILENCE_STOP_FRAMES) break;
  }
  return { snaps, hashes: hashes.subarray(0, f), lastAudible, ranToLimit: f >= maxFrames };
}

/**
 * Loop detection tolerant of fractional-tempo drivers (MM3-6), where each pass
 * through the loop can land up to a frame earlier/later. Compares a per-frame
 * pitch feature at period L and accepts small mismatch rates.
 */
export function findLoopFuzzy(features: Uint32Array, minPeriod = 300, maxMismatch = 0.03): { start: number; length: number } | null {
  const n = features.length;
  // A frame matches if the frame one period later (±1 frame of jitter) has the same pitches
  const same = (i: number, L: number) => {
    const v = features[i];
    return v === features[i + L] || v === features[i + L - 1] || (i + L + 1 < n && v === features[i + L + 1]);
  };
  const regionStart = Math.floor(n / 2);
  const mismatchRate = (L: number) => {
    const count = n - L - regionStart;
    if (count <= L) return 1; // tail must cover at least one full repeat
    const budget = maxMismatch * count;
    let bad = 0;
    for (let i = regionStart; i < n - L; i++) {
      if (!same(i, L) && ++bad > budget) return 1;
    }
    return bad / count;
  };
  for (let L = minPeriod; L <= n / 2; L++) {
    if (mismatchRate(L) > maxMismatch) continue;
    // Jitter lets neighbours pass too; keep the best of the next few
    let best = L, bestRate = mismatchRate(L);
    for (let k = L + 1; k <= L + 3; k++) { const r = mismatchRate(k); if (r < bestRate) { best = k; bestRate = r; } }
    // Walk back to where the periodicity starts (windowed so isolated jitter doesn't stop it)
    const W = 60;
    let start = regionStart;
    let windowBad = 0;
    for (let i = regionStart - 1; i >= 0; i--) {
      if (!same(i, best)) windowBad++;
      if (i + W < regionStart && !same(i + W, best)) windowBad--;
      if (windowBad > W * 0.25) break;
      if (same(i, best)) start = i;
    }
    return { start, length: best };
  }
  return null;
}

function pitchFeature(s: FrameSnapshot): number {
  let v = 0;
  for (let ch = 0; ch < 3; ch++) {
    const c = s[ch];
    const m = c.audible && c.volume > 0 ? Math.round(periodToMidi(ch, c.period)) & 0x7f : 0;
    v = (v << 8) | m;
  }
  return v >>> 0;
}

export function analyzeSong(image: Uint8Array, spec: DriverSpec, id: number): SongAnalysis {
  const cap = captureSong(image, spec, id);
  let loopStart = -1;
  let endFrame = cap.lastAudible + 30;
  if (cap.ranToLimit) {
    const loop = findLoop(cap.hashes) ?? findLoopFuzzy(Uint32Array.from(cap.snaps, pitchFeature));
    if (loop) {
      loopStart = loop.start;
      endFrame = loop.start + loop.length;
    }
  }
  endFrame = Math.min(endFrame, cap.snaps.length);
  const notes: Note[] = [];
  for (let ch = 0; ch < 3; ch++) notes.push(...extractChannelNotes(cap.snaps, ch, endFrame));
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return { id, loopStart, endFrame, notes };
}

export function periodToMidi(ch: number, period: number): number {
  const freq = CPU_HZ / ((ch === 2 ? 32 : 16) * (period + 1));
  return 69 + 12 * Math.log2(freq / 440);
}

/** Minimum frames a changed pitch must persist before it counts as a new note (filters vibrato / slides) */
const PITCH_SETTLE_FRAMES = 3;

export function extractChannelNotes(snaps: FrameSnapshot[], ch: number, endFrame: number): Note[] {
  const notes: Note[] = [];
  // Segment on articulation: silence, $4003 trigger, or a volume re-attack
  let segStart = -1;
  let prevVol = 0;
  const closeSegment = (end: number) => {
    if (segStart >= 0 && end > segStart) splitByPitch(snaps, ch, segStart, end, notes);
    segStart = -1;
  };
  for (let f = 0; f < endFrame; f++) {
    const c = snaps[f][ch];
    const audible = c.audible && c.volume > 0;
    if (!audible) { closeSegment(f); prevVol = 0; continue; }
    const attack = ch !== 2 && c.volume >= prevVol + 2;
    if (segStart < 0) segStart = f;
    else if (c.triggered || attack) { closeSegment(f); segStart = f; }
    prevVol = c.volume;
  }
  closeSegment(endFrame);
  return notes;
}

function splitByPitch(snaps: FrameSnapshot[], ch: number, start: number, end: number, out: Note[]) {
  const pitches: number[] = [];
  for (let f = start; f < end; f++) pitches.push(Math.round(periodToMidi(ch, snaps[f][ch].period)));
  let noteStart = 0;
  let current = pitches[0];
  const emit = (from: number, to: number) => {
    // Pitch = most common rounded pitch across the note (robust to vibrato and slides)
    const counts = new Map<number, number>();
    let vel = 0;
    for (let i = from; i < to; i++) {
      counts.set(pitches[i], (counts.get(pitches[i]) ?? 0) + 1);
      vel = Math.max(vel, snaps[start + i][ch].volume);
    }
    let midi = pitches[from], best = 0;
    for (const [p, n] of counts) if (n > best) { best = n; midi = p; }
    out.push({ ch, midi, start: start + from, end: start + to, vel, duty: snaps[start + from][ch].duty });
  };
  for (let i = 1; i < pitches.length; i++) {
    if (Math.abs(pitches[i] - current) < 1) continue;
    // Require the new pitch to hold before splitting
    let hold = 1;
    while (hold < PITCH_SETTLE_FRAMES && i + hold < pitches.length && pitches[i + hold] === pitches[i]) hold++;
    if (hold >= PITCH_SETTLE_FRAMES || i + hold === pitches.length) {
      if (i - noteStart >= PITCH_SETTLE_FRAMES) { emit(noteStart, i); noteStart = i; }
      current = pitches[i];
    }
  }
  emit(noteStart, pitches.length);
}

export interface RenderParams {
  sampleRate: number;
  /** Gain per channel [p1, p2, tri, noise, dmc] */
  gains: number[];
  /** Playback speed multiplier (tempo only; pitch is preserved) */
  speed: number;
  endFrame: number;
  /** Seconds of fade appended after endFrame when the song loops */
  fadeSeconds: number;
}

/** Renders the song to mono PCM. Slowing down stretches frames, not pitch. */
export function renderSong(image: Uint8Array, spec: DriverSpec, id: number, p: RenderParams): Float32Array {
  const player = new NsfPlayer(image, spec);
  player.reset();
  player.requestSound(id);
  const fadeFrames = Math.round(p.fadeSeconds / FRAME_SECONDS);
  const totalFrames = p.endFrame + fadeFrames;
  const cyclesPerFrame = NTSC_FRAME_CYCLES / p.speed;
  const cyclesPerSample = CPU_HZ / p.sampleRate;
  const out = new Float32Array(Math.ceil((totalFrames * cyclesPerFrame) / cyclesPerSample) + 16);
  const state = { frac: 0 };
  let pos = 0;
  let cycleDebt = 0;
  const fadeStartSample = Math.round((p.endFrame * cyclesPerFrame) / cyclesPerSample);
  for (let f = 0; f < totalFrames; f++) {
    player.tick();
    cycleDebt += cyclesPerFrame;
    const run = Math.floor(cycleDebt);
    cycleDebt -= run;
    pos += player.apu.render(run, out, pos, cyclesPerSample, p.gains, state);
  }
  if (fadeFrames > 0) {
    const fadeLen = pos - fadeStartSample;
    for (let i = fadeStartSample; i < pos; i++) out[i] *= 1 - (i - fadeStartSample) / fadeLen;
  }
  return out.subarray(0, pos);
}
