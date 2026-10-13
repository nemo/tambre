# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The product itself is a terminal tool (a CLI and an Ink TUI). The web
surface is the landing page at nemo.github.io/tambre, served from
`index.html` at the repo root as static HTML on GitHub Pages. Impeccable's
platform value covers that page; the TUI is a terminal surface and is noted
under constraints.

## Users

Solo developers who run several coding-agent sessions at once (Claude Code,
Codex, and later OpenCode, pi, Amp), typically with two or more terminals
open across different projects, often on a call or looking at something
else. Their job: know which agent session is still working, which one is
waiting on them, and which one is blocked on a permission prompt, without
looking at any terminal.

Teams are a secondary audience: a project's `tambre.json` is committed, so
contributors who opt in hear the same voice for that repo.

## Product Purpose

Tambre gives a coding agent a sound. A resident daemon synthesizes audio
live: a quiet texture while the agent works, a held tension layer while it
waits on a permission prompt, silence within seconds once it is waiting on
the user, and short harmonically tied one-shots at boundaries (session
start and end, turn end and failure, permission request, compaction). Each
project gets its own voice inside a shared key, so concurrent sessions never
clash and can be told apart by ear.

Success: a user with two sessions running can say, eyes closed, which
project stopped and which is still going, and can leave it on during a call
without anyone noticing.

## Positioning

Every existing agent-sound tool (peon-ping and its peers) plays pre-recorded
files on events. Tambre synthesizes everything live from a small JSON patch:
no audio files, a session-long texture that reflects state, and one voice
per project in a shared harmonic frame. It is designed to be quiet enough to
run under a call, with textures chosen by measuring and listening to each
one mixed under speech.

## Operating Context

- Installed per project by default (`tambre install` inside a git repo), or
  per user. Project install commits `tambre.json` and writes hooks only to
  gitignored local agent settings; teammates opt in by installing themselves.
- Agents reach the daemon through their native hook systems (JSON hook
  entries for Claude Code and Codex; generated plugin files for OpenCode, pi,
  Amp later). Hooks are thin clients that must exit in milliseconds and never
  print.
- Users configure voices, textures, and frames in the TUI (`tambre`) or by
  editing `tambre.json` and `~/.tambre/config.json`.
- Distributed on npm as `@tambre/cli`, run as `tambre` or `npx @tambre/cli`.
- Verified on macOS and Linux; Windows code paths exist but are untested.

## Capabilities and Constraints

- Engine: `node-web-audio-api` (Rust Web Audio for Node, prebuilt binaries),
  Node 22 or newer. No pure-JavaScript real-time audio path exists.
- Musical model: pinned pedal root, four extended voicings cycling slowly,
  triangle beds, saw tension layer, compressor ceiling. Patches choose root,
  voicing set, tempo, and per-voice macros; they are JSON, never code.
- Textures for the working state: drone, breath, pulse, rain, hum, hush,
  none. Default is hush. Texture is a per-session property.
- Eight palette voices, auto-assigned per project so two projects never
  sound alike by default.
- Frame (key, voicings, tempo) is shared across all live sessions. A project
  may propose a frame; it applies only when it is the first live session.
- Mute and volume are global, per project, or per session.
- Terminology: frame, voice, patch, texture, session, state (working,
  blocked, waiting, ended), one-shot, canonical event, adapter, daemon.
- Undecided: whether one-shots should duck when a microphone is live
  (mic-aware auto-duck is planned, not built); whether a blocked session
  should duck the others.
- The product has no registry, marketplace, accounts, or web app. An
  earlier incarnation as a sound-pack registry is preserved at the
  `v0-library` git tag and is not the product.

## Brand Commitments

- Name: tambre, lowercase in commands and prose. No logo exists.
- Voice: plain and specific, as in `README.md` and `spec/tambre-spec.md`. No
  marketing superlatives; claims are backed by what was measured or heard.
- No taglines, palettes, typography, or other visual commitments have been
  made. The current `index.html` is a placeholder stub, not a binding
  design.

## Evidence on Hand

- `spec/tambre-spec.md` §3.8 records engine parameters and what each
  listening pass changed; commit messages record the call-test findings
  (which textures were noticed under speech and which were not).
- `cli/` is the working implementation with 128 passing tests;
  `tambre demo --mode <texture> --out demo.wav` renders a 40 s two-session
  audition that can be embedded or linked.
- No users, testimonials, quotes, press, download numbers, or case studies
  exist. Future work must not fabricate any.

## Product Principles

1. Never annoy: silence when nothing needs you, no nagging, tool churn never
   beeps.
2. Never clash: every concurrent session shares one harmonic frame.
3. Never block the agent: hooks exit fast, exit 0, print nothing, fail
   silent.
4. Data, not code: a shared patch cannot run anything on another machine.
5. Prove it by listening: every texture and level decision is measured and
   heard, not assumed.

## Accessibility & Inclusion

The product's output is audio; everything it conveys is also available in
text through `tambre status` and the TUI's session list, so no information
is audio-only. The landing page should not autoplay sound.
