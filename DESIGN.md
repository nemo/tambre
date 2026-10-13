---
name: tambre
description: A hardware-synth parameter page drawn in the terminal's own type and rules; no device is ever drawn.
# Medium adaptation: this is an Ink TUI. "colors" are the terminal's own 16-colour
# names as render.ts passes them to Ink; "typography" roles carry the terminal
# attribute (bold / dim / normal) instead of a face or size; "spacing" is in
# character columns and lines. There are no fonts, pixels, or radii to record.
colors:
  accent: "yellow"
  mute: "red"
typography:
  value:
    fontWeight: "bold"
  label:
    fontWeight: "dim"
  label-focused:
    fontWeight: "normal"
  wordmark:
    fontWeight: "bold"
  tab-active:
    fontWeight: "bold"
  tab-inactive:
    fontWeight: "dim"
  ruler-filled:
    fontWeight: "normal"
  ruler-empty:
    fontWeight: "dim"
  status:
    fontWeight: "normal"
  help:
    fontWeight: "dim"
  banner:
    fontWeight: "bold"
spacing:
  cell-indent: "2 cols"
  ruler: "12 cols"
  tab-gap: "2 cols"
  grid-row-gap: "1 line"
  cell-lines: "3 lines"
  compact-label: "12 cols"
  transport-max: "8 lines"
  first-run-note: "3 lines"
components:
  tab-active:
    textColor: "{colors.accent}"
    typography: "{typography.tab-active}"
  tab-inactive:
    typography: "{typography.tab-inactive}"
  cell-label:
    typography: "{typography.label}"
    padding: "0 0 0 2 cols"
  cell-label-focused:
    textColor: "{colors.accent}"
    typography: "{typography.label-focused}"
  cell-value:
    typography: "{typography.value}"
    padding: "0 0 0 2 cols"
  ruler:
    typography: "{typography.ruler-filled}"
    width: "{spacing.ruler}"
  session-mute-on:
    textColor: "{colors.mute}"
  session-mute-off:
    typography: "{typography.label}"
  daemon-banner:
    typography: "{typography.banner}"
---

# Design System: tambre

## Overview

**Creative North Star: "The Parameter Page"**

tambre's terminal UI is one hardware-synth parameter page per Tab: eight cells in a 2×4 grid, each a small label over a large value over a short bar on one shared 12-cell ramp. The number you see is the sound you hear; move it and the sound moves. The page is made of nothing but the terminal's own glyphs and attributes. There are no drawn boxes, no bracketed sliders, no knobs, LEDs, or bezels. Hairline rules separate the four regions (tabs, grid, transport, status), and everything that is not in hand is dimmed.

Colour is almost absent. Terminal yellow marks the one thing being edited (the focused cell and the active tab). Terminal red appears in exactly one place: a muted session's `[x]`. Everything else is the terminal's default foreground, either bold (values, the wordmark, the live-session mark) or dim (labels, rules, empty ruler cells, help). Every state is also a mark (`▸`, `[x]`, `‹ ›`, `•`, `locked`), so the page reads identically in a monochrome terminal.

This file records the terminal surface's world. PRODUCT.md lists the platform as `web` for the landing page at the repo root; that page has no visual world yet and must not inherit these terminal marks (`▸`, `━╌`, `[x]`, hairlines) as decoration. A web world, when one is chosen, is a separate decision.

**Key Characteristics:**
- Typography and rules only; nothing that imitates a device.
- One accent (yellow) for focus, one alarm (red) for mute, dim for the inert.
- Values are the loudest glyphs on screen (bold); labels the quietest (dim).
- Every cell carries a 12-cell ruler on one shared ramp: `━` filled, `╌` empty.
- Every state has a mark; colour is never the only signal.
- One lowercase status line reports the last action; nothing else speaks.

## Colors

Two terminal colours, named by role, and the terminal's own foreground in three attributes. The terminal theme owns the actual hues; tambre never sets a hex.

### Primary
- **Accent (terminal `yellow`)**: the focused cell's `▸` mark and label, the active tab word, and the `patch name:` prompt label. It names the one thing under your hand.

### Tertiary
- **Mute (terminal `red`)**: the `[x]` mark of a muted session in the transport strip. Nowhere else.

### Neutral
- **Foreground, bold**: every cell value, the `tambre` wordmark, the active tab, the selected session's `▸` and voice name, a `blocked` state word, and the daemon-unreachable banner.
- **Foreground, normal**: filled ruler cells `━`, session project names, the status line, the first-run note.
- **Foreground, dim**: unfocused labels, hairline rules, empty ruler cells `╌`, the cycle brackets `‹ ›`, inactive tabs, the header's right side, session numbers and texture, `waiting` and `ended` states, `[ ]` unmuted, the `locked` word, pick-cell sub lines, help rows.

### Named Rules
**The One Accent Rule.** Yellow means "this is what you are editing" and nothing else. The transport strip's selected session uses a bold `▸`, not a yellow one, because selecting a session is not editing it.

**The Red Is Mute Rule.** Red appears only on a muted session's `[x]`. No red for errors, warnings, or the daemon banner; those are bold text on the status line.

**The Mark Before Colour Rule.** Any state that is coloured is also marked: focus is `▸`, mute is `[x]`, a cycle cell is `‹ ›`, the loaded voice is `•`. Remove every colour and the page still reads.

## Typography

**Display Font:** the terminal's monospace face (inherited; never set)
**Body Font:** the same
**Label/Mono Font:** the same

**Character:** one face, three weights of attention. Bold is loud, normal is present, dim is furniture. Size never changes; hierarchy is attribute and position.

### Hierarchy
- **Value** (bold, one line, indented 2 columns): the number or word the cell holds, formatted by the cell (`0.55`, `G2`, `60 bpm`, `L 0.35`, `+1`). The largest thing in any cell.
- **Label** (dim; yellow and un-dimmed when focused): lowercase parameter name on the cell's first line, after the 2-column mark slot. May carry a dim ` · tag` (`fm ratio · stored`) or a ` •` on the loaded pick.
- **Tab word** (uppercase; bold yellow when active, dim otherwise): `PALETTE VOICE FRAME ADVANCED PATCHES`, two columns apart. The only uppercase words on the page.
- **Wordmark** (bold): `tambre` at the top left; the header's right side (project · root · voicings · tempo) is dim.
- **Status** (normal): one lowercase line naming the last action.
- **Help** (dim): `key verb` pairs separated by two spaces.

### Named Rules
**The Lowercase Rule.** Labels, values, status messages, and help are lowercase. Tab titles are the only uppercase words; key names are written as typed (`Enter`, `Tab`, `s`); the first-run note is in sentences.

**The Value Is Loudest Rule.** Within a cell, only the value is bold. A bold label or bold ruler would compete with the number the user is listening to.

## Layout

The page is a fixed column of lines, top to bottom: header, tab row, hairline, optional one-line daemon banner, optional three-line first-run note (PALETTE page only), the grid, hairline, the transport strip, hairline, the status line, then one or two help rows. Horizontal and vertical measures are character columns and lines.

- **Grid**: 2 rows × 4 columns of cells at 80 columns or wider; each cell is `floor(cols / 4)` columns wide (25 at 100 columns) and three lines tall (label, value, ruler) with one blank line between the two rows (7 grid lines). Below 80 columns the grid collapses to a single column of eight one-line cells: mark, 12-column label, value, ruler, each in its own column.
- **Ruler**: 12 cells, starting 2 columns in from the cell's left edge; the cycle ruler sits one column in so its `‹ ›` brackets flank the same 12 cells. The ruler is the hit target for click and drag.
- **Tabs**: five words on line 2 with a 2-column gap; on PATCHES a dim `n/m` page counter follows.
- **Transport**: one line per live session, at most 8; a `+N more` line when there are more. Columns are fixed: 2 mark, 3 index, 9 voice, 19 project, 10 state, 3 mute mark, then texture. The mute mark is clickable at column 43.
- **Help**: two rows at 26 terminal rows or taller, otherwise one row that drops items from the end until it fits.
- **First viewport at 100×30**: header on row 1, tabs row 2, rule row 3, grid rows 4–10, rule 11, transport 12–19, rule 20, status 21, help 22–23. The brief sketched 24-column cells and a lower transport; the build's `floor(cols / 4)` and tighter stack are what shipped.

**The No Border Rule.** Regions are separated by a single dim `─` hairline across the full width. Nothing is boxed; the terminal's own edge is the only frame.

## Elevation & Depth

Flat. There are no shadows, layers, or backgrounds; the terminal's default background is the only surface. Depth is conveyed by attribute alone: what is in hand is yellow, what matters is bold, what waits is dim. The one inverse-video glyph is the prompt cursor in the patch-name line.

**The Attribute Is Depth Rule.** Never draw a region to lift it. Bold brings forward, dim pushes back, and a hairline separates.

## Shapes

No corners, borders, or boxes. The form language is a vocabulary of single glyphs with fixed meanings:

- `▸` focus (yellow in the grid, bold in the transport strip); two blank columns hold its slot when absent, so nothing shifts.
- `━` filled ruler cell, `╌` empty ruler cell; 12 per ruler, one shared ramp.
- `‹ ›` brackets a cycle cell's ruler: the value steps through named options.
- `[x]` muted, `[ ]` not muted.
- `─` hairline rule, full width, dim.
- `•` the palette voice or patch currently loaded in the editor.
- `·` separator inside a line (`G2 · dusk · 60 bpm`, `hear working · moss · hush`).
- `…` a truncated path.
- `locked` replaces a frame cell's ruler while sessions are live.

**The Glyph Vocabulary Rule.** A new state gets a glyph from this list or a lowercase word; it never gets a drawn box, a bracket slider `[====  ]`, or an emoji.

## Components

### Cell (range)
- **Shape:** three lines, `floor(cols / 4)` wide; collapses to one line below 80 columns.
- **Lines:** mark slot + dim lowercase label; bold formatted value indented 2; 12-cell `━╌` ruler indented 2.
- **Focus:** the mark becomes a yellow `▸` and the label turns yellow; nothing else changes.
- **Edit:** `h`/`l`, `<`/`>`, the mouse wheel, or a click/drag on the ruler; the status line echoes `label value`.
- **Locked (FRAME page, sessions live):** the ruler line reads a dim `locked`; the edit still saves to user config and the status line says so.

### Cell (cycle)
- As the range cell, but the third line is `‹` + 12-cell ruler + `›` in dim brackets, the fill showing the option's position among its siblings. Values are words (`hush`, `dusk`, `off`).

### Cell (pick: palette voice or patch)
- Label is the voice or patch name, with ` •` when it is the loaded one. The bold line is a two-word character (`dark, soft`) or the patch's voice; the third line is a dim sub (`soft bell`, texture name). No ruler. Space auditions, Enter loads.

### Tabs
- Five uppercase words, 2 columns apart; active is bold yellow, the rest dim. Tab and Shift+Tab cycle; a click lands on the word. PATCHES appends a dim `page/pages` counter when there is more than one page.

### Transport row
- `▸` (bold) on the selected session, then dim `01`, voice (bold when selected), project, state (dim for `waiting`/`ended`, bold for `blocked`), `[x]` red or `[ ]` dim, dim texture. `J`/`K` select, `m` toggles mute, clicking the mark toggles it too. With no sessions the strip reads a dim `no sessions · daemon ok` (or `starting daemon…`, or `no sessions` when down).

### Status line
- One line, normal weight, lowercase, no trailing period. One message per action: `muted brass`, `volume 0.80`, `loaded moss; Tab to VOICE to tune it`, `saved tambre.json · …path`, `hear working · moss · hush`, `no audio · daemon unreachable`. Errors append after a colon: `label: error`.

### Patch-name prompt
- Replaces the status line: yellow `patch name: `, the typed text, an inverse-video space as the cursor, then dim `Enter saves, Esc cancels`.

### Daemon banner
- One bold line directly under the tab rule: `daemon unreachable · no audio · editing and saving still work · tambre doctor explains`. Bold, not red; stated once; the status line repeats `no audio · daemon unreachable` only when a key tries to play.

### First-run note
- Three plain lines above the PALETTE grid, in sentences, naming the three keys to press. Disappears after `s`.

### Help
- Dim `key verb` pairs, two spaces apart; two rows at 26+ terminal rows, else one row trimmed from the end in priority order.

## Do's and Don'ts

### Do:
- **Do** mark focus with a yellow `▸` in the two-column mark slot and dim everything unfocused.
- **Do** put the value in bold and nothing else in the cell.
- **Do** draw every ruler as 12 cells of `━` and `╌`; a cycle cell adds `‹ ›` around the same 12 cells.
- **Do** separate regions with one dim full-width `─` hairline.
- **Do** write labels, values, status, and help in lowercase; keep tab titles as the only uppercase words.
- **Do** report each action in one status line, with `·` between parts and no trailing period.
- **Do** collapse to one column below 80 columns and to one help row below 26 rows.

### Don't:
- **Don't** draw boxes, panels, bracket sliders, knobs, LEDs, or bezels; the grid is typography and rules only.
- **Don't** use yellow for anything but the focused cell, the active tab, and the prompt label.
- **Don't** use red for anything but a muted session's `[x]`.
- **Don't** convey a state by colour alone; give it a glyph from the vocabulary or a lowercase word.
- **Don't** bold a label or a ruler; only values, the wordmark, the active tab, the selected session, `blocked`, and the banner are bold.
- **Don't** carry these marks onto the web landing page as decoration; that surface has no world yet.
