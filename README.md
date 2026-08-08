# Tambre

An open registry for **AI agent sound packs** — plus a library of seven
interaction-design treatments of the same marketplace.

**Live library:** https://nemo.github.io/tambre/

---

## What Tambre is

A package registry for sound packs that bind to **AI coding agent lifecycle
events**. Publish a pack once; it works on Claude Code, Codex CLI, and Cursor.

Three pieces:

1. **A sound DSL** (`sdsl/1`) — JSON describing how to synthesise a sound from
   six physical-modelling primitives. Kilobytes, not megabytes, and
   deterministic: the same document renders to bit-identical audio everywhere.
2. **A canonical event taxonomy + adapter layer** — agent-neutral event names
   (`turn.end`, `tool.pre`, `permission.request`) and per-agent adapters that
   translate them into that agent's native hook config.
3. **A registry** — versioned, immutable packages under publisher scopes,
   browsable like Pinterest, installable like npm. Identity is a keypair, so an
   agent can claim a scope and publish with no human account and no browser.

Full specification: [`spec/tambre-spec.md`](spec/tambre-spec.md)
([rendered](https://nemo.github.io/tambre/spec/)).

## Installing a pack

There is no CLI and no registry server yet, so installing a pack today is
agent-driven rather than a shell command: copy the install line off any pack
in the library and paste it into Claude Code. The agent reads
[`INSTALL.md`](INSTALL.md), finds the pack's data inline in whichever variant
defined it, renders its sounds, and wires up the hooks itself.

```
Install the Tambre sound pack @scope/name for Claude Code. Read https://github.com/nemo/tambre/blob/main/INSTALL.md and follow it.
```

Substitute the pack's actual `@scope/name` — each variant shows it on the
pack's own card. The [library index](index.html) also has a copy button for
the generic form. See [`INSTALL.md`](INSTALL.md) for what actually happens
when an agent follows it, including what a hand-driven install can't do yet
(e.g. throttle enforcement).

## Why the seven variants

The registry's hard problem is not storage or auth — it is **auditioning**. A
pack is not one sound; it is a *set* of bindings across sixteen lifecycle hooks,
with per-role gain and throttle, and ragged support across three agents. Until
you can see which hooks a pack covers and hear each one individually, the
marketplace is unshoppable.

So the browse surface was explored seven times, each committing hard to a
different interaction paradigm:

| | Variant | Browse metaphor |
| --- | --- | --- |
| 01 | [Console](01-console-rack/) | Studio mixing desk — one channel strip per pack, expandable patch bay of hooks |
| 02 | [Broadsheet](02-broadsheet/) | Printed catalogue page — numbered entries in running columns, footnoted hook index |
| 03 | [Ledger](03-ledger/) | Ruled account book — 17 sortable columns, a 16×3 support matrix per row |
| 04 | [Stack](04-stack/) | Deck of cards — one pack per viewport, approach colours the screen |
| 05 | [Session](05-session/) | DAW arrangement — a 62-second agent session you scrub, two packs per lane |
| 06 | [Field](06-field/) | Spatial map — packs plotted by measured brightness and weight, browsed by sweeping |
| 07 | [Pedalboard](07-pedalboard/) | Wall of stompboxes — footswitches *are* the bound hooks |

Each variant is a **single self-contained HTML file** with no build step and no
dependencies. Each synthesises all its audio in-browser from `sdsl` documents —
six generators (`tap`, `modal`, `pluck`, `tone`, `blip`, `noise`), an RBJ
cookbook band-pass, a seeded PRNG, and a mandatory limiter. There are no audio
files in this repository.

Each variant folder also contains a `direction.md` recording the seven axes it
diverged on, the decisions someone could disagree with, and — most usefully —
an unsparing account of what does not work.

## Repository layout

```
index.html              the library
assets/site.css         neutral chrome for the library and notes pages
spec/tambre-spec.md     implementation spec v0.1
spec/index.html         rendered spec
NN-slug/index.html      a variant, self-contained
NN-slug/direction.md    its design notes
NN-slug/notes.html      those notes, rendered
variants.json           extracted metadata driving the library page
```

## Running it

Open `index.html` in a browser, or serve the directory:

```sh
python3 -m http.server 8000
# then http://localhost:8000/
```

Any variant also opens directly as a file — nothing requires a server.

## GitHub Pages

Pages serves from the repository root on `main`. Enable it under
**Settings → Pages → Source: Deploy from a branch → main / (root)**. The
`.nojekyll` file is required so Jekyll doesn't skip paths beginning with
underscores.

## Findings worth keeping

Building seven implementations surfaced three problems in the spec itself:

- **The per-sound limiter does not bound the output.** §5.3's chain is applied
  per sound, but six voices at the polyphony cap sum well past 0 dBFS. A
  bus-level soft-clip is also required. Loudness is a safety property here —
  people browse in headphones.
- **§10.3's lint measures the wrong quantity.** It compares churn and boundary
  *levels*, but what predicts whether a pack is pleasant under load is
  **duration × throttle**. Long-tailed `bed` packs pass the level check and
  still exhaust polyphony during a burst of tool events.
- **Coverage must count direct native support only.** Counting fallback-resolved
  events makes every pack read 16/16 on every agent, and the number stops
  carrying information. Fallback reachability belongs in a secondary state.

Two interaction findings generalised across every variant:

- **Hover preview needs its own throttle**, separate from the spec's role
  throttle. `turn.end` is role `cue` → throttle 0, which is right for a live
  agent and miserable when browsing: one mouse sweep down a dense list fires a
  sound per item.
- **Derive a pack's sounds from one authored gesture** at graded pitch and
  length, the way `denim`'s `tap-1` and `tap-2` differ only in pitch. Sweeping a
  pack's hooks then plays as a phrase rather than a pile of unrelated noises.

## Status

`spec/tambre-spec.md` is v0.1 and unimplemented — there is no CLI, no registry
server, and no published pack. This repository is the specification and a
design exploration of its browse surface.

The npm namespace **`@tambre`** is claimed, and [`cli/`](cli/) holds a
placeholder `@tambre/cli` that reports project status and installs nothing.
Bare `tambre` is not obtainable — npm blocks it as too similar to the existing
package `table` — so the CLI is scoped, though its `bin` is still named
`tambre`. See §0 of the spec for the details.

What the install line does (see [Installing a pack](#installing-a-pack)): the
agent renders the pack's `sdsl` sounds to WAV with the same renderer the
browser uses and adds hook entries to your `~/.claude/settings.json`. The
procedure in [`INSTALL.md`](INSTALL.md) is written against the spec and the
variants' own renderer, but **it has not been run end to end** — treat the
first install as the test. What it does not give you regardless: a registry to
resolve `@scope/name` over the network, Codex or Cursor adapters, per-binding
throttle enforcement, or an uninstall command — those still require the CLI in
§11 of the spec.

The variants were verified programmatically: audio renders without silence, NaN,
or peaks above −1 dBFS; all six generators are exercised; per-hook hover
auditioning fires the correct sound; no audio starts before the gesture gate;
zero console errors under jsdom. **None was opened in a browser during
construction** — visual layout, colour, motion, and texture are unverified.

## Licence

MIT — see [`LICENSE`](LICENSE).
