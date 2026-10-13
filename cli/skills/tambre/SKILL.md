---
name: tambre
description: Control tambre, the sound your coding agent makes, by running its CLI. Use when the user says to mute, unmute, quiet, or silence tambre; turn tambre up or down; change or switch the voice or sound of this project; change the texture (drone, breath, pulse, rain, hum, hush, none); change the key, root, tempo, bpm, voicings, or frame; asks what tambre is doing, which session is working or blocked, or whether tambre is on; or says tambre is not working, is silent, or asks to check it.
---

# tambre

tambre is a daemon that plays a quiet synthesized texture while a coding
agent works, a held tension while it waits on a permission prompt, and short
bells at turn and session boundaries. Each project has a voice (its timbre)
and a texture (what "working" sounds like); all sessions share one frame
(key, voicings, tempo). This skill is a wrapper: every intent below is one
`tambre` command, run from the project directory the user means.

## Intent to command

| User says | Run |
| --- | --- |
| mute / silence / quiet tambre, mute everything | `tambre mute` |
| mute this project, mute it here | `tambre mute --here` |
| unmute (everything / this project) | `tambre unmute` / `tambre unmute --here` |
| turn it down / up, set volume to half | `tambre volume 0.4` (0..1; read the current value from `tambre show` first and step by about 0.2) |
| switch this project to brass, use the cedar voice, change the sound | `tambre voice brass` |
| make my default voice X (every project without its own) | `tambre voice X --user` |
| use the rain texture, make it breathe, no texture, just bells | `tambre texture rain` / `breath` / `none` |
| put it in D, change the key to D2, tempo 56, slower, use the dawn voicings | `tambre frame --root D2 --bpm 56 --voicings dawn` |
| what is tambre doing, which session is working, is anything blocked | `tambre status` (`--json` when you need to reason over it) |
| what is this project set to, what voice is this | `tambre show` |
| which voices are there, list the sounds | `tambre voices` |
| tambre is silent / not working / check tambre | `tambre doctor` |

Textures: `drone` (sustained bed), `breath` (slow swells), `pulse` (soft
taps), `rain` (noise grains), `hum` (sub only), `hush` (hum plus breaths,
the default), `none` (bells only). Voicings: `dusk` (default), `dawn`,
`harbor`, `field`. Root notes are written like `G2`, `D2`, `F#2`; the engine
keeps them between D2 and D3.

## Rules

- Run commands from the project directory the user is talking about. `--here`
  means that project's sessions only; without it, mute and volume are global.
- "This project" or "here" means `--here` for mute and the default (project)
  scope for `voice` and `texture`. Only add `--user` when the user asks for
  their default across projects.
- When the user names a voice loosely ("something brighter", "the wooden
  one"), run `tambre voices` first and pick the closest palette name; say
  which you picked.
- After any change, run `tambre show` and report only the line that changed,
  plus when it applies (the command's own output says: pushed live, at the
  next session start, or when the last session ends).
- Never edit `tambre.json` or `~/.tambre/config.json` by hand when a command
  covers the change. If the user wants something no command covers (a custom
  voice object), `tambre voice '{"name":"mine","timbre":0.4,...}'` accepts
  JSON.
- If `tambre` is not on PATH, use `npx @tambre/cli <command>`, or the absolute
  `node <path>/dist/tambre.js` that appears in `.claude/settings.local.json`
  (or `.codex/hooks.json`) under the project's hooks.
- `tambre doctor` output is the whole diagnosis; relay its warn and fail lines
  verbatim and stop there unless the user asks you to fix something.
