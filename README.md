# Mega Man Keys

A keyboard trainer for the music of Mega Man 1–6. The original NES soundtrack plays while notes fall toward an on-screen piano, Rock Band style. Play along on a MIDI keyboard and you're scored on pitch and timing, with best scores and difficulty ratings for every song.

![Song list with difficulty ratings and best scores](docs/library.png)

The music isn't recorded or transcribed. It's generated live by the games' own sound drivers, which run in a small NES sound emulator and are read straight from **your own copy** of *Mega Man Legacy Collection* (Steam). The repo contains no game data.

## Features

- **Every track, found automatically:** 16–34 per game, including stage themes, bosses, jingles and endings.
- **Play by hand, not by channel:** right hand (melody), right hand with chords, left hand, or both. Each note is given to a hand by where it sits on the keyboard, so when Pulse 1 plays the bass riff under the triangle (Needle Man's intro), it's the left hand's part.
- **Practice tools:**
  - speed 50–100% without changing pitch;
  - **stop mode**, where the song waits at each note until you play it;
  - seamless looping of the game's loop section;
  - octave shift, filtering of very short notes, and a quiet guide for your part.
- **Score runs:** scored out of 1,000,000 with S–D grades and full combos. A best score is kept for each song, chart, speed and stop-mode setting.
- **Difficulty ratings (1–10)** for each chart, based on note density, hand jumps and chords.
- **Suggested fingering:** finger numbers (1 = thumb … 5 = little finger) on every falling note, and on the keys you're about to play.
- **Accurate sync:** the audio clock accounts for output latency, and the results screen can calibrate your personal timing offset.
- **Track names** you assign are saved to the project. This repo ships names for almost every track in all six games.

## Requirements

- *Mega Man Legacy Collection* on Steam (the first collection, with MM1–6).
- [Node.js](https://nodejs.org/) 18 or newer.
- Chrome or Edge, for Web MIDI.
- A USB MIDI keyboard. Optional: the computer keyboard works too, with `A W S E D F T G Y H U J K O L P ;` playing C4 upward and `Z`/`X` shifting an octave.

## Getting started

```sh
git clone https://github.com/brentnewey/mm-music-trainer.git
cd mm-music-trainer
npm install
npm run dev
```

Open the printed URL (usually http://localhost:5173) in Chrome or Edge and allow MIDI access.

The dev server serves the game executable from the default Steam location, `C:\Program Files (x86)\Steam\steamapps\common\Suzy\Proteus.exe`. If yours is elsewhere, set `MMLC_EXE` to its full path before `npm run dev`, or choose the file in the page when asked. Only the six sound drivers (~130 KB) are extracted, and they're cached in the browser.

> If `npm install` skips Rollup's native module on Windows (an npm config with `os=linux` causes this), run `npm install --os=win32 --cpu=x64`.

## Playing

Pick a game, preview a track with ▶, then click **Play**.

### Practice

| Option | What it does |
|---|---|
| Your part | Right hand (melody), Right hand + chords, Left hand, or Both hands, with each part's notes, range and difficulty |
| Speed | 50–100%. The audio is re-rendered, so pitch doesn't change |
| Notes | Every note / Normal / Simplified / Long notes only (drops grace notes and arpeggio blips) |
| Your part in the music | Muted, quiet guide, or full |
| Loop | The intro plays once, then the loop section repeats as in the game, with per-pass accuracy. Esc → *Finish & see results* to stop |
| Stop mode | The song stops before each note until you play it |
| Octave shift / any octave | Fits melodies onto smaller keyboards |
| Show suggested fingering | Finger numbers on notes and upcoming keys (on by default) |
| Latency offset | Set from the results screen's timing calibration |

### Score runs

Switch the dialog to **Score run** to play for a record.

- **Parts:** Right hand, Right hand + chords, Left hand, or Both hands.
- **Records:** one best per **song × part × speed × stop mode**.
- **Score (out of 1,000,000):** 90% comes from timing accuracy (Perfect 100 / Great 70 / Good 40 per note, minus half a note per wrong press) and 10% from max combo.
- **Grades:** S ≥ 95%, A ≥ 90%, B ≥ 80%, C ≥ 70%, otherwise D. Every note hit with no wrong presses is a ★ full combo.
- **Fixed rules:** Normal notes, exact octaves and no loop, so records stay comparable.
- **Stop mode:** timing isn't judged, so the score reflects correct notes and wrong presses.

The bar above the song list chooses which part, speed and stop mode the list shows records and difficulty for, and score runs start from that selection. Tracks without notes for the selected part are hidden.

### Difficulty

Ratings come from the exact notes a score run uses, at the selected speed.
- **Cost per press:** every press costs 1, and a chord adds 0.5 per extra key.
- **Jumps:** moving from that hand's previous press costs 0.6 per octave, up to twice that when there's less than ¼ s to move.
- **Both hands at once:** adds 0.25.
- **Combining:** the cost per second is measured over 4-second windows, blending the busiest stretches (60%) with the average (40%).

Hover a rating to see presses per second, average jump size and chord share. At full speed, a typical song rates about 4 for Right hand, 5.5 for Right hand + chords, 5 for Left hand, and 7 for Both hands.

### Which hand plays what

NES channels don't map neatly onto hands. Usually the pulses carry melody and harmony and the triangle the bass, but channels swap roles, sometimes within a song. So each note is given to a hand by register (`src/song/hands.ts`):

- **Windows:** the song is cut into 2-second windows.
- **Scoring each window:** every combination of hands for the parts playing in that window is scored.
  - Low parts lean left and high parts lean right.
  - Crossed hands cost extra.
  - So do three parts in one hand, two parts more than an octave apart in one hand, and two parts in one hand while the other hand is free.
- **Smoothing:** the cheapest sequence is found with a charge for each part that changes hands. Each switch is moved to the nearest rest in that part.

**Right hand** (melody) keeps one line from the right hand's parts, normally the highest. It won't jump to an echo channel copying the melody a moment later.

In practice, the channels that mostly carry your part are the ones turned down by "Your part in the music".

### Suggested fingering

Fingering is predicted for each hand separately, using the hands chosen above. It uses dynamic programming (Viterbi) to find the cheapest finger sequence through the whole song under an ergonomic cost model, based on Parncutt et al. (1997), *An ergonomic model of keyboard fingering for melodic fragments*. The model charges for:
- stretches beyond comfortable spans for each pair of fingers;
- the weaker 4th and 5th fingers;
- the thumb or little finger on a black key next to white keys;
- 3 followed by 4;
- reusing a finger on a different key.

A thumb pass under fingers 2–4 counts as a hand shift, so scales come out with their textbook fingerings: C, G, D and F major, ascending and descending, in both hands. Chords get one finger per key in pitch order, and transitions across rests count for less because the hand can reposition. It's a suggestion, not a rule: NES melodies leap a lot, and an octave-plus leap is fingered as a hand jump.

### Your data

| File | Contents | In git |
|---|---|---|
| `track-names.json` | Names you give tracks (✎ rename) | Yes, so you can share names |
| `scores.json` | Your score-run records. Records from the earlier channel charts were copied to the nearest hand part (Pulse 1 → Right, Pulse 1 + 2 → Right + chords, Triangle → Left, All three → Both) and marked `migratedFrom` | No (gitignored) |

The dev server writes both files, and the browser keeps a copy, so they survive clearing browser data.

## How it works

1. **Extraction** (`src/rom/extract.ts`):
   - `Proteus.exe` keeps each game's ROM raw in its `.rdata` section, each followed by a descriptor and a label (`MegaMan2`, …).
   - It also keeps the jukebox's **NSF sound drivers** (`NSFMegaMan2`, …), the games' own sound engines repackaged for the collection.
   - `npm run extract` dumps the ROMs and drivers to `roms/` for inspection.
2. **Emulation** (`src/emu`):
   - A 6502 interpreter calls the driver's sound-request routine, then its per-frame update 60 times a second.
   - A register-level 2A03 APU model renders the audio: two pulses, triangle, noise and DMC, with the hardware's nonlinear mixer and filters.
3. **Discovery** (`src/song/discover.ts`): every sound ID is probed. Anything that uses at least two melodic channels for long enough is music, and IDs with identical output are merged.
4. **Analysis** (`src/song/analyze.ts`):
   - **Notes:** per-frame channel state becomes notes. Onsets come from note triggers, volume re-attacks and silences. Pitch is the most common rounded pitch, so vibrato and slides don't split notes.
   - **Loops:** found exactly from the APU register stream. MM3–6 use a fractional tempo, so for those a jitter-tolerant comparison of pitch features is used.
5. **Game** (`src/game`): audio and visuals share a clock derived from `AudioContext.getOutputTimestamp()`. MIDI timestamps are mapped onto it before judging (Perfect ±45 ms, Great ±90 ms, Good ±150 ms).

## Development

```sh
npm test                                   # unit tests (+ integration tests when roms/ has been extracted)
npm run build                              # type-check and production build
npm run extract                            # dump ROMs and sound drivers to roms/ (gitignored)
npx tsx tools/discover.ts                  # list discovered tracks for every game
npx tsx tools/render.ts mm2 1 out.wav      # print notes and render a track to WAV
npx tsx tools/difficulty.ts [speed]        # difficulty ratings for every chart of every song
npx tsx tools/fingering.ts mm2 0 both 40   # suggested fingering for a track and part
npx tsx tools/hands.ts mm3 1 both          # which hand plays each channel over time (--summary for all songs)
npm run probe -- mm3 8000 806c 40          # disassemble a sound driver
```

## Known limitations

- **Track names:** the collection's track list is encrypted, so unnamed tracks show as "Track 07". Preview them and rename.
- **Inferred notes:** notes are inferred from sound-chip behaviour. Percussive pitch drops on the pulse or triangle channels can show up as short notes, and the Notes filter hides most of them.
- **Reduced speed:** the APU's hardware envelopes still run in real time. Capcom's drivers mostly use software envelopes, so this is rarely audible.
- **Platform:** the app runs from the Vite dev server, which provides the executable and the data files. It's built for Windows with Steam's default install location.

## Legal

This is a fan-made practice tool, not affiliated with or endorsed by Capcom. *Mega Man* is a trademark of Capcom. The repo contains no ROMs, music or other game data. You need your own purchased copy of the game.
