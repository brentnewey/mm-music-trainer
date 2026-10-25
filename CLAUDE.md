# Mega Man Keys: project notes for Claude Code

A browser-based MIDI keyboard trainer for Mega Man 1–6 music. It's TypeScript and Vite with no framework. The DOM is wired by hand in `src/main.ts`, and the gameplay is drawn on a canvas. See `README.md` for user-facing features and the "How it works" overview.

## Hard rules

- **Never commit game data.** `roms/` holds extracted ROMs and NSF drivers and is gitignored. The repo must stay free of ROMs, driver blobs, rendered audio and byte arrays copied from them. Tests that need driver data read `roms/nsf/*.bin` and skip when it's missing.
- **`scores.json` is the user's personal record file** and is gitignored. `track-names.json` is committed. Both hold real user data: don't overwrite or delete them during testing. Back them up first and restore them afterwards.
- On this machine the global npm config has `os=linux`, so install with `npm install --os=win32 --cpu=x64`, or Rollup's native module goes missing.
- When editing files with Python, always pass `encoding='utf-8'`. The Windows default (cp1252) has corrupted `…`, `—` and `✎` in this codebase before.

## Commands

```sh
npm run dev          # Vite dev server (the user usually has one on :5173)
npm test             # vitest: unit tests, plus driver integration tests when roms/nsf exists
npx tsc --noEmit     # type-check (strict, noUnusedLocals)
npm run build        # type-check + production build
npm run extract      # Proteus.exe -> roms/ (ROMs + NSF drivers)
npx tsx tools/discover.ts | render.ts | difficulty.ts | probe.ts   # dev inspection tools
```

## Architecture

| Path | Role |
|---|---|
| `vite.config.ts` | Dev-server plugins: `/proteus.exe` serves the Steam exe (`MMLC_EXE` overrides the path); `/api/data/<track-names\|scores>` GETs/PUTs the JSON data files in the project root |
| `src/rom/extract.ts` | Finds ROMs and NSF drivers in `Proteus.exe` `.rdata` by their labels (`MegaMan2`, `NSFMegaMan2`) |
| `src/emu/cpu6502.ts`, `apu.ts`, `nsf.ts` | 6502 interpreter, register-level 2A03 APU, NSF driver player (`requestSound`, `tick`) |
| `src/games.ts` | Per-game driver specs (load/play/request addresses, probe IDs) |
| `src/song/discover.ts` | Probes sound IDs to find music tracks |
| `src/song/analyze.ts` | Turns APU state into notes, detects loops (exact APU-write hash, or fuzzy pitch matching for MM3–6), renders PCM |
| `src/song/targets.ts` | Notes → timed targets for the chosen parts; `partInfo`, `defaultPart` |
| `src/song/difficulty.ts` | 1–10 difficulty rating from targets (`RATING_SCALE` tunes the curve) |
| `src/worker/` | Heavy emulation runs in a Web Worker; `SongWorkerClient` is the main-thread API |
| `src/game/judge.ts` | Hit windows, score (out of 1,000,000), grades, full combo |
| `src/game/session.ts` | One play session: audio sync, stop mode, loop passes, wake lock |
| `src/game/highway.ts` | Canvas renderer for falling notes and keyboard |
| `src/audio/engine.ts` | Web Audio playback; `position()` is the heard-time clock (`getOutputTimestamp`) |
| `src/input/midi.ts` | Web MIDI input, plus a computer-keyboard fallback |
| `src/scores.ts` | Charts (`p1`, `tri`, `p12`, `all`), score records keyed `game:id:chart:speed%:stop\|flow`, the library's `ScoreView` |
| `src/storage.ts` | Settings, localStorage/IndexedDB, `syncProjectFiles` (merges the JSON data files with localStorage) |
| `src/main.ts` | Boot, library screen (score filter bar, difficulty, records), song dialog (Practice / Score run), results |

## Domain facts worth knowing

- Channels: 0 = Pulse 1, 1 = Pulse 2, 2 = Triangle, 3 = Noise, 4 = DMC. Pulses are treated as right hand and Triangle as left hand.
- Driver entry points:
  - MM1: load/play `$9000`, request `$9003` (A = sound ID).
  - MM2–6: `$8000`/`$8003`.
  - MM2 also needs a setup call at `$C0F0`.
- One NTSC frame is `CPU_HZ / 60.0988` cycles, and `FRAME_SECONDS` converts frames to seconds.
- Score runs force `SCORE_RUN_RULES` (minNoteFrames 4, exact octave, no loop). Speed and stop mode are part of the record key. In the song dialog they're kept separately for practice (`Settings`) and for score runs (`ScoreView`).
- Track identity is `trackKey(game, id)` = `mm2:0a` (hex sound ID), and names and scores are keyed by it. Discovery results are cached in localStorage per game. If discovery output changes, bump `DISCOVERY_VERSION` in `main.ts` so caches refresh.

## Testing in a browser

Real MIDI and audio need the user. For automated UI checks, Playwright (`playwright-core` driving the installed Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`) against a separate `vite --port 5199` server works well. A fresh browser profile starts empty and syncs from the project JSON files. Back up `scores.json` and `track-names.json` before any test that plays a run or renames a track.
