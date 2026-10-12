# Tambre — hear what your coding agent is doing

**Spec v0.2 (skeleton), 2026-10-12.** Supersedes v0.1 (the registry spec,
preserved at the `v0-library` tag). Sections marked *pending spike* are
filled in from the engine spike in `cli/` once it has been listened to.

---

## 0. One paragraph

Tambre is a CLI you install into a project, or for your user, that gives a
terminal coding agent a sound. A resident daemon synthesizes a **drone** while
the agent works, a held **tension** layer while it waits on a permission
prompt, silence within seconds once it is waiting on you, and short
**one-shots** at boundaries: session start and end, turn end and failure,
permission request, compaction. Every project gets its own **voice** (texture)
inside a shared **frame** (key, voicings, tempo), so with several sessions
running you can hear which project is still going and which one stopped. No
audio files, no registry, no accounts. A patch is a small JSON document.

---

## 1. Non-negotiables

1. **Never annoy.** The drone is silent when nothing needs you. Tool churn
   never beeps. Permission requests do not nag by default.
2. **Never clash.** All concurrent sessions share one harmonic frame. A
   project cannot put itself in a different key.
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
| **Frame** | The harmonic container: root note, voicing set, tempo, chord cycle length, master volume. User-level, one at a time. |
| **Voice** | A session's texture: timbre, register, brightness, movement, width, bell colour. Project-level. Eight built-in palette voices. |
| **Patch** | A JSON document holding a frame, a voice, or both. `~/.tambre/config.json` holds the user frame and default voice; `<project>/tambre.json` holds a project voice and optionally a proposed frame. |
| **Session** | One live agent process, identified by the agent's session id and the agent's PID. Owns one voice instance in the drone. |
| **State** | Per session: `working`, `blocked`, `waiting`, `ended`. |
| **Canonical event** | Agent-neutral event name an adapter emits (§5). |
| **Adapter** | Per-agent translation from native hooks or plugin callbacks into canonical events, plus the install/uninstall of the native wiring. |
| **Daemon** | The resident process that owns the audio context, the session table, and the frame. |

---

## 3. Sound model

### 3.1 Doctrine

Adopted from `lwcassid/source-scenes` (its `sound-craft` skill and
`SOUND-DESIGN-GOALS.md`), which has been played to rooms of people for hours:

- **Pedal root, pinned.** The root never moves within a frame. Colour comes
  from a cycle of four extended voicings above it (add9, m9, m11, maj9 and
  the like), never triads. One voicing per `chordBars` bars at 56 to 66 BPM.
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
    "root": 43,                 // MIDI note; G2. Clamp 38..50.
    "voicings": "dusk",         // named set of four chords, or an inline array
    "bpm": 60,
    "chordBars": 4,
    "volume": 0.8
  }
}
```

Named voicing sets ship with the engine. An inline set is four arrays of
semitone offsets from the root with octave spread kept verbatim, e.g.
`[[0,7,14,17,24],[0,10,14,19,26],[0,7,12,15,22],[0,10,15,17,24]]`.

### 3.3 Voice

```jsonc
{
  "voice": {
    "name": "glass",            // palette name, or free text for a custom voice
    "timbre": 0.2,              // 0 triangle .. 1 saw (noise band added above 0.8)
    "register": 0,              // octave offset, -1..+1
    "brightness": 0.4,          // lowpass cutoff, mapped 240..1500 Hz
    "movement": 0.3,            // LFO depth and rate
    "width": 0.5,               // detune spread and pan position
    "bell": "glass",            // glass | wood | soft
    "advanced": {               // hidden from the TUI's main page
      "attack": 0.35, "release": 0.5, "resonance": 0.7,
      "fmRatio": 0, "reverb": 0.55
    }
  }
}
```

### 3.4 Palette

Eight built-in voices, distinct on at least two of timbre, register and pan,
so any two are tellable apart in the bed. Names and parameters: *pending
spike.* `tambre install` in a project assigns the next palette voice not yet
assigned to another project on this machine (recorded in
`~/.tambre/config.json`).

### 3.5 States

| State | Entered on | Sound |
| --- | --- | --- |
| `working` | `prompt.submit`, `tool.*` while not blocked | Voice up. Tool activity raises cutoff and adds a second pad pair; decays over a few seconds without activity. |
| `blocked` | `permission.request` | One-shot once, then the tension layer sustains until the next event. No re-ping by default. A patch may set `permission.repeatAfter` with a floor of 60 s. |
| `waiting` | `turn.end`, idle notification | Voice fades to silence within about 3 s. Highs die first. |
| `ended` | `session.end`, or the agent PID is gone | Session-end roll, then the voice is removed. |

Waiting and ended are both silent. The one-shots tell them apart.

### 3.6 One-shots

All pitched from the current chord ladder in the session's voice timbre and
bell colour, so they are consonant with the bed and identify the project.

| Event | Gesture |
| --- | --- |
| `session.start` | Ascending three-note roll, entrance of the voice |
| `session.end` | Descending roll with a long tail |
| `turn.end` | Single bell on a chord tone |
| `turn.fail` | Low toll, a ♭9 above the root |
| `permission.request` | Two-note rising interval, then `blocked` |
| `compact.pre` | Short soft tap |

`tool.pre`, `tool.post`, `subagent.start`, `subagent.end` only feed the
working texture. `file.edit` is not an event.

### 3.7 Concurrency

One drone. Each live session is a voice on the shared chord ladder, panned
by its voice's width, entrance rolled low to high, capped at eight with
quietest-voice stealing. The **frame** is set by the first live session: its
project's proposed frame if it has one, else the user frame. Later sessions
join the frame with their own voice. The frame persists until the last
session ends.

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

---

## 4. Runtime

### 4.1 Engine

`node-web-audio-api` (Rust implementation of the Web Audio API for Node,
prebuilt binaries bundled for macOS, Linux and Windows on x64 and arm64).
Node 22 or newer. Works under Bun. `AudioContext({ latencyHint: 'playback' })`.
No pure-JavaScript path exists that can do real-time output; this is the
lightest dependency that can.

### 4.2 Daemon

- One per user. Socket at `$XDG_RUNTIME_DIR/tambre.sock`, else
  `$TMPDIR/tambre-<uid>.sock`; Windows `\\.\pipe\tambre-<user>`. PID file
  beside it.
- Spawned detached (`stdio: 'ignore'`, `unref()`, `windowsHide`) by the first
  hook that finds no live socket. Exits after the last session's end roll.
- Protocol: newline-delimited JSON, one message per line:
  `{ "event", "sessionId", "agent", "cwd", "pid"?, "voice"?, "frame"? }`.
- Liveness: `session.end` is lossy on at least Claude Code (Ctrl-C, async
  teardown). The `session.start` hook records its parent PID, which is the
  agent process, and the daemon polls it every 2 s. Death is `session.end`.
- Dedupe: `permission.request` arriving from two native sources within 2 s
  counts once.
- Silence: no output unless `TAMBRE_DEBUG=1`.
- Failure: if the audio device cannot open, the daemon keeps the session
  table and answers `tambre status`, but plays nothing. `tambre doctor`
  reports the cause.

### 4.3 Hook client

`tambre hook <agent>` reads the native payload from stdin, maps it to a
canonical event, connects or spawns the daemon, writes one line, exits 0.
Target: under 50 ms when the daemon is up. Never prints.

### 4.4 Layout on disk

```
~/.tambre/
  config.json        # user frame, default voice, volume, mute, palette assignments
  daemon.log         # only when TAMBRE_DEBUG=1
<project>/tambre.json          # voice (+ optional frame proposal); commit this
<project>/.claude/settings.local.json   # hooks; gitignored
```

---

## 5. Canonical events and adapters

### 5.1 Events

| Canonical | Meaning |
| --- | --- |
| `session.start` | Agent process started or resumed |
| `session.end` | Agent process ended |
| `prompt.submit` | User submitted a prompt |
| `turn.end` | Agent finished its turn |
| `turn.fail` | Turn ended in failure |
| `tool.pre` / `tool.post` / `tool.fail` | Tool lifecycle (texture only) |
| `permission.request` | Agent waiting on human approval |
| `waiting` | Agent idle, waiting on the user |
| `subagent.start` / `subagent.end` | Texture only |
| `compact.pre` / `compact.post` | Context compaction |

### 5.2 Coverage

Verified 2026-10-12 against each agent's current docs.

| Canonical | Claude Code | Codex | OpenCode | pi | Amp |
| --- | --- | --- | --- | --- | --- |
| session.start | SessionStart | SessionStart | session.created | session_start | session.start |
| session.end | SessionEnd (lossy) | SessionEnd | session.deleted (partial) | session_shutdown | — (PID poll only) |
| prompt.submit | UserPromptSubmit | UserPromptSubmit | chat.message | before_agent_start | agent.start |
| turn.end | Stop | Stop | session.idle | agent_settled | agent.end |
| turn.fail | StopFailure | — | session.error | ? | agent.end status |
| tool.pre / post | PreToolUse / PostToolUse | same | tool.execute.before / after | tool_call / tool_result | tool.call / tool.result |
| tool.fail | PostToolUseFailure | — | via tool.execute.after | via tool_result | tool.result status |
| permission.request | PermissionRequest, Notification(permission_prompt) | PermissionRequest | permission.ask | — | — |
| waiting | Notification(idle_prompt, agent_completed) | — | session.idle | agent_settled | agent.end |
| subagent.* | SubagentStart / Stop | SubagentStart / Stop | session.created with parentID | — | — |
| compact.* | PreCompact / PostCompact | PreCompact / PostCompact | experimental.session.compacting / session.compacted | — | — |

Known drift: OpenCode's plugin API is being restructured on its dev branch;
code against the published `@opencode-ai/plugin` types. pi's package has
reportedly moved scope; verify at adapter time.

### 5.3 Adapter shapes

- **JSON hook entry** (Claude Code, Codex): the adapter writes hook entries
  whose command is `tambre hook <agent>`, `async: true` on everything but
  `SessionEnd`, which gets an explicit timeout. Codex uses its hooks, not
  the legacy `notify`.
- **Generated plugin file** (OpenCode, pi, Amp): the adapter writes a small
  TypeScript file into the agent's plugin directory whose only job is to
  spawn `tambre hook <agent>` with the event JSON on stdin. One client code
  path for all agents. The user must trust the plugin in-agent; `install`
  prints that step.
- **Native sounds**: Amp (`amp.notifications.enabled`) and OpenCode
  (`tui.json` `attention.sound`) are turned off at install and restored at
  uninstall unless `--keep-native-sounds`.

### 5.4 Order of delivery

v1: Claude Code, Codex. Then OpenCode, pi, Amp, in that order. The adapter
interface and the coverage matrix above are designed for all five from the
start.

---

## 6. Install

```
tambre install [--agent claude-code|codex|all] [--user | --project]
tambre uninstall [--agent …]
```

- `--project` (default when run inside a git repo): writes `tambre.json`
  with the next unused palette voice, and hook entries into the agent's
  **local, gitignored** settings. Commit `tambre.json`; teammates opt in by
  running `tambre install` themselves. A hook command on a machine without
  tambre no-ops silently.
- `--user`: hook entries in the user settings; voice from the user default.
- Never writes to a committed settings file.

---

## 7. CLI

```
tambre                       # TUI
tambre install / uninstall   # §6
tambre hook <agent>          # hook client, stdin → daemon
tambre demo                  # 40 s scripted two-session audition, in-process
tambre status                # live sessions, states, voices, frame
tambre mute [--here]         # global, or this project's sessions
tambre unmute [--here]
tambre volume <0..1>
tambre doctor                # device, daemon, hooks, trust, native-sound conflicts
tambre hooks print <agent>   # the JSON block install would write
```

---

## 8. TUI

Ink. One screen: preset list (palette voices and saved patches) on the left;
the six voice macros and the four frame controls as knobs; audition keys for
each one-shot and each state; a live session list with voice, project, state
and a mute toggle; save as patch. An **advanced** page exposes attack,
release, resonance, FM ratio, reverb send. Every preview is played by the
daemon so there is exactly one audio owner.

---

## 9. Platforms

macOS and Linux verified at v1. Windows: prebuilt engine and named-pipe
code paths present, marked untested until run on real hardware. Linux note:
the prebuilt uses JACK only if a server is running (PipeWire via
`pipewire-jack`), else ALSA, where the `playback` latency hint avoids the
small-quantum crackle. Headless hosts: no device, fail silent.

---

## 10. Milestones

| # | Deliverable | Done when |
| --- | --- | --- |
| **S0** | Spike: engine, daemon, Claude Code hook client, `demo` | `tambre demo` plays two distinguishable voices through the state cycle; a real Claude Code session drives the daemon end to end |
| **M1** | `install` for Claude Code and Codex, `status`, `mute`, `volume`, `doctor`, palette, patches | Two projects, two sessions, you can name which one stopped with eyes closed |
| **M2** | TUI | A new user picks a voice and tunes it in under two minutes without reading docs |
| **M3** | OpenCode adapter | Plugin file install, trust step documented, native sound toggled |
| **M4** | pi and Amp adapters | Same, with the coverage gaps surfaced by `doctor` |
| **M5** | Windows verified; mic-aware auto-duck | — |

---

## 11. Open questions

1. Should `blocked` on one session duck the other sessions' working texture,
   so the tension reads as foreground?
2. How does the frame recover when the frame-setting session ends while
   others continue: hold (current answer) or retune to the user frame at the
   next chord boundary?
3. OpenCode's SSE `/event` stream could replace its plugin file. Worth it
   once the plugin API settles.
4. Whether the eight palette voices should be a fixed set or a generator
   with a fixed seed per slot.
