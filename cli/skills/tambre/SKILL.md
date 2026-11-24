---
name: tambre
description: Give your coding agent a distinct sound. Use when the user wants to install, change, or remove the sound for this project or their user account, list the 12 presets, preview a preset, or run diagnostics.
---

# tambre

tambre assigns a distinct synthesized sound (one of 12 presets) to a coding
agent session. It can be scoped per project (committed config) or per user
(global default). Every preset uses the same synth engine and is normalised
to a similar loudness, so several sessions on one machine never clash.

## Presets

guitar-pluck, piano-arpeggio, violin-rise, marimba-tap, glass-chime,
bell-chime, flute-breath, snap, clap, drum-tap, whistle, pop.

## Intent to command

| User says | Run |
| --- | --- |
| install tambre here / for this project | `tambre install --project` |
| install tambre for me / globally | `tambre install --user` |
| list sounds / presets | `tambre presets` |
| preview a sound | `tambre play <preset>` |
| use the snap sound here | `tambre preset snap` |
| set my default sound | `tambre preset <preset> --user` |
| tambre not working / check | `tambre doctor` |
| remove tambre | `tambre uninstall` |

## Rules

- Prefer `--project` inside a git repo (default) and `--user` elsewhere.
- Project scope writes `tambre.json` (commit it so teammates share the voice).
- Never edit `tambre.json` by hand when a command covers it.
- If `tambre` is not on PATH, use `npx @tambre/cli <command>`.
EOF
echo done