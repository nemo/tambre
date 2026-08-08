# 04 — Stack
**Slug:** 04-stack   **Date:** 2026-08-08   **Parent:** none

## One line
One pack fills the viewport as a full-bleed card in a deck you move through a card at a time, the whole screen takes the colour of that pack's approach, and the pack's bound hooks sit across the bottom as a row of large targets you sweep like an instrument.

## The seven axes

| Axis | This variant |
| --- | --- |
| Browse metaphor | A deck of cards. Exactly one pack in the spotlight; two peeking cards behind it at increasing offset/rotation carry depth-of-stack. Advance with ←/→, drag/swipe, or the two edge buttons. Position indicator (`07 / 20`) replaces scroll entirely. |
| Typography | One heavy grotesque, weight 800, tracking −0.042em, line-height 0.87. Pack name at 64–164px depending on length. Mono (`ui-monospace`) for every machine string: canonical event names, gains, throttles, coverage counts, the install command. |
| Density | Deliberately minimal — one record per screen. Twenty-four packs are reachable only through navigation, the scrubber, or the index sheet. The one dense region is the hook organ, and that density is per-pack, not per-registry. |
| Colour | The loudest in the library. Four saturated full-screen palettes keyed to `approach`: tactile = vermilion `#C0331A`, jingle = chrome yellow `#F0C000` on near-black ink, bed = deep teal `#0B5E63`, hybrid = violet `#5C1AA8`. Each carries its own accent (`--hot`) used for the curated badge, the playhead, and the scrubber's current tick. Background is a radial two-stop of the palette; the card is a translucent scrim over it. |
| Ornament | Waveforms only, but big: a 132px-tall hero canvas at full card width (~200 mirrored peak bars) plus a 40-bar sparkline inside every hook tile. No icons, no illustration, no gradients other than the background wash and the card scrim. |
| Motion | The differentiator. Card deals in with a 260ms translate+scale+rotate (direction-aware), the whole background cross-fades between approach palettes in 260ms, the hero waveform runs a real playhead sweep lighting bars in the accent colour as the buffer plays, hook tiles lift 3px and invert on hover, drag translates and rotates the card under the pointer. Everything under 300ms. `prefers-reduced-motion` kills the deal animation, the drag transform, and the rAF playhead loop (the waveform still repaints statically). |
| Audio interaction | Per-hook auditioning is the primary interaction, not a secondary one. Hover or keyboard-focus any hook target → it plays *that hook's own sound* and the hero waveform morphs to it. Click plays without the hover gate. Advancing the deck auto-plays the new pack's `turn.end` (defeatable via the `auto-cue` toggle). Hover preview has its own 100ms throttle, separate from the binding's role throttle. |

## Load-bearing decisions

**The gesture gate is the deck, face down.** Four fanned card backs in the four approach colours, "Twenty-four packs, face down." and a `Cut the deck` button. Enter/Space also works. `powerOn()` constructs the AudioContext and immediately deals card 01, so the first sound you hear is a consequence of the gesture rather than an apology for needing it.

**The hook organ is the payload.** Each pack binds 4–16 canonical events, and each binding gets its own tile: canonical event name (mono), sound name (17px, bold), then `role · gain · throttle` and three tiny per-agent dots (filled = native, hatched = fallback-only, hollow = unreachable) — so per-hook coverage is legible without leaving the card. Under that, a sparkline of that specific sound. Sweeping the mouse across a row genuinely plays a phrase, because the sounds within a pack are graded transpositions of one signature gesture: churn voices are higher and shorter, failure voices lower and longer. `throttle 120ms` on churn and `gain 0.20` are printed on the tile, so the runtime's gain-staging policy (§10.3) is visible rather than implied.

**Hover throttle is separate from role throttle.** `turn.end` is role `cue`, throttle 0 — correct for a live agent, miserable when you sweep across fourteen targets. Hover preview goes through a single 100ms global gate and skips the per-binding role throttle entirely; clicking uses the role throttle. Both paths are asserted in the jsdom tests.

**Coverage counts native support only.** `evState()` returns 2/1/0 for native / fallback-only / unreachable. The headline reads `10/11` and the sub-line reads `+1 via fallback`. If fallbacks counted, every pack would read 16/16 and the number would say nothing.

**Filters reduce the deck, sort reorders it.** Approach, "clean on <agent>" (≥3 of 4 bindings fire natively there), tag (top 8), trust, and three sorts. Toggling a filter preserves the currently focused pack when it survives the new deck; otherwise it clamps. `unverified` is excluded from the default deck per §8.3 — the chip is styled in the accent colour and its tooltip says why. Turning it on takes the deck from 20 to 24.

**Two overview affordances, because one-at-a-time needs them.** A scrubber of one tick per deck position along the bottom (current tick tall and accent-coloured, click to jump), and an index sheet (`index` button or `i`) listing the whole filtered deck with title, scope, sound count, hook count, and `c·x·u` direct-coverage triple — click a card to jump, Esc to close.

**Navigation wraps.** Past the last card you land on the first. The alternative — a hard stop — makes the deck feel broken with no scrollbar to explain the boundary.

## What works
- Approach as a full-screen colour is the right call for this metaphor. Because you only ever see one pack, the palette is unambiguous — the screen turning yellow *is* the fact that this pack is a jingle. It also makes navigating feel like something happened.
- The hero waveform at 132px × full width finally reads as sound rather than as a decorative squiggle, and morphing it as you hover through the hooks makes "each hook has its own sound" undeniable in about two seconds.
- Big type plus one record forces honest copy. Every pack description had to earn its 62 characters-per-line, so they say something specific (which pack is loud, which is unattested, which one is Cursor-shaped) instead of listing adjectives.
- The 52-character title problem largely solves itself with a five-bucket size ramp; the long one still occupies two lines of confident display type rather than wrapping into soup.
- Printing role/gain/throttle on every hook tile turns §10.3 into a browsable fact. This is the thing I'd steal for any other variant.

## What doesn't
- **Comparison is dead.** This is the real cost and it is not small. You cannot answer "which of these two bell packs is brighter" or "who has the widest Codex coverage" without a lot of arrow-keying and holding audio in your head. Variants 01 and 03 answer both at a glance. A registry's primary job is comparison, and this design trades it away for presence.
- **Twenty-four is already too many for the metaphor.** At 24 cards the scrubber ticks are 40px wide and useful; at 2,400 they're sub-pixel and the index sheet becomes the actual browse UI — which means the deck becomes a detail view with a grid bolted on behind it. The metaphor does not scale past a curated set.
- **Filtering is a leap of faith.** Chips carry counts for approach only. When you toggle "clean on Cursor" the deck silently goes from 20 to 14 and you see one card; you have to open the index to understand what you did. A one-at-a-time surface has no room for the visible before/after that makes filtering feel safe.
- **Auto-cue is a coin flip.** Holding an arrow key fires a sound per card. The 100ms hover gate doesn't apply (it's the nav path, not the hover path) and voices stack to the polyphony cap of 6, which sounds like a dropped tray. Fixed on my side only by a toggle, which means the default is wrong for someone.
- **Yellow.** The jingle palette needs dark ink, so it's the one screen where the card scrim reads as muddy rather than luminous, and the accent (indigo) has to fight the background instead of sitting on it. Three palettes are right and one is tolerated.
- **The card runs out of vertical room before the packs do.** `felt-hammer` and `wet-glass` bind all 16 events; at a 900px viewport the organ scrolls internally, which is exactly the scroll this design claims to have abolished. A pack with 16 bindings is the honest stress case and the layout only just survives it.
- **Focus-driven audio is aggressive.** Tabbing through the organ plays every hook. Good for keyboard auditioning, hostile for a screen-reader user who just wanted to read the labels.
- Hover-to-audition doesn't exist on touch. The tiles are tappable, but the "sweep it like an instrument" gesture — the whole point — is desktop-only.

## Burned for future variants
- Full-screen approach colour is now spent. Any later variant reusing saturated per-approach palettes will read as a remix of this one.
- The face-down-deck gesture gate is used.
- The "hero waveform morphs to the hovered hook" mechanic is used, and it's strong enough to be worth reusing in a non-deck layout — but then it needs a different framing (e.g. a persistent detail pane) to not look like this.
- Per-hook tiles printing `role · gain · throttle` plus three coverage dots: reuse this freely at smaller sizes; it's the most information-dense honest widget in the set.
- Still unclaimed: dark neutral with a single accent (01 took amber), cream serif editorial (02), dense light table (03), full-screen saturated colour (04). Untouched territory: monochrome/print, terminal/TUI, timeline-of-a-session, map/graph of the event taxonomy, physical-object catalogue.

## Verification
Checked, in the sandbox, with Node 22 and jsdom:

1. **Syntax.** `<script>` extracted and `node --check`ed clean. The file is split so that everything before the `PART 5 — DOM BOOT` marker is environment-free and can be evaluated in Node with no shims.
2. **Audio, all 24 packs × 99 sounds rendered.** Asserted per sound: no NaN/Infinity, peak ≥ 0.02 (no silence), non-trivial mean absolute amplitude, **max true peak −2.30 dBFS** across the whole set (nothing above −1 dBFS), length ≥ 20ms, and bit-stable across two renders with the same seed string. All six generators exercised (`tap, modal, pluck, tone, blip, noise`). Spectral centroid measured per sound via a Goertzel sweep: **102 Hz (`@null-hotel/subfloor/bloom`) → 3,714 Hz (`@halyard/paper-route/brush-2`), a 36× spread**. Also asserted: every binding resolves to a sound that exists, churn throttle is exactly 120ms and non-churn 0, gains equal the role table, sound counts span 2…6, exactly 4 unverified packs (default deck 20 of 24), and `@quarry/keystroke` scores **Cursor 11/11 vs Claude 10/11** — the required Cursor-beats-Claude case, via `file.edit`.
3. **Real DOM, jsdom, stubbed `AudioContext` + `HTMLCanvasElement.prototype.getContext`, zero console errors and zero jsdomErrors.** Exercised: initial render (gate up, **no audio before the gesture**, including a hook hover that stays silent); the gate; auto-cue firing on deal and being defeatable; per-hook hover playback; the 100ms hover throttle suppressing a rapid five-tile sweep while the hero caption still follows the pointer; the 120ms churn role throttle suppressing a repeat on a frozen clock; the **polyphony cap** (16 voices on a frozen clock → 6 live, 11 oldest stopped); next/prev past both ends (25 forward, 30 back, wrap intact); ArrowLeft/Right, Home, End, Space, `i`, Esc; all 4 approach chips, all 3 agent chips, all 8 tag chips, all 3 trust chips (unverified in → 24, out → 20) and all 3 sorts (verified to actually reorder the top of the deck); a filter combination that empties the deck (position reads `00 / 00`, empty state shown, nav/keyboard on an empty deck does not throw); the index sheet (20 entries, jump-to-index lands on the right card, closes on jump); scrubber jump; drag left and right via pointer events; the copy-install button; the volume input. Canvas drawing confirmed live: 83k `fillRect` calls, dpr transform applied, hero canvas sized 2048px wide at `devicePixelRatio: 2`, and one sparkline canvas per hook tile.

**Not verified: anything visual.** No browser was available — Chrome MCP refuses `file://` and the sandbox lacks the libraries for headless Chromium. So layout, the actual look of the four palettes, contrast in practice, the deal/drag animations, the playhead sweep, the peek-card offsets, whether the 16-binding packs really do overflow the organ at common viewport heights, and mobile behaviour are **all unverified by inspection** — they are reasoned about, not seen. I also could not hear the audio; loudness and timbral spread are verified numerically only.
