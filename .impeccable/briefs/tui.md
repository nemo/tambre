# Surface brief: the TUI (`tambre`)

Status: shipped 2026-10-12. Finish review: disposition ship after two verdict passes (eight material fixes plus three residuals resolved). DESIGN.md and .impeccable/design.json written from the build.

## Direction contract

THESIS: the value is the control. One hardware-synth parameter page per
Tab: eight cells in a 2×4 grid, each a small label over a large value with a
short bar on one shared ramp, and the sound changes under your hand as the
number moves. It refuses the three-bordered-panel ncurses layout with
bracket sliders that every terminal tool ships.

OWN-WORLD: the terminal's own ground with no drawn borders; hairline rules
separate tabs, grid, transport, and status. Terminal yellow is the only
accent, for the focused cell and the active tab; terminal red only for mute
and destructive confirms; dim for everything inert. Values are the largest
glyphs on screen, labels the smallest. Every state is also a mark (`▸`,
`[x]`, `·`), never colour alone. With all content removed, the page is five
tab words, eight empty rulers in two rows, one strip, one line.

STORY: a developer opens `tambre` in a project, sees eight voices as eight
cells, presses space and hears one, Enter to take it, Tab to the VOICE page,
drags or nudges a cell while it plays, and presses `s`. Returning later they
Tab to FRAME to change the key or tempo, or watch the transport strip and
mute a session. They believe every number on screen is the sound they hear.

FIRST VIEWPORT (100×30): line 1 `tambre` left, project path and frame right;
line 2 the five tab words with the active one in yellow; a hairline; rows
4–12 the 2×4 grid, each cell 24 columns wide with label, value, and a
12-cell ruler; a hairline; rows 15–22 the transport strip, one line per
session; a hairline; the status line; one help line. On first run the grid
shows the PALETTE page with a three-line note above it. The primary action
is space on the focused cell.

FORM: parameter page, position 1 on the ordered list of seven (the roll
assigned position 7, the track sheet; the user chose this pick).
seed: be81133c

RISK: it reads as a device emulation. It stays tambre's own only if it never
draws a device: no knobs, no LEDs, no screen bezels, no fake hardware
labels; the grid is typography and rules and nothing else.

FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying
its provenance.

## 1. Job and audience

A solo developer who runs several coding-agent sessions at once opens
`tambre` in a project to give it a sound, or comes back to it to tune one.
Mode: **Operate**. They are in a task, usually between agent turns, often
with a session already playing. Two states of mind: first-run ("make it
sound like something in two minutes") and expert ("I want the detune and
the filter resonance exactly so, and I want to hear every change").

## 2. Outcome and proof

- Primary task: choose a voice and a texture for this project, adjust its
  parameters while hearing them, and save. Secondary: adjust the user frame
  (root, voicing set, tempo, volume); mute, push a voice to, and watch live
  sessions.
- Success: a new user picks and tunes a voice in under two minutes without
  reading docs; an expert reaches every engine parameter without leaving
  the keyboard; every change is audible within a keypress.
- Real material: the eight palette voices, the seven textures, the user's
  saved patches, the live session table from the daemon, and real previews
  rendered by the engine. Nothing is mocked on screen.

## 3. Selected direction: PARAMETER PAGE

- Visual authority: none recorded (no DESIGN.md). This brief establishes the
  TUI's world; the documenter records it at finish.
- Thesis: a hardware-synth parameter page. One page shows eight parameters
  in a 2×4 grid; each cell is a small-caps label over a large value with a
  short bar beneath. Pages are switched, not scrolled. Sessions live in a
  one-line transport strip. It refuses the three-bordered-panel ncurses
  layout and its bracket sliders.
- Own world: the terminal's own ground, no drawn borders, hairline rules
  between the page tabs, the grid, and the transport strip. One accent
  (terminal yellow) for the focused cell and the active tab; one red for
  mute and for a destructive confirm; dim for everything inert. Values are
  the largest thing on screen; labels are the smallest. Bars share one fixed
  12-cell ramp so magnitudes compare across cells.
- Pages, in Tab order:
  1. `PALETTE`: the eight voices as the eight cells (name, bell, texture
     default, a two-word character line). Space auditions the focused voice
     working; Enter loads it into the editor. On first run this page opens
     first.
  2. `VOICE`: timbre, register, brightness, bell · move depth, move rate,
     detune, pan.
  3. `FRAME`: texture, root, voicing set, tempo · chord bars, volume, mute
     all, (blank). Frame cells show `locked` while any real session is live
     and explain why on focus.
  4. `ADVANCED`: attack, release, resonance, fm ratio · reverb, (blank),
     (blank), (blank). Cells the engine does not yet render say `stored`.
  5. `PATCHES`: saved patches as cells, eight per page, paged with `[` `]`.
- Transport strip (bottom, above the help line): one line per live session,
  up to eight: index, voice name, project basename, state word, mute mark.
  `J/K` highlight, `m` mute, `p` push the edited voice and texture to it.
  Empty: `no sessions · daemon ok` or `starting daemon…`.
- Signature interaction: the value is the control. Focus a cell, press `h/l`
  or drag the bar, and the sound changes under your hand while the number
  updates. Space always plays the working state of what you are editing.
- Implementation consequence: Ink 5. Mouse needs SGR 1006 mouse reporting
  enabled on start and parsed from stdin (Ink has no mouse layer); click
  focuses a cell or tab, drag on a bar adjusts, wheel adjusts the focused
  cell, click on a session's mute mark toggles it. Terminals without mouse
  reporting lose nothing: keyboard is complete.

## 4. Scope and boundaries

- Fidelity: production screen, replacing `cli/src/tui/*` as the one screen,
  plus the first-run path. Keyboard complete, mouse additive.
- Untouched: engine, daemon, IPC protocol, config model, save semantics
  (`s` project or user default, `S` named patch), the key set users already
  learned where it still fits (digits and `w b i` audition, `m p M +/- s S q`).
- Anti-goals: no drawn box borders; no imitation of knobs, LEDs, or screens;
  no modal dialogs (the patch-name prompt is inline on the status line);
  no motion that does not convey state; no colour-only state.

## 5. States and ranges

- First run (no project voice, no assignment): PALETTE page with a
  three-line note at the top: pick, hear, Enter, then `s`. The note leaves
  after the first save.
- Daemon unreachable or audio device unavailable: a one-line banner under
  the tabs; editing and saving still work; audition keys report "no audio".
- Sessions: 0 to 8 lines; beyond 8 the strip shows `+n more`.
- Patches: 0 to a few hundred; paged.
- Project path: truncated from the left to fit.
- Terminal: designed at 100×30; must work at 80×24 (narrower bars, help line
  collapses to one row); below 80 columns each cell becomes one line (marker,
  label, value, ruler) so eight fit without scrolling; below 20 rows the transport strip shows one line and `+n`.
- Frame locked while sessions are live; unlocked edits apply at the next
  chord boundary.

## 6. Interaction and layout

- Hierarchy: tabs (small) → grid (dominant) → transport (secondary) →
  status/help (quiet).
- Topology: one screen, five pages, no overlays. Tab / Shift-Tab move pages;
  arrows move among cells in two dimensions; `h/l` or `+/-` adjust; Enter on
  a palette or patch cell loads it; `>` on a cycle cell advances it.
- Feedback: every action writes one line to the status line (what played,
  what saved, what failed); the focused cell's bar fills as it is adjusted;
  a session's state word changes within a second of the daemon.
- Transitions: none beyond immediate repaint.

## 7. Constraints and open decisions

- Node 22, Ink 5, TTY required (non-TTY prints one hint and exits 1).
- Colour from the terminal's 16-colour palette only; state is always also a
  mark (`▸` focus, `[x]` mute, `·` inert), never colour alone.
- Nothing is audio-only: the transport strip and status line carry every
  fact the sound does.
- Open decisions a builder must not invent:
  1. Whether the eighth cell of the FRAME page holds anything (proposed:
     blank).
  2. Whether mouse drag on a bar is absolute (position maps to value) or
     relative (delta). Proposed: absolute.
  3. The exact two-word character line per palette voice (proposed from the
     listening notes: moss "dark, soft"; brass "bright, glassy"; cedar "low,
     wooden"; glass "high, bright"; reed "reedy, wooden"; tide "low,
     moving"; wire "high, brightest"; felt "pure, darkest").
  4. Whether `PATCHES` also lists the project voice as a cell.
  Decided at build (2026-10-12): below 80 columns, one-line cells, no
  scrolling; a locked frame edit is saved to the user config rather than
  queued, and applies at the next daemon start.
