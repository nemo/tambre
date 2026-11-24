# Tambre

Hear what your coding agent is doing.

Tambre is a skill you install into a project (or for your user) that gives a
coding agent a distinct sound. Pick one of twelve synthesized presets (guitar
pluck, piano arpeggio, violin rise, snap, clap, and more) per project or per
user; every preset uses the same synth engine and is normalised to a similar
loudness, so concurrent sessions never clash. Installable with
`npx skills add`.

Nothing is pre-recorded. A resident daemon synthesizes everything live from a
small JSON patch; agent hooks are thin clients that send it events.

Status: being rebuilt from a clean slate. The specification is in
[`spec/tambre-spec.md`](spec/tambre-spec.md). The CLI lives in [`cli/`](cli/).

The project's previous life as a sound-pack registry, with its seven-variant
design library, is preserved at the
[`v0-library`](https://github.com/nemo/tambre/tree/v0-library) tag.

## Licence

MIT
