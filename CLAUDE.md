# Mega Man Keys: project notes for Claude Code

A browser-based MIDI keyboard trainer for Mega Man 1–6 music. It's TypeScript and Vite with no framework. The DOM is wired by hand in `src/main.ts`, and the gameplay is drawn on a canvas. See `README.md` for user-facing features and the "How it works" overview.

## Hard rules

- **Never commit game data.** `roms/` holds extracted ROMs and NSF drivers and is gitignored. The repo must stay free of ROMs, driver blobs, rendered audio and byte arrays copied from them. Tests that need driver data read `roms/nsf/*.bin` and skip when it's missing.
- **`scores.json` is the user's personal record file** and is gitignored. `track-names.json` and `track-edits.json` are committed. All three hold real user data: don't overwrite or delete them during testing. Back them up first and restore them afterwards.
- On this machine the global npm config has `os=linux`, so install with `npm install --os=win32 --cpu=x64`, or Rollup's native module goes missing.
- When editing files with Python, always pass `encoding='utf-8'`. The Windows default (cp1252) has corrupted `…`, `—` and `✎` in this codebase before.

## Commands

```sh
npm start            # tools/dev.ps1: starts the dev server if :5173 is down, then opens it in Chrome
npm run dev          # Vite dev server (the user usually has one on :5173)
npm test             # vitest: unit tests, plus driver integration tests when roms/nsf exists
npx tsc --noEmit     # type-check (strict, noUnusedLocals)
npm run build        # type-check + production build
npm run extract      # Proteus.exe -> roms/ (ROMs + NSF drivers)
npx tsx tools/discover.ts | render.ts | difficulty.ts | fingering.ts | probe.ts   # dev inspection tools
```

## Architecture

| Path | Role |
|---|---|
| `vite.config.ts` | Dev-server plugins: `/proteus.exe` serves the Steam exe (`MMLC_EXE` overrides the path); `/api/data/<track-names\|track-edits\|scores>` GETs/PUTs the JSON data files in the project root |
| `src/rom/extract.ts` | Finds ROMs and NSF drivers in `Proteus.exe` `.rdata` by their labels (`MegaMan2`, `NSFMegaMan2`) |
| `src/emu/cpu6502.ts`, `apu.ts`, `nsf.ts` | 6502 interpreter, register-level 2A03 APU, NSF driver player (`requestSound`, `tick`) |
| `src/games.ts` | Per-game driver specs (load/play/request addresses, probe IDs) |
| `src/song/discover.ts` | Probes sound IDs to find music tracks |
| `src/song/analyze.ts` | Turns APU state into notes, detects loops (exact APU-write hash, or fuzzy pitch matching for MM3–6), renders PCM |
| `src/song/targets.ts` | Notes → timed targets. `buildPart(a, part, opts)` (part = `right`, `p1`, `p2`, `lh` or `both`) selects a hand's notes (`p1`/`p2`: the right hand's notes on one pulse); `partChannels` picks which channels to quieten; `spanOf` is the span a set of targets occupies (for “Trim to my part”) |
| `src/song/hands.ts` | `roleOf`: a note's hand by channel (pulses right, triangle left), changed by the song's `EditRule`s (channel, optional sound = `duty:vel`, time range in 100%-speed seconds, hand `R`/`L`/`off`/`default`/`swap` (`swap` flips the hand the earlier rules left, leaving `off` alone), or an `Operation`: `merge`/`tie`/`slide`/`split`/`join`/`keep`/`8va`/`8vb`/`easy-off`; later rules win, and `isOperation` tells the two kinds apart). `applyMerges` cuts notes held across a `split` rule's `from`/`to` (`splitPoints`), joins `merge` rules' notes into one, `tie` rules' repeats of a pitch into one, `slide` rules' notes into one slide (`Note.slideTo`, judged on its start with keys along it allowed: `judge.ts` `inSlide`) folds `join` rules' cross-channel echoes into the note they repeat (both before the length filter) and moves `8va`/`8vb` rules' notes an octave up or down (they stack), then `buildTargets` lets `keep` rules' notes (`isKept`) past the length filter and drops `off` notes, and in easy mode (`TargetOptions.easy`) `easy-off` rules' notes (`isEasyOff`), before merging unisons. Edits come from `track-edits.json` via `TargetOptions.edits`; tools read it with `tools/edits.ts`. Check with `tools/hands.ts` |
| `src/song/difficulty.ts` | 1–10 difficulty rating from targets (`RATING_SCALE` tunes the curve) |
| `src/song/fingering.ts` | Suggested fingering: per-hand Viterbi over chord fingerings with a Parncutt-style cost model; sets `TargetNote.finger`. `markWideReaches` sets `TargetNote.wide` (drawn red) on right-hand notes held together more than `MAX_REACH` semitones apart, and `markHandClashes` sets `TargetNote.clash` (also red) where a left-hand note sounds at or above a right-hand note held with it — the case an `8va`/`8vb` edit fixes. Both are marked in `main.ts` on the built part, so clashes only show on `both`; the editor calls `wideReaches`/`handClashes` directly, the latter on a `both` build, since its roll still holds the unisons a build merges. `test/fingering.test.ts` pins textbook scale/arpeggio fingerings, so rerun it when tuning costs |
| `src/worker/` | Heavy emulation runs in a Web Worker; `SongWorkerClient` is the main-thread API |
| `src/game/judge.ts` | Hit windows, `accuracyOf` (notes hit, less half a note per wrong press), `timingOf`, score (out of 1,000,000: 90% timing + 10% max combo), `gradeOf` (S ≥ 99%, A ≥ 90%, B ≥ 80%, C ≥ 70%, else D), full combo |
| `src/game/session.ts` | One play session: audio sync, stop mode, loop passes, wake lock. `onPass` reports each looped pass's accuracy (only when the pass had notes). A `PlayRange` sets where the run starts and ends; `LoopSpan.leadIn` is the run-up replayed (with a countdown) before each pass of a looped section |
| `src/game/ladder.ts` | Speed ladder: `SpeedLadder.record` turns per-pass accuracies into speed steps along `PRACTICE_SPEEDS` (rules in `LADDER`: 3 passes at 90%+ up, 3 under it down). Changing speed means re-rendering the music, so `main.ts` steps by restarting the session; the ladder instance lives across those restarts |
| `src/game/highway.ts` | Canvas renderer for falling notes and keyboard (note names, finger badges, upcoming-key fingers) |
| `src/audio/engine.ts` | Web Audio playback; `position()` is the heard-time clock (`getOutputTimestamp`) |
| `src/input/midi.ts` | Web MIDI input, plus a computer-keyboard fallback |
| `src/scores.ts` | Parts (`CHARTS`: `right`, `p1`, `p2`, `lh`, `both`), score records keyed `game:id:part:speed%:stop\|flow`, the library's `ScoreView`, migrations from older chart ids and grades. Retired parts (`rh` melody-only, `rhc`, channel charts) keep their records in the file, hidden |
| `src/storage.ts` | Settings, localStorage/IndexedDB, `syncProjectFiles` (merges the JSON data files with localStorage) |
| `src/trackEditor.ts` | Track editor dialog: per-channel piano roll coloured by role, range/note selection, channel and sound filters, listen, edit list. Saves through `EditorContext.save` (main.ts writes `track-edits.json` and clears `partCache`). `EditorView.marker` is a line down the roll with no selection of its own, which the roll opens scrolled to: the pause menu's *Edit parts here* (`editHere` in `main.ts`) sets it to where the run had reached |
| `src/sectionPicker.ts` | Song-dialog timeline for choosing a practice section (100%-speed seconds, snapped to note onsets, remembered per song in localStorage `practiceSection`) |
| `src/stages.ts` | Stage-theme sound IDs per game, for the song list's *Stages only* filter |
| `src/main.ts` | Boot, library screen (score filter bar, difficulty, records, `lastPlayed` marker on the row and game tab), song dialog (Practice / Score run), results |

## Domain facts worth knowing

- Channels: 0 = Pulse 1, 1 = Pulse 2, 2 = Triangle, 3 = Noise, 4 = DMC. What you play is chosen by **hand**. Hands follow the channels (pulses right, triangle left) except where the user's edits in the track editor say otherwise (Needle Man's intro has the bass on Pulse 1; removed notes are percussion or accompaniment). Automatic register-based hand assignment and melody/chord extraction were tried and dropped as unreliable; the user edits the songs they care about. A channel's "sounds" are notes grouped by duty cycle and peak volume (`Note.duty`, `Note.vel`). Fingering, difficulty and note colours all use `TargetNote.hand` (`handOf` falls back to the channel's usual hand). A part for one hand is built from that hand's notes alone (`buildTargets`' `hand` argument), so a unison on the other hand's channel can't drop a note from it — Heat Man's intro doubles the triangle bass note for note on Pulse 1, and the left hand lost all of it that way.
- Driver entry points:
  - MM1: load/play `$9000`, request `$9003` (A = sound ID).
  - MM2–6: `$8000`/`$8003`.
  - MM2 also needs a setup call at `$C0F0`.
- One NTSC frame is `CPU_HZ / 60.0988` cycles, and `FRAME_SECONDS` converts frames to seconds.
- **Accuracy decides a record, score only breaks ties** (`recordRun`): the most accurate run wins the key even when its timing, and so its score, came out lower. `recordAccuracy` recomputes a stored record's accuracy from its judgment counts, falling back to the stored `accuracy` field only when a record has no counts, so always compare records through it rather than reading `rec.accuracy`.
- The span a run plays comes from `startSession`: the chosen practice section, or, with the `trimToPart` setting, the span the part itself occupies (`spanOf` on the built notes, converted to 100%-speed seconds). Both become a `PlayRange`; a trim drops no notes, since every note of the part is inside it, and it leaves a looped run on the song's own loop section (only its first pass starts trimmed).
- Migrations run once at boot, in `main.ts` `boot()` (`migrateLegacyBests`, `migrateChannelCharts`, `migrateGrades`), and rewrite the user's `scores.json` in place. Add a new one there, make it idempotent, and have the user back the file up first.
- Score runs force `SCORE_RUN_RULES` (minNoteFrames 4, exact octave, no loop). Speed, stop mode and easy mode are part of the record key (easy adds an `:easy` suffix, so full-mode keys are unchanged). In the song dialog they're kept separately for practice (`Settings`) and for score runs (`ScoreView`).
- Track identity is `trackKey(game, id)` = `mm2:0a` (hex sound ID), and names and scores are keyed by it. Discovery results are cached in localStorage per game. If discovery output changes, bump `DISCOVERY_VERSION` in `main.ts` so caches refresh.

## Adding a feature

Where things tend to go, and the wiring that is easy to miss:

- **A setting** (`Settings` in `src/storage.ts`): add the field, a default in `DEFAULT_SETTINGS`, and a control in `index.html` whose `name` matches the field exactly. The song dialog binds generically — it reads every `Object.keys(settings)` through `form.elements.namedItem(k)` and writes checkboxes as `checked` and everything else as `Number(value)` — so no per-setting code in `main.ts`. Only `number` and `boolean` settings work; a string would need that loop changed. Score runs ignore settings in `locked`.
- **A part to play** (`CHARTS` in `src/scores.ts`): parts are record keys, so adding or renaming one strands existing records — add a migration rather than changing an id, and retire a part by hiding it, as `rh`/`rhc` were.
- **A hand edit rule**: a new `hand` value runs through `roleOf` and `applyMerges` in `src/song/hands.ts` (add it to `Operation` and `OPERATIONS` if it reshapes notes rather than naming a hand), `buildTargets` in `targets.ts`, the editor's `ROLE_NAMES` and `data-role` buttons in `trackEditor.ts` and `index.html`, and `test/hands.test.ts`.
- **Anything touching notes or targets** invalidates `partCache` in `main.ts` (keyed `game:id:part:speed`); the editor clears the song's entries on save. Difficulty and records are computed from those targets, so changing note selection silently moves both.
- **Heavy work belongs in the worker** (`src/worker/`), reached through `SongWorkerClient`, not on the main thread during a session.
- Run `npx tsc --noEmit` (strict, `noUnusedLocals`) and `npm test` before committing. `test/fingering.test.ts` pins textbook fingerings and `test/hands.test.ts` pins edit behaviour, so expect those to catch unintended changes.

## Testing in a browser

Real MIDI and audio need the user. For automated UI checks, Playwright (`playwright-core` driving the installed Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`) against a separate `vite --port 5199` server works well. A fresh browser profile starts empty and syncs from the project JSON files. Back up `scores.json` and `track-names.json` before any test that plays a run or renames a track.
