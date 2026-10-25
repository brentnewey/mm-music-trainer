// Minimal NMOS 6502 interpreter (official opcodes + common NOPs).
// Cycle counts are approximate; they are only used as a runaway guard.

export interface Bus {
  read(addr: number): number;
  write(addr: number, value: number): void;
}

const C = 0x01, Z = 0x02, I = 0x04, D = 0x08, B = 0x10, U = 0x20, V = 0x40, N = 0x80;

type Mode = 'imp' | 'acc' | 'imm' | 'zp' | 'zpx' | 'zpy' | 'abs' | 'abx' | 'aby' | 'ind' | 'izx' | 'izy' | 'rel';

interface Op { name: string; mode: Mode; cycles: number }

const OPS: (Op | undefined)[] = new Array(256);
function def(name: string, entries: [number, Mode, number][]) {
  for (const [code, mode, cycles] of entries) OPS[code] = { name, mode, cycles };
}
def('ADC', [[0x69, 'imm', 2], [0x65, 'zp', 3], [0x75, 'zpx', 4], [0x6d, 'abs', 4], [0x7d, 'abx', 4], [0x79, 'aby', 4], [0x61, 'izx', 6], [0x71, 'izy', 5]]);
def('AND', [[0x29, 'imm', 2], [0x25, 'zp', 3], [0x35, 'zpx', 4], [0x2d, 'abs', 4], [0x3d, 'abx', 4], [0x39, 'aby', 4], [0x21, 'izx', 6], [0x31, 'izy', 5]]);
def('ASL', [[0x0a, 'acc', 2], [0x06, 'zp', 5], [0x16, 'zpx', 6], [0x0e, 'abs', 6], [0x1e, 'abx', 7]]);
def('BCC', [[0x90, 'rel', 2]]); def('BCS', [[0xb0, 'rel', 2]]); def('BEQ', [[0xf0, 'rel', 2]]);
def('BMI', [[0x30, 'rel', 2]]); def('BNE', [[0xd0, 'rel', 2]]); def('BPL', [[0x10, 'rel', 2]]);
def('BVC', [[0x50, 'rel', 2]]); def('BVS', [[0x70, 'rel', 2]]);
def('BIT', [[0x24, 'zp', 3], [0x2c, 'abs', 4]]);
def('BRK', [[0x00, 'imp', 7]]);
def('CLC', [[0x18, 'imp', 2]]); def('CLD', [[0xd8, 'imp', 2]]); def('CLI', [[0x58, 'imp', 2]]); def('CLV', [[0xb8, 'imp', 2]]);
def('CMP', [[0xc9, 'imm', 2], [0xc5, 'zp', 3], [0xd5, 'zpx', 4], [0xcd, 'abs', 4], [0xdd, 'abx', 4], [0xd9, 'aby', 4], [0xc1, 'izx', 6], [0xd1, 'izy', 5]]);
def('CPX', [[0xe0, 'imm', 2], [0xe4, 'zp', 3], [0xec, 'abs', 4]]);
def('CPY', [[0xc0, 'imm', 2], [0xc4, 'zp', 3], [0xcc, 'abs', 4]]);
def('DEC', [[0xc6, 'zp', 5], [0xd6, 'zpx', 6], [0xce, 'abs', 6], [0xde, 'abx', 7]]);
def('DEX', [[0xca, 'imp', 2]]); def('DEY', [[0x88, 'imp', 2]]);
def('EOR', [[0x49, 'imm', 2], [0x45, 'zp', 3], [0x55, 'zpx', 4], [0x4d, 'abs', 4], [0x5d, 'abx', 4], [0x59, 'aby', 4], [0x41, 'izx', 6], [0x51, 'izy', 5]]);
def('INC', [[0xe6, 'zp', 5], [0xf6, 'zpx', 6], [0xee, 'abs', 6], [0xfe, 'abx', 7]]);
def('INX', [[0xe8, 'imp', 2]]); def('INY', [[0xc8, 'imp', 2]]);
def('JMP', [[0x4c, 'abs', 3], [0x6c, 'ind', 5]]);
def('JSR', [[0x20, 'abs', 6]]);
def('LDA', [[0xa9, 'imm', 2], [0xa5, 'zp', 3], [0xb5, 'zpx', 4], [0xad, 'abs', 4], [0xbd, 'abx', 4], [0xb9, 'aby', 4], [0xa1, 'izx', 6], [0xb1, 'izy', 5]]);
def('LDX', [[0xa2, 'imm', 2], [0xa6, 'zp', 3], [0xb6, 'zpy', 4], [0xae, 'abs', 4], [0xbe, 'aby', 4]]);
def('LDY', [[0xa0, 'imm', 2], [0xa4, 'zp', 3], [0xb4, 'zpx', 4], [0xac, 'abs', 4], [0xbc, 'abx', 4]]);
def('LSR', [[0x4a, 'acc', 2], [0x46, 'zp', 5], [0x56, 'zpx', 6], [0x4e, 'abs', 6], [0x5e, 'abx', 7]]);
def('NOP', [[0xea, 'imp', 2], [0x1a, 'imp', 2], [0x3a, 'imp', 2], [0x5a, 'imp', 2], [0x7a, 'imp', 2], [0xda, 'imp', 2], [0xfa, 'imp', 2],
  [0x80, 'imm', 2], [0x04, 'zp', 3], [0x44, 'zp', 3], [0x64, 'zp', 3], [0x0c, 'abs', 4],
  [0x14, 'zpx', 4], [0x34, 'zpx', 4], [0x54, 'zpx', 4], [0x74, 'zpx', 4], [0xd4, 'zpx', 4], [0xf4, 'zpx', 4],
  [0x1c, 'abx', 4], [0x3c, 'abx', 4], [0x5c, 'abx', 4], [0x7c, 'abx', 4], [0xdc, 'abx', 4], [0xfc, 'abx', 4]]);
def('ORA', [[0x09, 'imm', 2], [0x05, 'zp', 3], [0x15, 'zpx', 4], [0x0d, 'abs', 4], [0x1d, 'abx', 4], [0x19, 'aby', 4], [0x01, 'izx', 6], [0x11, 'izy', 5]]);
def('PHA', [[0x48, 'imp', 3]]); def('PHP', [[0x08, 'imp', 3]]); def('PLA', [[0x68, 'imp', 4]]); def('PLP', [[0x28, 'imp', 4]]);
def('ROL', [[0x2a, 'acc', 2], [0x26, 'zp', 5], [0x36, 'zpx', 6], [0x2e, 'abs', 6], [0x3e, 'abx', 7]]);
def('ROR', [[0x6a, 'acc', 2], [0x66, 'zp', 5], [0x76, 'zpx', 6], [0x6e, 'abs', 6], [0x7e, 'abx', 7]]);
def('RTI', [[0x40, 'imp', 6]]); def('RTS', [[0x60, 'imp', 6]]);
def('SBC', [[0xe9, 'imm', 2], [0xeb, 'imm', 2], [0xe5, 'zp', 3], [0xf5, 'zpx', 4], [0xed, 'abs', 4], [0xfd, 'abx', 4], [0xf9, 'aby', 4], [0xe1, 'izx', 6], [0xf1, 'izy', 5]]);
def('SEC', [[0x38, 'imp', 2]]); def('SED', [[0xf8, 'imp', 2]]); def('SEI', [[0x78, 'imp', 2]]);
def('STA', [[0x85, 'zp', 3], [0x95, 'zpx', 4], [0x8d, 'abs', 4], [0x9d, 'abx', 5], [0x99, 'aby', 5], [0x81, 'izx', 6], [0x91, 'izy', 6]]);
def('STX', [[0x86, 'zp', 3], [0x96, 'zpy', 4], [0x8e, 'abs', 4]]);
def('STY', [[0x84, 'zp', 3], [0x94, 'zpx', 4], [0x8c, 'abs', 4]]);
def('TAX', [[0xaa, 'imp', 2]]); def('TAY', [[0xa8, 'imp', 2]]); def('TSX', [[0xba, 'imp', 2]]);
def('TXA', [[0x8a, 'imp', 2]]); def('TXS', [[0x9a, 'imp', 2]]); def('TYA', [[0x98, 'imp', 2]]);

export class UnknownOpcodeError extends Error {}

export class Cpu6502 {
  a = 0; x = 0; y = 0; sp = 0xfd; pc = 0; p = U | I;
  cycles = 0;

  constructor(private bus: Bus) {}

  private rd(addr: number) { return this.bus.read(addr & 0xffff) & 0xff; }
  private wr(addr: number, v: number) { this.bus.write(addr & 0xffff, v & 0xff); }
  private rd16(addr: number) { return this.rd(addr) | (this.rd(addr + 1) << 8); }
  private push(v: number) { this.wr(0x100 | this.sp, v); this.sp = (this.sp - 1) & 0xff; }
  private pop() { this.sp = (this.sp + 1) & 0xff; return this.rd(0x100 | this.sp); }
  private setZN(v: number) { this.p = (this.p & ~(Z | N)) | (v === 0 ? Z : 0) | (v & N); }
  private flag(f: number, on: boolean) { this.p = on ? this.p | f : this.p & ~f; }
  private rmwStore(mode: Mode, ea: number, r: number) {
    if (mode === 'acc') this.a = r; else this.wr(ea, r);
    this.setZN(r);
  }

  /**
   * Calls a subroutine at `addr` and runs until it returns.
   * Returns false if the instruction budget is exhausted.
   */
  call(addr: number, maxInstructions = 200_000): boolean {
    const sentinelSp = this.sp;
    // Push a fake return address of $FFFF-1 so RTS lands on $0000 sentinel check
    this.push(0xff); this.push(0xfe);
    this.pc = addr;
    for (let i = 0; i < maxInstructions; i++) {
      this.step();
      if (this.pc === 0xffff && this.sp === sentinelSp) return true;
    }
    this.sp = sentinelSp;
    return false;
  }

  private addr(mode: Mode): number {
    switch (mode) {
      case 'imm': return this.pc++;
      case 'zp': return this.rd(this.pc++);
      case 'zpx': return (this.rd(this.pc++) + this.x) & 0xff;
      case 'zpy': return (this.rd(this.pc++) + this.y) & 0xff;
      case 'abs': { const a = this.rd16(this.pc); this.pc += 2; return a; }
      case 'abx': { const a = this.rd16(this.pc); this.pc += 2; return (a + this.x) & 0xffff; }
      case 'aby': { const a = this.rd16(this.pc); this.pc += 2; return (a + this.y) & 0xffff; }
      case 'ind': {
        const ptr = this.rd16(this.pc); this.pc += 2;
        // 6502 page-wrap bug
        return this.rd(ptr) | (this.rd((ptr & 0xff00) | ((ptr + 1) & 0xff)) << 8);
      }
      case 'izx': {
        const zp = (this.rd(this.pc++) + this.x) & 0xff;
        return this.rd(zp) | (this.rd((zp + 1) & 0xff) << 8);
      }
      case 'izy': {
        const zp = this.rd(this.pc++);
        const base = this.rd(zp) | (this.rd((zp + 1) & 0xff) << 8);
        return (base + this.y) & 0xffff;
      }
      case 'rel': { const off = this.rd(this.pc++); return (this.pc + (off < 0x80 ? off : off - 0x100)) & 0xffff; }
      default: return 0;
    }
  }

  private adc(v: number) {
    const r = this.a + v + (this.p & C);
    this.flag(V, (~(this.a ^ v) & (this.a ^ r) & 0x80) !== 0);
    this.flag(C, r > 0xff);
    this.a = r & 0xff; this.setZN(this.a);
  }
  private cmp(reg: number, v: number) {
    const r = (reg - v) & 0x1ff;
    this.flag(C, reg >= v); this.setZN(r & 0xff);
  }

  step() {
    const pc = this.pc;
    const opcode = this.rd(this.pc++);
    const op = OPS[opcode];
    if (!op) throw new UnknownOpcodeError(`Unknown opcode $${opcode.toString(16)} at $${pc.toString(16)}`);
    this.cycles += op.cycles;
    const mode = op.mode;
    const ea = this.addr(mode);
    switch (op.name) {
      case 'ADC': this.adc(this.rd(ea)); break;
      case 'SBC': this.adc(this.rd(ea) ^ 0xff); break;
      case 'AND': this.a &= this.rd(ea); this.setZN(this.a); break;
      case 'ORA': this.a |= this.rd(ea); this.setZN(this.a); break;
      case 'EOR': this.a ^= this.rd(ea); this.setZN(this.a); break;
      case 'ASL': { const v = mode === 'acc' ? this.a : this.rd(ea); this.flag(C, (v & 0x80) !== 0); this.rmwStore(mode, ea, (v << 1) & 0xff); break; }
      case 'LSR': { const v = mode === 'acc' ? this.a : this.rd(ea); this.flag(C, (v & 1) !== 0); this.rmwStore(mode, ea, v >> 1); break; }
      case 'ROL': { const v = mode === 'acc' ? this.a : this.rd(ea); const r = ((v << 1) | (this.p & C)) & 0xff; this.flag(C, (v & 0x80) !== 0); this.rmwStore(mode, ea, r); break; }
      case 'ROR': { const v = mode === 'acc' ? this.a : this.rd(ea); const r = (v >> 1) | ((this.p & C) << 7); this.flag(C, (v & 1) !== 0); this.rmwStore(mode, ea, r); break; }
      case 'BIT': { const v = this.rd(ea); this.flag(Z, (this.a & v) === 0); this.flag(N, (v & N) !== 0); this.flag(V, (v & V) !== 0); break; }
      case 'BCC': if (!(this.p & C)) this.pc = ea; break;
      case 'BCS': if (this.p & C) this.pc = ea; break;
      case 'BEQ': if (this.p & Z) this.pc = ea; break;
      case 'BNE': if (!(this.p & Z)) this.pc = ea; break;
      case 'BMI': if (this.p & N) this.pc = ea; break;
      case 'BPL': if (!(this.p & N)) this.pc = ea; break;
      case 'BVC': if (!(this.p & V)) this.pc = ea; break;
      case 'BVS': if (this.p & V) this.pc = ea; break;
      case 'BRK': {
        this.pc++; this.push(this.pc >> 8); this.push(this.pc & 0xff); this.push(this.p | B | U);
        this.p |= I; this.pc = this.rd16(0xfffe); break;
      }
      case 'CLC': this.p &= ~C; break; case 'SEC': this.p |= C; break;
      case 'CLD': this.p &= ~D; break; case 'SED': this.p |= D; break;
      case 'CLI': this.p &= ~I; break; case 'SEI': this.p |= I; break;
      case 'CLV': this.p &= ~V; break;
      case 'CMP': this.cmp(this.a, this.rd(ea)); break;
      case 'CPX': this.cmp(this.x, this.rd(ea)); break;
      case 'CPY': this.cmp(this.y, this.rd(ea)); break;
      case 'DEC': { const r = (this.rd(ea) - 1) & 0xff; this.wr(ea, r); this.setZN(r); break; }
      case 'INC': { const r = (this.rd(ea) + 1) & 0xff; this.wr(ea, r); this.setZN(r); break; }
      case 'DEX': this.x = (this.x - 1) & 0xff; this.setZN(this.x); break;
      case 'DEY': this.y = (this.y - 1) & 0xff; this.setZN(this.y); break;
      case 'INX': this.x = (this.x + 1) & 0xff; this.setZN(this.x); break;
      case 'INY': this.y = (this.y + 1) & 0xff; this.setZN(this.y); break;
      case 'JMP': this.pc = ea; break;
      case 'JSR': { const ret = (this.pc - 1) & 0xffff; this.push(ret >> 8); this.push(ret & 0xff); this.pc = ea; break; }
      case 'RTS': this.pc = ((this.pop() | (this.pop() << 8)) + 1) & 0xffff; break;
      case 'RTI': this.p = (this.pop() & ~B) | U; this.pc = this.pop() | (this.pop() << 8); break;
      case 'LDA': this.a = this.rd(ea); this.setZN(this.a); break;
      case 'LDX': this.x = this.rd(ea); this.setZN(this.x); break;
      case 'LDY': this.y = this.rd(ea); this.setZN(this.y); break;
      case 'STA': this.wr(ea, this.a); break;
      case 'STX': this.wr(ea, this.x); break;
      case 'STY': this.wr(ea, this.y); break;
      case 'NOP': if (mode !== 'imp') this.rd(ea); break;
      case 'PHA': this.push(this.a); break;
      case 'PHP': this.push(this.p | B | U); break;
      case 'PLA': this.a = this.pop(); this.setZN(this.a); break;
      case 'PLP': this.p = (this.pop() & ~B) | U; break;
      case 'TAX': this.x = this.a; this.setZN(this.x); break;
      case 'TAY': this.y = this.a; this.setZN(this.y); break;
      case 'TXA': this.a = this.x; this.setZN(this.a); break;
      case 'TYA': this.a = this.y; this.setZN(this.a); break;
      case 'TSX': this.x = this.sp; this.setZN(this.x); break;
      case 'TXS': this.sp = this.x; break;
    }
  }
}

/** Disassembles one instruction; returns [text, length]. Handy for probing drivers. */
export function disasm(read: (a: number) => number, pc: number): [string, number] {
  const op = OPS[read(pc)];
  if (!op) return [`.db $${read(pc).toString(16).padStart(2, '0')}`, 1];
  const b1 = read(pc + 1), w = b1 | (read(pc + 2) << 8);
  const h2 = (v: number) => '$' + v.toString(16).padStart(2, '0');
  const h4 = (v: number) => '$' + v.toString(16).padStart(4, '0');
  const fmt: Record<Mode, [string, number]> = {
    imp: ['', 1], acc: [' A', 1], imm: [` #${h2(b1)}`, 2], zp: [` ${h2(b1)}`, 2], zpx: [` ${h2(b1)},X`, 2], zpy: [` ${h2(b1)},Y`, 2],
    abs: [` ${h4(w)}`, 3], abx: [` ${h4(w)},X`, 3], aby: [` ${h4(w)},Y`, 3], ind: [` (${h4(w)})`, 3],
    izx: [` (${h2(b1)},X)`, 2], izy: [` (${h2(b1)}),Y`, 2], rel: [` ${h4((pc + 2 + (b1 < 0x80 ? b1 : b1 - 256)) & 0xffff)}`, 2],
  };
  const [arg, len] = fmt[op.mode];
  return [op.name + arg, len];
}
