// Decides which hand plays each note: the pulses go to the right hand and the
// triangle to the left, except where the song's edits (made in the track editor
// and saved in track-edits.json) say otherwise.
import type { Note } from './analyze';
import { FRAME_SECONDS } from './analyze';

export type Hand = 'L' | 'R';
/** Where a note goes: a hand, or nowhere (removed from every part) */
export type Role = Hand | 'off';

/** The usual hand for each channel: pulses right, triangle left */
export const CHANNEL_HAND: Record<number, Hand> = { 0: 'R', 1: 'R', 2: 'L' };

/**
 * One edit to a song's parts. Edits apply in order, so a later one wins where
 * they overlap. `default` puts notes back in their channel's usual hand,
 * `merge` joins the notes into one held note, and `join` folds echoes into the
 * note they repeat (see `applyMerges`).
 */
export interface EditRule {
  /** Channel: 0 = Pulse 1, 1 = Pulse 2, 2 = Triangle */
  ch: number;
  /** Only notes of this sound (see `soundOf`); all of the channel's notes if left out */
  sound?: string;
  /** Applies to notes starting in [from, to), song seconds at 100% speed; either end may be left open */
  from?: number;
  to?: number;
  hand: Role | 'default' | 'merge' | 'join';
}

/** Song edits keyed by track (`trackKey`: game and hex sound ID) */
export type TrackEdits = Record<string, EditRule[]>;

/** A note's sound within its channel: duty cycle and volume, which the drivers set per instrument */
export const soundOf = (n: Pick<Note, 'duty' | 'vel'>) => `${n.duty}:${n.vel}`;

/** Whether an edit applies to a note: its channel, sound and start time */
export function ruleCovers(r: EditRule, n: Note) {
  const t = n.start * FRAME_SECONDS;
  return r.ch === n.ch && (r.sound === undefined || r.sound === soundOf(n)) && t >= (r.from ?? -Infinity) && t < (r.to ?? Infinity);
}

/** The hand that plays a note, or `off` if the song's edits remove it */
export function roleOf(n: Note, rules: EditRule[] = []): Role {
  let role: Role = CHANNEL_HAND[n.ch] ?? 'R';
  for (const r of rules) {
    if (r.hand === 'merge' || r.hand === 'join' || !ruleCovers(r, n)) continue;
    role = r.hand === 'default' ? CHANNEL_HAND[n.ch] ?? 'R' : r.hand;
  }
  return role;
}

/** An echo starting up to this many frames after the note it repeats ends is joined to it */
export const ECHO_GAP_FRAMES = 15;

/**
 * Folds the echoes the `join` edits cover into held notes, since a keyboard can only
 * reproduce an echo by holding the key. Works one pitch at a time. The channel with
 * the longest note in a held note leads it; a note of that pitch on another channel
 * is an echo if it starts while the lead's note sounds, or up to ECHO_GAP_FRAMES
 * after it ends and is no longer than it (Flash Man's Pulse 2 repeats Pulse 1 a fifth
 * of a second later). Echoes are held until they end. The lead's own repeated notes,
 * and notes too long or late to be echoes, stay separate presses.
 */
function joinEchoes(notes: Note[], rules: EditRule[]): Note[] {
  const out: Note[] = [];
  const byPitch = new Map<number, Note[]>();
  for (const n of notes) {
    if (n.ch > 2) { out.push(n); continue; }
    let list = byPitch.get(n.midi);
    if (!list) byPitch.set(n.midi, (list = []));
    list.push(n);
  }
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.start - b.start || a.ch - b.ch);
    let held: Note | null = null;
    let lead = { ch: -1, len: 0, end: 0 };
    for (const n of list) {
      const len = n.end - n.start;
      const echo = held && n.ch !== lead.ch && (n.start < lead.end || (n.start - lead.end <= ECHO_GAP_FRAMES && len <= lead.len));
      if (echo && rules.some((r) => ruleCovers(r, n))) {
        held!.end = Math.max(held!.end, n.end);
        if (len > lead.len) lead = { ch: n.ch, len, end: n.end };
        continue;
      }
      // An echo on a channel the edits don't cover is left as it is
      if (echo) { out.push(n); continue; }
      // A new press: the previous held note lets go of the key first
      if (held) held.end = Math.min(held.end, n.start);
      held = { ...n };
      lead = { ch: n.ch, len, end: n.end };
      out.push(held);
    }
  }
  return out;
}

/**
 * Applies the song's merge and join edits. A merge joins the notes it covers (such
 * as a vibrato or trill written as many short notes) into one note from the first
 * start to the last end, at the pitch held longest, keeping the first note's sound.
 * Merges apply in order; then all the join edits fold echoes into the notes they
 * repeat in one pass (see `joinEchoes`). Returns a new list; other notes are untouched.
 */
export function applyMerges(notes: Note[], rules: EditRule[] = []): Note[] {
  let out = notes;
  for (const r of rules) {
    if (r.hand !== 'merge') continue;
    const group = out.filter((n) => ruleCovers(r, n)).sort((a, b) => a.start - b.start);
    if (group.length < 2) continue;
    const held = new Map<number, number>();
    for (const n of group) held.set(n.midi, (held.get(n.midi) ?? 0) + n.end - n.start);
    const midi = [...held].reduce((best, p) => (p[1] > best[1] ? p : best))[0];
    const first = group[0];
    const merged: Note = { ch: r.ch, midi, start: first.start, end: Math.max(...group.map((n) => n.end)), vel: first.vel, duty: first.duty };
    const drop = new Set(group);
    out = out.filter((n) => !drop.has(n));
    out.push(merged);
  }
  const joins = rules.filter((r) => r.hand === 'join');
  if (joins.length) out = joinEchoes(out, joins);
  return out === notes ? notes : out.sort((a, b) => a.start - b.start || a.midi - b.midi);
}
