# 05 — Session
**Slug:** 05-session   **Date:** 2026-08-08   **Parent:** none

## One line
A DAW arrangement view of one 62-second agent session: 175 hook events laid out along a
time ruler, two lanes loaded with two packs, scrub the playhead and hear what a *working
session* actually sounds like instead of what one chime sounds like.

## The seven axes

| Axis | Choice |
| --- | --- |
| **Browse metaphor** | Audio-editor arrangement. Time is the x-axis; a pack is a *layer* you load onto it. Browsing = swapping which pack occupies lane A or lane B and re-scrubbing the same moments. The pack list is demoted to a loader below the timeline. |
| **Typography** | System sans for prose, `ui-monospace` for everything that is a machine fact — canonical event names, gains, throttles, coverage counts, timecode. Nothing decorative. 9–13 px; the type is instrumentation, not voice. |
| **Density** | Moderate-to-dense in the timeline (175 markers × 2 lanes = 350 hit targets), deliberately airy in the two detail panels, medium in the chooser (6 rows/page). The timeline occupies the fold; everything else is below it. |
| **Colour** | Cool desaturated blue-grey light editor theme. Paper `#e8edf1`, panels white, ink `#16212b`. Exactly two saturated hues, and they are *identity* not decoration: lane A steel teal `#1e6f8b`, lane B muted violet `#6a5c94`. Playhead is the only warm mark on the page (`#c0392b`). Silence is `#b3c0ca`; unsupported is lighter still. |
| **Ornament** | None. Waveforms and the grid are the only non-informational marks, and both are load-bearing. No shadows over 2 px, no gradients except the 1 px second-grid, no rounded corners beyond 2 px. |
| **Motion** | Functional only: the playhead translates, markers get a 2 px halo for 140 ms as they fire, the muted lane drops to 42% opacity. No transitions on hover, no entrance animation, nothing eases. |
| **Audio interaction** | Three tiers. (1) **Transport** — play/pause/stop/scrub/loop plays the whole session through the loaded packs. (2) **Marker hover** — auditions exactly that hook, in context, with its own 100 ms throttle. (3) **Hook index hover** — sweeps every distinct binding without hunting along the axis. Gesture gate is the play button. |

## Load-bearing decisions

**The timeline is the product page, not the feed.** Every other variant answers "which packs
exist". This one answers "what will my Tuesday sound like", which is the question that decides
an install. The 24-pack list is present, filterable, sortable and paged — but it is furniture.

**Two lanes, one time axis.** The purchase decision is comparative, and comparison only works
when the *moment* is held constant. Solo A / solo B / swap ⇄ means you can flip between two
packs at the same `permission.request` in under a second. A single-lane version of this design
would be much prettier and much less useful.

**Real clock scheduling, not a `setTimeout` chain.** A `segments` list maps `AudioContext.currentTime`
onto session time (`{ctxStart, sesStart, sesEnd}`). A 25 ms interval schedules 160 ms ahead with
`src.start(absoluteTime)`; a rAF loop only *reads* the clock to move the playhead. Looping pushes
a new segment rather than resetting the anchor, so the playhead never jumps early even though the
scheduler has already crossed the loop point. Pause calls `killVoices()` — otherwise everything
already committed to the future still fires after you stopped.

**Roles are shapes, not colours.** boundary = full-height bar, cue = diamond on a stem, churn =
short tick offset into one of three sub-rows. You can read the rhythm of a session — sparse tall
marks, dense low clusters — before reading a single label. Labels print the canonical event name
on boundaries and cues only, with a collision test; churn names live in the tooltip.

**Silence is drawn.** Three marker states, visually distinct: bound (solid), **unbound** (dotted
outline, struck-through label, tooltip "binds no sound for this event"), and **won't fire on the
target agent** (pale grey, hatched row in the hook table). Pick Cursor from the target selector
and `permission.request`, `notification`, `permission.denied`, `turn.fail` and `compact.post` all
go grey across the whole session. That is the coverage matrix made audible-by-absence, which is a
thing a number in a card corner cannot do.

**Coverage counts direct native support only.** Fallback reachability is a second number
(`15+1`) and a hollow `○` cell titled with the event it re-homes to. The footer says why: count
fallbacks and every pack reads 16/16 and the number stops meaning anything. The fallback chain
re-homes the *sound*, not the *moment* — so a fallback never un-greys a marker.

**Zoom, because density is real.** 15 / 30 / 60 / 120 px/s. At 30 the grep burst is 60 px wide and
reads as a texture block; at 120 its 30 events are 8 px apart and individually hoverable. Clicking
a phase band loops that phase — the fastest possible path to "just let me hear the burst".

## What works

- Gain staging finally makes sense. Churn at 0.2 under boundaries at 1.0 is meaningless when you
  click sounds one at a time; over 68 `tool.pre` events it is obviously the whole point.
- The grep burst is the best 3 seconds on the page. With spec defaults a tactile pack fires 31 of
  62 burst events per lane and peaks at 3 voices — it reads as light rain. It is genuinely pleasant.
- Silent markers changed how the data reads. "Two Taps binds 4/16" is an abstraction; a lane that
  is visibly empty for 30 seconds is a decision.
- The hook index doubles as the coverage matrix. One 16-row table per lane carries event, role,
  sound, gain, throttle, occurrences-in-this-session, waveform, and three support cells — and every
  bound row is a hover-to-audition target. It is the densest honest thing in the library so far.
- Scrub-pauses-and-resumes, click-a-marker-to-seek, space to play, `l` to loop. It feels like a tool.

## What doesn't

- **A timeline is not a browse surface for 24 packs, and pretending otherwise would be a lie.**
  Two lanes hold two packs. Comparing 24 pairwise is 276 comparisons. The moment you need to
  answer "what's out there" you are using the list at the bottom of the page — which is a
  competent but unremarkable table, i.e. this variant quietly contains a worse version of variant
  03 as its actual discovery mechanism. The honest framing: this is the best *evaluation* surface
  in the library and among the worst *discovery* surfaces. It should probably be the pack page
  (`/@scope/name`), with a real feed in front of it.
- **The metaphor only pays off on the second pack.** Cold, with nothing loaded, the timeline is an
  intimidating grey grid of 350 dashes and you have no idea what to press. There is no cheap
  "just show me the good ones" affordance anywhere above the fold.
- **One canned session flatters packs tuned to it.** 62 seconds, 3 prompts, 1 compaction, 68
  `tool.pre`. A real two-hour session has thousands of churn events and the same handful of
  boundaries, so the *ratio* here is far kinder to jingle packs than reality is. The pitch —
  "two hours of ticks is the product" — is not actually what you audition. It should offer a few
  session archetypes (long refactor, chatty pairing, CI thrash) and it offers one.
- **Dense churn is not individually hoverable at default zoom.** 30 markers in 60 px means the
  hit targets overlap and you get whichever one the browser picks. Requiring a zoom step to
  audition a single `tool.pre` in the burst is a real failure of the "hover any marker" promise;
  the hook index is what actually keeps that promise.
- **Horizontal scroll is a tax.** Trackpad horizontal scrolling is awkward, the gutter/scrollpane
  split means two independent scroll contexts to reason about, and on a phone this design has no
  answer at all beyond stacking the detail panels. It is a desktop-only surface and the CSS admits it.
- **Preview bypasses the mix.** Hover auditions go straight to the master bus, so if you soloed
  lane A and then hover a lane B marker you hear it anyway. Defensible (auditioning isn't playback)
  and still surprising.
- **Loops are deterministic in a way reality isn't.** Wrapping resets throttle state, so every
  pass of a looped burst is identical. Nice for A/B, slightly dishonest about the runtime.
- **The "plays fully on" filter is invented.** It keeps packs with zero unreachable bindings,
  which counts fallbacks as fine — a looser standard than the coverage number right next to it.
  Two different notions of "works on Cursor" sit 200 px apart on the same row.
- The lane gutter clamps long titles to two lines, so
  `@verbose/exhaustively-descriptive-longform-pack-name` is unreadable while loaded. The full
  title survives in the detail panel and the chooser row, which is the least-bad place to lose it.

## Burned for future variants

- The A/B-on-one-timeline idea is spent. Any later variant doing side-by-side comparison will
  look like a subset of this.
- Marker-shape-encodes-role (bar / diamond / tick) and dotted-outline-means-silent are now the
  house notation for "this hook is bound / unbound".
- `direct +fallback` as two numbers with `● ○ ✕` cells — reuse this rather than reinventing it.
- Session phase bands as clickable loop regions.
- Steel-teal + muted-violet as a two-party comparison palette; a later variant needing an accent
  pair should pick different hues.
- The "grep burst ×30" as the canonical §10.3 stress case, and the fired/throttled/dropped/peak-voices
  readout as the way to show that throttling worked.

## Verification

**Checked, in Node 22 + jsdom 30 (228 assertions, 0 failures, 0 console errors/warnings):**

- `<script>` extracted and `node --check`ed clean (71 KB).
- **DSP, exhaustive:** all **90 sounds** across all 24 packs rendered. No NaN/Inf, none silent
  (min peak 0.240), none above the tanh ceiling (max peak **0.769 = −2.28 dBFS**, so nothing is
  within 1 dB of full scale). All six generators exercised across 96 sdsl events (`tap` 20,
  `noise` 19, `modal` 18, `pluck` 18, `blip` 14, `tone` 7). Timbral spread: spectral centroid p5 **145 Hz**,
  p95 **3736 Hz** — a 26× ratio.
- Every pack has 2–6 sounds, ≥4 bindings, only canonical event names, and every binding resolves
  to a real sound in its own pack.
- Structure: 175 session events covering all 16 canonical events; 350 markers; 12 phase bands;
  two 16-row hook tables; 24 packs; 4 unverified, 6 curated, 14 attested.
- Awkward cases assert green: 2-sound pack, 6-sound pack, 103-character title, ragged coverage
  (no pack reads 16/16 on all three agents), and **two** packs scoring better on Cursor than
  Claude (`@driftline/hydrophone` 9 vs 8+1, `@typeset/keystroke-grain` 10 vs 9+1).
- Gesture gate: hovering markers before any gesture creates **no AudioContext**; tooltips still
  work; pressing play arms it and hides the notice.
- Transport: play/pause/stop, position preserved across pause, scrub clamps at both ends, ruler
  drag pauses-and-resumes, phase-band click sets the loop, loop wrap pushes a bounded segment
  list, pause stops sources already scheduled into the future.
- Per-hook audition: marker hover fires exactly one voice; immediate repeat is suppressed by the
  100 ms hover throttle and fires again after it; tooltip names the canonical event and its gain;
  hook-table row hover fires one voice; the hook index exposes every distinct binding.
- Silent case: with `@minimal/two-taps` loaded, `compact.pre` markers carry `st-unbound`, hovering
  them plays nothing, the tooltip says "silent", the hook table lists all 12 unbound events, and
  the scheduler counts them as silent during playback.
- Target agent: `cursor` greys `permission.request`, hovering it plays nothing, tooltip explains
  that Cursor never fires it; switching back to `all` restores it.
- Filters/sorts/paging: unverified hidden by default and revealed by the trust toggle (UI states
  the count), all 4 approach filters, all 3 agent filters, tag filters, all 3 sorts verified
  monotone, and paging shown to reach every visible pack.
- Gain/throttle findings, measured over the burst with the clock stepped in 50 ms increments:
  tactile+jingle → **62 fired, 60 throttled, 0 dropped, peak 3 voices**; two `bed` packs →
  **31 fired, 60 throttled, 3 dropped, peak 6 voices**.
- Master chain: a `WaveShaper` running the same `tanh(x×1.25)×0.8` curve was added between the
  volume node and the destination, and asserted monotone, zero-at-zero, and topping out at 0.8.

**Do the spec's defaults hold up?** For `tactile`, `jingle` and `hybrid` packs, yes — churn at
0.2 with a 120 ms throttle turns 30 `tool.pre` in two seconds into ~15 audible ticks that sit
clearly under the boundary cues and never approach the polyphony cap. Two defaults do *not*
survive contact:

1. **Polyphony 6 is the binding constraint for `bed` packs, not gain.** A bed pack's churn sound is
   0.5–0.9 s long, so even after throttling it overlaps 5–6 deep and the runtime starts dropping
   oldest voices mid-burst. §10.3's lint warning ("churn within 6 dB of boundary") is aimed at the
   right packs but measures the wrong thing — the real predictor is churn *duration* × throttle,
   not level. A duration-aware lint would catch this; the current one won't.
2. **The per-sound limiter does not bound the output.** Each buffer is correctly ≤0.8 peak, but six
   summed voices at graph level can exceed 0 dBFS, and §13 promises −1 dBFS is a hard ceiling. The
   spec's chain is per-sound only; a bus-level limiter has to be mandatory too. Added here.

Also worth flagging upstream: the spec's fallback story reads as if fallbacks improve coverage, but
a fallback moves the sound to a *different moment*. On this timeline that is unmistakable, and it
argues for calling the second number "re-homed", not "fallback coverage".

**Not verified — no browser was available.** Chrome MCP refuses `file://` and the sandbox lacks the
libraries for headless Chromium, so I did not look at this page. Unverified, specifically:

- All visual layout. Gutter-to-lane row alignment, marker vertical packing inside the 104 px lanes,
  label collision spacing, whether the long title actually clamps cleanly, canvas crispness at
  `devicePixelRatio` 2, and whether the timeline is legible at 1280 px wide.
- Real-time playback timing. Whether 160 ms lookahead with a 25 ms interval is jitter-free on a
  busy main thread, whether the loop seam is audible, whether the 8 ms polyphony-drop release
  clicks, and whether the rAF playhead tracks the audio clock without visible drift.
- Actual sound. I asserted numeric properties of 90 buffers; I have not heard one of them. Whether
  the burst is "pleasant" is an inference from level, count and duration, not a listening result.
- Mouse-driven scrub feel, horizontal scroll behaviour, and anything touch.
