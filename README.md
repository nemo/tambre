# Tambre

Hear what your coding agent is doing.

Tambre is a small CLI you install into a project (or for your user) that gives
Claude Code, Codex, and friends a sound. A synthesized drone plays while the
agent works, a held tension layer while it waits on a permission prompt, and a
bell when a turn ends. Every project gets its own texture in a shared key, so
with two sessions running you can hear which one is still going and which one
stopped, without looking at either terminal.

Nothing is pre-recorded. A resident daemon synthesizes everything live from a
small JSON patch; agent hooks are thin clients that send it events.

Status: being rebuilt from a clean slate. The specification is in
[`spec/tambre-spec.md`](spec/tambre-spec.md). The CLI lives in [`cli/`](cli/).

The project's previous life as a sound-pack registry, with its seven-variant
design library, is preserved at the
[`v0-library`](https://github.com/nemo/tambre/tree/v0-library) tag.

## Licence

MIT
