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

## Licence

MIT
