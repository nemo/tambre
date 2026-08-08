# 02 — Broadsheet
**Slug:** 02-broadsheet   **Date:** 2026-08-08   **Parent:** none

## One line
The feed is a printed catalogue page — packs are numbered entries set in three
running columns with rules between them, and each entry carries its own
footnoted index of bound hooks that you audition by running the cursor down it.

## The seven axes

| Axis | This variant |
| --- | --- |
| **Browse metaphor** | A classifieds / record-review page in a broadsheet. 24 numbered *entries*, 12 to a page, set in three columns with a 1px column rule; a masthead, standing matter (editor's note, key to the marks, notice to the reader), an index bar for filters, and a folio with "continued on page 2". No cards, no grid, no tiles. |
| **Typography** | Does all the work. Display serif (Iowan Old Style → Palatino → Georgia) for pack titles at 23px; Georgia for running text; letterspaced uppercase Georgia at 9.5–11px for labels and canonical event names; small caps for trust words; Georgia's native oldstyle figures for every number in the document (entry numbers, counts, gains, dates, coverage). Four type sizes and three weights carry the whole hierarchy. |
| **Density** | High and unapologetic. Every entry shows title, scope@version, approach, waveform, description, sound count, installs, plays, publish date, three-agent coverage, **its full hook index**, subject tags, license and install line. 12 entries × ~5 hooks = ~60 hoverable audition targets on one page, all visible at once, nothing disclosed progressively. |
| **Colour** | Warm paper `#f4f1ea`, ink `#14120e`, two greys, and exactly one editorial red `#a3201a` reserved entirely for the sounding state. No dark mode, by fiat. |
| **Ornament** | Rules only: 6px masthead rule, 3px/2px section rules, 1px hairlines between hook lines and between columns. No shadows, no gradients, no radii, no filled chips. Emphasis is weight, size, italic, small caps, and rule thickness. Waveforms are letterpress marks — 1px ink strokes on a hairline baseline, 170×24 for the pack, 36×11 in each hook row, all drawn from real rendered peaks. |
| **Motion** | Essentially none. Hover underlines an event name, fills a 4px ink caret in the margin, and darkens the row's hairline. Live playback swaps the row and its micro-waveform to red. No transitions, no transforms, no reveals. |
| **Audio interaction** | Per-hook, not per-pack. Each hook line is a `<button>` labelled with the canonical event name, the sound name in italic, three agent-support marks, and the gain as an oldstyle figure. `mouseenter` plays that hook's own sound through its own gain; click does the same and bypasses the hover gate. Two independent throttles: a global 100 ms **browse gate** on hover, and the spec's per-role throttle (churn 120 ms, everything else 0). |

## Load-bearing decisions

1. **The hook index is always open.** No expand/collapse, because an expander
   inside CSS multi-columns reflows every entry after it, and reflow is motion.
   The cost is grey density; the benefit is that the thing the product is
   actually about — which sound is bound to which event, at what gain — is on
   the page for all 60-odd hooks simultaneously.
2. **Three marks per hook, not one number per pack.** `■` native, `□` fallback
   only, `·` silent, ordered Claude / Codex / Cursor. The pack-level coverage
   line then reads `Cla 5/5 · Cod 3/5⁺¹ · Cur 2/5⁺²` — native count as the
   figure, fallback-only reachability as a raised second figure. If fallbacks
   were folded in, every pack would read 5/5 everywhere and the number would say
   nothing.
3. **The gesture gate is a piece of the page.** The third column of the standing
   matter is a "Notice to the Reader": *the type is set but the press is cold*,
   with an **Ink the press** button set as a 19px rule-underlined display line.
   Once inked, that column is replaced by the house volume slider (an ink rule
   with a square slug for a thumb). Hovering a hook while cold underlines the
   notice instead of firing anything.
4. **Withheld, not hidden.** `unverified` is off by default per §8.3. Instead of
   a checkbox the page prints an italic line: *"4 entries are withheld from this
   setting pending attestation of its scope"* with a **Set them anyway** button.
   Same mechanic, editorial register.
5. **The agent filter is called "Complete on"** and keeps only packs whose every
   binding is *natively* supported on that agent. A "has at least one hook"
   filter would pass 24 of 24 and be furniture.
6. **Pagination, not infinite scroll.** A broadsheet has pages. The folio reads
   "Catalogue continued on page 2 of 2."

## What works

- The hook index. Auditioning is genuinely per-hook: you can hear that
  `tool.pre` and `tool.post` are the *same* sound 3 dB apart, that
  `turn.fail` is a different object entirely, and that a `bed` pack has
  deliberately flat dynamics — none of which a one-sound-per-card feed can show.
- The three-mark reachability strip. It makes ragged coverage a visual texture
  you scan rather than a number you parse. `@scholia/errata` visibly falls apart
  on Cursor; `@recto/quill` visibly does better there than on Claude Code.
- Oldstyle figures. Georgia's text figures sit inside running prose without
  shouting, which lets stats live in a sentence instead of a stat block.
- The cold-press conceit. It earns the gesture gate a real place in the layout
  and gives the volume control somewhere to live afterwards.
- The single red. Because *nothing* else is coloured, the live row is
  unmistakable at a glance across three columns.

## What doesn't

- **The hover gate fights the intended gesture.** A 100 ms browse throttle is
  the right answer to accidental sweeps, and it is the wrong answer to
  *deliberate* sweeps — which is exactly what "hover through a pack's hooks"
  means. Running the cursor down a five-hook index at normal speed plays roughly
  two of the five and silently swallows the rest, with no indication that
  anything was suppressed. Click always plays, so the escape hatch exists, but
  the primary interaction is throttled against itself. A per-row debounce (fire
  on 60 ms dwell, no global gate) would probably be correct and I did not build it.
- **Waveforms mostly fail at this size.** At 170×24 with 85 bins, a 90 ms tap is
  one spike at the far left of an otherwise empty rule. Two thirds of the pack
  marks are visually near-identical because the *durations* differ more than the
  envelopes do, and nothing normalises the time axis. The 36×11 micro-marks in
  the hook rows are real data rendering as decoration — you cannot read them,
  you can only see that something is there. They pull their weight only as a
  red/black state indicator.
- **CSS multi-column is hostile to dense interactive content.** Columns fill
  top-to-bottom-then-across, so entries 01–04 are in column one and 05–08 in
  column two — correct for print, wrong for anyone who reads a three-up layout
  as a grid. `break-inside: avoid` leaves ragged column bottoms of 60–120px.
  Resizing the window reshuffles which entry sits where with no animation and no
  anchor.
- **Grey.** 12 entries × (title + prose + stats + coverage + 5 hook lines) is a
  wall. There is no rest anywhere on the page — no leading image, no pull quote,
  no size jump larger than 23px→13px. A real broadsheet would set one entry at
  double width as the lead review; this one treats all 24 as equal-weight
  classifieds, which is honest to the registry and dull to look at.
- **11px letterspaced uppercase Georgia** is at the bottom of comfortable.
  `permission.request` wraps to two lines in a 340px column, which breaks the
  table alignment it is pretending to have. The "table" is a CSS grid with no
  column headers over four of its five columns.
- **The live state is often missed.** Boundary sounds run 200–600 ms but churn
  taps are 70–150 ms, so the red flash on a `tool.pre` row is at the edge of
  perception — and because motion was ruled out, there is no afterglow or decay
  to catch the eye. Forbidding motion cost the audio its only visual echo.
- **No dark mode, and the audience is nocturnal.** Someone browsing a sound-pack
  registry in headphones at 2 a.m. is not a hypothetical user; this variant
  refuses them on principle. The principle is the brief, but it is a real cost
  and worth naming.
- **Mobile destroys the metaphor.** Below 660px the columns collapse to one, the
  column rules vanish, the standing matter stacks, and what is left is a long
  grey list of serif text with tiny buttons. The conceit only exists at desktop
  width.
- **6px squares** are near the perceptual floor for distinguishing filled from
  outlined, especially the `·` silent mark. It needs the legend, and nobody
  reads legends.
- Scope is feed-only: no pack page, no publisher page, no search field, no
  version history, no README. The install line and license are printed but
  nothing is copyable with one click.

## Burned for future variants

- **Per-hook auditioning with the event name, sound name and gain on the same
  line is the right unit of the product.** Any variant that plays one sound per
  pack is showing you 20% of what a pack is. Keep this; give it more room.
- **`■ □ ·` per agent per hook** is the best piece of information design in this
  file. Reuse it at a larger size — 8–9px squares with 3px gaps.
- **A browse-only hover throttle separate from the role throttle is mandatory**,
  but make it per-row dwell, not a global gate. ~60 ms dwell, not 100 ms global.
- **Coverage must expose fallback-only as a second state** or the figure is a
  lie. `5/5` and `2/5⁺²` are different products.
- **"Withheld pending attestation"** beats "show unverified" as framing, and the
  reveal button belongs next to the count.
- **Make the gesture gate part of the layout**, not a dismissible bar. It is the
  one moment where the page gets to explain itself.
- **Do not put a dense hoverable table inside CSS multi-columns.** Use a real
  grid with explicit row placement if you want columns *and* interactivity.
- Waveforms need either a normalised time axis or ~3× more width to differentiate
  packs. At thumbnail size they are texture, not information — budget them as such.

## Verification

**Checked, passing:**

- `<script>` extracted and `node --check`ed clean (single script block, 46 KB).
- **DSP audit in Node:** all **87** sounds across all 24 packs rendered through
  the real `renderSdsl`. Asserted per sound: no NaN/Infinity, peak ≥ 0.02 (no
  silence), buffer length ≥ 200 samples, and **peak ≤ −1 dBFS**. Measured range
  **−12.82 to −2.41 dBFS**; nothing approaches the ceiling. All six generators
  exercised (tap 36, modal 21, noise 19, tone 10, blip 8, pluck 7). Timbral
  spread via zero-crossing brightness proxy: **58 Hz → 11 240 Hz**, median
  712 Hz — wide, with genuine low material (`foundry-bed/hum`, 82 Hz drone) and
  genuine bright material (`ledger-nib/scratch`, `tin-post/rattle`).
- **jsdom (30.0.1) with stubbed `AudioContext` and
  `HTMLCanvasElement.prototype.getContext`, 65 assertions, all passing, zero
  console errors or warnings:** initial render (12 entries, 63 hook rows, one
  pack mark per entry, one micro-mark per hook, all `fillRect` args finite);
  every approach filter; every agent filter (verified it keeps only
  natively-complete packs); tag filter; all three trust toggles; the
  §8.3 default-hidden `unverified` behaviour and the "set them anyway" path;
  all three sorts verified monotonic on the real field; pagination forward,
  back, direct jump, disabled end-stops, and the "continued on page N" folio;
  the gesture gate (hover before ink creates no `AudioContext` and starts zero
  sources); per-hook hover playback (one source per hover, row goes live,
  distinct events and distinct sounds per row, gain printed and in the
  `aria-label`); the 100 ms hover gate (an 8-row sweep fires **once**, and fires
  again after the gate expires); the churn role throttle (3 rapid clicks → 1
  play); the polyphony cap (10 rapid plays → ≤ 6 live voices, 9 oldest stopped);
  volume slider; and render idempotency.
- **Data integrity:** all 24 packs have 2–6 sounds and ≥ 2 bindings; every
  binding's sound exists in the pack; every role and throttle matches the
  canonical event's role (churn 120 ms, else 0); every gain in [0, 1]; every
  fallback names a real canonical event. All **16/16** canonical events are used
  somewhere in the catalogue. Coverage triples are ragged — **11 distinct**
  Claude/Codex/Cursor combinations from 2/5 to 6/6.
- Required awkward cases confirmed present: a 90-character title
  (`@veilliard/compendium`), a 2-sound pack (`@scholia/marginalia`), two 6-sound
  packs (`@veilliard/compendium`, `@stitch/bindery`), and `@recto/quill` scoring
  **Cursor 5/5 vs Claude Code 4/5** by binding `file.edit`.

**Not checked — stated plainly:**

- **No browser was opened.** Chrome MCP refuses `file://` and the sandbox has no
  libraries for headless Chromium. **The visual layout is unverified.** Column
  balance, whether the 90-character title actually behaves inside a 340px
  column, whether the hook grid's five columns hold at that width, whether
  `permission.request` wraps where I think it does, real font fallback (I have
  not seen Iowan Old Style or Palatino render), the range-input thumb styling,
  and the `@media print` rules are all reasoned about and none of them are
  observed.
- **No sound was heard.** Amplitude, duration, spectrum and the master chain are
  measured numerically; whether `@aviary/dovecote`'s trill is pleasant or
  `@greenroom/tin-post` is as unbearable as its own description claims is
  unverified by ear.
- Real `AudioContext` behaviour — `createBuffer`/`start` timing, `onended`
  firing, and whether the polyphony bookkeeping stays correct under real
  asynchronous ends — was exercised only against a stub.
- No accessibility audit beyond `aria-pressed`/`aria-current`/`aria-label` and
  focus-visible rules; no screen reader, no contrast measurement (the greys
  `#7c7566` on `#f4f1ea` at 11px are the likeliest failure).
