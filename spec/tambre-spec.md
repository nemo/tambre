# Tambre — hear what your coding agent is doing

**Spec v0.3, 2026-10-12.** Describes what is built on `main` in `cli/`.
Supersedes v0.2 (the skeleton written before the engine spike) and v0.1 (the
registry spec, preserved at the `v0-library` tag). Where this document and
the code disagree, the code is wrong or this document is stale; both are
bugs. Section 3.8 is the engine as listened to on 2026-10-12 and is kept as
written then; 3.9 records what has changed since.

---

## 0. One paragraph

Tambre is a CLI you install into a project, or for your user, that gives a
terminal coding agent a sound. A resident daemon synthesizes a **texture**
while the agent works (a sustained drone, or one of six sparser modes quiet
enough to sit under a call), a held **tension** layer while it waits on a
permission prompt, silence within seconds once it is waiting on you, and
short **one-shots** at boundaries: session start and end, turn end and
failure, permission request, compaction. Every project gets its own
**voice** inside a shared **frame** (key, voicings, tempo), so with several
sessions running you can hear which project is still going and which one
stopped. No audio files, no registry, no accounts. A patch is a small JSON
document.

---

## 1. Non-negotiables

1. **Never annoy.** The texture is silent when nothing needs you. Tool churn
   never beeps. Permission requests ping once per block and do not nag.
2. **Never clash.** All concurrent sessions share one harmonic frame. A
   project cannot put itself in a different key while another is live.
3. **Never block the agent.** Hooks exit in milliseconds, exit 0
   unconditionally, and never write to stdout or stderr. If audio cannot
   open, everything fails silent; `tambre doctor` explains.
4. **Never execute shared code.** A patch is data over a fixed engine. A
   project file committed to a repo cannot run anything on a teammate's
   machine.
5. **One audio owner.** One daemon per user owns the device. The TUI and
   every hook are clients of it.

---

## 2. Concepts

| Term | Meaning |
| --- | --- |
| **Frame** | The harmonic container: root note, voicing set, tempo, chord cycle length. User-level, one at a time, locked while any session is live. |
| **Voice** | What one project sounds like inside the frame: timbre, register, brightness, movement, width, bell colour, plus an advanced block. Eight built-in palette voices. |
| **Texture** | How a session sounds *while working*: `drone`, `breath`, `pulse`, `rain`, `hum`, `hush` or `none`. Per session; the project's choice overrides the user default. |
| **Patch** | A JSON document holding a voice, a frame, a texture, or any combination. `~/.tambre/config.json` holds the user frame, default voice and texture, and named patches; `<project>/tambre.json` holds a project voice, optionally a texture and a frame proposal. |
| **Session** | One live agent process, identified by the agent's session id and PID. Owns one voice instance in the engine. |
| **State** | Per session: `working`, `blocked`, `waiting`, `ended`. |
| **Canonical event** | Agent-neutral event name an adapter emits (§5). |
| **Adapter** | Per-agent translation from native hooks into canonical events, plus the install and uninstall of the native wiring. |
| **Daemon** | The resident process that owns the audio context, the session table, and the frame. |
| **Project root** | Nearest ancestor of the cwd holding `tambre.json`, else the git toplevel, else the cwd (§4.5). |

---

## 3. Sound model

### 3.1 Doctrine

Adopted from `lwcassid/source-scenes` (its `sound-craft` skill and
`SOUND-DESIGN-GOALS.md`), which has been played to rooms of people for hours:

- **Pedal root, pinned.** The root never moves within a frame. Colour comes
  from a cycle of four extended voicings above it (maj9, 6/9, sus4add9,
  maj13), never triads. One voicing per `chordBars` bars at 56 to 66 BPM.
- **State is which voices are up, not which patch.** Energy adds voices;
  it does not swap sounds.
- **Beds are triangle, tension is saw.** Bed voices are pairs of detuned
  oscillators through a gentle lowpass at tiny gain. The tension register is
  a saw layer through a resonant filter with the cutoff raised.
- **Transitions are short and marked.** Retunes glide for at most 0.2 s and
  are marked by a staggered bell roll (about 90 ms between notes).
- **Nothing repeats.** Two incommensurate slow LFOs on the bed floor; every
  breath randomised.
- **Idle highs are dead.** Only the low register moves at rest.
- **Ceiling.** Master gain into a compressor at −18 dB threshold, 6:1.

### 3.2 Frame

```jsonc
{
  "frame": {
    "root": 43,                 // MIDI note; G2. Clamped to 38..50.
    "voicings": "default",      // a named set, or an inline array of four
    "bpm": 60,                  // clamped to 20..200
    "chordBars": 4              // bars per chord, clamped to 1..32
  }
}
```

Named sets that ship: `default` and `dusk`, both the set in §3.8. An inline
set is arrays of semitone offsets from the root with octave spread kept
verbatim, e.g. `[[0,4,7,11,14],[0,7,9,12,16],[0,5,7,12,14],[0,4,11,14,21]]`.
Volume is not part of the frame; it is a user setting (§4.5). A project may
propose a *partial* frame (just `root`, say); the missing fields come from
the user frame.

### 3.3 Voice

```jsonc
{
  "voice": {
    "name": "glass",            // palette name, or free text for a custom voice
    "timbre": 0.1,              // 0 triangle .. 1 saw
    "register": 1,              // octave offset, -1, 0 or 1
    "brightness": 0.7,          // lowpass cutoff, 320 + brightness*1200 Hz
    "movement": { "depth": 0.2, "rate": 0.11 },   // LFO on the cutoff; depth 0..1, rate 0..2 Hz
    "width": { "detune": 6, "pan": 0.7 },         // cents 0..30, pan -1..1
    "bell": "glass",            // glass | wood | soft
    "advanced": {               // optional; hidden behind the TUI's advanced page
      "attack": 0.35,           // seconds; the voice's entrance time constant on session.start
      "release": 0.7,           // seconds; time constant of the fade to silence on waiting
      "resonance": 0.7,         // 0..1 -> filter Q 0.5..4.0
      "fmRatio": 0,             // stored, not rendered yet
      "reverb": 0               // stored, not rendered yet
    }
  }
}
```

The engine renders `attack`, `release` and `resonance`. `fmRatio` and
`reverb` are carried through config, IPC and the TUI so a patch written
today keeps them, but no graph reads them yet; the TUI says so on the
advanced page.

### 3.4 Palette

Eight built-in voices, deliberately far apart in timbre, register and pan so
that any two are tellable apart in the bed.

| Name | timbre | register | brightness | movement depth / rate | detune / pan | bell |
| --- | --- | --- | --- | --- | --- | --- |
| moss | 0.05 | 0 | 0.30 | 0.25 / 0.05 | 5 / −0.35 | soft |
| brass | 0.55 | 0 | 0.55 | 0.35 / 0.08 | 7 / +0.40 | glass |
| cedar | 0.20 | −1 | 0.25 | 0.15 / 0.03 | 4 / −0.70 | wood |
| glass | 0.10 | +1 | 0.70 | 0.20 / 0.11 | 6 / +0.70 | glass |
| reed | 0.90 | 0 | 0.40 | 0.45 / 0.06 | 9 / −0.15 | wood |
| tide | 0.35 | −1 | 0.45 | 0.60 / 0.04 | 8 / +0.15 | soft |
| wire | 0.60 | +1 | 0.85 | 0.30 / 0.14 | 3 / −0.55 | glass |
| felt | 0.00 | 0 | 0.15 | 0.10 / 0.02 | 5 / +0.55 | soft |

`tambre install` in a project assigns the first palette voice not yet
assigned to another project on this machine, recorded under `assignments`
in `~/.tambre/config.json`; once all eight are taken it wraps. `tambre
doctor` reports two projects holding the same name.

### 3.5 States

| State | Entered on | Sound |
| --- | --- | --- |
| `working` | `session.start`, `working` (prompt submitted), `activity` (any tool or subagent event) | Voice up in its texture. In `drone`, tool activity raises the cutoff by 0.3 of brightness and adds the second pad pair; both decay 4 s after the last event. |
| `blocked` | `permission.request` | Two-note one-shot once, then the saw tension layer sustains until the next event. A second request while already blocked is ignored; two native sources within 2 s count once. No re-ping. |
| `waiting` | `turn.end`, `turn.fail`, `waiting` (idle notification, Codex interrupt) | Voice fades to silence within about 3 s (`release`). Texture scheduler stops. |
| `ended` | `session.end`, or the agent PID is gone | Session-end roll, then the voice is removed after a 5 s tail. |

Waiting and ended are both silent. The one-shots tell them apart. `compact`
plays its tap and leaves the state alone.

### 3.6 One-shots

All pitched from the current chord ladder in the session's voice register
and bell colour, so they are consonant with the bed and identify the
project.

| Event | Gesture |
| --- | --- |
| `session.start` | Ascending three-note roll, entrance of the voice |
| `session.end` | Descending roll with a long tail |
| `turn.end` | Single bell on a chord tone |
| `turn.fail` | Low wood toll an octave under the root, plus a quiet ♭9 |
| `permission.request` | Two-note rising interval, then `blocked` |
| `compact` | Short soft wood tap |

`working`, `activity` and `waiting` play nothing of their own; they move the
state. One-shots are identical in every texture mode.

### 3.7 Concurrency

One engine. Each live session is a voice on the shared chord ladder, panned
by its voice's width. Real sessions take the lowest free even rung from 0,
so two voices never share a chord tone; a preview session (§4.6) sits on
rung 6 or above every real voice. No cap is enforced and no voice stealing
exists yet; a ninth session simply takes rung 16.

The **frame** is set by the first real session: its project's proposal
merged over the user frame if `tambre.json` has one, else the user frame.
The engine refuses a new frame while any real session is live and releases
the lock when the last one ends, including by PID death. Previews never lock
the frame and are retuned into a new one. Later sessions join the frame
with their own voice.

### 3.8 Engine parameters, as built and listened to (2026-10-12)

Listened with Inkling (native audio model) on rendered WAVs, cross-checked
with a DFT of the drone. Every number below survived a listening pass.

**Frame default.** Root G2 (MIDI 43). Voicings, semitones above the root,
octave spread verbatim: `[0,4,7,11,14]` maj9, `[0,7,9,12,16]` 6/9,
`[0,5,7,12,14]` sus4add9, `[0,4,11,14,21]` maj13. Every voicing but the
sus carries the major third; no ♭6, ♭7, ♭9 or tritone anywhere. 60 BPM,
4 bars per chord (16 s). The first version used m7♭13-family voicings and
was heard as "eerie, dissonant"; this set was heard as a gentle colour
shift, "about right for background".

**Shared chord bed.** Chord tones 1..4 one octave up (250 to 450 Hz, where
warmth lives), each a triangle pair detuned ∓(3 + 0.5·i) / ±(3 + 0.6·i)
cents, gain 0.03 per oscillator, through a lowpass at 1500 Hz, Q 0.7.
Up (time constant 0.8 s) while any session is live. This layer is what
makes the chord cycle audible: without it each session is a dyad and the
piece was heard as "static, no chord change". Putting it at octave 0
stacked everything under 220 Hz and was heard as a "dark hollow hum".

**Sub.** Sine one octave below the root, gain 0.045 while any session is
live. 0.07 was heard as muddy.

**Session voice.** Two pad pairs on ladder rungs `r` and `r+1` (sessions sit
on rungs 0, 2, 4…). Each pair: two detunes, −(d−1)−1.8·i and +d+2.4·i
cents (`d` = voice width.detune), each a triangle and a saw blended by
`timbre`, with the saw scaled by 0.55 because it carries far more energy.
Pair gain 0.11 before the filter. Lowpass Q 0.7 at `320 + brightness·1200`
Hz with one LFO on the cutoff (depth·300 Hz at the voice's rate). The
second pair sits at 0 and rises on tool activity (τ 0.25 s), falling 4 s
after the last event (τ 0.6 s); activity also lifts brightness by 0.3.

**Teeth (blocked).** Saw pair at −6/+7 cents an octave below the voice,
gain 0.06, lowpass Q 2.2 opening from 170 Hz to `240 + brightness·780`
Hz, τ 0.4 to 0.5 s. Heard as "harsher, biting, reads as tension, not
merely louder" and dropping cleanly.

**State moves.** working: voice gain → 1, τ 0.3. waiting: gain → 0, τ 0.7
(silent in about 3 s). ended: gain → 0, τ 0.5, sources stop after the
5 s end tail.

**Bells.** Envelope: linear attack then exponential decay with τ = dur/4.
Attack 12 ms glass, 8 ms wood, 50 ms soft; the first version's 4 ms attack
was heard as a click on every strike. Glass: sine plus partials at 2.76×
(0.09) and 5.4× (0.015), lowpass at min(3200, 6·f). The first version's
0.18 and 0.05 partials were heard as "piercing, metallic". Wood: triangle
plus 2× sine (0.2), lowpass at min(1400, 4·f). Soft: sine plus 2× sine
(0.12), no filter.

**Gestures.** Rung offsets on the ladder, delays, durations, gains:
session.start 0/+2/+4 at octave +1, 0/90/180 ms, 1.2/1.2/1.6 s,
0.18/0.16/0.14. session.end +4/+2/0, octave +1/+1/0, 0/90/180 ms,
1.2/1.4/4.0 s, 0.16/0.15/0.20. turn.end +2, octave +1, 1.4 s, 0.20.
permission.request 0 then +3 at octave +1, 180 ms apart, 0.9/1.6 s,
0.18/0.20, then blocked. turn.fail wood toll on root −12 (2.5 s, 0.24)
plus ♭9 (1.6 s, 0.08). compact wood tap on the rung, 0.15 s, 0.10.
Chord change: three soft bells on rungs 0/2/4 at octave +1, 90 ms apart,
1.2 s, 0.045.

**Master.** Bed floor 0.82 modulated by two sine LFOs at 0.031 and 0.017
rad/s (depths 0.10 and 0.07). Master 0.8 → compressor −18 dB, 6:1, attack
10 ms, release 250 ms. Rendered demo measures −23 dB mean, −7 dB peak.

**Palette.** moss (tri, soft bell, left), brass (timbre 0.55, glass,
right), cedar (−1 octave, wood, hard left), glass (+1 octave, bright,
hard right), reed (saw, wood), tide (−1 octave, deep movement), wire
(+1 octave, brightest), felt (pure triangle, darkest). moss against brass
was heard as "a lower darker smooth pad centre-left" against "a higher
brighter glassier tone on the right".

**Still unproven by ear.** Whether the drone reads as *warm* rather than
neutral: the listening model called a plain major triad "ambiguous, no
third" too, so chord-quality judgements from it are not evidence. A human
listening pass decides this.

### 3.9 Texture modes (added after 3.8)

The sustained bed in 3.8 is too present to run under a call. Six more
textures were added, and texture became a **per-session** property: every
`SessionVoice` carries its own mode, the project's `tambre.json` chooses
it, and the user config supplies the default (`hush`). This supersedes two
lines of 3.8: the chord bed is now up only while some live session is in
`drone`, and the sub is at 0.045 for `drone`, 0.03 for `hum` or `hush`,
and off otherwise. Both are recomputed whenever a session is added,
removed or has its texture changed (time constant 0.8 s; 1.2 s when the
last voice leaves). The chord-change roll plays only while a `drone`
session is live.

Only the working state differs between modes. The blocked teeth, every
one-shot, and the `waiting` fade are identical in all seven. The
activity thickening (second pad pair, cutoff lift) exists only in `drone`.
"Busy" below means a tool event within the last 4 s.

| Mode | Working state | Sustained pad (pair 0) | Sub | Chord bed |
| --- | --- | --- | --- | --- |
| `drone` | The bed of 3.8. | 1.0 | 0.045 | up |
| `breath` | One pad swell to 0.45 (busy 0.7), in with τ 0.5 s, back to 0 with τ 1.0 s after 1.8 s; next swell in 8–14 s (busy 5–8 s). | 0, swells | off | off |
| `pulse` | One soft bell on the session's rung (busy: half the time rung +2), register +1, 0.5 s, gain 0.045 (busy 0.06); next in 2.5–5 s (busy 1.2–2.2 s). | 0 | off | off |
| `rain` | One band-passed noise grain, 60–140 ms, centre 900–2600 Hz × (brightness + 0.6), Q 2.5, peak 0.20 (busy 0.30) × 0.6–1.0; next in 0.3–0.8 s (busy 0.12–0.3 s). | 0 | off | off |
| `hum` | Pair 0 held at a whisper with the filter at 400 Hz; nothing scheduled. | 0.25 | 0.03 | off |
| `hush` | `hum` plus `breath` swells; the pad never drops below 0.25. | 0.25, swells | 0.03 | off |
| `none` | Nothing while working; one-shots and teeth only. | 0 | off | off |

**Listened (commit `af5684e`).** Each mode was rendered in the working
state and mixed under synthesized speech. `hum` and `rain` went unnoticed
under speech; `breath` and `pulse` got noticed; `drone` sat in between.
`hush` was built from `hum` and `breath` after that pass and has not been
listened to under speech on its own. The per-mode loudness figures taken
in that pass were not committed; the levels above are the engine's
constants, not measurements.

**Live swaps.** `SessionVoice.setTexture` and `setVoice` rebuild the
voice's graph in place without a click: the old graph fades out with
τ 0.08 s, the new one is built at once and brought up to the session's
current state 300 ms later. The texture scheduler is bound to the graph it
was built with, so a swell still decaying when the graph is swapped cannot
touch the new one.

---

## 4. Runtime

### 4.1 Engine

`node-web-audio-api` (Rust implementation of the Web Audio API for Node,
prebuilt binaries bundled for macOS, Linux and Windows on x64 and arm64).
Node 22 or newer. `AudioContext({ latencyHint: 'playback' })`, opened in
`Engine.start()`; `started` flips only once the whole master chain exists,
so a session added while the native addon is still loading sees an engine
that is not started, never half a graph. With `TAMBRE_NO_AUDIO=1` the
engine opens an inert stub context instead: every node and parameter
accepts calls, nothing is heard, and the addon is never loaded. Tests and
headless hosts run that way.

### 4.2 Daemon

- One per user. Socket at `$TAMBRE_SOCKET` if set; else
  `$XDG_RUNTIME_DIR/tambre.sock`; else `$TMPDIR/tambre-<uid>.sock`; Windows
  `\\.\pipe\tambre-<user>`. When `TAMBRE_HOME` is set the name carries an
  eight-hex-character hash of that directory, so a daemon persisting to one
  config can never be shared by a client under another. PID file beside the
  socket (`.sock` → `.pid`).
- Spawned detached (`stdio: 'ignore'`, `unref()`, `windowsHide`) by the
  first hook or client that finds no live socket. Startup recovers from a
  killed predecessor: a pid file naming a dead process is removed, a socket
  file nothing answers on is unlinked, an `EADDRINUSE` race on listen is
  retried once. A live daemon on the socket wins and the newcomer exits.
- Exits 8 s after the last real session ends. A control message arriving
  while no session is live re-arms that timer, so an open TUI keeps the
  daemon up and it leaves 8 s after the TUI quits. `tambre daemon
  --foreground` never idles out and logs every event to stderr.
- Protocol: newline-delimited JSON on one socket. A hook message gets no
  reply (§4.6). A control message gets one reply line, then the daemon
  closes that connection. Hooks that arrive while the device is still
  opening queue behind it in arrival order, so a cold-start `SessionStart`
  is never dropped. Every hook field is validated at the socket; a bad
  field is dropped with a debug line, a message with no usable id or event
  is ignored.
- Liveness: `session.end` is lossy on at least Claude Code (Ctrl-C, async
  teardown). Every hook carries the agent's PID and the daemon polls it
  every 2 s. Death is `session.end`. A PID that dies within 5 s of being
  adopted was a wrapper shell, not the agent; it is dropped and the session
  continues without a PID.
- Adoption: a session first seen through anything but its `session.start`
  (the start was lost, or the daemon came up mid-session) is resolved from
  the project it runs in exactly as the hook would have done (§4.5), and
  its entrance roll is played.
- Dedupe: `permission.request` arriving from two native sources within 2 s
  counts once, and any further request while the session is already
  `blocked` is ignored.
- Config: `~/.tambre/config.json` is re-read on every new session and on
  every `set`, so edits apply without a restart. Global mute and volume
  changes are written back to it.
- Silence: no output unless `TAMBRE_DEBUG=1`. A daemon spawned by a hook
  under `TAMBRE_DEBUG` logs to `~/.tambre/daemon.log` rather than inherit
  the hook's descriptors, which are the agent's.
- Failure: if the audio device cannot open, the daemon keeps the session
  table and answers `status` (states mirrored in its own table), but plays
  nothing and `preview` answers `ok: false`. `tambre doctor` reports the
  cause.

### 4.3 Hook client

`tambre hook <agent>` reads the native payload from stdin (500 ms budget,
then the pipe is destroyed so a launcher holding it open cannot stall the
hook), hands it to the agent's adapter, and gets a canonical event or
nothing. For `session.start` it resolves the project (§4.5) and attaches
`voiceSpec`, `texture`, `frame` and `projectRoot`, and walks up past any
wrapper shells (one `ps` per hop on macOS, `/proc` on Linux, at most four)
to find the agent's PID; every other event carries `process.ppid`. It then
connects (300 ms), spawns the daemon if nothing answers and retries every
100 ms for up to 2.5 s, writes one line, and calls `process.exit(0)`. A
`session.end` never spawns a daemon. Measured: 2 ms warm, about 200 ms when
it has to spawn. Never prints, never throws out, never fails the agent.

### 4.4 Layout on disk

```
~/.tambre/                      # TAMBRE_HOME overrides the directory
  config.json                   # user frame, default voice and texture, volume, mute,
                                # palette assignments, patches, files install created
  daemon.log                    # only when TAMBRE_DEBUG=1
~/.claude/settings.json         # user-scope Claude Code hooks (CLAUDE_CONFIG_DIR honoured)
~/.codex/hooks.json             # user-scope Codex hooks (CODEX_HOME honoured)
<project>/tambre.json           # voice, texture, optional frame proposal; commit this
<project>/.claude/settings.local.json   # project-scope Claude Code hooks; never committed
<project>/.codex/hooks.json             # project-scope Codex hooks; never committed
<project>/.git/info/exclude     # install appends the two paths above here
```

### 4.5 Configuration

`src/config.ts`. Nothing in it throws on bad input: every loader returns
defaults plus a list of warnings, which hooks ignore and `doctor` prints.

**User config, `~/.tambre/config.json`.** Every field optional.

```jsonc
{
  "frame": { "root": 43, "voicings": "default", "bpm": 60, "chordBars": 4 },
  "voice": "moss",                         // VoiceRef; the default voice
  "texture": "hush",                       // default texture
  "volume": 0.8,                           // 0..1
  "mute": false,
  "assignments": {                         // absolute project root -> palette voice name
    "/Users/me/src/api": "moss",
    "/Users/me/src/web": "brass"
  },
  "patches": {                             // named, saved from the TUI
    "night": { "voice": { "name": "night", "timbre": 0.1, "...": "..." }, "texture": "hum" }
  },
  "createdFiles": [                        // settings files and directories install made from nothing
    "/Users/me/src/api/.codex", "/Users/me/src/api/.codex/hooks.json"
  ]
}
```

**Project config, `<project>/tambre.json`.** Pure data, safe to commit.

```jsonc
{
  "voice": "brass",                        // VoiceRef
  "texture": "hush",                       // optional
  "frame": { "root": 45 }                  // optional, may be partial
}
```

**VoiceRef** is one of: a palette name (`"moss"`); a full voice object
(§3.3); or a palette name plus overrides (`{ "name": "moss", "brightness":
0.6 }`). A custom name with missing fields is filled from `moss`.

**Validation.** `root` is rounded and clamped to 38..50, `bpm` to 20..200,
`chordBars` to 1..32; an unknown named voicing set is a warning. Voice
fields are clamped to the ranges in §3.3; an unknown palette name, an
object without `name`, or a bad `bell` drops the field with a warning.
`assignments` entries that are not palette names are dropped. A file that
is not JSON yields all defaults and a warning naming the parse error.

**Writing.** `saveUserConfig(partial)` and `updateProjectConfig(root,
patch)` read the file, merge the patch (`assignments` and `patches` one
level deep, `null` removes a key, unknown keys already in the file are
kept), and write it back pretty-printed through a temp file and rename.
Both refuse to overwrite a file that exists but is not JSON (`ConfigError`),
so a hand-edited file with a syntax slip is never replaced by the patch.

**Project root.** `findProjectRoot(cwd)`: the nearest ancestor of cwd
(inclusive) holding `tambre.json`, searching no higher than the git
toplevel when inside a checkout (a `tambre.json` in `$HOME` must not
capture every repo beneath it); else the git toplevel; else cwd. Always
absolute with symlinks resolved, so a root a hook records from the agent's
cwd compares equal to one resolved from `process.cwd()`.

**Resolution.** `resolveSession(cwd)` returns `{ voice, voiceSource,
texture, frame?, projectRoot }`:

- voice: `tambre.json` `voice` if present, else `assignments[root]`, else
  the user `voice`; `voiceSource` says which.
- texture: project, else user.
- frame: the project's proposal merged per field over the user frame, or
  absent (the daemon then uses the user frame).

`nextUnusedPaletteVoice(userConfig)` is the first palette name no project
is assigned to, wrapping once all eight are taken.

### 4.6 IPC

`src/ipc.ts`. All messages are one JSON object per line on the socket in
§4.2. `src/client.ts` wraps them: `connect()`, `send(msg)` with a 500 ms
reply timeout, `status()` (null when nothing listens), `sendHook(msg)`,
`spawnDaemon()`, and `ensureDaemon()` which spawns and polls `status` every
100 ms for up to 3 s. Nothing in the client prints.

**Hook message**, no reply:

```jsonc
{
  "event": "session.start",     // canonical event, §5.1
  "sessionId": "abc-123",
  "agent": "claude-code",       // claude-code | codex
  "cwd": "/Users/me/src/api",
  "pid": 41213,                 // the agent process
  "voiceSpec": { "...": "..." },// a fully resolved Voice; the daemon looks nothing up
  "voice": "moss",              // palette name; used only when voiceSpec is absent
  "texture": "hush",
  "frame": { "root": 45 },      // partial proposal; honoured only for the first session
  "projectRoot": "/Users/me/src/api"
}
```

**Control messages**, one reply line each, then the daemon closes the
connection. Unknown `cmd` → `{ "ok": false, "error": "..." }`.

| Request | Reply |
| --- | --- |
| `{ "cmd": "status" }` | `{ "ok": true, "frame": Frame, "sessions": [{ "id", "agent", "projectRoot", "voice": name, "texture", "state", "muted", "pid"? }], "volume", "mute" }` |
| `{ "cmd": "mute", "scope": "all" \| { "project": root } \| { "session": id }, "value": bool }` | `{ "ok": true }`. `all` persists to the user config. Project roots compare after `path.resolve`. |
| `{ "cmd": "volume", "value": 0..1 }` | `{ "ok": true }`. Clamped, persisted. |
| `{ "cmd": "preview", "what": "event" \| "state", "name": CanonicalEvent \| SessionState, "voice": VoiceRef, "texture": TextureMode }` | `{ "ok": true }`, or `ok: false` for an unknown name, a bad voice or texture, or no audio device. |
| `{ "cmd": "set", "session": id, "voice"?: VoiceRef, "texture"?: TextureMode }` | `{ "ok": true }`. Live-swaps the session (§3.9). |
| `{ "cmd": "shutdown" }` | `{ "ok": true }`, then the daemon stops. |

**Preview** plays on one synthetic session, id `__preview__`, which never
appears in `status`, never locks the frame, never counts for the idle exit,
and sits above every real voice on the ladder. The first preview creates it
in the `waiting` state (or `working`, for a `session.start` preview); later
previews reuse it, swapping voice or texture when they differ. A
`session.end` preview rings the roll but keeps the session for the next
audition; a `state: ended` preview is treated as `waiting`. It is dropped
10 s after the last preview command.

---

## 5. Canonical events and adapters

### 5.1 Events

The set the engine plays is smaller than the v0.2 list; events that only
fed the working texture collapsed into one.

| Canonical | Meaning | State after |
| --- | --- | --- |
| `session.start` | Agent process started or resumed | working |
| `session.end` | Agent process ended | ended |
| `working` | User submitted a prompt | working |
| `activity` | A tool or subagent started, finished or failed; texture only | working |
| `turn.end` | Agent finished its turn | waiting |
| `turn.fail` | Turn ended in failure | waiting |
| `permission.request` | Agent waiting on human approval | blocked |
| `waiting` | Agent idle, waiting on the user | waiting |
| `compact` | Context compaction about to run | unchanged |

### 5.2 Coverage

Claude Code and Codex are built and tested against each native event. The
Codex column was checked against https://learn.chatgpt.com/docs/hooks on
2026-10-12. The last three columns are the plan from v0.2, not code.

| Canonical | Claude Code | Codex | OpenCode (plan) | pi (plan) | Amp (plan) |
| --- | --- | --- | --- | --- | --- |
| session.start | SessionStart | SessionStart | session.created | session_start | session.start |
| session.end | SessionEnd (lossy) | SessionEnd | session.deleted (partial) | session_shutdown | — (PID poll only) |
| working | UserPromptSubmit | UserPromptSubmit | chat.message | before_agent_start | agent.start |
| activity | PreToolUse, PostToolUse, PostToolUseFailure, SubagentStart, SubagentStop | PreToolUse, PostToolUse, SubagentStart, SubagentStop | tool.execute.before / after | tool_call / tool_result | tool.call / tool.result |
| turn.end | Stop | Stop | session.idle | agent_settled | agent.end |
| turn.fail | StopFailure | — (no such event) | session.error | ? | agent.end status |
| permission.request | PermissionRequest, Notification(permission_prompt) | PermissionRequest | permission.ask | — | — |
| waiting | Notification(idle_prompt, agent_completed) | Interrupt | session.idle | agent_settled | agent.end |
| compact | PreCompact | PreCompact | experimental.session.compacting | — | — |

`PostCompact` and other `Notification` types are parsed and dropped. Codex
has no `Notification` and no `StopFailure`; its `Interrupt` (the user cut
the turn short) maps to `waiting`.

### 5.3 Adapter shape

`src/adapters/<agent>.ts` implements:

- `events()`: the native events to register.
- `hooksBlock(command)`: the JSON to merge, `{ hooks: { <Event>: [ { hooks:
  [ { type: 'command', command, async?: true, timeout?: s, tambre: true } ] }
  ] } }`. Every entry is marked `"tambre": true` so uninstall can find it.
  Every event is `async: true` except `SessionEnd`, which runs synchronously
  with a timeout: 5 s on Claude Code, 3 s on Codex (its documented cap).
- `settingsPath(scope, root)`: Claude Code `$CLAUDE_CONFIG_DIR/settings.json`
  (default `~/.claude/settings.json`) or `<root>/.claude/settings.local.json`;
  Codex `$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`) or
  `<root>/.codex/hooks.json`.
- `parse(stdinJson)`: `{ event, sessionId, cwd?, nativeEvent, notificationType?,
  toolName? }` or null for anything not played or malformed. Both agents
  share the payload fields `hook_event_name`, `session_id`, `cwd`,
  `tool_name`; Claude Code adds `notification_type`.
- `postInstallNotes(scope)`: Codex tells the user to open Codex and run
  `/hooks` to trust the new entries; a project `.codex/hooks.json` is loaded
  only once that layer is trusted.

The v0.2 plan for OpenCode, pi and Amp (a generated plugin file whose only
job is to spawn `tambre hook <agent>`, plus turning native sounds off) is
unchanged and unbuilt.

### 5.4 Order of delivery

v1: Claude Code, Codex (built). Then OpenCode, pi, Amp, in that order.

---

## 6. Install

```
tambre install   [--agent claude-code|codex|all] [--user | --project] [--voice <name>] [--texture <mode>]
tambre uninstall [--agent claude-code|codex|all] [--user | --project] [--purge]
```

`--agent` defaults to `all`. `--project` is the default inside a git repo,
or when the project root already has a `tambre.json`; `--user` otherwise.

**Project scope.** Writes `<root>/tambre.json` if absent with `{ voice:
<--voice, or the root's existing assignment, or the next unused palette
voice>, texture: <--texture, or the user default> }`; if it exists,
`--voice` and `--texture` update just those keys and everything else in the
file stays. Records `assignments[root]` in the user config when the voice
is a palette name. Merges the hooks block into `.claude/settings.local.json`
and `.codex/hooks.json` under the root and appends each path to
`.git/info/exclude` (per clone, never committed). Prints "Commit
tambre.json; teammates opt in with `tambre install`". A hook command on a
machine without tambre no-ops silently.

**User scope.** Merges into `~/.claude/settings.json` and
`~/.codex/hooks.json`; `--voice` and `--texture` set the user defaults.

**Never** writes `<root>/.claude/settings.json`.

**Merge.** Read the existing JSON, drop every entry marked `tambre: true`
(matcher groups and events left empty go too), append our groups under
each event, keep everything else, write back pretty-printed. A second
install changes no bytes. A settings file that is not JSON is skipped with
the parse error and the command exits 1; nothing is written to it.

**Command.** `node <absolute dist/tambre.js> hook <agent>`, with symlinks
resolved so it never names an npm bin link or an npx cache entry that may
vanish. Local settings files are per machine, so an absolute path is right.

**Bookkeeping.** Files and directories install created from nothing are
recorded under `createdFiles` in the user config.

**Uninstall** strips only entries marked `tambre: true`. A file that
install created and that now holds nothing else is deleted (and its
directory, when install made that too); a file that pre-existed, even as
`{}`, is only emptied of our entries. `tambre.json` and the palette
assignment are kept unless `--purge`.

---

## 7. CLI

```
tambre                                  TUI (§8)
tambre install / uninstall              §6
tambre hook <agent>                     hook client, stdin → daemon; never prints
tambre hooks print <agent> [--command <cmd>]   the JSON block install would write
tambre status [--json]                  frame, volume, mute, live sessions with agent, voice, texture, state, muted, project
tambre mute [--here] / unmute [--here]  everything (persisted), or this project's live sessions
tambre volume <0..1>                    persisted, applied live if the daemon is up
tambre doctor                           §7.1; exit 1 if any check fails
tambre voices                           the palette, saved patches, and assignments
tambre demo [--mode <texture>] [--voices a,b] [--out f.wav]   40 s two-session audition, in-process
tambre daemon [--foreground]            the resident synth; hooks start it for you
tambre --version / --help
```

`hook` and `daemon` never write to stdout or stderr unless `TAMBRE_DEBUG=1`.
Every other command may print. `status --json` with no daemon prints
`{ "ok": false, "running": false, "error": "daemon not running" }` and
exits 0. `mute` and `volume` write the user config even when no daemon is
running, so one started later honours them; `mute --here` only talks to a
live daemon.

### 7.1 doctor

One line per check, `ok` / `warn` / `fail`, in this order. Never throws; a
check that blows up is a `fail` with the error text.

| Check | ok | warn | fail |
| --- | --- | --- | --- |
| node | version ≥ 22 | | older |
| audio addon | `node-web-audio-api` loads | skipped under `TAMBRE_NO_AUDIO` | does not load, or no `AudioContext` |
| audio device | an `AudioContext` opens (closed at once; reports the sample rate) | skipped | cannot open |
| daemon | running (session count, volume, mute) or not running | | |
| user config | parses, or absent (defaults) | warnings from validation, or not JSON | |
| project config | parses, or no `tambre.json` here | warnings, or not JSON | |
| hooks `<agent>`, one per adapter, for this scope | every registered event carries our entry and its command is this binary | not installed, some events missing, or the command names a different binary | the settings file is not JSON, or the recorded script no longer exists |
| palette | no two projects assigned the same voice | collisions, naming the roots | |
| pid file | none, or names the live daemon | not a pid, names a dead process, or alive but the socket does not answer | |

---

## 8. TUI

Ink 5 on React 18, `src/tui/`. Launched by bare `tambre`. Needs a TTY on
stdin and stdout; otherwise one line on stderr and exit 1. Calls
`ensureDaemon()` on start (exit 1 with a hint if none comes up) and talks
to the daemon only through `src/client.ts`, so every preview is played by
the one audio owner. Polls `status` once a second. `q` quits and leaves
the daemon running; with no sessions it exits by itself 8 s later.

One screen, three columns, two rows of key help, one status line.

**Left: presets.** The eight palette voices, then saved patches. `j`/`k`
or the arrows move, `Enter` loads the highlighted one into the editor (a
patch also loads its texture). The loaded voice is starred.

**Centre: sliders**, one page at a time. `Tab`/`Shift-Tab` move focus,
`h`/`l` or the arrows adjust by one step, cycles wrap, `a` toggles pages.

| Page | Slider | Range, step |
| --- | --- | --- |
| main | timbre | 0..1, 0.05 |
| main | register | −1..1, 1 |
| main | brightness | 0..1, 0.05 |
| main | move depth | 0..1, 0.05 |
| main | move rate | 0..0.5, 0.01 |
| main | detune | 0..30, 1 |
| main | pan | −1..1, 0.05 |
| main | bell | glass → wood → soft |
| main | texture | drone → breath → pulse → rain → hum → hush → none |
| advanced | attack | 0.05..5 s, 0.05 (default 0.35) |
| advanced | release | 0.05..10 s, 0.05 (default 0.7) |
| advanced | resonance | 0..1, 0.05 (default 0.7) |
| advanced | fm ratio | 0..8, 0.5; stored only, labelled so |
| advanced | reverb | 0..1, 0.05; stored only, labelled so |

The frame controls planned in v0.2 are not in the TUI; the frame is edited
in `config.json` or proposed in `tambre.json`. The header shows the live
frame's root and tempo.

**Audition.** `1` session.start, `2` turn.end, `3` permission.request,
`4` turn.fail, `5` session.end, `6` compact, `w` working, `b` blocked,
`i` waiting. Each sends a `preview` with the edited voice and texture.

**Right: sessions.** Voice, project basename, state, texture, muted, from
`status`. `J`/`K` pick one; `m` toggles its mute; `p` pushes the edited
voice and texture onto it live (`set`); `M` toggles global mute; `+` (or
`=`) and `-` move the global volume by 0.05.

**Saving.** `s` writes the edit as the project voice and texture into
`tambre.json` when run inside a project (a `tambre.json` ancestor or a git
checkout), merging into whatever else the file holds, and records or
releases the palette assignment (an untouched palette voice is written by
name; a tweaked one as a full object, which releases the project's claim on
the name). Outside a project it writes the user default voice and texture.
`S` prompts for a name (`Enter` saves, `Esc` cancels) and writes a patch to
the user config; it appears in the left column at once. A file that is not
JSON is refused and the error goes to the status line.

Tests: twelve `ink-testing-library` cases against a fake client cover the
initial render, project-voice start, slider and page changes, every daemon
command, and the three save paths.

---

## 9. Platforms

macOS verified end to end (real Claude Code sessions driving the daemon).
Linux and Windows: the prebuilt engine and the named-pipe code paths are
present and untested on real hardware. Linux note: the prebuilt uses JACK
only if a server is running (PipeWire via `pipewire-jack`), else ALSA,
where the `playback` latency hint avoids the small-quantum crackle.
Headless hosts: no device, fail silent; `TAMBRE_NO_AUDIO=1` skips the
device entirely.

---

## 10. Milestones

| # | Deliverable | Done when | Status |
| --- | --- | --- | --- |
| **S0** | Spike: engine, daemon, Claude Code hook client, `demo` | `tambre demo` plays two distinguishable voices through the state cycle; a real Claude Code session drives the daemon end to end | Done 2026-10-12. §3.8 is the listening record. |
| **M1** | `install` for Claude Code and Codex, `status`, `mute`, `volume`, `doctor`, palette, patches, textures | Two projects, two sessions, you can name which one stopped with eyes closed | Done 2026-10-12. Everything in §4–§7 is built; 128 tests pass, 113 of them outside the TUI. The eyes-closed criterion rests on the listening-model pass in §3.8 (moss against brass); a human pass is still open. |
| **M2** | TUI | A new user picks a voice and tunes it in under two minutes without reading docs | Built (§8) with twelve rendering tests. The two-minute criterion has not been tried on anyone; frame controls are absent; `fmRatio` and `reverb` are stored, not heard. |
| **M3** | OpenCode adapter | Plugin file install, trust step documented, native sound toggled | Not started |
| **M4** | pi and Amp adapters | Same, with the coverage gaps surfaced by `doctor` | Not started |
| **M5** | Windows verified; mic-aware auto-duck | — | Not started |

---

## 11. Open questions

1. Should `blocked` on one session duck the other sessions' working texture,
   so the tension reads as foreground?
2. How does the frame recover when the frame-setting session ends while
   others continue: hold (current behaviour: the lock is released only when
   the last real session ends, and the next first session sets it afresh)
   or retune to the user frame at the next chord boundary?
3. OpenCode's SSE `/event` stream could replace its plugin file. Worth it
   once the plugin API settles.
4. Whether the eight palette voices should be a fixed set or a generator
   with a fixed seed per slot, and what to do past eight concurrent sessions
   (no cap or stealing exists; §3.7).
5. The per-mode loudness measurements from the texture pass were never
   committed (§3.9). Re-measure and record them, including `hush`.
6. Whether `fmRatio` and `reverb` earn a place in the engine or should
   leave the advanced page.
