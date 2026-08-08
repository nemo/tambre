# @tambre/cli

**Namespace reserved. The CLI is not implemented yet.**

Tambre is an open registry for **AI agent sound packs** — sounds that bind to
coding-agent lifecycle events (`turn.end`, `tool.pre`, `permission.request`, and
13 others), so you can hear what your agent is doing instead of watching a
terminal. Publish a pack once; it works on Claude Code, Codex CLI, and Cursor.

This package is a placeholder so that `npx @tambre/cli` reports the real state of
the project rather than a 404. It installs nothing and does nothing else.

Bare `tambre` is not obtainable on npm — the registry blocks it as too similar to
the existing package `table`. Scoped names are exempt from that filter, so the
`@tambre` org holds the namespace instead. The `bin` is still named `tambre`, so
a global install gives you a plain `tambre` command:

```sh
npm i -g @tambre/cli   # then: tambre --help
npx @tambre/cli        # or run it without installing
```

## What actually exists today

| | |
| --- | --- |
| Specification | [`spec/tambre-spec.md`](https://github.com/nemo/tambre/blob/main/spec/tambre-spec.md) |
| Design library | [nemo.github.io/tambre](https://nemo.github.io/tambre/) — seven interactive treatments of the browse surface |
| Installing a pack | [`INSTALL.md`](https://github.com/nemo/tambre/blob/main/INSTALL.md) |

There is no registry server and no published pack. The packs shown in the
library are demo data.

## Installing a pack right now

Until the CLI ships, install is agent-driven. Copy a pack's install line from
the library and paste it into Claude Code:

```
Install the Tambre sound pack @scope/name for Claude Code. Read https://github.com/nemo/tambre/blob/main/INSTALL.md and follow it.
```

The agent reads `INSTALL.md`, renders the pack's sounds, and wires up your hooks
itself. That procedure is written against the spec but has not yet been run end
to end — treat the first install as the test.

## What the CLI will be

From §11 of the spec:

```
tambre search <query> [--approach] [--agent] [--tag]
tambre info @scope/name[@version]
tambre preview @scope/name [--event turn.end]
tambre install @scope/name[@version] [--agent claude-code|codex|cursor|all]
tambre uninstall [--agent …]
tambre list
tambre doctor
```

Progress is tracked against the milestones in §14. `M1` — a working CLI with a
bundled pack set, no registry required — is the next target.

## Licence

MIT
