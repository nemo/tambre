# 06 — Field
**Slug:** 06-field   **Date:** 2026-08-08   **Parent:** none

## One line
The registry as a 2D map of sound-space, where every pack sits at coordinates measured from its own rendered audio, and you browse by sweeping your cursor across regions rather than by reading names.

## The seven axes

| axis | choice |
| --- | --- |
| **browse metaphor** | Scatter field / spatial map. Not a list, grid, rack, deck or timeline — a plotted plane where position *is* the index. You navigate to "dry and quiet" as a place. |
| **typography** | Mono everywhere for data and chrome (`ui-monospace`), system sans only for pack descriptions and titles. Labels are 8–10 px; the whole interface is a measuring instrument, not a magazine. |
| **density** | Sparse. 24 nodes across an 810 × 562 plot; median nearest-neighbour distance 53 px. Whitespace is the medium — it is what makes proximity mean anything. |
| **color** | Deep ink-teal field (`#04141b`) with cool bright nodes: mint `#63e6c8` (tactile/hybrid), ice `#7cc9ff` (jingle), violet `#c9a6ff` (bed), rose only for unreachable coverage. No amber, no cream, no light mode. |
| **ornament** | Only the axes, the grid, the leader lines to displaced nodes, and the waveform in the panel. No cards, no borders around content, no shadows. |
| **motion** | Nodes settle in with a 340 ms stagger (9 ms per node) on load; glyph fill transitions 160 ms on proximity. Nothing else moves — sorting deliberately does *not* animate positions. All of it off under `prefers-reduced-motion`. |
| **audio interaction** | Sweep-to-audition. Moving the cursor plays the `turn.end` of nearby packs with gain falling off as `(1 − d/150)^1.7`. Selecting a node opens a satellite ring of its bound hooks, each individually hoverable. |

## Load-bearing decisions

**1. The axes are computed, and the first version of them was wrong.**
X is a **log-spectral centroid**: the magnitude²-weighted *geometric-mean* frequency, 2048-point Hann FFT, hop 1024, band-limited 60 Hz – 14 kHz, frames weighted by their own mean square, then averaged across the pack's sounds weighted by each sound's energy. I started with the ordinary linear centroid and it was useless here: a broadband click has a near-flat spectrum, so its linear centroid pins at ~10 kHz no matter what it is resonating at. Every pack with a tick in it read "very bright" and the whole field collapsed onto the right edge (six packs clamped at x-max). Switching to the log domain re-ordered the sounds the way an ear does — taps and tones 65–235 Hz, modal/pluck 650–1400 Hz, blips 1600–2600 Hz, noise beds 2600–7500 Hz.

**2. Y is RMS-weighted duration, not energy.**
First attempt was total energy (`Σx²/sr`). It works, but it correlates hard with duration *and* with loudness, so the field became a diagonal smear: everything long was heavy and everything short was light, and the two off-diagonal quadrants were empty. The measure now is **equivalent rectangular duration** — `Σx²/sr` divided by the peak 20 ms mean square, i.e. how long the sound would last if it held its loudest 20 ms throughout. A tick lands near 20 ms whether it is loud or quiet; a bed lands near a second. That decorrelates Y from X and from gain, and it has an honest unit (seconds) printed on the axis.

**3. Sorting does not move anything.**
If position carries meaning, sort cannot be allowed to reorder space. So sort drives two things instead: the ranked panel on the right (24 rows, hoverable to preview, clickable to select), and numbered rank badges on the top eight nodes in the field. The panel says this out loud. A test asserts that switching sort leaves every coordinate byte-identical.

**4. Filters dim, they do not remove.**
Removing nodes would change the apparent density of a region and lie about the field. Filtered-out packs drop to 7 % opacity, lose `pointer-events`, leave the tab order, and stop being audible to the sweep. Four `unverified` packs start dimmed (spec §8.3); ticking the box brings them in dashed.

**5. Overlap is handled by admitting it, not hiding it.**
A deterministic relief pass pushes any pair closer than `r₁+r₂+9 px` apart along the line between them, up to 180 iterations, then clamps to the plot. A node moved more than 3.2 px keeps a **cross at its true measured position** and a dotted leader line back to it, and the detail panel prints "drawn offset". Two pairs actually collide in this data: `@ledger/tick` ↔ `@abacus/bead-tick` at 18.8 px (authored to collide) and `@static/dust-flick` ↔ `@sparklet/needle-drop` at 17.7 px (an accident I kept).

**6. The gesture gate is the ear, not a banner.**
The field draws fully at load — measured, positioned, labelled — but the node glyphs render hollow and a centred overlay says *"the field is drawn. the ear is closed."* with one button: **open the ear**. Opening it constructs the AudioContext and fills every glyph. Measurement needs no AudioContext, so nothing about the layout waits on permission.

**7. Two throttles, because continuous audition is a machine-gun risk.**
The sweep has its own 100 ms throttle *plus* a 12 px minimum-move threshold, so resting the cursor is silent. On top of that each pack has a 320 ms re-trigger guard keyed by name, so crossing a dense region plays a stream of *different* packs rather than stuttering one. At most two packs fire per tick. Hook previews use their binding's own throttle (churn 120 ms) with a 70 ms floor. Polyphony is capped at 6, oldest voice stopped and disconnected.

**8. Hooks get their own geometry.**
Selecting a node draws a dashed halo at `r+46` with one satellite per binding, ordered boundary → cue → churn. Glyph encodes role (square = boundary, large circle = cue, small circle = churn); each satellite is labelled with the canonical event name on the first line and `sound · gain` on the second, is `tabindex=0`, and plays *its own* sound on hover, focus, click or Enter. The same bindings appear as a hoverable list in the panel with throttle and per-agent gaps — so the ring is the spatial affordance and the list is the easily-swept one, and hovering either highlights the other and redraws the waveform.

**9. Installing is a sentence, not a command.**
There is no Tambre CLI and no registry server yet — the spec is v0.1 and nothing implements it — so the old `npx tambre install … --agent all` line was fiction. The panel's install block is now a visible, selectable `<pre>` holding a plain-English instruction ("Install the Tambre sound pack `@scope/name` for Claude Code. Read `INSTALL.md` and follow it.") plus a `copy` button, and every row in the hook list gets its own small `copy` that loads the single-binding variant ("…binding only `turn.end`…") into that same readout before copying it — one shared readout fed by whichever control you touch, the same trick the waveform already does. Copy tries `navigator.clipboard`, falls back to a hidden textarea and `execCommand`, and on total failure selects the visible text and prompts "press ⌘C", so the readout being on screen is the actual safety net rather than decoration. Feedback is a label swap (`copy` → `copied` / `press ⌘C`) in ice, never rose, reverting after 1.4 s and paired with an `aria-live` announcement; none of it animates.

## What works

- **The four corners genuinely mean something.** Dark-and-short is the drawer/denim corner, dark-and-long is the harbour drones, bright-and-short is emery and needles, bright-and-long is the cicada bed. 15 of 16 grid cells are occupied and nothing is clamped to an edge. You can point at a region and describe it in words before reading a single name.
- **Sweeping is genuinely a different way to browse.** Because the gain falls off with distance, moving slowly through a cluster gives you a crossfade between neighbours, and the neighbours are neighbours *because they sound alike*. That is the thing a list cannot do.
- **The satellite ring makes "a pack is many sounds" legible for the first time.** In a card grid a pack is one hover and one sound. Here `@copperworks/tine-set` visibly has eight hooks and five distinct pitched tines, and you can hear the scale by sweeping the ring.
- **Nodes are readable without a tooltip.** Shape = approach, size = installs (log), ring = trust, and every node is permanently labelled with its title; hover/focus adds installs, brightness and hook count.
- **Coverage stays honest.** Direct native support only, with fallback-only reachability as a separate bar segment and colour, and unreachable as a third. `@static/dust-flick` reads Cursor 6/6, Claude 5/6, Codex 5/6 because it binds `file.edit` with no fallback, and the panel prints `[no Claude, no Codex]` on that row.

## What doesn't

- **A pack is not a point, and the map pretends it is.** This is the deepest flaw. `@ferrywake/hull-and-gull` is a 90 Hz drone and a 3 kHz gull; its energy-weighted mean lands at 475 Hz, which is a frequency *neither sound contains*. `@feltroom/pad-touch` is two 90 Hz taps and a 1.2 kHz lift and plots at 789 Hz. `@cathedral/aeolian-shelf` reads 1605 Hz entirely because the wind carries more energy than the pipes. For single-timbre packs the position is excellent; for hybrids it is an average of things you will never hear averaged. The right fix is a cloud or hull per pack rather than a dot, and I did not do it. I put the confession in three pack descriptions instead, which is not the same as fixing it.
- **Overlap relief is a compromise that degrades with scale.** At 24 packs, four nodes move and the leader lines read fine. At 240 the relief pass would turn dense regions into a packed blob whose positions are all lies with tick marks scattered underneath. This design does not survive a real registry without zoom, or clustering into aggregate nodes that expand on approach. Neither is here.
- **Discoverability of the sweep is poor.** Nothing tells you that moving the mouse is the interaction except one line of gate copy that you will dismiss without reading. There is no visible cursor radius, no ripple, no "you are here" — I considered a faint proximity circle following the cursor and cut it as noise, which was probably the wrong call. A user who clicks straight onto a node gets a satellite ring and never discovers the field at all.
- **Does browsing by timbre actually help? Partly, and less than the metaphor claims.** It is genuinely better than tags for "something dry and quiet" — that is a region, and the region is correct. It is useless for "something that sounds like a bell rather than a bowl", because bells and bowls have near-identical brightness and duration and sit on top of each other; the axes measure two of maybe six dimensions that matter. It is also useless for the thing people actually want, which is *appropriateness to an event* — nothing about brightness tells you whether a sound is right for `permission.request`. The honest claim is narrower than "browse by ear": it is "find the acoustic neighbourhood, then read".
- **The measurement is fragile for very short sounds.** Sounds under ~2048 samples get one zero-padded analysis frame, and any broadband component in them is a seeded random noise burst — so two taps with a 4 % parameter difference measured 894 Hz and 664 Hz purely from PRNG realisation. I had to remove the `bright` term from the two tick packs to make them measure stably. The map is therefore quietly sensitive to authoring choices in a way a name-based index is not, and a publisher could game their position.
- **Mobile is not addressed.** There is no touch sweep, no pinch-zoom, and the three-column layout collapses badly under ~900 px. The `touch-action:none` on the SVG is aspirational.
- **`@sparklet/needle-drop` is nearly inaudible on laptop speakers** and its node looks identical in weight to packs you can actually hear. Neither axis measures "will you hear this at all", which for a browse surface is arguably more useful than either axis that is here.
- **The right panel does two unrelated jobs** (ranked list *or* pack detail) and switching between them is a modal jump with no animation. It works but it is the least considered part of the layout.
- **The install affordance trades one fiction for a smaller one.** `npx tambre install` was a command that does not exist; the replacement is honest about that, but "paste this sentence and let an agent fetch a URL and act on whatever it finds" is a materially different trust ask than running a shell command, and the UI presents both with the same neutral `copy` button and no comment on the difference. The fallback label now reads `press ⌘C` or `press Ctrl+C` by platform, but there is still no right-click-paste wording for anyone whose failure mode is neither.

## Burned for future variants
- Linear spectral centroid as a brightness index for percussive material. Dead end — use the log/geometric-mean centroid.
- Total energy as a Y axis. Too correlated with duration and loudness; equivalent rectangular duration is strictly better.
- "Sort reorders the layout" in any position-carries-meaning design.
- One dot per pack for multi-timbre packs. The next spatial variant should try a small point cloud, a convex hull, or a per-*sound* field where packs are polylines connecting their own sounds — that would also make the hook ring redundant in an interesting way.
- Filtering by removal in a spatial layout.

## Verification

**Checked, in Node:**
- `<script>` extracted and `node --check`ed clean.
- All **77 sounds across 24 packs** rendered. No NaN/Inf, no near-silence (min peak −24.3 dBFS), **nothing above −1 dBFS** (loudest sound −2.16 dBFS; the mandatory `tanh(x×1.25)×0.8` chain caps at −1.94 dBFS by construction). All **six generators** exercised (tap 27, noise 18, blip 14, tone 11, modal 11, pluck 4). Sound-level brightness spread **65 Hz → 7 498 Hz**.
- **Computed coordinate spread** (plot x 86–896, y 44–606; X domain 60 Hz–8 kHz log₂, Y domain 10 ms–1.78 s log₁₀):

  | | dark | | | bright |
  | --- | --- | --- | --- | --- |
  | **short** | 1 | 1 | 2 | 3 |
  | | 2 | 1 | 2 | 1 |
  | | 1 | 0 | 3 | 1 |
  | **long** | 2 | 2 | 1 | 1 |

  **15 of 16 grid cells occupied**, zero nodes clamped to an axis, median nearest-neighbour distance **53.3 px**, range 67 Hz/25 ms (`@denimlab/thigh-pat`) to 6 960 Hz/34 ms (`@grit/emery`) and 73 Hz/1.09 s (`@lowtide/undertow`) to 5 317 Hz/0.67 s (`@saltflat/cicada-bed`). The data was tuned four times against this printout: `@denimlab` was shortened and de-brightened to fill the dark/short corner, `@cathedral` rebalanced so the wind carries the energy to fill mid-bright/long, `@feltroom` and `@brasslamp` shortened, and both tick packs de-brightened so they collide as intended.

**Checked, in jsdom** (real DOM, stubbed `AudioContext` and `HTMLCanvasElement.prototype.getContext`) — **128 assertions, zero console errors or warnings**: initial render and layout (24 nodes, all inside the plot, numeric transforms, true-position ticks); gate (no context and no sound before the gesture, exactly one context after); node hover playback and the 320 ms per-pack guard; sweep proximity gain monotonic with distance and never exceeding cue gain × volume; 12 px min-move suppression; **polyphony cap held at 6 across a 400-step sweep with 100+ oldest-voice drops**; sweep throttle limiting a 200-move burst; selection building a ring of exactly N satellites, each tabbable, each labelled with its canonical event/sound/gain, **each playing its own distinct sound on hover, and on Enter**; panel hook rows playing and cross-highlighting; every filter (approach, agent-direct-support, tag, all three trust tiers, reset) including 4-of-24 hidden by default and 24 shown when `unverified` is ticked; all three sorts ordering correctly, numbering exactly 8 nodes, and **not moving any node**; ranked-row hover-preview and click-to-select; list view with all 12 required data columns, 20 rows, 20 waveform canvases and 100+ working hook buttons; keyboard tabbing between nodes auditioning each and Enter selecting; Escape deselecting; satellite label and halo bounds inside the viewBox at the four extreme nodes and the busiest node; long-title truncation on the field and full title in the panel; aria-live announcements. Awkward cases asserted present: 66-char title, a 2-sound and a 6-sound pack, `@static/dust-flick` at Cursor 6 / Claude 5 / Codex 5 with one unreachable hook, fallback chains, fallback-only reachability as a distinct state, and two packs 18.8 px apart both drawn offset.

**Not checked — stated plainly:** no browser was available. Chrome MCP refuses `file://` and the sandbox lacks the libraries for headless Chromium. **I have not looked at this page.** Everything below is unverified: the actual visual balance of the field, whether 9 px labels are legible against `#04141b`, whether node labels collide anywhere (I checked satellite labels geometrically but not the 24 node labels against each other), whether the settle animation reads as settling or as jitter, and — most importantly — **whether the sweep feels good**. Gain curve exponent, 150 px radius, 100 ms throttle, 320 ms per-pack guard and two-voices-per-tick are all reasoned numbers that have never been heard. The one thing this variant lives or dies on is the only thing I could not test.
