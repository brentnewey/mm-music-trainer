// NES 2A03 APU, register-level model with band-limited-ish (box filtered)
// sample output. Clocked in CPU cycles; NTSC timing.

export const CPU_HZ = 1789773;

const LENGTH_TABLE = [
  10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
  12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30,
];
const DUTY = [
  [0, 1, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
  [1, 0, 0, 1, 1, 1, 1, 1],
];
const TRIANGLE_SEQ = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const NOISE_PERIOD = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
const DMC_RATE = [428, 380, 340, 320, 286, 254, 226, 214, 190, 160, 142, 128, 106, 84, 72, 54];

class Envelope {
  start = false; divider = 0; decay = 0;
  loop = false; constant = false; param = 0;
  clock() {
    if (this.start) { this.start = false; this.decay = 15; this.divider = this.param; return; }
    if (this.divider > 0) { this.divider--; return; }
    this.divider = this.param;
    if (this.decay > 0) this.decay--; else if (this.loop) this.decay = 15;
  }
  get volume() { return this.constant ? this.param : this.decay; }
}

export class Pulse {
  enabled = false; duty = 0; seq = 0; timer = 0; period = 0; length = 0;
  env = new Envelope();
  sweepEnabled = false; sweepPeriod = 0; sweepNegate = false; sweepShift = 0; sweepReload = false; sweepDivider = 0;
  /** set when $4003/$4007 written; consumed by note tracking */
  triggered = false;

  constructor(private ones: boolean) {}

  write(reg: number, v: number) {
    switch (reg) {
      case 0: this.duty = v >> 6; this.env.loop = (v & 0x20) !== 0; this.env.constant = (v & 0x10) !== 0; this.env.param = v & 15; break;
      case 1: this.sweepEnabled = (v & 0x80) !== 0; this.sweepPeriod = (v >> 4) & 7; this.sweepNegate = (v & 8) !== 0; this.sweepShift = v & 7; this.sweepReload = true; break;
      case 2: this.period = (this.period & 0x700) | v; break;
      case 3:
        this.period = (this.period & 0xff) | ((v & 7) << 8);
        if (this.enabled) this.length = LENGTH_TABLE[v >> 3];
        this.seq = 0; this.env.start = true; this.triggered = true;
        break;
    }
  }
  private sweepTarget() {
    const delta = this.period >> this.sweepShift;
    return this.sweepNegate ? this.period - delta - (this.ones ? 1 : 0) : this.period + delta;
  }
  get muted() { return this.period < 8 || this.sweepTarget() > 0x7ff; }
  clockSweep() {
    if (this.sweepDivider === 0 && this.sweepEnabled && this.sweepShift > 0 && !this.muted) this.period = this.sweepTarget();
    if (this.sweepDivider === 0 || this.sweepReload) { this.sweepDivider = this.sweepPeriod; this.sweepReload = false; }
    else this.sweepDivider--;
  }
  clockLength() { if (!this.env.loop && this.length > 0) this.length--; }
  get audible() { return this.length > 0 && !this.muted && this.env.volume > 0; }
  output() { return this.length > 0 && !this.muted && DUTY[this.duty][this.seq] ? this.env.volume : 0; }
  /** Advance by `cycles` CPU cycles, returning integrated output (sum of output*cycles). */
  run(cycles: number): number {
    let acc = 0;
    while (cycles > 0) {
      const step = Math.min(cycles, this.timer + 1);
      acc += this.output() * step;
      cycles -= step; this.timer -= step;
      if (this.timer < 0) { this.timer = this.period * 2 + 1; this.seq = (this.seq + 1) & 7; }
    }
    return acc;
  }
}

export class Triangle {
  enabled = false; seq = 0; timer = 0; period = 0; length = 0;
  control = false; linearReloadValue = 0; linear = 0; linearReload = false;
  triggered = false;
  write(reg: number, v: number) {
    switch (reg) {
      case 0: this.control = (v & 0x80) !== 0; this.linearReloadValue = v & 0x7f; break;
      case 2: this.period = (this.period & 0x700) | v; break;
      case 3:
        this.period = (this.period & 0xff) | ((v & 7) << 8);
        if (this.enabled) this.length = LENGTH_TABLE[v >> 3];
        this.linearReload = true; this.triggered = true;
        break;
    }
  }
  clockLinear() {
    if (this.linearReload) this.linear = this.linearReloadValue; else if (this.linear > 0) this.linear--;
    if (!this.control) this.linearReload = false;
  }
  clockLength() { if (!this.control && this.length > 0) this.length--; }
  get audible() { return this.length > 0 && this.linear > 0 && this.period >= 2; }
  run(cycles: number): number {
    const active = this.audible;
    // Ultrasonic periods: real hardware outputs a ~7.5 average; avoid aliasing junk
    if (this.period < 2) return TRIANGLE_SEQ[this.seq] * cycles;
    let acc = 0;
    while (cycles > 0) {
      const step = Math.min(cycles, this.timer + 1);
      acc += TRIANGLE_SEQ[this.seq] * step;
      cycles -= step; this.timer -= step;
      if (this.timer < 0) { this.timer = this.period; if (active) this.seq = (this.seq + 1) & 31; }
    }
    return acc;
  }
}

export class Noise {
  enabled = false; mode = false; periodIndex = 0; timer = 0; length = 0; shift = 1;
  env = new Envelope();
  triggered = false;
  write(reg: number, v: number) {
    switch (reg) {
      case 0: this.env.loop = (v & 0x20) !== 0; this.env.constant = (v & 0x10) !== 0; this.env.param = v & 15; break;
      case 2: this.mode = (v & 0x80) !== 0; this.periodIndex = v & 15; break;
      case 3: if (this.enabled) this.length = LENGTH_TABLE[v >> 3]; this.env.start = true; this.triggered = true; break;
    }
  }
  clockLength() { if (!this.env.loop && this.length > 0) this.length--; }
  get audible() { return this.length > 0 && this.env.volume > 0; }
  run(cycles: number): number {
    let acc = 0;
    const vol = this.length > 0 ? this.env.volume : 0;
    while (cycles > 0) {
      const step = Math.min(cycles, this.timer + 1);
      acc += (this.shift & 1 ? 0 : vol) * step;
      cycles -= step; this.timer -= step;
      if (this.timer < 0) {
        this.timer = NOISE_PERIOD[this.periodIndex] - 1;
        const fb = (this.shift & 1) ^ ((this.shift >> (this.mode ? 6 : 1)) & 1);
        this.shift = (this.shift >> 1) | (fb << 14);
      }
    }
    return acc;
  }
}

export class Dmc {
  enabled = false; irq = false; loop = false; rate = DMC_RATE[0]; timer = 0;
  output = 0; sampleAddr = 0xc000; sampleLen = 1; curAddr = 0; bytesLeft = 0;
  shiftReg = 0; bitsLeft = 8; silence = true; buffer = -1;
  constructor(private read: (addr: number) => number) {}
  write(reg: number, v: number) {
    switch (reg) {
      case 0: this.irq = (v & 0x80) !== 0; this.loop = (v & 0x40) !== 0; this.rate = DMC_RATE[v & 15]; break;
      case 1: this.output = v & 0x7f; break;
      case 2: this.sampleAddr = 0xc000 | (v << 6); break;
      case 3: this.sampleLen = (v << 4) | 1; break;
    }
  }
  restart() { this.curAddr = this.sampleAddr; this.bytesLeft = this.sampleLen; }
  private fill() {
    if (this.buffer < 0 && this.bytesLeft > 0) {
      this.buffer = this.read(this.curAddr);
      this.curAddr = this.curAddr === 0xffff ? 0x8000 : this.curAddr + 1;
      if (--this.bytesLeft === 0 && this.loop) this.restart();
    }
  }
  run(cycles: number): number {
    let acc = 0;
    while (cycles > 0) {
      const step = Math.min(cycles, this.timer + 1);
      acc += this.output * step;
      cycles -= step; this.timer -= step;
      if (this.timer < 0) {
        this.timer = this.rate - 1;
        if (!this.silence) {
          if (this.shiftReg & 1) { if (this.output <= 125) this.output += 2; }
          else if (this.output >= 2) this.output -= 2;
        }
        this.shiftReg >>= 1;
        if (--this.bitsLeft <= 0) {
          this.bitsLeft = 8;
          this.fill();
          if (this.buffer < 0) this.silence = true;
          else { this.silence = false; this.shiftReg = this.buffer; this.buffer = -1; }
        }
      }
    }
    return acc;
  }
}

/** Channel indices used across the app */
export const CH = { pulse1: 0, pulse2: 1, triangle: 2, noise: 3, dmc: 4 } as const;
export const CHANNEL_NAMES = ['Pulse 1', 'Pulse 2', 'Triangle', 'Noise', 'DMC'];

export interface RenderOptions {
  sampleRate: number;
  /** linear gain per channel, index by CH */
  channelGain?: number[];
}

export class Apu {
  pulse1 = new Pulse(true);
  pulse2 = new Pulse(false);
  triangle = new Triangle();
  noise = new Noise();
  dmc: Dmc;
  private frameCycle = 0;
  private fiveStep = false;

  // filter state
  private hpPrev = 0; private hpOut = 0; private lpOut = 0;

  constructor(read: (addr: number) => number) { this.dmc = new Dmc(read); }

  write(addr: number, v: number) {
    if (addr >= 0x4000 && addr <= 0x4003) this.pulse1.write(addr & 3, v);
    else if (addr <= 0x4007) this.pulse2.write(addr & 3, v);
    else if (addr <= 0x400b) this.triangle.write(addr & 3, v);
    else if (addr <= 0x400f) this.noise.write(addr & 3, v);
    else if (addr <= 0x4013) this.dmc.write(addr & 3, v);
    else if (addr === 0x4015) {
      this.pulse1.enabled = (v & 1) !== 0; if (!this.pulse1.enabled) this.pulse1.length = 0;
      this.pulse2.enabled = (v & 2) !== 0; if (!this.pulse2.enabled) this.pulse2.length = 0;
      this.triangle.enabled = (v & 4) !== 0; if (!this.triangle.enabled) this.triangle.length = 0;
      this.noise.enabled = (v & 8) !== 0; if (!this.noise.enabled) this.noise.length = 0;
      this.dmc.enabled = (v & 16) !== 0;
      if (!this.dmc.enabled) this.dmc.bytesLeft = 0; else if (this.dmc.bytesLeft === 0) this.dmc.restart();
    } else if (addr === 0x4017) {
      this.fiveStep = (v & 0x80) !== 0; this.frameCycle = 0;
      if (this.fiveStep) { this.quarter(); this.half(); }
    }
  }

  private quarter() {
    this.pulse1.env.clock(); this.pulse2.env.clock(); this.noise.env.clock(); this.triangle.clockLinear();
  }
  private half() {
    this.pulse1.clockLength(); this.pulse2.clockLength(); this.triangle.clockLength(); this.noise.clockLength();
    this.pulse1.clockSweep(); this.pulse2.clockSweep();
  }

  /** Advance the frame sequencer by `cycles`, firing quarter/half frame clocks. */
  private sequencerSteps(from: number, to: number) {
    // NTSC step points (CPU cycles)
    const steps = this.fiveStep ? [7457, 14913, 22371, 37281] : [7457, 14913, 22371, 29829];
    const len = this.fiveStep ? 37282 : 29830;
    for (let c = from; c < to; ) {
      const pos = c % len;
      let next = len;
      for (const s of steps) if (s > pos) { next = s; break; }
      const hit = c - pos + next;
      if (hit >= to) break;
      const idx = steps.indexOf(next);
      this.quarter();
      if (idx === 1 || idx === 3) this.half();
      c = hit;
    }
  }

  /**
   * Render `cycles` CPU cycles of audio into `out` starting at `offset`.
   * `fracState` carries fractional sample position between calls.
   */
  render(cycles: number, out: Float32Array, offset: number, cyclesPerSample: number, gains: number[], state: { frac: number }): number {
    let written = 0;
    let remaining = cycles;
    while (remaining > 0) {
      const want = cyclesPerSample - state.frac;
      const step = Math.max(1, Math.min(remaining, Math.ceil(want)));
      const seqFrom = this.frameCycle;
      this.sequencerSteps(seqFrom, seqFrom + step);
      this.frameCycle = seqFrom + step;
      const p1 = this.pulse1.run(step) * gains[0];
      const p2 = this.pulse2.run(step) * gains[1];
      const t = this.triangle.run(step) * gains[2];
      const n = this.noise.run(step) * gains[3];
      const d = this.dmc.run(step) * gains[4];
      this.acc.p += p1 + p2; this.acc.t += t; this.acc.n += n; this.acc.d += d; this.acc.c += step;
      state.frac += step; remaining -= step;
      if (state.frac >= cyclesPerSample) {
        state.frac -= cyclesPerSample;
        const k = 1 / this.acc.c;
        const pul = this.acc.p * k, tri = this.acc.t * k, noi = this.acc.n * k, dmc = this.acc.d * k;
        const pulseOut = pul > 0 ? 95.88 / (8128 / pul + 100) : 0;
        const tndIn = tri / 8227 + noi / 12241 + dmc / 22638;
        const tndOut = tndIn > 0 ? 159.79 / (1 / tndIn + 100) : 0;
        let s = pulseOut + tndOut;
        // ~37Hz high-pass (DC removal) then ~14kHz low-pass
        this.hpOut = 0.995 * (this.hpOut + s - this.hpPrev); this.hpPrev = s; s = this.hpOut;
        this.lpOut += 0.8 * (s - this.lpOut);
        if (offset + written < out.length) out[offset + written] = this.lpOut;
        written++;
        this.acc.p = this.acc.t = this.acc.n = this.acc.d = this.acc.c = 0;
      }
    }
    return written;
  }
  private acc = { p: 0, t: 0, n: 0, d: 0, c: 0 };

  /** Advance all state without producing samples (fast-forward for analysis). */
  skip(cycles: number) {
    this.sequencerSteps(this.frameCycle, this.frameCycle + cycles);
    this.frameCycle += cycles;
  }
}
