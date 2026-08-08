# Installing a Tambre sound pack

**If you are a human:** there is no `tambre` CLI yet. The way to install a pack
today is to paste the pack's install command (shown on its card in the
[library](https://nemo.github.io/tambre/)) into Claude Code. Claude Code reads
this file and performs the steps below itself. The rest of this document is
written for that agent, in the imperative.

**If you are the agent that just received a prompt like:**

> Install the Tambre sound pack `@scope/name` for Claude Code. Read
> `https://github.com/nemo/tambre/blob/main/INSTALL.md` and follow it.

follow the procedure below in order. If the prompt instead says
`binding only <event>`, see [§6](#6-single-binding-installs) before you start —
it changes step 3 and step 4, nothing else.

## 0. What's true right now

- **No registry exists.** There is no server, no `npm` package, no
  `@scope/name@version` you can resolve over the network.
- **No CLI exists.** `tambre install …` in the spec (`spec/tambre-spec.md` §11)
  describes a future tool. You are standing in for it by hand.
- **Pack documents live inline in this repository.** Each of the seven
  `NN-slug/index.html` variant files (`01-console-rack` … `07-pedalboard`)
  embeds its own array of packs as plain JS object literals, and its own copy
  of the `sdsl` renderer, in one `<script>` tag. **The seven variants do not
  share one catalogue** — each one invented its own pack names — so the pack
  you were asked to install exists in exactly one (occasionally more than one)
  of the seven files, and you must find it before you can do anything else.
- Everything you render and write stays **local to this machine**. Installing
  a pack means: render its bound sounds to WAV files under `~/.tambre/`, then
  add hook entries to a Claude Code `settings.json` that play them.

## 1. Locate the pack

You need the repository's contents, not just this file. If you already have
`tambre` checked out (e.g. you're running inside it), work from disk. If not,
fetch each variant's raw file from GitHub before searching — do not try to
grep a URL.

Search all seven variants for the pack name (`@scope/name`, exactly as given):

```sh
grep -rn '@scope/name' [0-9][0-9]-*/index.html
```

(substitute the real pack id for `@scope/name`, keep the quotes). If nothing
matches, the pack doesn't exist — say so plainly and stop; don't fabricate one.

If a match turns up in more than one variant, prefer the one whose surrounding
object also defines a `version` matching what was asked (if a version was
given at all — the canonical install command doesn't carry one), otherwise use
the first match and note the ambiguity in your final report.

Each variant file has **exactly one** `<script>` block, and it contains, top
to bottom: the seeded PRNG, the six generators, the renderer, that file's own
pack-array helper functions, and then the pack array itself. Nothing above the
pack array touches the DOM, which is what makes step 2 possible.

### Field names vary between variants — read them, don't assume them

All seven implement the same manifest concepts (§7.2 of the spec) but none of
them use the same JS field names, and one doesn't even use the same array
variable name. Observed so far:

| Concept | Variants and their field/spelling |
| --- | --- |
| pack array | `PACKS` in six variants; `P` in `03-ledger` |
| pack name | `name` (full `@scope/name`); or split `s` (scope) + `n` (bare name); or `n`/`s` swapped meaning per file — check an actual entry, don't guess |
| version | `version`, `v`, or `ver` |
| sounds map | `sounds`, `s`, or `snd` — each value is an `sdsl` doc, sometimes built via that file's own shorthand (`sd()`, `doc()`, `S()`, `snd()`, `ev()`, `T()`, `N()`, `eTap()`, `eNoise()`, `tap()`, `noise()` — names differ per file) |
| bindings | `bindings` (object keyed by canonical event, or an array of tuples), or `b` |
| binding sound ref | `sound` or `s` |
| binding gain | `gain` or `g` |
| binding throttle | `throttle`, `th`, or `tp`(-like) |
| binding fallback | `fallback` or `fb` |
| pack default volume | `volume` or `vol`; **absent means 1.0**, not 0 |

`01-console-rack` and `04-stack` go a step further: they don't store a literal
`sdsl` doc per bound event at all. Each pack authors **one** gesture (`p.d` /
similarly named) plus a grade table (`GRADES`), and `buildSounds()` /
`buildBindings()` (defined earlier in the same script, before the pack array)
derive the actual per-event docs, gains, and throttles by transposing that one
gesture. If the pack you found looks like this, call *that file's* derivation
functions to get the concrete `{kind:"sdsl", events:[...]}` document for the
event you need — don't hand-roll a new one, and don't skip straight to
guessing a `sounds` map that isn't there.

The one thing that **is** identical across all seven files: the PRNG
(`fnv1a`, `mulberry32`), the six generators (`gTap`, `gModal`, `gPluck`,
`gTone`, `gBlip`, `gNoise`) behind a `GENS` lookup table, and
`renderSdsl(doc, seedStr[, volume])`. That's what you reuse in step 2.

## 2. Render the pack's sounds to WAV

Do not reimplement the DSL. The renderer already inline in the variant file
you found is the reference implementation of spec §5.2 (six generators) and
§5.3 (the determinism contract) — port nothing, just run it.

1. Copy everything from the start of that file's single `<script>` tag through
   the line that closes the pack array (a line that is exactly `];` right
   after the last pack's closing `}`) into a new file, e.g. `render.js`. This
   slice is pure data and pure functions — no `document`, no DOM — in every
   one of the seven files (verified: the first real DOM call in each file
   comes after the array closes).
2. Append one line exporting what you need, e.g.:
   ```js
   module.exports = { list: typeof PACKS !== "undefined" ? PACKS : P, renderSdsl };
   ```
3. For the pack you found, and for **each binding** you're installing (all of
   them, unless this is a single-binding install — §6):
   - Resolve the sound doc for that binding (via the sounds map, or via the
     derivation functions — see §1).
   - Resolve the pack's default volume (`volume`/`vol` field, or `1.0` if
     absent).
   - Render with the **exact seed the spec requires** (§5.3): the string
     `` `${packName}@${version}/${soundName}` `` — e.g.
     `"@nima/denim@1.2.0/tap-2"` — fed through `renderSdsl(doc, seed, volume)`.
     Reusing this exact seed string is what makes the render deterministic and
     match what the browser would have played; inventing your own seed breaks
     that guarantee for no benefit.
   - The result is a `Float32Array` in `[-1, 1]`. **Bake the binding's own
     `gain` in now** by multiplying every sample by it (gains observed in this
     codebase are all ≤ 1.0, so this can only attenuate — if you ever meet a
     gain > 1.0, clamp the final samples to `[-1, 1]` rather than let the WAV
     clip). This is why the runtime never needs a volume flag at play time
     (§10.2) and why the file is named after the *event*, not the *sound*: the
     same sound bound at two different gains becomes two different WAV files.
   - Convert to 16-bit PCM (`Math.max(-32768, Math.min(32767, Math.round(x *
     32767)))` per sample) and write a standard mono 44.1 kHz WAV (RIFF/WAVE,
     `fmt ` chunk, `data` chunk — ~44 bytes of header, nothing exotic).
4. Write each file to
   `~/.tambre/packs/<scope>/<name>/<version>/<canonical-event>.wav`
   — `<scope>` and `<name>` are the pack id split apart (`@nima/denim` →
   `nima`/`denim`, no `@`), `<version>` is the pack's version string, and
   `<canonical-event>` is the canonical event name (`turn.end`,
   `tool.pre`, …), not the internal sound name. Create the directories as
   needed.

## 3. Install the player

Write this file to `~/.tambre/bin/tambre-play` and `chmod +x` it. This is the
**only** executable surface this install creates (see [§7](#7-rules-you-must-not-break)).
It satisfies spec §10.2 exactly: resolves a player in order
`afplay → paplay → aplay → ffplay → sox`, spawns it detached, discards all its
stdio, and exits 0 unconditionally — a missing player, a bad path, or a dead
audio device must never fail the hook that called it, and it must never write
to stderr (Codex and Cursor surface hook stderr to the user; be conservative
and hold Claude Code to the same bar).

```sh
#!/bin/sh
# tambre-play <wav-path> — play one file and get out of the way.
# Never blocks the caller, never prints, always exits 0.
f="$1"
if [ -n "$f" ] && [ -f "$f" ]; then
  if command -v afplay >/dev/null 2>&1; then
    ( afplay "$f" >/dev/null 2>&1 & )
  elif command -v paplay >/dev/null 2>&1; then
    ( paplay "$f" >/dev/null 2>&1 & )
  elif command -v aplay >/dev/null 2>&1; then
    ( aplay -q "$f" >/dev/null 2>&1 & )
  elif command -v ffplay >/dev/null 2>&1; then
    ( ffplay -nodisp -autoexit -loglevel quiet "$f" >/dev/null 2>&1 & )
  elif command -v sox >/dev/null 2>&1; then
    ( sox -q "$f" -d >/dev/null 2>&1 & )
  fi
fi
exit 0
```

Per-binding gain is already baked into the WAV (step 2), so the player never
takes a volume argument — that keeps it identical across all five backends,
none of which expose volume the same way.

Backgrounding happens via `( cmd & )`: the subshell exits immediately, the
child is orphaned and keeps playing, and the script's own `exit 0` runs
without waiting on it. That's the entire detachment mechanism — no `nohup`,
`disown`, or `setsid` needed, and none of those are portable across the
shells you'll find on the three platforms this targets anyway.

If you're installing on a machine with no known player at all, still write
the script — spec §10.2 requires it to exit 0 silently in that case too, and
a future player showing up on `PATH` should just start working.

## 4. Wire the hooks into Claude Code

Target `~/.claude/settings.json` for a user-wide install (use
`.claude/settings.json` in the project root instead if the user asked for a
project-local install). **Read the file first if it exists, and back it up**
(`cp settings.json settings.json.bak.$(date +%s)`) before writing — per spec
§6.5, this is what makes the reference adapter safe.

### Canonical event → Claude Code hook event

Only the events the pack actually binds matter; this is the full map (spec
§6.2, Claude Code column) so you can look up whichever ones you need:

| Canonical | Claude Code hook |
| --- | --- |
| `session.start` | `SessionStart` |
| `session.end` | `SessionEnd` |
| `prompt.submit` | `UserPromptSubmit` |
| `turn.end` | `Stop` |
| `turn.fail` | `StopFailure` |
| `tool.pre` | `PreToolUse` |
| `tool.post` | `PostToolUse` |
| `tool.fail` | `PostToolUseFailure` |
| `permission.request` | `PermissionRequest` |
| `permission.denied` | `PermissionDenied` |
| `notification` | `Notification` |
| `subagent.start` | `SubagentStart` |
| `subagent.end` | `SubagentStop` |
| `compact.pre` | `PreCompact` |
| `compact.post` | `PostCompact` |
| `file.edit` | *(no Claude Code equivalent — skip this binding entirely)* |

`StopFailure`, `PermissionDenied`, `SubagentStart`, and `PostCompact` are
flagged in the spec as less rigorously verified than the rest. Wire them
anyway — if Claude Code doesn't actually fire one, the entry is simply inert
(all three agents ignore hook names they don't recognise), never harmful.

If a pack binds a canonical event with no Claude Code mapping (`file.edit`)
and declares a `fallback` chain, walk the chain and bind the first event in it
that *does* have a mapping instead. If there's no fallback either, skip that
one binding and mention the drop in your final report.

### Shape

```json
{
  "hooks": {
    "<ClaudeCodeEvent>": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "TAMBRE_HOOK=1 /Users/you/.tambre/bin/tambre-play /Users/you/.tambre/packs/<scope>/<name>/<version>/<canonical-event>.wav" }
        ]
      }
    ]
  }
}
```

- Use `matcher: "*"` for the tool events (`PreToolUse`, `PostToolUse`,
  `PostToolUseFailure`) so it fires for every tool. Omit `matcher` entirely
  for events that aren't tool-shaped (`Stop`, `SessionStart`, …) — Claude Code
  doesn't expect one there.
- **Resolve `$HOME` to an absolute path** in the command string (e.g.
  `/Users/nima/.tambre/...`) rather than leaving a literal `~` — don't assume
  the hook's shell expands it.
- Prefix every command you write with `TAMBRE_HOOK=1`. This is the ownership
  marker from spec §6.4: it's how a future real `tambre uninstall` (or you,
  doing this by hand later) finds and removes exactly the entries this
  install created, and nothing the user wrote themselves.

### Merge, don't clobber

`settings.json` may already have a `hooks` object with the user's own entries,
possibly for the same event. **Append to the array at `hooks[<Event>]`; never
replace the array or the top-level `hooks` object.** If `hooks` or
`hooks[<Event>]` doesn't exist yet, create it. If you find an entry whose
`command` is byte-identical to one you're about to add (a re-install), skip
adding the duplicate rather than doubling the sound.

### Gain and throttle you didn't already bake in

Gain is baked into the WAV (step 2) — nothing to do here. Throttle
(`bindings[event].throttle`, spec §10.3) is a *runtime* rate-limit with no
static-hook equivalent, so there's nothing to encode in `settings.json` for
it either; the practical effect of skipping it is that a `churn`-role event
firing faster than its throttle will just play every time instead of being
rate-limited. That's a real, known gap of doing this by hand instead of
through the real CLI — say so in your report, don't paper over it.

If a binding has no explicit `gain`, use the role default from spec §10.3
before baking it into the WAV: `boundary` → 1.0, `cue` → 0.9, `churn` → 0.2.
(`role` is usually implicit from the canonical event per the table in spec
§6.1 — `turn.end` and `permission.request` are the two `primary cue`/`cue`
events, most `tool.*`/`subagent.*` events are `churn`, the rest are
`boundary`.)

## 5. Verify

1. Run the player directly on one rendered file and confirm you hear it and
   it exits clean:
   ```sh
   ~/.tambre/bin/tambre-play ~/.tambre/packs/<scope>/<name>/<version>/turn.end.wav
   echo $?   # must print 0
   ```
2. Validate the edited `settings.json` actually parses (`json.tool`, `jq .`,
   or just re-`Read` it) before telling the user you're done — a syntax error
   here breaks every hook, not just this pack's.
3. If you can, finish a real turn and confirm the `Stop`-bound sound plays.
   If not (headless environment, no way to trigger a real turn), say
   explicitly that this step is unverified rather than assuming it works.

## 6. Single-binding installs

If the request was:

> Install the Tambre sound pack `@scope/name` for Claude Code, binding only
> `turn.end`. Read … and follow it.

do steps 1–5 exactly as above, except in step 2/4 only render and wire the one
named canonical event — ignore every other binding the pack declares. If the
pack itself doesn't bind that event directly, follow its `fallback` chain (if
any) for *that* event the way you would in step 4; if there's no binding and
no reachable fallback for the requested event, say so and stop — don't
substitute a different event the user didn't ask for.

## 7. Rules you must not break

- **I1 — packages contain no executable code, ever.** Everything you read out
  of a pack's `sounds`/`bindings` data is numbers and strings feeding pure
  generator functions (`gTap`, `gModal`, …). Never `eval` a pack field, never
  treat a pack string as a shell fragment, never let pack data influence the
  contents of `tambre-play` itself. The player script you wrote in step 3 is
  the *only* executable this install produces — that is what makes a
  malicious pack's worst case "an unpleasant noise" instead of something
  worse.
- **I4 — hooks never block the agent.** The command you write to
  `settings.json` must return in milliseconds: spawn-and-exit, never a
  foreground play, never a network call, never anything that can hang waiting
  on an audio device. If you're ever tempted to add a flag or a wrapper "just
  this once" to `tambre-play`, re-read spec §10.2 first — the whole script is
  built around never letting a bad day on the user's audio stack cost them a
  tool call.

## Uninstalling

1. In `~/.claude/settings.json` (and the project one, if used), remove every
   hook entry whose `command` contains both `TAMBRE_HOOK=1` and the pack's
   path (`packs/<scope>/<name>/`). Leave every other entry untouched.
2. `rm -rf ~/.tambre/packs/<scope>/<name>/<version>` (or the whole
   `<name>` directory to remove every version).
3. Leave `~/.tambre/bin/tambre-play` in place if any other pack still points
   at it — check for other `TAMBRE_HOOK=1` entries first.
