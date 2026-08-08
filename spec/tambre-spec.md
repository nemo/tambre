# Tambre — an open registry for AI agent sound packs

**Status:** implementation spec, v0.1
**Audience:** the coding agent building this
**Date:** 2026-08-08

---

## 0. Naming

`Tambre` is the placeholder — the film craft of performing everyday sound effects
in sync with picture, which is exactly what this does for an agent. It's short,
available-ish as a concept, and reads well as a verb (`tambre install`,
`tambre.dev`). Swap it if you have something better; the string appears in the
CLI name, the manifest `spec` URL, and the env var prefix, and nowhere else that
matters. Alternatives considered: Timbre, Chime, Hookfire, Audible.

---

## 1. What this is

A package registry for **sound packs that bind to AI coding agent lifecycle
events**. Publish a pack once; it works on Claude Code, Codex CLI, and Cursor.

Three pieces:

1. **A sound DSL** (`sdsl/1`) — a JSON description of how to synthesise a sound
   from physical-modelling primitives. Kilobytes, not megabytes. Deterministic:
   the same document renders to bit-identical audio on every implementation.
2. **A canonical event taxonomy + adapter layer** — agent-neutral event names
   (`turn.end`, `tool.pre`, `permission.request`) and per-agent adapters that
   translate them into that agent's native hook config.
3. **A registry** — versioned, immutable packages under publisher scopes,
   browsable like Pinterest, installable like npm.

A working reference implementation of the DSL and its renderer already exists
(30 packs, 381 sounds, dual Python/JS engines verified sample-identical to 7e-9).
Port it; don't redesign it.

---

## 2. Non-negotiable invariants

These are the properties that make the thing safe and cheap. Violating any of
them is a redesign, not a tweak.

**I1. Packages contain no executable code. Ever.**
A package is JSON plus optionally WAV files. The registry never distributes
anything that runs. This matters more here than for a normal registry, because
installing a pack writes entries into an agent's hook config — and hook configs
*do* execute. The executable surface is exactly two things, both shipped by us,
both audited once: the `tambre` CLI and the `tambre-play` player script. A
malicious pack's worst case is an unpleasant noise.

**I2. Rendering is deterministic and offline.**
`sdsl` documents render identically in the browser (audition), in the CLI
(install), and on the server (preview waveforms). Same seeded PRNG, same filter
coefficients, same envelopes. No "the preview sounded different" bugs, and no
server round-trip to hear something.

**I3. Published versions are immutable.**
`@scope/name@1.2.0` resolves to one artifact digest forever. Yank/deprecate
flags exist; overwrite does not.

**I4. Hooks never block the agent.**
The player detaches, discards stdio, and exits 0 immediately. A missing audio
device, a corrupt WAV, or a full disk must never fail a tool call or add
latency. Cursor is fail-open by default but Codex hooks default to a 600 s
timeout — a hanging player would be catastrophic there.

**I5. The registry is not a Git repo.**
You were right to doubt it. Git storage means: no atomic publish, unbounded repo
growth from binary WAVs, clone times that degrade forever, no per-version
integrity without extra machinery, and a hard ceiling on write throughput. Git
*is* used — for the spec, schemas, adapters, and CLI source, and for a
periodically-exported append-only index snapshot that makes the registry
reconstructible if the company disappears. It is not the storage layer.

---

## 3. Stack

Per your call: **Next.js on Vercel + Cloudflare R2.**

| Concern | Choice | Notes |
| --- | --- | --- |
| Web + API | Next.js (App Router) on Vercel | Browse UI and registry API in one deploy |
| Metadata DB | Neon Postgres | Serverless driver over HTTP; connection pooling is otherwise painful on Vercel |
| Blob storage | Cloudflare R2 | Zero egress. Tarballs, WAV assets, previews, peaks |
| CDN for artifacts | R2 public bucket + Cloudflare cache | Artifacts are immutable → `Cache-Control: public, max-age=31536000, immutable` |
| Registry JSON cache | Vercel Edge Cache + `stale-while-revalidate` | Packuments are hot and change rarely |
| Search | Postgres FTS (`tsvector`) for v1 | Fewer moving parts than a search service; revisit past ~50k packages |
| Publish endpoint | Node runtime, not Edge | Needs `node:crypto` verify, gzip, and tar parsing |
| Queue | Vercel Cron + a `jobs` table | Preview rendering, peak generation, index export. Don't add a broker yet |

R2 credentials via S3-compatible API (`@aws-sdk/client-s3` against the R2
endpoint). Two buckets: `tambre-artifacts` (public, immutable) and `tambre-staging`
(private, publish scratch + quarantine).

---

## 4. Concepts

| Term | Meaning |
| --- | --- |
| **Scope** | A publisher namespace, `@handle`. Owned by a keypair. |
| **Package** | A named collection under a scope: `@nima/denim`. |
| **Version** | An immutable semver release of a package. |
| **Sound** | One named audible event within a pack. Either `sdsl` or `audio`. |
| **Binding** | A mapping from a canonical event to a sound, with gain/throttle. |
| **Canonical event** | Agent-neutral lifecycle event name, e.g. `tool.pre`. |
| **Adapter** | Translates bindings into one agent's native hook config. |
| **Profile** | A user's installed selection: pack + agent + overrides. |

A publisher can have many packages — that's how collections work. No separate
"collection" primitive in v1.

---

## 5. The sound DSL (`sdsl/1`)

### 5.1 Shape

A sound is a list of time-offset events. Each event names a generator, a gain,
and generator parameters.

```json
{
  "kind": "sdsl",
  "events": [
    { "t": 0.0,  "g": "tap",   "gain": 0.8,
      "p": { "f": 380, "q": 3.2, "dec": 0.042, "thump": 0.38,
             "thumpf": 72, "thumpdec": 0.065, "bright": 0.10, "dur": 0.24 } },
    { "t": 0.09, "g": "tap",   "gain": 1.0,
      "p": { "f": 494, "q": 3.2, "dec": 0.042, "thump": 0.38,
             "thumpf": 78, "thumpdec": 0.065, "bright": 0.10, "dur": 0.24 } }
  ]
}
```

### 5.2 Generators

Six, and they cover a genuinely wide timbral range (measured spectral centroids
from 91 Hz to 5 kHz across the reference packs).

| `g` | Models | Required params |
| --- | --- | --- |
| `tap` | Fingers on denim, knuckles on wood, palm | `f`, `dec`, `dur`; opt `q`, `thump`, `thumpf`, `thumpdec`, `bright` |
| `modal` | Bars, bells, bowls, coins, tines | `f0`, `partials[[ratio,amp,decayMul]]`, `dec`, `dur`; opt `hit` |
| `pluck` | Karplus-Strong string | `f0`, `dur`; opt `damp`, `bright` |
| `tone` | Additive sustain — drones, harmonic beds | `f0`, `dur`, `partials[[ratio,amp]]`; opt `atk`, `rel`, `vib`, `vibrate`, `drift` |
| `blip` | Swept oscillator — arcade, water drops, morse | `f0`, `f1`, `dur`, `wave`(sine\|square\|tri\|saw); opt `dec` |
| `noise` | Band-passed noise — paper, breath, shakers | `lo`, `hi`, `dur`; opt `atk`, `dec`, `curve` |

### 5.3 Determinism contract

This is the part implementations get wrong. Specify it as a conformance test,
not prose.

- Sample rate **44100**, mono, float internally, 16-bit PCM on output.
- PRNG is **mulberry32**, seeded with **FNV-1a 32** over the string
  `"<packageName>@<version>/<soundName>"`. One PRNG instance per rendered sound,
  drawn in event order.
- Band-pass is the **RBJ cookbook biquad**, constant peak gain, coefficients
  normalised by `a0`.
- Master chain, in order: `× 0.9 × volume` → `tanh(x × 1.25) × 0.8` → trim
  trailing samples below `1.26e-4` → 4 ms linear fade-out.
- Ship a **conformance fixture**: 20 reference sounds with SHA-256 of their
  16-bit PCM output. Any renderer claiming `sdsl/1` must match. This is how you
  keep the browser, the CLI, and any future Rust/Go port honest.

### 5.4 Audio payloads

```json
{ "kind": "audio", "file": "sounds/stop.wav", "sha256": "…", "peakDb": -6.2 }
```

Constraints, enforced at publish:

- WAV (PCM 16/24-bit) or FLAC. No MP3 uploads — lossy in, lossy out.
- ≤ 4 s and ≤ 2 MB per sound; ≤ 25 MB per package version.
- Mono or stereo, 44.1 or 48 kHz.
- Must decode cleanly with `ffprobe`; reject anything with trailing garbage.
- Server transcodes a **48 kbps Opus** preview for browse; the original ships in
  the tarball for install.
- Loudness-normalise previews to **-23 LUFS** for consistent browsing. Do not
  normalise the shipped asset — publishers get to decide how loud their own pack
  is, and the runtime applies user volume anyway.

Mixed packs are fine: a pack may use `sdsl` for tool ticks and `audio` for a
recorded chime.

---

## 6. Canonical events and the adapter layer

### 6.1 Canonical event set

Deliberately small. Every name maps to something at least two of the three
target agents actually fire.

| Canonical | Meaning | Typical role |
| --- | --- | --- |
| `session.start` | Session begins, resumes, or is cleared | boundary |
| `session.end` | Session terminates | boundary |
| `prompt.submit` | User submitted a prompt | boundary |
| `turn.end` | Agent finished its turn | **primary cue** |
| `turn.fail` | Turn ended in failure | boundary |
| `tool.pre` | Before a tool runs | churn |
| `tool.post` | Tool succeeded | churn |
| `tool.fail` | Tool errored, timed out, or was denied | churn |
| `permission.request` | Agent is waiting on human approval | **primary cue** |
| `permission.denied` | A call was blocked | churn |
| `notification` | Agent raised a notification | cue |
| `subagent.start` | Subagent spawned | churn |
| `subagent.end` | Subagent finished | churn |
| `compact.pre` | About to compact context | boundary |
| `compact.post` | Compaction finished | boundary |
| `file.edit` | Agent edited a file | churn |

`role` is not decorative — the runtime uses it for default gain staging and
throttle policy (§10.3).

### 6.2 Support matrix

Grounded in the current docs and source for each agent as of 2026-08-08. Encode
this as **data** (`adapters/*/support.json`), serve it from
`GET /api/v1/events`, and let CLIs refresh it — do not hardcode it in three
places.

| Canonical | Claude Code | Codex CLI | Cursor |
| --- | --- | --- | --- |
| `session.start` | `SessionStart` | `SessionStart` | `sessionStart` ¹ |
| `session.end` | `SessionEnd` | `SessionEnd` ² | `sessionEnd` ¹ |
| `prompt.submit` | `UserPromptSubmit` | `UserPromptSubmit` | `beforeSubmitPrompt` |
| `turn.end` | `Stop` | `Stop` | `stop` |
| `turn.fail` | `StopFailure` ³ | — (fold into `Stop`) | — |
| `tool.pre` | `PreToolUse` | `PreToolUse` | `preToolUse` |
| `tool.post` | `PostToolUse` | `PostToolUse` | `postToolUse` |
| `tool.fail` | `PostToolUseFailure` ³ | `PostToolUse` (non-zero exit) | `postToolUseFailure` |
| `permission.request` | `PermissionRequest` | `PermissionRequest` | **unsupported** |
| `permission.denied` | `PermissionDenied` ³ | — | — |
| `notification` | `Notification` | — | — |
| `subagent.start` | `SubagentStart` ³ | `SubagentStart` | `subagentStart` |
| `subagent.end` | `SubagentStop` | `SubagentStop` | `subagentStop` |
| `compact.pre` | `PreCompact` | `PreCompact` | `preCompact` |
| `compact.post` | `PostCompact` ³ | `PostCompact` | — |
| `file.edit` | — | — | `afterFileEdit` |

¹ Not available to Cursor **cloud** agents (no home dir on the VM).
² Codex `SessionEnd` timeout defaults to **1 s, capped at 3 s** — the player
must already be detached by then. It also never fires for subagents.
³ Verified less rigorously than the rest; these came partly from secondary
sources during research. **Confirm against Claude Code's own docs before
shipping**, and treat unrecognised keys as harmless (all three agents ignore
hook names they don't know).

### 6.3 Binding fallback

Because coverage is ragged, every binding may declare a fallback chain. The
adapter walks it and uses the first canonical event the target agent supports.

```json
"bindings": {
  "permission.request": {
    "sound": "chime-rising",
    "gain": 1.0,
    "fallback": ["notification", "turn.end"]
  }
}
```

The registry computes and displays per-agent coverage from
`bindings × support.json` — the browse UI shows `Claude 16/16 · Codex 13/16 ·
Cursor 12/16` on every card. Publishers get this for free; they never declare
agent support by hand.

### 6.4 Adapter contract

```ts
interface Adapter {
  id: 'claude-code' | 'codex' | 'cursor';
  displayName: string;
  supports: Record<CanonicalEvent, NativeEventSpec | null>;

  /** Where config lives for a given scope. */
  configPaths(scope: 'user' | 'project'): { path: string; format: 'json' | 'toml' };

  /** Pure function: bindings -> a patch to merge into native config. */
  plan(input: {
    pack: Manifest;
    soundDir: string;      // absolute
    playerPath: string;    // absolute
    scope: 'user' | 'project';
  }): ConfigPatch;

  /** Merge a patch without clobbering the user's own hooks. */
  apply(patch: ConfigPatch, existing: unknown): unknown;

  /** Remove only entries this tool created. Must be exact. */
  revert(existing: unknown): unknown;

  /** Human-readable steps we cannot perform programmatically. */
  postInstallNotes(patch: ConfigPatch): string[];
}
```

Ownership marker: every command string this tool writes contains the literal
`TAMBRE_HOOK=1` as an env prefix. `revert` removes exactly the entries carrying
it and nothing else. This is the single mechanism that makes uninstall safe, and
it is already proven in the reference implementation.

### 6.5 Per-adapter notes the implementer must handle

**Claude Code** — `~/.claude/settings.json`, `.claude/settings.json`,
`.claude/settings.local.json`. Shape:
`hooks: { <Event>: [ { matcher?, hooks: [{ type: "command", command }] } ] }`.
Back the file up before writing. Straightforward; this is the reference adapter.

**Codex CLI** — `~/.codex/hooks.json` or an inline `[hooks]` table in
`~/.codex/config.toml`; project-level `.codex/hooks.json` also works. Two traps:

- **Hook trust.** Non-managed command hooks are hashed and *skipped until a
  human reviews and trusts them* via `/hooks` in the CLI. Editing a hook
  invalidates trust. So `tambre install --agent codex` **cannot** be fully
  automatic. The adapter must write the config and then print an explicit
  "now run `/hooks` in Codex and trust these entries" instruction, and
  `tambre doctor` must be able to detect the untrusted state. Do not paper over
  this; a silent no-op install is the worst possible outcome.
- **`notify` is a usable fallback.** The legacy `notify = ["cmd", "args"]`
  top-level key needs no trust review and fires on `agent-turn-complete` only.
  It receives its JSON as an **appended argv token**, not stdin. Offer it as
  `--minimal` for users who just want a turn-end sound with zero ceremony. Note
  it is ignored in project-local config and must be set at user level.

**Cursor** — `~/.cursor/hooks.json` or `<project>/.cursor/hooks.json`. Traps:

- Relative `command` paths resolve against **`~/.cursor/`** for user hooks but
  the **project root** for project hooks. Always write absolute paths and sidestep
  this entirely.
- Hooks are **fail-open** by default; keep `failClosed` unset.
- Cursor can also read `.claude/settings.json` hooks when third-party configs are
  enabled. If a user has both Claude and Cursor adapters installed, they may get
  **double sounds**. `tambre doctor` must detect this overlap and offer to
  disable one.
- `permission.request` has no Cursor equivalent — the fallback chain earns its
  keep here.

---

## 7. Package format

### 7.1 Tarball

`.tgz`, gzip, deterministic ordering, no symlinks, no absolute paths, no dotfiles
outside `sounds/`. Max 25 MB.

```
tambre.json            # manifest, required
README.md             # optional, rendered on the package page
LICENSE               # optional
sounds/*.wav          # only for audio-kind sounds
```

Reject at publish: any path traversal, any entry type other than file, any file
not referenced by the manifest, total uncompressed size > 60 MB (zip-bomb guard).

### 7.2 Manifest (`tambre.json`)

```json
{
  "spec": "tambre/1",
  "name": "@nima/denim",
  "version": "1.2.0",
  "title": "Denim",
  "description": "One fingertip on denim over a thigh. Counts and weights carry the meaning instead of pitch.",
  "license": "CC0-1.0",
  "homepage": "https://github.com/nima/tambre-denim",
  "tags": ["tactile", "dry", "quiet", "non-pitched"],
  "approach": "tactile",
  "engine": { "sdsl": "^1.0.0" },
  "defaults": { "volume": 0.8, "polyphony": 6 },

  "sounds": {
    "tap-1": { "kind": "sdsl", "events": [ … ] },
    "tap-2": { "kind": "sdsl", "events": [ … ] },
    "thud":  { "kind": "audio", "file": "sounds/thud.wav", "sha256": "…" }
  },

  "bindings": {
    "turn.end":           { "sound": "tap-2", "gain": 1.00 },
    "permission.request": { "sound": "tap-2", "gain": 1.00, "fallback": ["notification"] },
    "tool.pre":           { "sound": "tap-1", "gain": 0.20, "throttle": 120 },
    "tool.post":          { "sound": "tap-1", "gain": 0.16, "throttle": 120 },
    "tool.fail":          { "sound": "thud",  "gain": 0.55 }
  }
}
```

Field rules:

- `name` — `@scope/name`, both `[a-z0-9][a-z0-9-]{1,38}`. Lowercase only.
- `version` — strict semver. No ranges, no build metadata in the published tag.
- `approach` — `tactile | jingle | bed | hybrid`. Drives browse facets.
- `license` — SPDX identifier. Required. Default the CLI scaffold to `CC0-1.0`.
- `bindings[event].throttle` — minimum ms between plays of this binding.
- Unknown top-level keys are **rejected**, not ignored. Cheap forward-compat
  discipline while the spec is young.

Publish the JSON Schema at `https://tambre.dev/schema/tambre-1.json` and validate
both client-side (CLI, pre-flight) and server-side (authoritative).

---

## 8. Identity and auth — agent-only

You asked for an auth system agents can use without a human in the loop. That
rules out OAuth. The design below is keypair-first: **an agent can claim a scope
and publish with no human account, no email, and no browser.**

### 8.1 Model

- Publisher identity **is** an Ed25519 keypair. The agent generates it locally
  (`tambre key new`), stores the private key at `~/.tambre/keys/<fingerprint>.jwk`
  with `0600`, and never transmits it.
- A **scope** is claimed by the first key to successfully register it. The scope
  record stores the public key and a fingerprint (`base32(sha256(pubkey))[..16]`).
- Every mutating request carries a detached signature over a canonical
  request digest.

### 8.2 Publish request signing

```
digest = SHA256(
  "tambre-publish/1\n" +
  name + "\n" + version + "\n" +
  hex(sha256(tarball)) + "\n" +
  issuedAt_iso8601 + "\n" +
  nonce
)
signature = Ed25519-Sign(privateKey, digest)
```

Sent as headers: `X-Tambre-Key`, `X-Tambre-Sig`, `X-Tambre-Issued-At`,
`X-Tambre-Nonce`. Server rejects `issuedAt` skew > 300 s and replays a nonce it
has seen in the last hour (store nonces in Postgres with a TTL index; this is
low volume).

### 8.3 Scope claiming and spam resistance

With no human identity there is no free spam gate, so buy it with compute and
throttles:

1. **Proof of work on scope claim.** `POST /api/v1/scopes/challenge` returns a
   random challenge and a difficulty. Client finds `nonce` such that
   `sha256(challenge || pubkey || nonce)` has N leading zero bits. Tune N to
   ~20–40 s of single-core work. Negligible for a real publisher, brutal for
   someone claiming 10,000 scopes. Difficulty is a server-side config value —
   raise it under attack.
2. **Rate limits.** Per key: 10 versions/hour, 50/day. Per IP: 3 scope claims/day.
   Per scope: 1 new package/hour for the first week of the scope's life.
3. **Trust tiers**, stored on the scope:
   - `unverified` (default) — reachable by direct link and by search with an
     explicit toggle; excluded from the default browse feed and from any
     "featured"/"popular" surface.
   - `attested` — the key holder proved control of a GitHub account or a domain
     by publishing the fingerprint in a gist or a DNS TXT record. Fully
     automatable by an agent, still no OAuth. Promotes into the default feed.
   - `curated` — a maintainer marked it. Eligible for the homepage.
4. **Content is inert** (I1), so the blast radius of spam is a bad browse
   experience, not a security incident. Bias toward openness.

### 8.4 Key rotation and loss

- `POST /api/v1/scopes/:scope/rotate` — body signed by the **current** key,
  contains the new public key. Old key is retired, kept in an audit table.
- **Key loss without attestation is unrecoverable.** State this in the CLI at
  key-creation time in plain language. Offer `tambre key backup` which writes an
  encrypted export and tells the agent to persist it somewhere durable.
- Attested scopes *can* recover by re-proving the GitHub/DNS control. This is
  the strongest practical argument for attestation and the CLI should say so.

### 8.5 Human surface

The website is **read-only**. There is no sign-up, no login, no dashboard. A
human who wants to publish runs the CLI (or asks their agent to). This removes an
entire category of work — sessions, password reset, email deliverability, account
recovery, GDPR account deletion — from v1.

Maintainer actions (curate, takedown) go through a separate admin path gated by a
static allowlist of maintainer public keys. Same signing scheme, different table.

---

## 9. Storage and data model

### 9.1 R2 layout

```
tambre-artifacts/
  pkg/<scope>/<name>/<version>/package.tgz          # immutable
  pkg/<scope>/<name>/<version>/tambre.json           # extracted, for fast reads
  prev/<scope>/<name>/<version>/<sound>.opus        # audio-kind previews only
  prev/<scope>/<name>/<version>/<sound>.peaks.json  # waveform peaks, all sounds
  index/snapshot-<iso8601>.jsonl.gz                 # nightly export
```

`Cache-Control: public, max-age=31536000, immutable` on everything under `pkg/`
and `prev/`. Never overwrite a key; a failed publish leaves orphans in
`tambre-staging` that a cron sweeps after 24 h.

**Preview cost note:** `sdsl` packs render client-side in the browser, so they
need no audio in R2 at all — only the small `peaks.json` for waveform display.
Only `audio`-kind sounds get an Opus preview. This keeps storage close to zero
for the majority of packs and is a real argument for DSL-first authoring.

### 9.2 Postgres schema (essentials)

```sql
create table scopes (
  handle          text primary key,
  public_key      bytea not null,
  fingerprint     text unique not null,
  trust           text not null default 'unverified',   -- unverified|attested|curated
  attestation     jsonb,
  created_at      timestamptz not null default now()
);

create table packages (
  id              bigserial primary key,
  scope           text not null references scopes(handle),
  name            text not null,
  latest_version  text,
  approach        text not null,
  tags            text[] not null default '{}',
  install_count   bigint not null default 0,
  play_count      bigint not null default 0,
  deprecated      text,
  search          tsvector generated always as (
                    setweight(to_tsvector('english', coalesce(name,'')), 'A') ||
                    setweight(to_tsvector('english', coalesce(array_to_string(tags,' '),'')), 'B')
                  ) stored,
  created_at      timestamptz not null default now(),
  unique (scope, name)
);

create table versions (
  id              bigserial primary key,
  package_id      bigint not null references packages(id),
  version         text not null,
  manifest        jsonb not null,
  tarball_sha256  text not null,
  tarball_bytes   int not null,
  coverage        jsonb not null,     -- {"claude-code":16,"codex":13,"cursor":12}
  sound_count     int not null,
  yanked_reason   text,
  published_at    timestamptz not null default now(),
  unique (package_id, version)
);

create index on versions using gin (manifest jsonb_path_ops);
create index on packages using gin (search);
```

Counters (`install_count`, `play_count`) are advisory and updated from a
`jobs`-batched aggregate — never in the hot path.

### 9.3 The Git repo

`github.com/tambre-dev/tambre` is the project, not the storage:

```
/spec               this document + JSON Schemas + the sdsl conformance fixtures
/packages/core      shared TS: manifest types, sdsl renderer, canonical events
/packages/cli       the tambre CLI
/adapters/*         one dir per agent: support.json + plan/apply/revert + tests
/apps/web           Next.js app
/apps/api           route handlers (co-located with web on Vercel)
/examples           reference packs, including the 30 that already exist
```

Nightly, export `index/snapshot-*.jsonl.gz` to R2 and mirror it to a
`tambre-dev/index` Git repo — one line per version, with digests. That gives you a
credible "the registry is reconstructible without us" story at negligible cost,
without pretending Git is a database.

---

## 10. Runtime

### 10.1 Layout on the user's machine

```
~/.tambre/
  bin/tambre-play           # the only executable, installed once
  packs/<scope>/<name>/<version>/<event>.wav
  profiles.json            # what is installed, per agent
  keys/                    # publisher keys, 0600
```

Packs are pre-rendered to WAV at install time. Nothing is synthesised at play
time — that would add latency and a runtime dependency for no benefit.

### 10.2 Player

One script, ~30 lines, already proven. Resolves a player in order
`afplay → paplay → aplay → ffplay → sox`, spawns detached, exits 0 unconditionally.
Windows gets a `.ps1` sibling using `System.Media.SoundPlayer`. If no player is
found it exits 0 silently — **never** print to stderr, since Codex and Cursor
surface hook stderr to the user.

### 10.3 Gain staging and throttling

The single biggest determinant of whether this is pleasant or maddening. Bake the
policy into the runtime so pack authors can't get it catastrophically wrong:

- Default gain by role: `boundary` 1.0, `cue` 0.9, `churn` 0.2.
- Default throttle by role: `churn` 120 ms, everything else 0.
- `polyphony` cap (default 6) — drop the oldest if exceeded.
- Publish-time lint (`tambre lint`) **warns** when a `churn` binding is within
  6 dB of a `boundary` binding in the same pack. Warn, don't block; the `bed`
  approach deliberately flattens dynamics.

---

## 11. CLI

```
tambre search <query> [--approach] [--agent] [--tag]
tambre info @scope/name[@version]
tambre preview @scope/name [--event turn.end]   # renders + plays locally
tambre install @scope/name[@version] [--agent claude-code|codex|cursor|all]
                                    [--scope user|project] [--volume 0.8]
tambre uninstall [--agent …]
tambre list                                     # what's installed where
tambre doctor                                   # diagnose: trust, overlap, no player

tambre init                                     # scaffold a pack
tambre lint [path]
tambre render [path] --out ./wav
tambre key new | tambre key backup | tambre key show
tambre scope claim @handle                      # runs the PoW
tambre scope attest @handle --github <user>     # or --domain
tambre publish [path] [--tag next]
tambre yank @scope/name@version --reason "…"
```

`install --agent all` is the common case and should be the thing the docs lead
with. It must print a per-agent result table including anything it could not do
automatically (Codex trust, above).

Ship as a single npm package with a `bin`, plus a `curl | sh` installer that
fetches a prebuilt binary. Agents will mostly invoke `npx tambre …`.

---

## 12. Web app

Read-only, minimalist, Pinterest-shaped. Four routes.

**`/` — the feed.** Masonry grid of pack cards. Each card: pack name, scope,
approach chip, per-agent coverage, and a **waveform strip** rendered from
`peaks.json`. Hover (desktop) or tap (mobile) plays the pack's `turn.end` sound
immediately — `sdsl` renders in a Web Audio worklet, `audio` streams the Opus.
No autoplay, no sound until a gesture. Infinite scroll. Filter rail: approach,
agent, tag, trust tier. Sort: newest, most installed, most played.

**`/@scope/name` — the pack page.** Full sound table with per-event play buttons
and waveforms, the binding map, per-agent coverage detail, README, version
history, and a copy-ready install command. This is essentially the artifact
already built for the Claude packs — reuse its layout and its renderer wholesale.

**`/@scope` — the publisher page.** Their packs. That's the collection view.

**`/docs`** — the spec, the DSL reference, adapter notes, publishing guide.

Design constraints: system font stack, one accent colour, no shadows deeper than
2 px, no gradients, generous whitespace, waveforms as the only ornament. Light
mode primary. The sound is the product; the UI should get out of its way.

Performance: the feed must be usable on a cold cache in under 1 s. Serve card
data from an edge-cached JSON endpoint, lazy-load peaks, and never block first
paint on audio.

---

## 13. Moderation and abuse

- **Automated at publish:** schema validation, tarball safety, audio decode
  check, manifest/asset digest match, rate limits, PoW on scope claim.
- **Reactive:** a `POST /api/v1/reports` endpoint (unauthenticated, rate-limited)
  and a maintainer queue. Grounds for takedown: copyright, malicious loudness
  (a version whose peak exceeds -1 dBFS after the limiter — auto-flag), scope
  impersonation, illegal content.
- **Yank ≠ delete.** Yanked versions stop resolving for new installs but existing
  lockfiles keep working. Full deletion only for legal necessity, and it leaves a
  tombstone.
- **Loudness is a safety issue here**, not an aesthetic one — people wear
  headphones. The soft-knee limiter in the render chain is mandatory and
  server-verified: reject any published `audio` asset whose true peak exceeds
  -1 dBFS.

---

## 14. Milestones

| # | Deliverable | Done when |
| --- | --- | --- |
| **M0** | Spec + JSON Schema + sdsl conformance fixtures | 20 reference sounds hash-match across two independent renderers |
| **M1** | `core` + CLI: init, lint, render, preview, install for Claude Code | The 30 existing packs install and uninstall cleanly, round-trip verified |
| **M2** | Registry read path | Publish by hand into R2/Postgres; `tambre install @scope/name` resolves from the network |
| **M3** | Publish path + agent auth | Keypair, PoW scope claim, signed publish, immutability enforced |
| **M4** | Web feed + pack page | Browse, filter, hover-to-play, copy install command |
| **M5** | Codex + Cursor adapters | Coverage matrix live; `install --agent all`; `doctor` detects Codex trust and Claude/Cursor overlap |
| **M6** | Trust tiers, attestation, reports, index export | Attestation via GitHub gist and DNS TXT both work end to end |

M1 is shippable on its own as a CLI with a bundled pack set — do that first and
get it in front of people before building the registry.

---

## 15. Open questions

1. **Does the throttle belong in the pack or the profile?** Spec'd as both
   (pack default, user override). If that proves confusing, the pack should win
   and the user override should be a single global "quiet mode".
2. **Semver ranges on install.** v1 pins exact versions in `profiles.json`.
   Adding `^` ranges means re-rendering WAVs on update — probably worth it later,
   definitely not now.
3. **Should `file.edit` stay canonical?** Only Cursor fires it. Keeping it costs
   nothing and it's the most-requested "I want to hear the agent typing" event.
4. **Attestation via DNS TXT for agents without a GitHub account** — is this
   actually reachable for a headless agent, or does it always imply a human with
   registrar access? May need a third method.
5. **Claude Code's rarer hook names** (`StopFailure`, `PermissionDenied`,
   `SubagentStart`, `PostCompact`) need first-party confirmation before M5. They
   are in the matrix flagged; verify, don't assume.
