# @tambre/cli

Hear what your coding agent is doing.

A resident daemon synthesizes a quiet texture while the agent works, a held
tension layer while it waits on a permission prompt, silence once it is
waiting on you, and short bells at the boundaries: session start and end,
turn end and failure, permission request, compaction. Every project gets its
own voice in a shared key, so with two sessions running you can hear which
one stopped without looking at either terminal. Nothing is pre-recorded and
nothing executable is ever shared: a voice is a small JSON document.

**Status.** Engine, daemon, hooks for Claude Code and Codex, `install`,
`status`, `mute`, `volume`, `doctor`, the eight-voice palette, seven texture
modes, saved patches, and the TUI editor are built (spec milestones S0, M1
and M2). Verified end to end on macOS; Linux and Windows have the code paths
and prebuilt audio binaries but have not been run on real hardware. The
spec is in [`../spec/tambre-spec.md`](../spec/tambre-spec.md).

## Requirements

- Node 22 or newer.
- An audio output device. Audio is `node-web-audio-api`, which ships
  prebuilt binaries for macOS, Linux and Windows on x64 and arm64. On
  Linux it uses JACK when a server is running (PipeWire via
  `pipewire-jack`), else ALSA.
- Claude Code or the Codex CLI.

## Install

The package is not on npm yet. From a checkout:

```sh
cd cli
npm install
npm run build          # tsc -> dist/, bin is dist/tambre.js
npm link               # optional: puts `tambre` on your PATH
```

Hook commands always carry the absolute path of `dist/tambre.js`, so
`tambre` need not be on your PATH for the hooks to work; only you need it.
The examples below assume `npm link`; otherwise write `node dist/tambre.js`.

## Quick start

```sh
cd ~/src/my-project
tambre install         # in a git repo: writes tambre.json, hooks into .claude/settings.local.json and .codex/hooks.json
tambre doctor          # node, audio, daemon, config, hooks, palette, pid file
tambre                 # the editor: pick a voice, audition it, save it
```

Then start Claude Code or Codex in that project. The first `SessionStart`
hook spawns the daemon; it exits by itself 8 s after the last session ends.
Codex asks you to trust new hooks: open Codex in the project and run
`/hooks`.

Outside a git repo, or with `--user`, the hooks go into your user settings
and every session uses your default voice:

```sh
tambre install --user --voice brass --texture hum
```

`tambre demo` plays a scripted 40 s scene with two voices in-process, no
daemon, no hooks; `--mode <texture>` picks the texture and `--out demo.wav`
writes what played.

## Commands

```
tambre                                            open the TUI
tambre install [--agent claude-code|codex|all] [--user | --project] [--voice <name>] [--texture <mode>]
tambre uninstall [--agent claude-code|codex|all] [--user | --project] [--purge]
tambre status [--json]                            frame, volume, live sessions
tambre mute [--here] / tambre unmute [--here]     everything, or this project's sessions
tambre volume <0..1>
tambre doctor                                     one line per check, exit 1 on any fail
tambre voices                                     the palette, your patches, and project assignments
tambre hooks print <agent> [--command <cmd>]      the JSON block install would write
tambre demo [--mode drone|breath|pulse|rain|hum|hush|none] [--voices moss,brass] [--out demo.wav]
tambre hook <agent>                               hook entry point; reads the agent's JSON on stdin
tambre daemon [--foreground]                      the resident synth; hooks start it for you
```

`hook` and `daemon` never print unless `TAMBRE_DEBUG=1`. `mute` and
`volume` are saved to your config even when no daemon is running, so one
started later honours them. `mute --here` mutes the live sessions whose
project root is the one you are in.

## How the hooks work

`tambre install` merges one entry per event into the agent's hooks file.
Each entry runs `node /abs/path/dist/tambre.js hook <agent>`, is marked
`"tambre": true` so `uninstall` can remove exactly those, and is `async`
except `SessionEnd`, which runs synchronously with a short timeout (5 s on
Claude Code, 3 s on Codex). The merge keeps everything else in the file and
a second install changes nothing.

| Scope | Claude Code | Codex |
| --- | --- | --- |
| `--project` (default in a git repo) | `<root>/.claude/settings.local.json` | `<root>/.codex/hooks.json` |
| `--user` | `~/.claude/settings.json` (`CLAUDE_CONFIG_DIR` honoured) | `~/.codex/hooks.json` (`CODEX_HOME` honoured) |

Project-scope files are added to `.git/info/exclude` so they are never
committed; the committed `.claude/settings.json` is never written. Commit
`tambre.json` instead and teammates opt in by running `tambre install`
themselves. A hook entry on a machine without tambre no-ops.

The hook reads the agent's JSON payload from stdin, maps the native event
to a canonical one, and writes one line to the daemon's unix socket,
spawning the daemon if none answers. It exits 0 in every case and never
writes to stdout or stderr. Measured at 2 ms when the daemon is up.

| Canonical | Claude Code | Codex |
| --- | --- | --- |
| session.start / session.end | SessionStart / SessionEnd | same |
| working | UserPromptSubmit | same |
| activity (texture only) | PreToolUse, PostToolUse, PostToolUseFailure, SubagentStart, SubagentStop | PreToolUse, PostToolUse, SubagentStart, SubagentStop |
| turn.end / turn.fail | Stop / StopFailure | Stop / — |
| permission.request | PermissionRequest, Notification(permission_prompt) | PermissionRequest |
| waiting | Notification(idle_prompt, agent_completed) | Interrupt |
| compact | PreCompact | PreCompact |

Codex has no `Notification` or `StopFailure` event; its hook file shape and
payload fields were checked against https://learn.chatgpt.com/docs/hooks on
2026-10-12. Adapters live in `src/adapters/`.

`SessionEnd` is lossy on Claude Code (Ctrl-C), so every hook also carries
the agent's PID and the daemon polls it every 2 s; a dead PID ends the
session. `uninstall` removes only the marked entries and keeps
`tambre.json` unless you pass `--purge`.

## Configuration

Two files, both plain JSON, both validated without ever throwing: a bad
field is dropped with a warning that `tambre doctor` shows, and a file that
is not JSON falls back to defaults and is never overwritten by a save.

**`~/.tambre/config.json`** (set `TAMBRE_HOME` to move the directory).
Every field optional.

```jsonc
{
  "frame": { "root": 43, "voicings": "default", "bpm": 60, "chordBars": 4 },
  "voice": "moss",                 // default voice: a palette name, a voice object, or a name plus overrides
  "texture": "hush",               // default texture
  "volume": 0.8,
  "mute": false,
  "assignments": { "/Users/me/src/api": "moss" },   // project root -> palette voice, written by install
  "patches": { "night": { "voice": { "name": "night", "timbre": 0.1 }, "texture": "hum" } },
  "createdFiles": []               // settings files install created, so uninstall may delete them
}
```

**`<project>/tambre.json`**, safe to commit:

```jsonc
{
  "voice": "brass",                // or a full voice object, or { "name": "brass", "brightness": 0.6 }
  "texture": "hush",               // optional
  "frame": { "root": 45 }          // optional proposal, may be partial
}
```

A session's voice is the project's, else the palette voice assigned to that
project on this machine, else your default. Its texture is the project's,
else your default. The frame is shared by every live session and is set by
the first one: its project's proposal over your frame if it has one, else
your frame; it cannot change while any session is live. The project root
is the nearest ancestor holding `tambre.json`, else the git toplevel, else
the current directory. Changes to `tambre.json`, and to your volume or mute
in `config.json`, apply to live sessions within a second; the frame waits
for the next session start.

A voice:

```jsonc
{
  "name": "glass",
  "timbre": 0.1,                   // 0 triangle .. 1 saw
  "register": 1,                   // -1, 0, 1 octaves
  "brightness": 0.7,               // lowpass cutoff
  "movement": { "depth": 0.2, "rate": 0.11 },
  "width": { "detune": 6, "pan": 0.7 },
  "bell": "glass",                 // glass | wood | soft
  "advanced": { "attack": 0.35, "release": 0.7, "resonance": 0.7, "fmRatio": 0, "reverb": 0 }
}
```

The engine renders `attack` (entrance time), `release` (fade on waiting)
and `resonance` (filter Q). `fmRatio` and `reverb` are stored but not
rendered yet.

## Voices

Eight built-in voices, far apart in timbre, register and pan so any two are
tellable apart. `tambre install` in a project takes the first one no other
project on this machine has; `tambre voices` lists them with their
assignments.

| | timbre | register | brightness | pan | bell |
| --- | --- | --- | --- | --- | --- |
| moss | 0.05 | 0 | 0.30 | left | soft |
| brass | 0.55 | 0 | 0.55 | right | glass |
| cedar | 0.20 | −1 | 0.25 | hard left | wood |
| glass | 0.10 | +1 | 0.70 | hard right | glass |
| reed | 0.90 | 0 | 0.40 | centre-left | wood |
| tide | 0.35 | −1 | 0.45 | centre-right | soft |
| wire | 0.60 | +1 | 0.85 | left | glass |
| felt | 0.00 | 0 | 0.15 | right | soft |

## Texture modes

The texture is what a session sounds like *while working*. The tension
layer for a permission prompt and every bell are the same in all modes.

| Mode | While working |
| --- | --- |
| `drone` | The sustained bed: a chord that changes colour every 16 s, thickening while tools run. Too present to run under a call. |
| `breath` | One soft pad swell every 8–14 s, more often while tools run. |
| `pulse` | One soft bell tap every few seconds. |
| `rain` | Short filtered noise grains, several a second. |
| `hum` | A sub tone and a whisper of the pad. Nothing moves. |
| `hush` | `hum` plus the breath swells. The default. |
| `none` | Silence while working; bells and the tension layer only. |

Listened under synthesized speech when they were built: `hum` and `rain` go
unnoticed, `breath` and `pulse` get noticed, `drone` sits between. Set the
texture per project in `tambre.json`, as your default in `config.json`, with
`tambre install --texture`, or in the TUI; the TUI can also push a new
texture onto a live session without a click.

## The TUI

Bare `tambre` opens a one-screen editor. It needs a terminal, starts the
daemon if none is running, and leaves it running on quit.

- **Left, presets.** The palette, then your saved patches. `j`/`k` or the
  arrows move, `Enter` loads one.
- **Centre, sliders.** `Tab`/`Shift-Tab` focus, `h`/`l` or the arrows
  adjust. Timbre, register, brightness, movement depth and rate, detune,
  pan, bell colour, and texture, which cycles through every mode. `a` flips
  to the advanced page: attack, release, resonance, fm ratio, reverb.
- **Audition.** `1` session.start, `2` turn.end, `3` permission.request,
  `4` turn.fail, `5` session.end, `6` compact; `w`, `b`, `i` hold the
  working, blocked and waiting states. Every preview is played by the
  daemon with the voice and texture you are editing, on a scratch session
  that never shows up in `status`.
- **Right, sessions.** Live sessions with voice, project, state, texture
  and mute, refreshed every second. `J`/`K` pick one, `m` mutes it, `p`
  pushes the edited voice and texture onto it live. `M` mutes everything,
  `+`/`-` move the volume.
- **Save.** `s` writes the edit as the project voice and texture
  (`tambre.json`) when run inside a project, else as your user default.
  `S` asks for a name and saves a patch. `q` quits.

## The daemon

One per user. It owns the audio device, the session table and the frame,
and answers both hooks and the CLI on one unix socket:
`$XDG_RUNTIME_DIR/tambre.sock`, else `$TMPDIR/tambre-<uid>.sock` (Windows:
a named pipe), with a pid file beside it. Hooks and the TUI spawn it
detached when nothing answers; it recovers from a stale socket or pid file
left by a killed predecessor, and exits 8 s after the last session ends.
If the audio device will not open it keeps the session table, answers
`status`, and plays nothing; `tambre doctor` says why.

| Variable | Effect |
| --- | --- |
| `TAMBRE_DEBUG=1` | Daemon and hook logs on stderr. A daemon spawned by a hook logs to `~/.tambre/daemon.log` instead. |
| `TAMBRE_HOME` | Directory for `config.json` and `daemon.log` (default `~/.tambre`). The socket name carries a hash of it. |
| `TAMBRE_SOCKET` | Socket path override. |
| `TAMBRE_NO_AUDIO=1` | Open an inert stub instead of a device; nothing is heard and the native addon is not loaded. Tests run this way. |

`tambre daemon --foreground` logs to stderr and never idles out, for
watching one daemon across several agent runs.

## doctor

```
ok   node               v24.16.0
ok   audio addon        node-web-audio-api loads
ok   audio device       opened at 48000 Hz
ok   daemon             not running (/tmp/tambre-501.sock)
ok   user config        /Users/me/.tambre/config.json
ok   project config     /Users/me/src/api/tambre.json: voice brass, texture hush
ok   hooks claude-code  /Users/me/src/api/.claude/settings.local.json (project)
warn hooks codex        not installed (project); run `tambre install --agent codex --project`
ok   palette            2 project(s) assigned, no collisions
ok   pid file           none
```

Checks: Node version, the audio addon, opening a device, the daemon socket,
both config files, the hooks for each agent in this scope (present for
every event and pointing at this binary), palette collisions between
projects, and a stale pid file. Exit 1 if any line is `fail`.

## Platform status

| | |
| --- | --- |
| macOS | Verified: real Claude Code sessions drive the daemon end to end. |
| Linux | Prebuilt binary present, hook and socket paths the same; not run on real hardware. |
| Windows | Named-pipe and pid-file code paths present; not run. |
| Headless | No device: the daemon fails silent, hooks still exit 0, `doctor` reports it. `TAMBRE_NO_AUDIO=1` skips the device. |
| OpenCode, pi, Amp | Planned (spec §5), not built. |

## Development

```sh
npm run build                       # tsc
npm test                            # vitest, 128 tests, TAMBRE_NO_AUDIO=1, no device needed
npm run dev -- status               # run from source with tsx
TAMBRE_SOCKET=/tmp/t.sock node dist/tambre.js daemon --foreground   # a private daemon you can watch
```

Layout of `src/`: `engine/` (the synth: `engine.ts`, `voice.ts`,
`texture.ts`, `bell.ts`, `harmony.ts`), `palette.ts`, `config.ts` (both
config files, validation, project root, session resolution), `ipc.ts`
(message shapes, socket paths), `client.ts` (everything that talks to the
daemon), `daemon.ts`, `hook.ts`, `adapters/` (one file per agent),
`install.ts`, `doctor.ts`, `tui/` (Ink), `demo.ts`, `tambre.ts` (dispatch).
Tests sit beside the code as `*.test.ts(x)`; the daemon tests run a real
daemon in-process on a temp socket.

## Licence

MIT
