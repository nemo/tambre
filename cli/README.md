# @tambre/cli

Hear what your coding agent is doing.

A resident daemon synthesizes a drone while the agent works, a held tension
layer while it waits on a permission prompt, and a bell when a turn ends.
Every project gets its own voice in a shared key, so with two sessions running
you can hear which one stopped.

**Status: spike.** Engine, daemon, and the Claude Code hook client work end
to end on macOS. No TUI, no `install` command, no Codex adapter yet. See
`../spec/tambre-spec.md`.

```sh
npm install && npm run build
node dist/tambre.js demo            # 40 s audition: two sessions, two voices
node dist/tambre.js voices          # the built-in palette
node dist/tambre.js hooks print claude-code --command "node $PWD/dist/tambre.js hook claude-code"
```

Merge the printed `hooks` block into `~/.claude/settings.json`. Hooks spawn the
daemon on the first `SessionStart` and it exits by itself after the last
session ends. `TAMBRE_DEBUG=1` prints daemon and hook logs to stderr; without
it nothing is ever printed.

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
