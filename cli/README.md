# @tambre/cli

Hear what your coding agent is doing.

A resident daemon synthesizes a drone while the agent works, a held tension
layer while it waits on a permission prompt, and a bell when a turn ends.
Every project gets its own voice in a shared key, so with two sessions running
you can hear which one stopped.

**Status: M1 in progress.** Engine, daemon, hook clients for Claude Code and
Codex, `install`/`uninstall`, `status`, `mute`, `volume`, `doctor`. The TUI
(M2) is a separate piece of work; bare `tambre` says "TUI not built" until it
lands. See `../spec/tambre-spec.md`.

```sh
npm install && npm run build
node dist/tambre.js install          # in a git repo: tambre.json + local hooks for Claude Code and Codex
node dist/tambre.js install --user   # hooks in ~/.claude/settings.json and ~/.codex/hooks.json instead
node dist/tambre.js status           # live sessions, states, voices, frame
node dist/tambre.js doctor           # device, daemon, config, hooks, palette
node dist/tambre.js demo             # 40 s audition: two sessions, two voices
```

`install` writes the absolute path of the binary into each hook command
(`node /abs/dist/tambre.js hook <agent>`), marks every entry it adds with
`"tambre": true` so `uninstall` can remove exactly those, and is idempotent.
Inside a git repo the hooks go to `.claude/settings.local.json` and
`.codex/hooks.json`, both added to `.git/info/exclude`; the committed
`.claude/settings.json` is never touched. Codex asks you to trust new hooks
with `/hooks` before they run.

Hooks spawn the daemon on the first `SessionStart` and it exits by itself
after the last session ends. `TAMBRE_DEBUG=1` prints daemon and hook logs to
stderr; without it `hook` and `daemon` never print.

```
tambre                       TUI (M2)
tambre install [--agent claude-code|codex|all] [--user | --project] [--voice <name>] [--texture <mode>]
tambre uninstall [--agent …] [--user | --project] [--purge]
tambre status [--json]
tambre mute [--here] / tambre unmute [--here]
tambre volume <0..1>
tambre doctor
tambre voices
tambre hooks print <agent> [--command <cmd>]
tambre demo [--mode …] [--voices a,b] [--out f.wav]
tambre hook <agent>          hook entry point (stdin → daemon)
tambre daemon
```

Adapters live in `src/adapters/`. Codex hook file shape and payload fields
follow https://learn.chatgpt.com/docs/hooks (checked 2026-10-12): Codex has no
`Notification` or `StopFailure` event; `Interrupt` maps to `waiting`;
`SessionEnd` runs synchronously with a 3 s cap.

Requires Node 22+. Audio output is `node-web-audio-api` (prebuilt for macOS,
Linux, and Windows on x64 and arm64).

## Configuration

`~/.tambre/config.json` (directory overridable with `TAMBRE_HOME`) holds the
user frame, default voice, texture, volume, mute, per-project palette
assignments and saved patches. `<project>/tambre.json` holds a project voice,
an optional frame proposal and an optional texture; it is pure data and safe
to commit. See `src/config.ts` for the exact shapes; bad input never throws,
it falls back to defaults with warnings.

Texture (`drone`, `breath`, `pulse`, `rain`, `hum`, `hush`, `none`) is per
session: the project texture wins, else the user default (`hush`).

## TUI

Bare `tambre` opens the one-screen editor (needs a terminal; it starts the
daemon if none is running and leaves it running on quit). Left: the palette
and saved patches (`j`/`k`, Enter loads one). Centre: the loaded voice's
macros as sliders (Tab/Shift-Tab to focus, `h`/`l` to adjust; `a` flips to
the advanced page: attack, release, resonance, fm ratio, reverb; the engine
renders the first three, the last two are stored on the voice only). The
texture slider cycles through every mode. Audition keys `1`-`6` play
session.start, turn.end, permission.request, turn.fail, session.end and
compact; `w`, `b`, `i` hold the working, blocked and waiting states. Every
preview is played by the daemon. Right: live sessions (`J`/`K` to pick, `m`
to mute one, `p` to push the edited voice and texture onto it live), `M`
mutes everything, `+`/`-` set the volume. `s` saves the edit as the project
voice (`tambre.json`) when run inside a project, else as the user default;
`S` saves it as a named patch. `q` quits.

## Development

```sh
npm test                            # vitest; runs with TAMBRE_NO_AUDIO=1, no device needed
TAMBRE_SOCKET=/tmp/t.sock node dist/tambre.js daemon   # run a daemon on a private socket
```

`TAMBRE_NO_AUDIO=1` makes the engine open an inert stub context instead of a
device (nothing is heard, the native addon is not loaded). `TAMBRE_SOCKET`
overrides the daemon socket path.

## Licence

MIT
