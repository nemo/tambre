# 01 — Console

**Slug:** `01-console-rack`
**Date:** 2026-08-08
**Parent:** none (first variant)

## One line

The feed is a studio mixing desk. Every pack is a channel strip in a rack, and
you audition packs the way an engineer solos channels.

## The seven axes

| Axis | This variant |
| --- | --- |
| **Browse metaphor** | **Channel-strip rack** — one full-width horizontal strip per pack, stacked vertically, numbered like desk channels. Not a grid, not cards. |
| **Typography** | Monospace for all data (IDs, counts, coverage, status); system sans only for pack titles. Type does no expressive work — it's instrumentation labelling. |
| **Density** | High. 74px strips, ~9 visible per screen, eight columns of information per row. Optimised for scanning a long rack, not for browsing pictures. |
| **Color** | Near-black (#0a0b0c) with a single amber accent (#ffab24) used exclusively for signal — LEDs, waveforms, active state. Approach chips get muted tints as the one exception. |
| **Ornament** | Hardware affordances: LED arrays, fader tracks, hairline panel rules, a 14-segment master meter. Everything ornamental is also functional. |
| **Motion** | Almost none. The master meter reacts to real audio via an AnalyserNode; a strip gets an amber edge while playing. No transitions over 180ms, no scroll animation. |
| **Audio interaction** | Four-tier: **hover a strip** = preview `turn.end`; **click a strip** = open its patch bay (accordion); **hover a pad** = play that specific hook's own sound at its bound gain; **solo button** = every binding in canonical order at 240ms. Master section is a real gain + mute on a live Web Audio graph. |

## Load-bearing decisions

**Power-on gate instead of a cookie-style consent line.** The spec forbids sound
before a gesture (§12). Rather than an apologetic banner, the whole console is
dark until you press the power button — the constraint becomes the entry
experience, and the AudioContext gets created inside a real user gesture, which
is what browsers require anyway.

**Coverage counts direct support only.** First pass counted fallback-resolved
events too (§6.3) and every pack came out 16/16 on every agent — the LED column
said nothing. Now a bright LED is native support, a dim LED is fallback-only,
and the headline number is direct. The rack immediately reads Claude > Codex >
Cursor, with two packs (`@mkobayashi/shaker`, `@lowtide/pebble`) inverting it
because they bind `file.edit`, which only Cursor fires.

**Hover preview gets its own throttle, overriding §10.3.** `turn.end` is
role=cue, so the spec assigns throttle 0. Correct for a live agent; miserable in
a dense rack, where one mouse sweep fired 20 sounds. Browsing is not the same
event stream as playback, so preview gets a 110ms floor. Verified: 20 rapid
hovers now produce 1 play. **This is the single most transferable finding here —
any variant with hover-to-play in a dense layout needs it.**

**Unverified packs are hidden by default** (§8.3), and the trust switches double
as the reveal. 20 of 24 channels show on load.

**One sound per pack was a lie; the patch bay fixed it.** The first pass played
the same rendered buffer for every event, which made the whole premise
unfalsifiable — you could not tell which hook you were hearing, or that a pack
even binds a dozen of them. Now each pack carries 2–6 named sounds derived from
one authored gesture at graded pitch and length (the way denim's `tap-1` and
`tap-2` actually differ), and a real bindings map of `event → {sound, gain,
throttle, role}`. Clicking a channel opens a **patch bay**: one labelled pad per
bound hook, showing the canonical event name, its role, the sound it fires, its
gain, its throttle, a mini waveform of that specific sound, and three dots for
Claude/Codex/Cursor reachability. **Hovering a pad plays that hook.** Sweeping
the pads plays the pack as a phrase, because the sounds are relatives.

Accordion, not multi-expand — one open channel keeps the rack scannable.

Auditioning churn pads is deliberately quiet: gain 0.2 per §10.3. The pad prints
`×0.20` so near-silence reads as information rather than a bug.

## What works

- Coverage-as-LEDs is the strongest idea. Three agents × 16 events is a lot of
  data for a card; as a 48-LED block it reads at a glance and costs 110px.
- The patch bay is the thing to steal. A pack's value is its *set* of bindings,
  and until you can hear each one labelled, a sound marketplace is unshoppable.
- Gain and throttle become visible, not buried. §10.3 is the spec's stated
  make-or-break UX problem and a mixing desk is literally the interface for it.
- The status bar (SIG / EVENT / VOICES / SR) makes the audio engine legible
  while you browse — you can see the polyphony cap working.

## What doesn't

- **It looks like a tool, not a marketplace.** Nothing here invites you to
  browse for pleasure; the spec's word was "Pinterest-shaped" and this is the
  opposite. A pack's *character* — the thing you're actually shopping for —
  gets one 188px waveform and a three-word tag list.
- **Density punishes long names.** `@hallway/a-genuinely-excessive-pack-name-here`
  ellipsises at 36 chars. The layout survives it but the pack is unreadable.
- **Below 1080px the design collapses to a plain list** — tags, coverage, and
  stats all drop. The metaphor doesn't survive mobile, which for a
  hover-dependent design was probably always true.
- Dark-only. No light mode, contradicting §12's "light mode primary".
- **The patch bay is buried behind a click with no affordance saying so.** The
  most valuable interaction in the design is invisible until you happen to click
  a row. Only the status bar hints at it. A persistent hook count or a chevron
  on each strip would fix it, and a later variant should try keeping the hook
  index always open instead of gated.
- Two hover behaviours now overlap: hovering a strip previews `turn.end` while
  hovering its pads plays specific hooks. Moving from strip to pad crosses both.
  The shared 110ms gate keeps it from machine-gunning, but the model is not
  self-evident.

## Burned for future variants

Browse metaphor **channel-strip rack** is now used. Also spent: near-black +
single-amber, monospace-instrumentation type, hardware-affordance ornament.

Wide open: grid/masonry, table, deck/carousel, map, timeline/waveform-scrub,
editorial print, light palettes, expressive display type, image-led cards,
motion-forward.

## Verification

- DSP rendered headlessly in Node for all 24 packs: no silence, no NaN, nothing
  above −1 dBFS (§13), all six generators exercised, timbral spread 58 Hz –
  8 kHz by zero-crossing proxy.
- DOM exercised in jsdom with stubbed Web Audio + canvas: render, filters, sort,
  paging, power-on, solo sequence, polyphony cap, hover throttle. Zero console
  errors.
- **Not verified:** visual layout and paint. Chrome MCP refuses `file://` and the
  sandbox lacks the libraries for a headless browser. Open it to judge the look.
