// Note input from Web MIDI devices, with a computer-keyboard fallback.

export interface NoteEvent {
  midi: number;
  velocity: number;
  /** performance.now() timestamp of the event */
  time: number;
  source: 'midi' | 'keyboard';
}

type Listener = (e: NoteEvent) => void;

// Two rows of a QWERTY keyboard laid out like piano keys, starting at C
const KEY_LAYOUT: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

export class NoteInput {
  private onListeners = new Set<Listener>();
  private offListeners = new Set<Listener>();
  private changeListeners = new Set<() => void>();
  private rawListeners = new Set<(data: Uint8Array, port: string) => void>();
  private access?: MIDIAccess;
  /** Base note for the computer keyboard (C4 by default); Z/X shift octaves */
  keyboardBase = 60;
  keyboardEnabled = true;
  readonly held = new Set<number>();
  midiError?: string;

  async init() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    if (!navigator.requestMIDIAccess) {
      this.midiError = 'This browser does not support Web MIDI. Use Chrome or Edge.';
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess();
      this.access.onstatechange = () => { this.attach(); this.changeListeners.forEach((l) => l()); };
      this.attach();
    } catch (e) {
      this.midiError = `MIDI access was denied (${(e as Error).message}).`;
    }
  }

  get devices(): string[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].filter((i) => i.state === 'connected').map((i) => i.name ?? 'MIDI device');
  }

  private attach() {
    this.access?.inputs.forEach((input) => {
      input.onmidimessage = this.onMidi;
      // Setting the handler implicitly opens the port; open explicitly so failures surface
      input.open().catch((e: Error) => { this.midiError = `Could not open ${input.name}: ${e.message}`; this.changeListeners.forEach((l) => l()); });
    });
  }

  private onMidi = (e: MIDIMessageEvent) => {
    const d = e.data;
    if (!d) return;
    const port = (e.target as MIDIInput | null)?.name ?? 'MIDI';
    this.rawListeners.forEach((l) => l(d, port));
    if (d.length < 3) return;
    const cmd = d[0] & 0xf0;
    if (cmd === 0x90 && d[2] > 0) this.emitOn({ midi: d[1], velocity: d[2], time: e.timeStamp, source: 'midi' });
    else if (cmd === 0x80 || (cmd === 0x90 && d[2] === 0)) this.emitOff({ midi: d[1], velocity: 0, time: e.timeStamp, source: 'midi' });
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.keyboardEnabled || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
    if (e.code === 'KeyZ') { this.keyboardBase = Math.max(24, this.keyboardBase - 12); return; }
    if (e.code === 'KeyX') { this.keyboardBase = Math.min(96, this.keyboardBase + 12); return; }
    const off = KEY_LAYOUT[e.code];
    if (off === undefined) return;
    e.preventDefault();
    this.emitOn({ midi: this.keyboardBase + off, velocity: 100, time: e.timeStamp, source: 'keyboard' });
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const off = KEY_LAYOUT[e.code];
    if (off === undefined) return;
    this.emitOff({ midi: this.keyboardBase + off, velocity: 0, time: e.timeStamp, source: 'keyboard' });
  };

  private emitOn(e: NoteEvent) { this.held.add(e.midi); this.onListeners.forEach((l) => l(e)); }
  private emitOff(e: NoteEvent) { this.held.delete(e.midi); this.offListeners.forEach((l) => l(e)); }

  onNoteOn(l: Listener) { this.onListeners.add(l); return () => this.onListeners.delete(l); }
  onNoteOff(l: Listener) { this.offListeners.add(l); return () => this.offListeners.delete(l); }
  /** Every incoming MIDI message, for diagnostics */
  onRawMidi(l: (data: Uint8Array, port: string) => void) { this.rawListeners.add(l); return () => this.rawListeners.delete(l); }
  onDevicesChanged(l: () => void) { this.changeListeners.add(l); return () => this.changeListeners.delete(l); }
}
