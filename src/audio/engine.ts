// Web Audio playback of rendered songs, a clock that tracks what the listener
// actually hears (output latency compensated), and a pulse-wave synth for the
// player's own notes.

export class AudioEngine {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  private master = this.ctx.createGain();
  private synthBus = this.ctx.createGain();
  private source?: AudioBufferSourceNode;
  private buffer?: AudioBuffer;
  /** Context time at which song position 0 is/was scheduled */
  private startAt = 0;
  /** Song position when paused, or null while playing */
  private pausedAt: number | null = 0;
  private voices = new Map<number, { osc: OscillatorNode; gain: GainNode }>();
  private pulseWave: PeriodicWave;

  constructor() {
    this.master.connect(this.ctx.destination);
    this.synthBus.gain.value = 0.18;
    this.synthBus.connect(this.ctx.destination);
    this.pulseWave = makePulseWave(this.ctx, 0.25);
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  setSong(pcm: Float32Array, sampleRate: number) {
    this.stop();
    this.buffer = this.ctx.createBuffer(1, pcm.length, sampleRate);
    this.buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
    this.pausedAt = 0;
    this.loop = null;
  }

  /** Loop region in buffer seconds; song position keeps increasing across repeats */
  private loop: { start: number; end: number } | null = null;

  setLoop(loop: { start: number; end: number } | null) { this.loop = loop; }

  /** Maps an ever-increasing song position to an offset within the buffer. */
  private bufferOffset(pos: number) {
    if (!this.loop || pos < this.loop.end) return pos;
    const len = this.loop.end - this.loop.start;
    return this.loop.start + ((pos - this.loop.start) % len);
  }

  get duration() { return this.loop ? Infinity : this.buffer?.duration ?? 0; }
  get playing() { return this.pausedAt === null; }

  /** Starts (or resumes) playback; song position `from` is heard after `leadIn` seconds. */
  play(from = this.pausedAt ?? 0, leadIn = 0) {
    if (!this.buffer) return;
    this.stopSource();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    if (this.loop) {
      src.loop = true;
      src.loopStart = this.loop.start;
      src.loopEnd = this.loop.end;
    }
    src.connect(this.master);
    const when = this.ctx.currentTime + leadIn + 0.03;
    this.startAt = when - from;
    if (from >= 0) src.start(when, this.bufferOffset(from));
    else src.start(when - from, 0); // negative position = count-in silence
    this.source = src;
    this.pausedAt = null;
  }

  pause() {
    if (this.pausedAt !== null) return;
    this.pausedAt = this.position();
    this.stopSource();
  }

  stop() {
    this.stopSource();
    this.pausedAt = 0;
  }

  private stopSource() {
    if (this.source) {
      try { this.source.stop(); } catch { /* already stopped */ }
      this.source.disconnect();
      this.source = undefined;
    }
  }

  /**
   * Context time corresponding to what is reaching the speakers at
   * performance-time `perfMs` (defaults to now).
   */
  heardContextTime(perfMs = performance.now()): number {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    }
    const latency = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return this.ctx.currentTime - latency - (performance.now() - perfMs) / 1000;
  }

  /** Song position (seconds) the listener hears at performance-time `perfMs`. */
  position(perfMs?: number): number {
    if (this.pausedAt !== null) return this.pausedAt;
    return this.heardContextTime(perfMs) - this.startAt;
  }

  // ---- player synth ----

  noteOn(midi: number, velocity = 100) {
    this.noteOff(midi);
    const osc = this.ctx.createOscillator();
    osc.setPeriodicWave(this.pulseWave);
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3 + (0.7 * velocity) / 127, t + 0.005);
    osc.connect(gain).connect(this.synthBus);
    osc.start(t);
    this.voices.set(midi, { osc, gain });
  }

  noteOff(midi: number) {
    const v = this.voices.get(midi);
    if (!v) return;
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + 0.04);
    v.osc.stop(t + 0.05);
    this.voices.delete(midi);
  }
}

/** Band-limited pulse wave with the given duty cycle, via Fourier series. */
function makePulseWave(ctx: AudioContext, duty: number): PeriodicWave {
  const n = 64;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    real[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty);
  }
  return ctx.createPeriodicWave(real, imag);
}
