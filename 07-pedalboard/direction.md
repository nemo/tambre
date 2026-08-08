# 07 — Pedalboard
**Slug:** 07-pedalboard   **Date:** 2026-08-08   **Parent:** none

## One line
The registry as a wall of guitar effects pedals: each pack is a painted stompbox whose
footswitches *are* its bound hooks, so auditioning a specific event means stomping the
switch with that event silkscreened on it.

## The seven axes

| Axis | This variant |
| --- | --- |
| **Browse metaphor** | A shelf/wall of effects pedals. Enclosure size is a data channel: hook count drives grid span (≤6 hooks = 1 column, 7–9 = 2, 10–14 = 3). Brass Tacks binds 14 and is a triple-wide box; Dead Room binds 2 and is a stompbox. Filters are a control panel: rotary approach selector, toggle-switch agent bank, trust toggles with a literal "drawer", a 1/4" jack patch bay for tags, a three-position slide switch for sort. Paging is a pair of pager footswitches with shelf LEDs. |
| **Typography** | Chunky condensed uppercase for silkscreen (`Arial Narrow`/`Helvetica Neue Condensed`/Impact stack, tight letter-spacing, embossed text-shadow against the enclosure colour). Monospace for the small printed data — scope, gain values, spec plate. Long titles step down through three size classes rather than clipping. Footswitch faces are small-caps abbreviations (`PERM·REQ`); a LEGEND toggle swaps every face to the full canonical name. |
| **Density** | Deliberately low per-pack, high per-screen. 8 pedals per shelf. Each pedal carries 2–14 switches, so a shelf can show 60+ individually auditionable hooks. Much lower information-per-pixel than variant 03's table; far higher *interactive surface* per pixel. |
| **Colour** | Saturated and varied — 14 enclosure finishes (cream, sand, tangerine, oxblood, teal, grape, olive, seafoam, charcoal, hammertone, mustard, sky, copper, rose, midnight). Approach informs the family (bed → cool/dark, jingle → hot/metallic, tactile → cream/earth, hybrid → two-tone/sparkle) but no two adjacent pedals read alike. Board is a dark pegboard; hardware is brushed steel; LEDs are amber and red; the LCD readout is phosphor green. |
| **Ornament** | Maximal and load-bearing: bevelled enclosure edges, CSS-gradient powder-coat plus an `feTurbulence` noise overlay, hammertone finish on one pedal, four slotted screws per box at pseudo-random rotations, a status LED per pedal, per-switch LEDs, three coverage lamps per switch, a stamped trust seal, a knurled volume knob, a per-switch mini-knob indicating gain, and an oscilloscope window showing the real rendered waveform. |
| **Motion** | Mechanical and short. Footswitches sink 2 px on hover and 5 px on press with the drop-shadow collapsing under them (70 ms, overshoot easing). Toggles snap (90 ms). Rotary pointer sweeps (120 ms). LEDs fade in 80 ms and hold 180 ms. Pedals lift 2 px on hover. Nothing over 130 ms. `prefers-reduced-motion` kills all transitions *and* the enclosure tilt. |
| **Audio interaction** | One labelled footswitch per bound hook. `pointerover` plays that hook's sound; click plays it and visibly depresses the switch; Enter/Space plays it from the keyboard. The switch LED and the pedal's status LED light. The pedal's scope window redraws to that sound's waveform and the caption changes to `event · sound`. The LCD prints the full canonical event name, the sound name, the exact gain, the throttle, the role, and per-agent reachability. Gate is a red rectangular mains rocker (deliberately not a round button). Hover has its own 100 ms throttle; role throttle (churn 120 ms) is separate and additional. |

## Load-bearing decisions

**Spec §12 constraints deliberately broken.** §12 asks for "system font stack, one accent
colour, no shadows deeper than 2 px, no gradients, generous whitespace, waveforms as the
only ornament, light mode primary." This variant violates all seven, on purpose:

- **No gradients → gradients everywhere.** A powder-coated aluminium box cannot be drawn
  without a gradient. Every enclosure is a 165° three-stop gradient plus a soft-light
  turbulence overlay; knobs and footswitches are conic + radial gradients. The finish
  *is* the identity system — it's how you recognise a pack across the wall before you
  can read the silkscreen.
- **No shadows deeper than 2 px → 26 px shadows and 5 px hard offsets.** A footswitch has
  to look pressable. That requires a hard `0 5px 0` under the cap that collapses to
  `0 0 0` on press. Without it there is no affordance and the whole metaphor is a
  drawing rather than a control.
- **System font stack → condensed display type.** Pedal graphics read a specific way;
  system-ui doesn't. Kept to safe pre-installed condensed faces with a fallback chain, so
  no webfont fetch and the page stays self-contained.
- **One accent colour → fourteen finishes.** The brief for this variant explicitly asks
  for varied saturated colour, and colour is doing work: it's the only way to tell 24
  boxes apart at a glance.
- **Generous whitespace → dense hardware.** Whitespace between pedals, none inside them.
- **Light mode primary → dark board.** You put pedals on a dark floor.
- **Waveforms as the only ornament → waveforms as one ornament among many.** They survive
  as the scope window, and they are still real audio, not decoration.

**Coverage counts native support only.** Fallback chains are computed and shown, but as a
distinct amber state on a per-switch three-lamp indicator (C / X / U), never folded into
the number. `@edgewise/keystroke` binds `file.edit` and reads Cursor 5/5, Claude 4/5,
Codex 4/5 — the one pack in the set that scores better on Cursor than on Claude. 14 of 24
packs have ragged coverage.

**The agent filter means something specific.** "PATCH TO" keeps only pedals where *every*
bound hook fires natively on the selected agent(s). Claude → 23 packs, Codex → 12,
Cursor → 11. A looser definition (any hook reachable) would have matched everything and
said nothing.

**Unverified packs are in a drawer.** §8.3: `unverified` is excluded from the default wall.
Three packs are unverified; the tally states the count and the trust toggle is styled as
the one dangerous switch on the panel (red lamp).

**Gain is printed twice.** Numerically (`g0.20`) and as a mini-knob rotated to
`-135° + gain × 270°`. The number is the truth; the knob is the pattern-recognition layer
— you can see at a glance that a bank's churn switches are all turned down.

**Install affordance.** There is no Tambre CLI or registry server yet — the spec is v0.1
and unimplemented — so "installing" a pack means handing an agent a natural-language
command that points it at this repo's `INSTALL.md`. Every pedal gets a stamped `INSTALL`
plate below the spec plate: a fixed-contrast dark chip (not the finish-dependent embossed
`--pink`) holding the exact copy-pasteable command in monospace, plus a `COPY` button.
Because each footswitch here literally *is* a bound hook, the LCD — which already prints
event, sound, gain, throttle, role and reachability for whatever switch you last touched —
also grows a single-binding command line and its own `COPY` button, so you can install a
pack scoped to just the hook you're looking at. Copy confirmation is two-part: a local
button-state flash (`copy → copied`, or `press ⌘c` if both `navigator.clipboard` and
`execCommand` fail) reverting after 1.4 s, and one spoken line borrowed from the LCD's
existing `aria-live="polite"` region rather than standing up a second one — the LCD is
sticky, so it's on screen no matter which of the 24 pedals you copied from.

**Audio.** Six generators written from scratch (`tap`, `modal`, `pluck`, `tone`, `blip`,
`noise`), RBJ cookbook band-pass normalised by `a0`, FNV-1a + mulberry32 seeded per
`"<pkg>@<version>/<sound>"` so waveforms are stable across reloads. Mandatory master
chain: `× 0.9 × volume` → `tanh(x × 1.25) × 0.8` → trim trailing samples below `1.26e-4`
→ 4 ms linear fade-out. Pack volume is baked into the buffer; role gain and the user's
master knob apply downstream through a `GainNode`. Measured worst-case peak across all
92 sounds is **−2.76 dBFS**.

## What works

- **The metaphor collapses the hardest requirement into an obvious gesture.** "Which sound
  is this hook?" stops being a UI problem the moment the event name is printed on the thing
  you press. Sweeping a cursor along Brass Tacks' 14 switches is the fastest way to
  understand a pack that exists in this library.
- **Enclosure size as hook count** is legible pre-attentively. You can spot the maximalist
  packs and the minimal ones from across the wall without reading a number.
- **A 14-switch pedal is genuinely funny and genuinely useful.** The absurdity is the
  information.
- **The three-lamp-per-switch indicator** puts ragged coverage exactly where the decision
  is made — at the individual hook — instead of summarising it away into `13/16`.
- **The LCD carries everything the silkscreen can't.** Abbreviated faces stay legible;
  full canonical name, gain, throttle, role and fallback target all land in one place on
  hover, and it's an `aria-live` region so it works with a screen reader.
- **Physical feedback reads as feedback, not decoration.** Switch sinks, LED lights, scope
  redraws, caption changes — four confirmations that a specific hook just played.

## What doesn't

- **Density cost is severe.** 8 packs per shelf against variant 03's table showing 40+.
  Three shelves to see 21 packs. If your task is "compare install counts across the
  registry" this is the worst design in the library, by a wide margin. It is a browsing
  and auditioning surface, not an analysis surface.
- **Skeuomorphism entertains more than it helps, past the switches.** The switches earn
  their keep — they are the only element where the physical metaphor produces a genuinely
  better interaction than a list of labelled play buttons would. The screws, the hammertone,
  the tilt, the powder coat: those are charm. Honest read is roughly 30% function,
  70% delight. I'd defend keeping it here only because delight is the brief; in a
  general-purpose product most of it should go.
- **Colour is not a working legend.** Fourteen finishes distinguish pedals from each other
  but they do not encode anything retrievable — the mapping from finish to approach is
  suggestive, not systematic, so nobody will learn "teal means bed". The chip does that
  work; the paint is just paint. Slightly dishonest as a visual system.
- **Accessibility is mixed.** Every control is a real `<button>`, focus rings are visible,
  the rotary and both sliders take arrow keys, switches take Enter/Space, the LCD is
  `aria-live`, lamps carry `title` text and the LEGEND switch prints full event names.
  But: hover-to-audition is a mouse affordance with no touch equivalent beyond tap-to-play;
  the coverage lamps are ~6 px colour-coded dots whose green/amber/grey distinction will
  fail for some colour-vision deficiencies (the `title` is the only fallback, and titles
  are unreliable); embossed silkscreen text on saturated enclosures lands between roughly
  4.5:1 and 7:1 depending on the finish — the seafoam and sky boxes are the weakest and
  should have been darkened; and a 14-button bank inside a card is a lot of tab stops with
  no skip mechanism. The new per-pedal `COPY` button adds exactly one more tab stop after
  the bank (not one per footswitch), which is proportionally cheap on Brass Tacks but is a
  ~50% increase on Dead Room's two-switch card — still no skip link, so the cost compounds
  with the existing one. It deliberately does *not* inherit the embossed `--pink` text
  colour that's already borderline on seafoam/sky: it sits on its own fixed dark chip with
  fixed ink instead, specifically to avoid adding a second control with a finish-dependent
  contrast failure on top of the one already flagged above.
- **The rotary selector is a worse control than a list of radio buttons.** It's charming
  and it is fully keyboard-operable, but the dial itself only cycles forward on click, so
  reaching "bed" from "hybrid" takes four clicks unless you use the text options beside it.
  The text options are doing the real work; the dial is jewellery.
- **Nothing is measured against a real render.** See Verification.
- **Mobile is untested and probably poor.** Spans collapse to one column under 720 px,
  which turns the 14-switch pedal into a very tall box, and the sticky rig plus the patch
  bay will eat most of a phone viewport before any pedal appears.
- **The scope window is small.** 38 px tall at card width; it confirms *that* a waveform
  changed more than it communicates *what* the waveform is.

## Burned for future variants

- **Per-hook footswitches.** Any future variant that wants hook-level auditioning should
  steal the pattern (one labelled control per binding, event name on the face, gain printed
  beside it) and drop the enclosure. It works without the skeuomorphism.
- **Size-as-data.** Card size driven by a real quantity is cheap and effective; reusable in
  any masonry layout.
- **Three-lamp reachability indicator per binding.** Better than any per-card coverage
  summary. Should probably become the house pattern.
- **The LEGEND switch.** Abbreviate-by-default with a global expand toggle is a clean answer
  to "the label doesn't fit but the full string must be available."
- **Hover throttle separate from role throttle.** Necessary the moment a card has more than
  ~4 hover targets. Worth making a shared default.
- **Do not reuse:** the enclosure finishes, screws, tilt, hammertone, and the depth of the
  shadow system. That is this variant's private language and it should stay here.

## Verification

**Checked, and passing:**

- Extracted the inline `<script>` (53.9 KB) and `node --check`ed it — clean.
- Rendered **all 24 packs × 92 sounds** in Node and asserted: no NaN/Inf; no silence
  (every buffer peaks above 1e-3); no buffer shorter than 200 samples; **nothing above
  −1 dBFS** (worst case −2.76 dBFS); all six generators exercised; wide timbral spread
  (approximate dominant frequency 58 Hz … 11.1 kHz); every sound bit-identical across two
  renders (seeded determinism); every binding resolves to a sound that exists; every bound
  event is in the canonical 16; every gain in (0, 1].
- Data-shape assertions: 24 packs; sound counts all within 2–6; five packs with exactly 2
  sounds and three with exactly 6; a 67-character title; 14 packs with ragged coverage;
  `@ferrous/brass-tacks` binds 14 hooks; `@edgewise/keystroke` reads Cursor 5 / Claude 4.
- **jsdom, real DOM, stubbed `AudioContext` and `HTMLCanvasElement.prototype.getContext`**
  — 18 groups of assertions, **zero console errors**: initial render (8 pedals, unverified
  absent, scopes drawn); one footswitch per binding for every rendered pack; every switch
  carries the full event name in `title` + `aria-label`, a printed gain, and three lamps;
  the gesture gate (hovering a switch before the mains rocker produces **no** audio node);
  arming; per-footswitch hover playback; LCD contents (full event name, gain, reachability);
  the 100 ms hover throttle (12 rapid hovers → 0 extra plays); click playback + visible
  depression; Enter and Space playback with `preventDefault` so it fires once; focus
  describes without playing; **polyphony cap under a rapid sweep** across every switch on
  the shelf (voice list never exceeds 6, oldest stopped); the 120 ms churn role throttle;
  all four approach positions plus dial click-cycling and arrow keys; all three agent
  toggles with no leakage; the trust drawer (unverified genuinely appears only after the
  toggle, and curated-off excludes curated); the tag patch bay; all three sorts verified
  against the max of the visible set; paging (content changes, prev/next disable at the
  ends, exactly one shelf LED lit); the LEGEND switch round-trip; BYPASS ALL resetting
  every control; and the master-volume knob's arrow keys. Test calls `process.exit`.
- **Install affordance, jsdom, 23 assertions, zero console errors:** one `COPY` button per
  rendered pedal with visible command text matching `installPayload()` exactly; clicking it
  neither arms the board nor plays a voice; with `navigator.clipboard` absent (as on
  `file://`) it falls through to `execCommand('copy')`; button flips to `copied` and reverts
  to `copy` after ~1.4 s; the LCD's `COPY` button starts `disabled` with a placeholder,
  enables and fills in the exact `bindingPayload()` for whatever footswitch is focused
  (tested on `focusin`, matching the existing hover/click/focus triggers), and focusing a
  switch still does not play it; clicking the LCD copy button announces `COPIED` on `l1`
  through the LCD's existing `aria-live` region and reverts after ~1.4 s without a second
  live region; existing mains-arm and footswitch-click playback still work unchanged after
  all of the above; and — with both `navigator.clipboard` and `execCommand` forced to fail —
  the manual fallback selects the visible command text (`window.getSelection()` matches it
  exactly) and the button shows `press ⌘c`.

**Not checked — and this matters more here than for any other variant:**

- **No browser render was ever produced.** Chrome MCP refuses `file://` and the sandbox
  lacks the libraries for headless Chromium. I did not look at this page. I am not
  claiming otherwise.
- Therefore **the entire visual thesis is unverified**: enclosure finishes and the
  `feTurbulence` overlay blend, bevel and shadow depth, whether the footswitches actually
  read as pressable, whether the silkscreen embossing is legible on the lighter finishes,
  whether the 67-character title wraps inside its box instead of overflowing, whether the
  wall reads as a wall or as a grid, and whether the 14-switch bank stays legible at real
  card widths. For a skeuomorphic design where the *finish work is the product*, that is
  a serious gap — every claim above about how this looks is an intention, not an
  observation.
- Real audio was never heard. The DSP is verified numerically (no clipping, no silence,
  distinct spectra) but nobody has confirmed that Brass Tacks' bell is pleasant or that
  the churn switches are actually unobtrusive at 0.2.
- Mobile/touch, screen-reader behaviour with a real AT, and actual contrast ratios are all
  asserted from reading the CSS, not measured.
- **The install `COPY` buttons' keyboard activation was not exercised.** jsdom does not
  implement native Enter/Space activation for `<button>` elements, so I could only click
  them programmatically. This is the same untested-but-standard territory as every other
  secondary control on the page — the rotary options, toggles, jacks, sort switch and
  BYPASS ALL button all rely on the same native behaviour with no custom keydown handling,
  and none of those were verified in jsdom either; only `.fsw` gets bespoke Enter/Space
  handling (to avoid double-firing) and only `.fsw` was actually tested against real
  keyboard events.
- A real `navigator.clipboard.writeText` success was never exercised — jsdom has no
  Clipboard API, so only the `execCommand` fallback and the fully-manual
  select-and-prompt path were tested. Whether `writeText` actually resolves from a real
  `file://` page in Chrome/Safari/Firefox is unverified; the fallback chain exists
  specifically because it's expected to fail there at least some of the time.
- The install chip's contrast against all 14 finishes is arithmetic, not measured: it uses
  a fixed `rgba(0,0,0,.72)` background with fixed light text specifically to sidestep the
  seafoam/sky emboss problem above, and a hand-computed luminance check against the
  lightest (cream) and one mid-tone (sky) finish landed around 8:1 and 10:1 — but nobody
  has pointed a contrast checker at a rendered pixel.
