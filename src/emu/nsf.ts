import { Cpu6502, Bus } from './cpu6502';
import { Apu, CPU_HZ } from './apu';

/** Describes how to drive one game's extracted sound driver. */
export interface DriverSpec {
  /** Address the driver blob is mapped to */
  load: number;
  /** Per-frame update routine */
  play: number;
  /** Sound request routine; called with A = sound id */
  request: number;
  /** Optional one-time setup routine run after reset */
  setup?: number;
}

export const NTSC_FRAME_CYCLES = CPU_HZ / 60.0988;

export interface ChannelFrame {
  /** Timer period register value (11 bits) */
  period: number;
  /** Current output volume 0-15 (triangle: 15 when audible) */
  volume: number;
  audible: boolean;
  /** Length/timer-high register was written this frame (new note on most drivers) */
  triggered: boolean;
  duty: number;
}

export type FrameSnapshot = [ChannelFrame, ChannelFrame, ChannelFrame, ChannelFrame];

export class NsfPlayer implements Bus {
  ram = new Uint8Array(0x800);
  wram = new Uint8Array(0x2000);
  apu: Apu;
  cpu: Cpu6502;
  /** Set if the driver writes outside RAM/APU (e.g. mapper bank switches) */
  romWrites = 0;
  private frameWrites: number[] = [];

  constructor(private image: Uint8Array, private spec: DriverSpec) {
    this.apu = new Apu((a) => this.read(a));
    this.cpu = new Cpu6502(this);
  }

  read(addr: number): number {
    if (addr < 0x2000) return this.ram[addr & 0x7ff];
    if (addr >= 0x6000 && addr < 0x8000) return this.wram[addr - 0x6000];
    if (addr >= this.spec.load) {
      const i = addr - this.spec.load;
      return i < this.image.length ? this.image[i] : 0;
    }
    return 0;
  }

  write(addr: number, value: number): void {
    if (addr < 0x2000) { this.ram[addr & 0x7ff] = value; return; }
    if (addr >= 0x4000 && addr <= 0x4017) { this.apu.write(addr, value); this.frameWrites.push(addr, value); return; }
    if (addr >= 0x6000 && addr < 0x8000) { this.wram[addr - 0x6000] = value; return; }
    if (addr >= 0x8000) this.romWrites++;
  }

  /** Resets machine state and silences the APU. */
  reset() {
    this.ram.fill(0); this.wram.fill(0);
    this.apu = new Apu((a) => this.read(a));
    this.cpu = new Cpu6502(this);
    for (let a = 0x4000; a <= 0x4013; a++) this.write(a, 0);
    this.write(0x4015, 0x0f);
    this.write(0x4017, 0x40);
    if (this.spec.setup !== undefined) this.mustCall(this.spec.setup);
    if (!this.hashMask) this.learnHashMask();
  }

  /** RAM bytes that change while idle (frame counters etc.) and must not affect loop detection */
  private hashMask?: Uint8Array;

  private learnHashMask() {
    const mask = new Uint8Array(0x800);
    for (let i = 0x100; i < 0x200; i++) mask[i] = 1; // stack contents are noise
    const before = this.ram.slice();
    for (let f = 0; f < 600; f++) {
      this.tick();
      for (let i = 0; i < 0x800; i++) if (this.ram[i] !== before[i]) mask[i] = 1;
    }
    this.hashMask = mask;
    this.ram.set(before);
  }

  requestSound(id: number) {
    this.cpu.a = id; this.cpu.x = 0; this.cpu.y = 0;
    this.mustCall(this.spec.request);
  }

  private mustCall(addr: number) {
    if (!this.cpu.call(addr)) throw new Error(`Driver routine $${addr.toString(16)} did not return`);
  }

  /** Runs the per-frame driver update; returns the APU writes performed. */
  tick(): number[] {
    this.frameWrites = [];
    this.mustCall(this.spec.play);
    return this.frameWrites;
  }

  snapshot(): FrameSnapshot {
    const { pulse1, pulse2, triangle, noise } = this.apu;
    const snap: FrameSnapshot = [
      { period: pulse1.period, volume: pulse1.env.volume, audible: pulse1.audible, triggered: pulse1.triggered, duty: pulse1.duty },
      { period: pulse2.period, volume: pulse2.env.volume, audible: pulse2.audible, triggered: pulse2.triggered, duty: pulse2.duty },
      { period: triangle.period, volume: triangle.audible ? 15 : 0, audible: triangle.audible, triggered: triangle.triggered, duty: 0 },
      { period: noise.periodIndex, volume: noise.env.volume, audible: noise.audible, triggered: noise.triggered, duty: noise.mode ? 1 : 0 },
    ];
    pulse1.triggered = pulse2.triggered = triangle.triggered = noise.triggered = false;
    return snap;
  }

  /** Hash of driver RAM, used to detect when a song loops back to an earlier state. */
  stateHash(): number {
    let h = 2166136261;
    const mask = this.hashMask!;
    for (let i = 0; i < this.ram.length; i++) if (!mask[i]) h = Math.imul(h ^ this.ram[i], 16777619);
    for (let i = 0; i < this.wram.length; i++) h = Math.imul(h ^ this.wram[i], 16777619);
    return h >>> 0;
  }
}
